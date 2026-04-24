const WebSocket = require('ws');
const config = require('./config');
const logger = require('./utils/logger');
const messageHandler = require('./handlers/messageHandler');
const subscriptionService = require('./services/subscriptionService');
const imageGenerator = require('./services/imageGenerator');
const ServiceManager = require('./services/ServiceManager');
const updateChecker = require('./services/subscription/updateChecker');
const dashboardServer = require('./dashboard/server');
const requestApprovalService = require('./services/requestApprovalService');
const { warmupEmojiIndexProvider } = require('./services/imageGenerator/renderers/components/emojiIndexProvider');

global.bot = global.bot || { groupList: new Map(), selfId: '0' };

warmupEmojiIndexProvider();

let ws = null;
let reconnectCount = 0;
let reconnectTimer = null;
let isManualClose = false;
const MAX_RECONNECT_DELAY = 60000;
const GROUP_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const GROUP_LIST_ECHO_PREFIX = 'get_group_list#';
let groupRefreshTimer = null;
let initialSyncDone = false;
let processHandlersRegistered = false;

const WS_OPEN = WebSocket.OPEN ?? 1;
const WS_CONNECTING = WebSocket.CONNECTING ?? 0;
const LIFECYCLE_SCOPE = logger.createScope('svc', 'lifecycle');

function botLog(level, message, fields = {}, scope = LIFECYCLE_SCOPE) {
    logger.logEvent(level, 'BOT', scope, message, fields);
}

function clearReconnectTimer() {
    if (!reconnectTimer) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
}

function clearGroupRefreshTimer() {
    if (!groupRefreshTimer) return;
    clearInterval(groupRefreshTimer);
    groupRefreshTimer = null;
}

function getMessageScope(payload) {
    const messageType = String(payload?.message_type || 'group');
    const userId = payload?.user_id != null ? String(payload.user_id) : 'unknown';
    const groupId = messageType === 'private'
        ? `private_${userId}`
        : (payload?.group_id != null ? String(payload.group_id) : 'unknown');
    const messageId = payload?.message_id != null ? String(payload.message_id) : Date.now();
    return logger.createMessageScope(groupId, userId, messageId);
}

function requestGroupList() {
    if (!ws || ws.readyState !== WS_OPEN) return;
    const echo = `${GROUP_LIST_ECHO_PREFIX}${Date.now()}`;
    const payload = { action: 'get_group_list', params: {}, echo };
    try {
        ws.send(JSON.stringify(payload));
    } catch (e) {
        botLog('error', 'group-list-request-failed', {
            error: logger.getErrorMessage(e)
        });
    }
}

function migrateGroupConfigs() {
    const groupConfigs = config.groupConfigs || {};
    let migrated = 0;

    for (const groupId in groupConfigs) {
        if (groupConfigs[groupId].isInGroup === undefined) {
            groupConfigs[groupId].isInGroup = true;
            migrated++;
        }
    }

    if (migrated > 0) {
        botLog('info', 'config-migrated', {
            count: migrated
        });
        config.save();
    }
}

function syncGroupStates() {
    if (!global.bot || !global.bot.groupList) {
        botLog('warn', 'group-sync-skipped', {
            reason: 'group_list_unavailable'
        });
        return;
    }

    const groupList = global.bot.groupList;
    const groupConfigs = config.groupConfigs || {};
    let leftCount = 0;
    let rejoinedCount = 0;

    for (const configGroupId in groupConfigs) {
        if (!groupList.has(configGroupId) && groupConfigs[configGroupId].isInGroup !== false) {
            groupConfigs[configGroupId].isInGroup = false;
            leftCount++;
            botLog('warn', 'group-left-detected', {
                groupId: configGroupId
            });
        }
    }

    for (const groupId of groupList.keys()) {
        if (groupConfigs[groupId] && groupConfigs[groupId].isInGroup === false) {
            groupConfigs[groupId].isInGroup = true;
            rejoinedCount++;
            const groupInfo = groupList.get(groupId);
            botLog('info', 'group-rejoined', {
                groupId,
                groupName: groupInfo?.group_name || groupId
            });
        }
    }

    if (leftCount > 0 || rejoinedCount > 0) {
        botLog('info', 'group-sync-complete', {
            leftCount,
            rejoinedCount
        });
        config.save();
    }

    initialSyncDone = true;
}

