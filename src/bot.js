const WebSocket = require('ws');
const config = require('./config');
const logger = require('./utils/logger');
const messageHandler = require('./handlers/messageHandler');
const subscriptionService = require('./services/subscriptionService');
const imageGenerator = require('./services/imageGenerator');
const mcpManager = require('./services/mcpManager');
const ServiceManager = require('./services/ServiceManager');
const dashboardServer = require('./dashboard/server');

global.bot = global.bot || { groupList: new Map() };

// WebSocket连接管理
let ws = null;
let reconnectCount = 0;
let reconnectTimer = null;
let isManualClose = false;
const RECONNECT_INTERVAL = 5000; // 5秒重连间隔
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

    ws.on('open', function open() {
        logger.info('Connected to NapCat WebSocket');
        reconnectCount = 0; // 重置重连计数

        // 设置WebSocket并启动订阅服务
        // subscriptionService.setWs(ws); // 已移除，ws 在 start 中传入
        subscriptionService.start(ws);

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
    logger.info(`Scheduling reconnect in ${RECONNECT_INTERVAL / 1000} seconds (attempt ${reconnectCount})...`);

    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        createWebSocketConnection();
    }, RECONNECT_INTERVAL);
}

// 优雅关闭
async function gracefulShutdown() {
    logger.info('Initiating graceful shutdown...');
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
    process.exit(0);
}

// 监听进程退出信号
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// 初始连接
(async () => {
    try {
        logger.info('Starting Service Manager...');
        await ServiceManager.start();
        logger.info('Service Manager started successfully');
    } catch (e) {
        logger.error('Failed to start Service Manager:', e);
    }

    try {
        await mcpManager.init();
    } catch (e) {
        logger.error('Failed to initialize MCP Manager:', e);
    }

    try {
        logger.info('Starting Dashboard Server...');
        await dashboardServer.start(config.dashboardPort);
    } catch (e) {
        logger.error('Failed to start Dashboard Server:', e);
    }

    createWebSocketConnection();
})();
