const WebSocket = require('ws');
const config = require('./config');
const logger = require('./utils/logger');
const messageHandler = require('./handlers/messageHandler');
const subscriptionService = require('./services/subscriptionService');
const imageGenerator = require('./services/imageGenerator');

// WebSocket连接管理
let ws = null;
let reconnectCount = 0;
let reconnectTimer = null;
let isManualClose = false;
const RECONNECT_INTERVAL = 5000; // 5秒重连间隔

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
    ws = new WebSocket(config.wsUrl);

    ws.on('open', function open() {
        logger.info('Connected to NapCat WebSocket');
        reconnectCount = 0; // 重置重连计数

        // 设置WebSocket并启动订阅服务
        subscriptionService.setWs(ws);
        subscriptionService.start();
    });

    ws.on('message', function incoming(data) {
        try {
            const payload = JSON.parse(data);

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

            // Handle Notices (e.g. Bot join group)
            if (payload.post_type === 'notice' && payload.notice_type === 'group_increase') {
                messageHandler.handleGroupIncrease(ws, payload);
            }

        } catch (e) {
            logger.error('Error processing message:', e);
        }
    });

    ws.on('close', function close(code, reason) {
        logger.warn(`Disconnected from NapCat (Code: ${code}, Reason: ${reason || 'N/A'})`);

        // 清除WebSocket引用，停止订阅检查
        subscriptionService.setWs(null);

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

    logger.info('Shutdown complete');
    process.exit(0);
}

// 监听进程退出信号
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// 初始连接
createWebSocketConnection();
