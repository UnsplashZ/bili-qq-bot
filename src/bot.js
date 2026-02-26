const WebSocket = require('ws');
const config = require('./config');
const logger = require('./utils/logger');
const messageHandler = require('./handlers/messageHandler');
const subscriptionService = require('./services/subscriptionService');
const imageGenerator = require('./services/imageGenerator');
const mcpManager = require('./services/mcpManager');
const ServiceManager = require('./services/ServiceManager');
const updateChecker = require('./services/subscription/updateChecker');
const dashboardServer = require('./dashboard/server');

global.bot = global.bot || { groupList: new Map(), selfId: '0' };

// WebSocket连接管理
let ws = null;
let reconnectCount = 0;
let reconnectTimer = null;
let isManualClose = false;
// 🆕 移除固定重连间隔，改用指数退避
// const RECONNECT_INTERVAL = 5000; // 5秒重连间隔
const MAX_RECONNECT_DELAY = 60000; // 最大重连延迟60秒
const GROUP_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const GROUP_LIST_ECHO_PREFIX = 'get_group_list#';
let groupRefreshTimer = null;
let initialSyncDone = false; // 标记是否已完成初始状态同步

function requestGroupList() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const echo = `${GROUP_LIST_ECHO_PREFIX}${Date.now()}`;
    const payload = { action: 'get_group_list', params: {}, echo };
    try {
        ws.send(JSON.stringify(payload));
    } catch (e) {
        logger.error('Failed to request group list:', e);
    }
}

// 配置迁移：为缺少 isInGroup 字段的配置设置默认值
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
        logger.info(`[Bot] Migrated ${migrated} group configs with default isInGroup=true`);
        config.save();
    }
}

// 同步群组状态：对比 groupList 与 groupConfigs
function syncGroupStates() {
    if (!global.bot || !global.bot.groupList) {
        logger.warn('[Bot] Cannot sync group states: groupList not available');
        return;
    }

    const groupList = global.bot.groupList;
    const groupConfigs = config.groupConfigs || {};
    let leftCount = 0;
    let rejoinedCount = 0;

    // 1. 标记已退出的群
    for (const configGroupId in groupConfigs) {
        if (!groupList.has(configGroupId)) {
            if (groupConfigs[configGroupId].isInGroup !== false) {
                groupConfigs[configGroupId].isInGroup = false;
                leftCount++;
                logger.warn(`[Bot] Group ${configGroupId} not in list, marked as left`);
            }
        }
    }

    // 2. 恢复重新加入的群
    for (const groupId of groupList.keys()) {
        if (groupConfigs[groupId] && groupConfigs[groupId].isInGroup === false) {
            groupConfigs[groupId].isInGroup = true;
            rejoinedCount++;
            const groupInfo = groupList.get(groupId);
            const groupName = groupInfo?.group_name || groupId;
            logger.info(`[Bot] Group ${groupId} (${groupName}) rejoined, config restored`);
        }
    }

    if (leftCount > 0 || rejoinedCount > 0) {
        logger.info(`[Bot] Synced group states: ${leftCount} left, ${rejoinedCount} rejoined`);
        config.save();
    }

    initialSyncDone = true;
}