function createWebSocketConnection() {
    if (ws) {
        try {
            ws.removeAllListeners();
            if (ws.readyState === WS_OPEN || ws.readyState === WS_CONNECTING) {
                ws.close();
            }
        } catch (e) {
            botLog('error', 'ws-close-old-failed', {
                error: logger.getErrorMessage(e)
            });
        }
    }

    botLog('info', 'connect-attempt', {
        attempt: reconnectCount + 1,
        wsUrl: config.wsUrl
    });
    ws = new WebSocket(`${config.wsUrl}?access_token=${config.wsToken}`);
    global.bot.ws = ws;

    ws.on('open', function open() {
        botLog('info', 'connected', {
            wsUrl: config.wsUrl
        });
        reconnectCount = 0;

        subscriptionService.start(ws);

        const videoDownloadService = require('./services/videoDownloadService');
        videoDownloadService.startCleanupScheduler();

        ws.send(JSON.stringify({ action: 'get_login_info', params: {}, echo: 'init_self_id' }));

        requestGroupList();
        clearGroupRefreshTimer();
        groupRefreshTimer = setInterval(requestGroupList, GROUP_REFRESH_INTERVAL_MS);
    });

    ws.on('message', function incoming(data) {
        try {
            const payload = JSON.parse(data);

            if (payload && payload.echo === 'init_self_id' && payload.data && payload.data.user_id) {
                global.bot.selfId = String(payload.data.user_id);
                if (payload.data.nickname) {
                    global.bot.nickname = String(payload.data.nickname);
                }
                botLog('info', 'self-id-ready', {
                    selfId: global.bot.selfId,
                    nickname: global.bot.nickname || ''
                });
            }

            if (payload && payload.echo && String(payload.echo).startsWith(GROUP_LIST_ECHO_PREFIX)) {
                const list = Array.isArray(payload.data) ? payload.data : [];
                const newMap = new Map();
                for (const g of list) {
                    const gid = g && g.group_id !== undefined ? String(g.group_id) : null;
                    if (gid) {
                        newMap.set(gid, g);
                    }
                }
                global.bot = global.bot || {};
                global.bot.groupList = newMap;

                if (!initialSyncDone) {
                    migrateGroupConfigs();
                    syncGroupStates();
                }
            }

            if (payload.post_type === 'meta_event') return;

            if (payload.post_type === 'message') {
                const scope = getMessageScope(payload);
                payload.traceContext = { scope, receivedLogged: true };
                const resolvedGroupId = payload.message_type === 'private'
                    ? `private_${payload.user_id != null ? String(payload.user_id) : 'unknown'}`
                    : (payload.group_id != null ? String(payload.group_id) : '');

                botLog('info', 'recv', {
                    groupId: resolvedGroupId,
                    userId: payload.user_id != null ? String(payload.user_id) : '',
                    messageType: payload.message_type
                }, scope);

                if (payload.self_id && global.bot.selfId === '0') {
                    global.bot.selfId = String(payload.self_id);
                    botLog('info', 'self-id-stored', {
                        selfId: global.bot.selfId
                    }, scope);
                }

                messageHandler.handleMessage(ws, payload);
                return;
            }

            if (payload.post_type === 'request') {
                requestApprovalService.handleRequestEvent(ws, payload);
                return;
            }

            if (payload.post_type === 'notice' && payload.notice_type === 'group_increase') {
                const groupId = String(payload.group_id);
                const userId = String(payload.user_id);
                const selfId = String(payload.self_id);

                if (userId === selfId) {
                    config.ensureGroupConfig(groupId);

                    if (config.groupConfigs[groupId] && config.groupConfigs[groupId].isInGroup === false) {
                        config.groupConfigs[groupId].isInGroup = true;
                        const groupInfo = global.bot?.groupList?.get(groupId);
                        botLog('info', 'group-rejoined', {
                            groupId,
                            groupName: groupInfo?.group_name || groupId
                        });
                        config.save();
                    }
                }

                messageHandler.handleGroupIncrease(ws, payload);
                requestGroupList();
                return;
            }

            if (payload.post_type === 'notice' && payload.notice_type === 'group_decrease') {
                const groupId = String(payload.group_id);
                const userId = String(payload.user_id);
                const selfId = String(payload.self_id);
                const subType = payload.sub_type;

                if (userId === selfId || subType === 'kick_me') {
                    if (config.groupConfigs && config.groupConfigs[groupId]) {
                        config.groupConfigs[groupId].isInGroup = false;
                        const groupInfo = global.bot?.groupList?.get(groupId);
                        botLog('warn', 'group-left', {
                            groupId,
                            groupName: groupInfo?.group_name || groupId,
                            action: subType === 'kick_me' ? 'kicked' : 'left'
                        });
                        config.save();
                    }

                    requestGroupList();
                }
            }
        } catch (e) {
            botLog('error', 'payload-process-failed', {
                error: logger.getErrorMessage(e),
                stack: e.stack || ''
            });
        }
    });

    ws.on('close', function close(code, reason) {
        botLog('warn', 'disconnected', {
            code,
            reason: reason ? String(reason) : 'N/A'
        });

        if (global.bot.ws === ws) global.bot.ws = null;

        subscriptionService.stop();
        clearGroupRefreshTimer();

        if (!isManualClose) {
            scheduleReconnect();
        }
    });

    ws.on('error', function error(err) {
        botLog('error', 'ws-error', {
            error: logger.getErrorMessage(err)
        });
    });

    return ws;
}

