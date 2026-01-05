const WebSocket = require('ws');
const config = require('./config');
const logger = require('./utils/logger');
const messageHandler = require('./handlers/messageHandler');
const subscriptionService = require('./services/subscriptionService');

const ws = new WebSocket(config.wsUrl);

ws.on('open', function open() {
    logger.info('Connected to NapCat WebSocket');
    subscriptionService.setWs(ws);
    subscriptionService.start();
});

ws.on('message', function incoming(data) {
    try {
        const payload = JSON.parse(data);
        
        // Handle Heartbeat or meta events (ignore for now)
        if (payload.post_type === 'meta_event') return;

        // Handle Messages
        if (payload.post_type === 'message' && payload.message_type === 'group') {
            logger.info(`Received group message from ${payload.user_id} in ${payload.group_id}`);
            messageHandler.handleMessage(ws, payload);
        }

    } catch (e) {
        logger.error('Error processing message:', e);
    }
});

ws.on('close', function close() {
    logger.warn('Disconnected from NapCat');
    // Implement reconnection logic here if needed
});

ws.on('error', function error(err) {
    logger.error('WebSocket Error:', err);
});