function createWebSocketConnection() {
    // 清除可能存在的旧连接
    if (ws) {
        try {
            ws.removeAllListeners();
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                ws.close();
            }
        } catch (e) {
            logger.error('Error closing old WebSocket:', e);
        }
    }

    logger.info(`Attempting to connect to NapCat WebSocket (attempt ${reconnectCount + 1})...`);
    ws = new WebSocket(`${config.wsUrl}?access_token=${config.wsToken}`);
    global.bot.ws = ws  // 暴露当前活跃连接供异步任务使用

    ws.on('open', function open() {
        logger.info('Connected to NapCat WebSocket');
        reconnectCount = 0; // 重置重连计数

        // 设置WebSocket并启动订阅服务
        // subscriptionService.setWs(ws); // 已移除，ws 在 start 中传入
        subscriptionService.start(ws);

        const videoDownloadService = require('./services/videoDownloadService')
        videoDownloadService.startCleanupScheduler()

        // 主动获取 selfId（供视频下载转发消息使用）
        ws.send(JSON.stringify({ action: 'get_login_info', params: {}, echo: 'init_self_id' }))

        requestGroupList();
        if (groupRefreshTimer) {
            clearInterval(groupRefreshTimer);
            groupRefreshTimer = null;
        }
        groupRefreshTimer = setInterval(requestGroupList, GROUP_REFRESH_INTERVAL_MS);
    });

    ws.on('message', function incoming(data) {
        try {
            const payload = JSON.parse(data);

            if (payload && payload.echo === 'init_self_id' && payload.data && payload.data.user_id) {
                global.bot.selfId = String(payload.data.user_id)
                logger.info(`[Bot] selfId initialized from login_info: ${global.bot.selfId}`)
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

                // 首次获取群列表后，进行配置迁移和状态同步
                if (!initialSyncDone) {
                    migrateGroupConfigs();
                    syncGroupStates();
                }
            }

            // Handle Heartbeat or meta events (ignore for now)
            if (payload.post_type === 'meta_event') return;

            // Handle Messages
            if (payload.post_type === 'message') {
                if (payload.message_type === 'group') {
                    logger.info(`Received group message from ${payload.user_id} in ${payload.group_id}`);
                    // 存储 selfId 供视频下载转发消息使用
                    if (payload.self_id && global.bot.selfId === '0') {
                        global.bot.selfId = String(payload.self_id)
                        logger.info(`[Bot] Stored selfId: ${global.bot.selfId}`)
                    }
                    messageHandler.handleMessage(ws, payload);
                } else if (payload.message_type === 'private') {
                    logger.info(`Received private message from ${payload.user_id}`);
                    messageHandler.handleMessage(ws, payload);
                }
            }

            // Handle Notices (e.g. Bot join/leave group)
            if (payload.post_type === 'notice' && payload.notice_type === 'group_increase') {
                const groupId = String(payload.group_id);
                const userId = String(payload.user_id);
                const selfId = String(payload.self_id);

                // 如果是 bot 自己加入群组
                if (userId === selfId) {
                    // 确保配置存在
                    config.ensureGroupConfig(groupId);

                    // 如果是重新加入已有配置的群，恢复状态
                    if (config.groupConfigs[groupId] && config.groupConfigs[groupId].isInGroup === false) {
                        config.groupConfigs[groupId].isInGroup = true;
                        const groupInfo = global.bot?.groupList?.get(groupId);
                        const groupName = groupInfo?.group_name || groupId;
                        logger.info(`[Bot] Rejoined group ${groupId} (${groupName}), config restored`);
                        config.save();
                    }
                }

                messageHandler.handleGroupIncrease(ws, payload);
                requestGroupList();
            }

            // Handle Bot leaving/kicked from group
            if (payload.post_type === 'notice' && payload.notice_type === 'group_decrease') {
                const groupId = String(payload.group_id);
                const userId = String(payload.user_id);
                const selfId = String(payload.self_id);
                const subType = payload.sub_type; // 'leave' or 'kick' or 'kick_me'

                // 如果是 bot 自己退出群组
                if (userId === selfId || subType === 'kick_me') {
                    // 标记配置为已退群
                    if (config.groupConfigs && config.groupConfigs[groupId]) {
                        config.groupConfigs[groupId].isInGroup = false;
                        const groupInfo = global.bot?.groupList?.get(groupId);
                        const groupName = groupInfo?.group_name || groupId;
                        const action = subType === 'kick_me' ? 'kicked from' : 'left';
                        logger.warn(`[Bot] Bot ${action} group ${groupId} (${groupName}), marked as isInGroup=false`);
                        config.save();
                    }

                    // 刷新群列表
                    requestGroupList();
                }
            }

        } catch (e) {
            logger.error('Error processing message:', e);
        }
    });

    ws.on('close', function close(code, reason) {
        logger.warn(`Disconnected from NapCat (Code: ${code}, Reason: ${reason || 'N/A'})`);

        // 清除全局 ws 引用（仅清空当前实例，避免误清新连接）
        if (global.bot.ws === ws) global.bot.ws = null

        // 清除WebSocket引用，停止订阅检查
        // subscriptionService.setWs(null); // setWs method no longer exists in Facade
        subscriptionService.stop();
        if (groupRefreshTimer) {
            clearInterval(groupRefreshTimer);
            groupRefreshTimer = null;
        }

        // 如果不是手动关闭，则尝试重连
        if (!isManualClose) {
            scheduleReconnect();
        }
    });

    ws.on('error', function error(err) {
        logger.error('WebSocket Error:', err.message || err);
        // error事件后通常会触发close事件，由close事件处理重连
    });

    return ws;
}