function scheduleReconnect() {
    clearReconnectTimer();
    reconnectCount++;

    const baseDelay = 1000;
    const exponentialDelay = baseDelay * Math.pow(2, reconnectCount - 1);
    const delay = Math.min(exponentialDelay, MAX_RECONNECT_DELAY);

    botLog('info', 'reconnect-scheduled', {
        delayMs: delay,
        attempt: reconnectCount,
        backoff: reconnectCount - 1
    });

    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        createWebSocketConnection();
    }, delay);
}

async function gracefulShutdown(exitCode = 0) {
    botLog('info', 'shutdown-start', {
        exitCode
    });
    isManualClose = true;

    clearReconnectTimer();
    clearGroupRefreshTimer();

    try {
        await imageGenerator.cleanup();
    } catch (e) {
        botLog('error', 'image-cleanup-failed', {
            error: logger.getErrorMessage(e)
        });
    }

    if (ws) {
        try {
            ws.close();
        } catch (e) {
            botLog('error', 'ws-close-failed', {
                error: logger.getErrorMessage(e)
            });
        }
    }

    try {
        dashboardServer.stop();
    } catch (e) {
        botLog('error', 'dashboard-stop-failed', {
            error: logger.getErrorMessage(e)
        });
    }

    botLog('info', 'shutdown-complete', {
        exitCode
    });
    process.exit(exitCode);
}

async function initializeBot() {
    try {
        botLog('info', 'startup', {
            phase: 'begin'
        });

        await ServiceManager.start();
        botLog('info', 'startup-step', {
            step: 'python-service-manager'
        });

        ServiceManager.onCriticalError = (message) => {
            updateChecker.notifyAdmin(message);
        };

        await dashboardServer.start(config.dashboardPort);
        botLog('info', 'startup-step', {
            step: 'dashboard-server',
            port: config.dashboardPort
        });

        createWebSocketConnection();
        botLog('info', 'startup-step', {
            step: 'napcat-websocket'
        });

        botLog('info', 'startup', {
            phase: 'ready'
        });
    } catch (error) {
        botLog('error', 'startup-failed', {
            error: logger.getErrorMessage(error),
            stack: error.stack || ''
        });

        try {
            await gracefulShutdown(1);
        } catch (cleanupError) {
            botLog('error', 'cleanup-failed', {
                error: logger.getErrorMessage(cleanupError)
            });
        }

        process.exit(1);
    }
}

function registerProcessHandlers() {
    if (processHandlersRegistered) return;
    processHandlersRegistered = true;

    process.on('SIGINT', () => gracefulShutdown(0));
    process.on('SIGTERM', () => gracefulShutdown(0));

    process.on('unhandledRejection', (reason) => {
        botLog('error', 'unhandled-rejection', {
            error: logger.getErrorMessage(reason),
            stack: reason instanceof Error ? reason.stack || '' : ''
        });
    });

    process.on('uncaughtException', (error) => {
        botLog('error', 'uncaught-exception', {
            error: logger.getErrorMessage(error),
            stack: error?.stack || ''
        });
        process.exit(1);
    });
}

async function startBot() {
    registerProcessHandlers();
    await initializeBot();
}

if (require.main === module) {
    startBot().catch((err) => {
        botLog('error', 'startup-unhandled', {
            error: logger.getErrorMessage(err),
            stack: err?.stack || ''
        });
        process.exit(1);
    });
}

module.exports = {
    initializeBot,
    createWebSocketConnection,
    scheduleReconnect,
    gracefulShutdown,
    registerProcessHandlers,
    startBot,
    __testHooks: {
        clearReconnectTimer,
        clearGroupRefreshTimer,
        resetRuntimeState() {
            ws = null;
            reconnectCount = 0;
            reconnectTimer = null;
            isManualClose = false;
            groupRefreshTimer = null;
            initialSyncDone = false;
        }
    }
};
