const imageGenerator = require('../services/imageGenerator');
const logger = require('../utils/logger');
const notificationService = require('../services/notificationService');

class HelpCommand {
    async handle(context) {
        const { ws, groupId, userId, rawMessage } = context;

        // Command: /菜单
        if (rawMessage.trim() === '/菜单' || rawMessage.trim() === '/帮助' || rawMessage.trim() === '/help') {
            try {
                const base64Image = await imageGenerator.generateHelpCard('user', groupId);
                this.sendGroupMessage(ws, groupId, [{ type: 'image', data: { file: `base64://${base64Image}` } }]);
            } catch (e) {
                logger.error('[HelpCommand] Error generating help card:', e);
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: 'Help menu generation failed.' } }]);
            }
            return true;
        }

        return false;
    }

    sendGroupMessage(ws, groupId, messageChain, userId = null) {
        if (typeof groupId === 'string' && groupId.startsWith('private_')) {
            const realUserId = groupId.replace('private_', '');
            notificationService.sendPrivateMessage(ws, realUserId, messageChain, 'HelpCommand', true);
            return;
        }

        if (groupId) {
            notificationService.sendGroupMessage(ws, groupId, messageChain, 'HelpCommand', true);
        } else if (userId) {
            notificationService.sendPrivateMessage(ws, userId, messageChain, 'HelpCommand', true);
        } else {
            logger.warn('[HelpCommand] Cannot send message: no groupId or userId provided');
        }
    }
}

module.exports = new HelpCommand();