function scheduleReconnect() {
    // 清除可能存在的重连定时器
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    reconnectCount++;

    // 🆕 指数退避策略: 1s → 2s → 4s → 8s → 16s → 32s → 60s (max)
    // 公式: delay = min(1000 * 2^(reconnectCount-1), 60000)
    const baseDelay = 1000; // 1秒基础延迟
    const exponentialDelay = baseDelay * Math.pow(2, reconnectCount - 1);
    const delay = Math.min(exponentialDelay, MAX_RECONNECT_DELAY);

    logger.info(`Scheduling reconnect in ${(delay / 1000).toFixed(1)}s (attempt ${reconnectCount}, backoff ${reconnectCount - 1})...`);

    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        createWebSocketConnection();
    }, delay);
}

// 优雅关闭
async function gracefulShutdown(exitCode = 0) {
    logger.info(`Initiating graceful shutdown with exit code ${exitCode}...`);
    isManualClose = true;

    // 清除重连定时器
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    // 清理 Puppeteer 资源
    try {
        logger.info('Cleaning up Puppeteer resources...');
        await imageGenerator.cleanup();
    } catch (e) {
        logger.error('Error cleaning up Puppeteer:', e);
    }

    try {
        await mcpManager.cleanup();
        logger.info('[Bot] MCP Manager cleaned up');
    } catch (e) {
        logger.error('[Bot] Failed to cleanup MCP Manager:', e);
    }

    // 关闭WebSocket连接
    if (ws) {
        try {
            ws.close();
        } catch (e) {
            logger.error('Error during graceful shutdown:', e);
        }
    }

    try {
        dashboardServer.stop();
    } catch (e) {
        logger.error('Error stopping Dashboard Server:', e);
    }

    logger.info('Shutdown complete');
    process.exit(exitCode);
}

// 监听进程退出信号
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

/**
 * 初始化应用程序
 * @throws {Error} 如果任何关键组件启动失败
 */
async function initializeBot() {
    try {
        logger.info('=================================================');
        logger.info('Starting Bili QQ Bot...');
        logger.info('=================================================');

        // 启动Python服务
        logger.info('[Init] Step 1/4: Starting Python Service Manager...');
        await ServiceManager.start();
        logger.info('[Init] ✓ Python Service Manager started');

        // 注册 Python 服务崩溃回调，反复崩溃时通知 Admin
        ServiceManager.onCriticalError = (message) => {
            updateChecker.notifyAdmin(message);
        };

        // 初始化MCP Manager
        logger.info('[Init] Step 2/4: Initializing MCP Manager...');
        await mcpManager.init();
        logger.info('[Init] ✓ MCP Manager initialized');

        // 启动Dashboard服务器
        logger.info('[Init] Step 3/4: Starting Dashboard Server...');
        await dashboardServer.start(config.dashboardPort);
        logger.info(`[Init] ✓ Dashboard Server started on port ${config.dashboardPort}`);

        // 创建WebSocket连接
        logger.info('[Init] Step 4/4: Connecting to NapCat WebSocket...');
        createWebSocketConnection();
        logger.info('[Init] ✓ WebSocket connection initiated');

        logger.info('=================================================');
        logger.info('Bili QQ Bot initialization completed successfully!');
        logger.info('=================================================');
    } catch (error) {
        logger.error('=================================================');
        logger.error('FATAL: Bot initialization failed!');
        logger.error('=================================================');
        logger.error('[Init] Error:', error.message);
        logger.error('[Init] Stack trace:', error.stack);
        logger.error('[Init] Please check your configuration and try again.');
        logger.error('=================================================');

        // 优雅清理
        try {
            await gracefulShutdown();
        } catch (cleanupError) {
            logger.error('[Init] Cleanup failed:', cleanupError);
        }

        // 退出进程
        process.exit(1);
    }
}

// 启动应用
initializeBot().catch(err => {
    logger.error('[Init] Unhandled promise rejection during initialization:', err);
    process.exit(1);
});

// 全局未处理Promise拒绝处理器
process.on('unhandledRejection', (reason, promise) => {
    logger.error('=================================================');
    logger.error('CRITICAL: Unhandled Promise Rejection!');
    logger.error('=================================================');
    logger.error('Reason:', reason);
    logger.error('Promise:', promise);
    if (reason instanceof Error) {
        logger.error('Stack trace:', reason.stack);
    }
    logger.error('=================================================');
    // 在生产环境中可能想要退出
    // process.exit(1);
});

// 全局未捕获异常处理器
process.on('uncaughtException', (error) => {
    logger.error('=================================================');
    logger.error('CRITICAL: Uncaught Exception!');
    logger.error('=================================================');
    logger.error('Error:', error.message);
    logger.error('Stack trace:', error.stack);
    logger.error('=================================================');
    process.exit(1);
});
