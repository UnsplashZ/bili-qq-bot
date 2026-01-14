const subscriptionCommand = require('./subscription');
const aiCommand = require('./ai');
const settingsCommand = require('./settings');
const adminCommand = require('./admin');
const helpCommand = require('./help');
const logger = require('../utils/logger');

class CommandManager {
    constructor() {
        this.commands = [
            subscriptionCommand,
            aiCommand,
            settingsCommand,
            adminCommand,
            helpCommand
        ];
    }

    async dispatch(context) {
        for (const command of this.commands) {
            try {
                const handled = await command.handle(context);
                if (handled) {
                    return true;
                }
            } catch (e) {
                logger.error('[CommandManager] Error handling command:', e);
            }
        }
        return false;
    }
}

module.exports = new CommandManager();
