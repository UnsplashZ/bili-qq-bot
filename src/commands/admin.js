const config = require('../config');
const logger = require('../utils/logger');
const aiHandler = require('../handlers/aiHandler');
const subscriptionService = require('../services/subscriptionService');
const notificationService = require('../services/notificationService');

class AdminCommand {
    async handle(context) {
        const { ws, groupId, userId, rawMessage } = context;

        // 12. 管理 (/管理 <群列表|清理> [群号])
        if (rawMessage.startsWith('/管理 ') || rawMessage.startsWith('/admin ')) {
            if (!config.isRootAdmin(userId)) {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足：此命令仅限全局管理员 (Root) 使用。' } }]);
                return true;
            }
            const parts = rawMessage.trim().split(/\s+/);
            const subCommand = parts[1];

            if (subCommand === '新对话' || subCommand === 'newchat') {
                const targetGid = parts[2] || groupId;
                aiHandler.resetContext(targetGid);
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `已重置群 ${targetGid} 的 AI 对话记忆。` } }]);
                return true;
            } else if (subCommand === '群列表' || subCommand === 'list') {
                 // Gather stats
                 const stats = new Map(); // groupId -> { hasConfig, hasSubs, hasBlacklist }
                 
                 // 1. Check Configs
                 if (config.groupConfigs) {
                     Object.keys(config.groupConfigs).forEach(gid => {
                         const strGid = gid.toString();
                         if (!stats.has(strGid)) stats.set(strGid, { hasConfig: false, hasSubs: false, hasBlacklist: false });
                         const c = config.groupConfigs[gid];
                         if (c) {
                             stats.get(strGid).hasConfig = true;
                             if (c.blacklistedQQs && c.blacklistedQQs.length > 0) {
                                 stats.get(strGid).hasBlacklist = true;
                             }
                         }
                     });
                 }

                 // 2. Check Subscriptions
                 const allSubs = subscriptionService.userSubs.concat(subscriptionService.bangumiSubs || []);
                 allSubs.forEach(sub => {
                     sub.groupIds.forEach(gid => {
                          const strGid = gid.toString();
                          if (!stats.has(strGid)) stats.set(strGid, { hasConfig: false, hasSubs: false, hasBlacklist: false });
                          stats.get(strGid).hasSubs = true;
                     });
                 });

                 let msg = '【Bot群组状态】\n群号 | 订阅 | 配置 | 黑名单\n';
                 stats.forEach((val, key) => {
                     msg += `${key} | ${val.hasSubs?'√':'x'} | ${val.hasConfig?'√':'x'} | ${val.hasBlacklist?'√':'x'}\n`;
                 });
                 
                 if (stats.size === 0) msg += '(无记录)';
                 this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: msg } }]);
                 return true;

            } else if (subCommand === '清理' || subCommand === 'clean') {
                const targetGid = parts[2];
                if (!targetGid) {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '请指定要清理的群号: /管理 清理 <群号>' } }]);
                    return true;
                }
                
                // 1. Remove Config
                let configRemoved = false;
                if (config.groupConfigs && config.groupConfigs[targetGid]) {
                    delete config.groupConfigs[targetGid];
                    config.save();
                    configRemoved = true;
                }

                // 2. Remove Subscriptions
                const subsRemoved = subscriptionService.removeAllGroupSubscriptions(targetGid);

                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `群 ${targetGid} 清理完成。\n配置删除: ${configRemoved?'是':'否'}\n订阅移除: ${subsRemoved?'是':'否'}` } }]);
                return true;
            } else {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '未知指令。可用: /管理 <群列表|清理> [群号]' } }]);
                return true;
            }
        }

        return false;
    }

    sendGroupMessage(ws, groupId, messageChain, userId = null) {
        if (typeof groupId === 'string' && groupId.startsWith('private_')) {
            const realUserId = groupId.replace('private_', '');
            notificationService.sendPrivateMessage(ws, realUserId, messageChain, 'AdminCommand', true);
            return;
        }

        if (groupId) {
            notificationService.sendGroupMessage(ws, groupId, messageChain, 'AdminCommand', true);
        } else if (userId) {
            notificationService.sendPrivateMessage(ws, userId, messageChain, 'AdminCommand', true);
        } else {
            logger.warn('[AdminCommand] Cannot send message: no groupId or userId provided');
        }
    }
}

module.exports = new AdminCommand();
