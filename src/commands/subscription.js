const subscriptionService = require('../services/subscriptionService');
const biliApi = require('../services/biliApi');
const imageGenerator = require('../services/imageGenerator');
const logger = require('../utils/logger');
const config = require('../config');
const notificationService = require('../services/notificationService');
const subscriptionUserMetaCacheService = require('../services/subscriptionUserMetaCacheService');

function commandLog(level, message, fields = {}) {
    logger.logEvent(level, 'BOT', 'cmd:subscription', message, fields);
}

class SubscriptionCommand {
    constructor() {
        this.groupListCmdCd = new Map();
    }

    async handle(context) {
        const { ws, groupId, userId, rawMessage } = context;
        const trimmedMessage = rawMessage.trim();
        const isPrivateGroup = typeof groupId === 'string' && groupId.startsWith('private_');

        if (isPrivateGroup) {
            const isSubscriptionMgmtCommand =
                trimmedMessage === '/订阅列表' ||
                trimmedMessage === '/listsub' ||
                trimmedMessage.startsWith('/订阅用户 ') ||
                trimmedMessage.startsWith('/订阅番剧 ') ||
                trimmedMessage.startsWith('/取消订阅用户 ') ||
                trimmedMessage.startsWith('/取消订阅番剧 ') ||
                trimmedMessage.startsWith('/查询订阅 ') ||
                trimmedMessage.startsWith('/checksub ');

            if (isSubscriptionMgmtCommand) {
                this.sendGroupMessage(ws, groupId, [{
                    type: 'text',
                    data: { text: '私聊仅支持聊天/AI/链接解析/下载，不支持群配置与订阅管理。请在目标群聊或 WebUI 操作。' }
                }]);
                return true;
            }
        }
        
        // Command: /订阅列表
        if (trimmedMessage === '/订阅列表' || trimmedMessage === '/listsub') {
            commandLog('info', 'subscription-list-start', {
                groupId,
                groupIdType: typeof groupId
            });

            const now = Date.now();
            const lastTime = this.groupListCmdCd.get(groupId) || 0;
            if (now - lastTime < 120 * 1000) {
                 this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `指令冷却中，请等待 ${(120 - (now - lastTime) / 1000).toFixed(0)} 秒后再试。` } }]);
                 return true;
            }
            this.groupListCmdCd.set(groupId, now);

            // Notify user about refresh
            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '正在刷新关注列表并生成图片，请稍候...' } }]);

            (async () => {
                let userSubs = [];
                let bangumiSubs = [];
                try {
                    // 1. Refresh Cookie Followings first
                    await subscriptionService.refreshCookieFollowings();

                    // 2. Fetch Subscriptions & Followings
                    let { users: groupUserSubs, bangumis: groupBangumiSubs } = await subscriptionService.getSubscriptionsByGroup(groupId);
                    commandLog('debug', 'subscription-list-loaded', {
                        groupId,
                        userCount: groupUserSubs.length,
                        bangumiCount: groupBangumiSubs.length
                    });

                    if (groupUserSubs.length === 0 && groupBangumiSubs.length === 0) {
                        // Attempt to reload from disk in case memory is stale
                        commandLog('info', 'subscription-list-reload-start', {
                            groupId
                        });
                        try {
                            await subscriptionService.reloadSubscriptions();
                            const res = await subscriptionService.getSubscriptionsByGroup(groupId);
                            groupUserSubs = res.users;
                            groupBangumiSubs = res.bangumis;
                            commandLog('debug', 'subscription-list-reload-finished', {
                                groupId,
                                userCount: groupUserSubs.length,
                                bangumiCount: groupBangumiSubs.length
                            });
                        } catch (e) {
                            commandLog('error', 'subscription-list-reload-failed', {
                                groupId,
                                error: logger.getErrorMessage(e)
                            });
                        }
                    }

                    if (groupUserSubs.length === 0 && groupBangumiSubs.length === 0) {
                        // Debug logging for troubleshooting
                        try {
                            const allUserSubs = subscriptionService.userSubs || [];
                            const allBangumiSubs = subscriptionService.bangumiSubs || [];
                            commandLog('debug', 'subscription-list-debug-summary', {
                                groupId,
                                totalUserSubs: allUserSubs.length,
                                totalBangumiSubs: allBangumiSubs.length
                            });
                            
                            // Check if any sub has this group ID (loose check)
                            const gidStr = String(groupId);
                            const userMatch = allUserSubs.find(s => s.groupIds && s.groupIds.some(id => String(id) === gidStr));
                            if (userMatch) {
                                commandLog('debug', 'subscription-list-debug-user-match', {
                                    groupId,
                                    name: userMatch.name,
                                    groupIds: userMatch.groupIds
                                });
                            } else {
                                commandLog('debug', 'subscription-list-debug-no-match', {
                                    groupId
                                });
                                if (allUserSubs.length > 0) {
                                    commandLog('debug', 'subscription-list-debug-first-user-groups', {
                                        groupId,
                                        firstGroupIds: allUserSubs[0].groupIds,
                                        firstGroupIdTypes: allUserSubs[0].groupIds.map(id => typeof id)
                                    });
                                }
                            }
                        } catch (e) {
                            commandLog('error', 'subscription-list-debug-failed', {
                                groupId,
                                error: logger.getErrorMessage(e)
                            });
                        }
                    }

                    // Get Account Follows (merged view)
                    let followings = [];
                    try {
                         // New method to get followings specific to this group (via mapping)
                         followings = await subscriptionService.getFollowingsForGroup(groupId) || [];
                    } catch (e) {
                         commandLog('error', 'subscription-followings-fetch-failed', {
                             groupId,
                             error: logger.getErrorMessage(e)
                         });
                    }

                    if (groupUserSubs.length === 0 && groupBangumiSubs.length === 0 && followings.length === 0) {
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '本群暂无订阅，且账户关注列表为空。' } }]);
                        return;
                    }

                    userSubs = groupUserSubs;
                    bangumiSubs = groupBangumiSubs;

                    const detailedUserSubs = await subscriptionUserMetaCacheService.enrichSubscriptions(
                        userSubs,
                        groupId
                    );

                    const data = {
                        users: detailedUserSubs,
                        bangumis: bangumiSubs,
                        accountFollows: followings // Pass account follows
                    };

                    const showId = config.getGroupConfig(groupId, 'showId');

                    const enableSync = config.getGroupConfig(groupId, 'enableCookieSync');
                    let syncGroups = config.getGroupConfig(groupId, 'cookieSyncGroupNames');
                    if (typeof syncGroups === 'string') {
                        syncGroups = syncGroups.split(',').map(item => String(item).trim()).filter(Boolean);
                    } else if (Array.isArray(syncGroups)) {
                        syncGroups = syncGroups.map(item => String(item).trim()).filter(Boolean);
                    } else {
                        syncGroups = [];
                    }

                    if (!enableSync) {
                        data.accountFollows = null; // Explicitly null to indicate disabled
                        data.accountFollowsTitle = '';
                    } else if (syncGroups.length > 0) {
                        // Ensure accountFollows is an array
                        if (!Array.isArray(data.accountFollows)) {
                            commandLog('warn', 'subscription-followings-invalid', {
                                groupId,
                                valueType: typeof data.accountFollows
                            });
                            data.accountFollows = [];
                        }
                        
                        data.accountFollows = data.accountFollows.filter(u => 
                            u.biliGroups && u.biliGroups.some(g => syncGroups.includes(g))
                        );
                        data.accountFollowsTitle = `关注列表 - ${syncGroups.join(' & ')}`;
                    } else {
                        if (!Array.isArray(data.accountFollows)) {
                            commandLog('warn', 'subscription-followings-invalid', {
                                groupId,
                                valueType: typeof data.accountFollows
                            });
                            data.accountFollows = [];
                        }
                        // 空同步分组语义统一为“不按分组过滤”
                        data.accountFollowsTitle = '关注列表 - 全部分组';
                    }

                    if (data.users.length === 0 && data.bangumis.length === 0 && (!data.accountFollows || data.accountFollows.length === 0)) {
                         // Check if accountFollows is null (disabled) or empty array (enabled but empty)
                         const isFollowsEmpty = !data.accountFollows || data.accountFollows.length === 0;
                         // Actually, if it's null, it's "empty" for the purpose of "nothing to show at all".
                         
                         this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '本群暂无订阅' + (enableSync ? '，且符合条件的账户关注为空' : '') + '。' } }]);
                         return;
                    }

                    const base64Image = await imageGenerator.generateSubscriptionList(data, groupId, showId);
                    this.sendGroupMessage(ws, groupId, [{ type: 'image', data: { file: `base64://${base64Image}` } }]);

                } catch (e) {
                    commandLog('error', 'subscription-list-render-failed', {
                        groupId,
                        error: logger.getErrorMessage(e)
                    });
                    // Fallback to text
                    let message = '生成图片失败，显示文本列表：\n';
                    if (userSubs.length) {
                        message += '\n【本群用户订阅】\n';
                        userSubs.forEach((sub, index) => {
                            message += `${index + 1}. ${sub.name} (UID: ${sub.uid})\n`;
                        });
                    }
                    if (bangumiSubs.length) {
                        message += '\n【本群番剧订阅】\n';
                        bangumiSubs.forEach((sub, index) => {
                            message += `${index + 1}. ${sub.title} (SID: ${sub.seasonId})\n`;
                        });
                    }
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: message } }]);
                }
            })().catch(e => {
                commandLog('error', 'subscription-list-handler-failed', {
                    groupId,
                    error: logger.getErrorMessage(e)
                });
            });
            return true;
        }

        // Command: /取消订阅 <uid> <type>
        if (rawMessage.startsWith('/取消订阅用户 ')) {
            if (!config.isGroupAdmin(groupId, userId)) {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足：此命令仅限群管理员使用。' } }]);
                return true;
            }
            const parts = rawMessage.trim().split(/\s+/);
            if (parts.length >= 2) {
                const input = parts[1];
                let uidToRemove = input;

                // Check if input is a number (UID)
                if (!/^\d+$/.test(input)) {
                    // Try to resolve name to UID from current group subscriptions
                    const { users } = await subscriptionService.getSubscriptionsByGroup(groupId);
                    // Try exact match first
                    let userSub = users.find(s => s.name === input);

                    if (!userSub) {
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `未在本群找到用户名为 "${input}" 的订阅。请尝试使用 UID 或检查用户名是否完全正确。` } }]);
                        return true;
                    }
                    uidToRemove = userSub.uid;
                }

                const result = await subscriptionService.removeUserSubscription(uidToRemove, groupId);
                if (result) {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `已取消订阅用户 ${uidToRemove}。` } }]);
                } else {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `未找到用户 ${uidToRemove} 的订阅。` } }]);
                }
            } else {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '使用方法: /取消订阅用户 <uid|用户名>' } }]);
            }
            return true;
        }

        // Command: /订阅 <uid> <type>
        if (rawMessage.startsWith('/订阅用户 ')) {
            if (!config.isGroupAdmin(groupId, userId)) {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足：此命令仅限群管理员使用。' } }]);
                return true;
            }
            const parts = rawMessage.trim().split(/\s+/);
            if (parts.length >= 2) {
                const uid = String(parts[1] || '').trim();
                if (!/^\d+$/.test(uid)) {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '使用方法: /订阅用户 <uid>' } }]);
                    return true;
                }
                (async () => {
                    try {
                        const name = await subscriptionService.addUserSubscription(uid, groupId);
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `成功订阅用户 ${name}（动态+直播）。` } }]);
                    } catch (e) {
                         commandLog('error', 'user-subscribe-failed', {
                             groupId,
                             uid,
                             error: logger.getErrorMessage(e)
                         });
                         this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `订阅失败，请稍后重试。` } }]);
                    }
                })().catch(e => {
                    commandLog('error', 'user-subscribe-handler-failed', {
                        groupId,
                        uid,
                        error: logger.getErrorMessage(e)
                    });
                });
            } else {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '使用方法: /订阅用户 <uid>' } }]);
            }
            return true;
        }

        if (rawMessage.startsWith('/订阅番剧 ')) {
            if (!config.isGroupAdmin(groupId, userId)) {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足：此命令仅限群管理员使用。' } }]);
                return true;
            }
            const parts = rawMessage.trim().split(/\s+/);
            if (parts.length >= 2) {
                const arg = String(parts[1] || '').trim();
                (async () => {
                    try {
                        let seasonId = null;
                        if (/^https?:\/\//i.test(arg)) {
                            const ssMatch = arg.match(/play\/ss(\d+)/);
                            const mdMatch = arg.match(/media\/md(\d+)/);
                            const epMatch = arg.match(/play\/ep(\d+)/);
                            if (ssMatch) {
                                seasonId = ssMatch[1];
                            } else if (mdMatch) {
                                const res = await biliApi.getMediaInfo(mdMatch[1]);
                                if (res.status === 'success') seasonId = res.data?.season_id;
                            } else if (epMatch) {
                                const res = await biliApi.getEpInfo(epMatch[1]);
                                if (res.status === 'success') seasonId = res.data?.season_id;
                            }
                        } else if (/^md\d+$/i.test(arg)) {
                            const mdId = arg.replace(/md/i, '');
                            const res = await biliApi.getMediaInfo(mdId);
                            if (res.status === 'success') seasonId = res.data?.season_id;
                        } else if (/^ep\d+$/i.test(arg)) {
                            const epId = arg.replace(/ep/i, '');
                            const res = await biliApi.getEpInfo(epId);
                            if (res.status === 'success') seasonId = res.data?.season_id;
                        } else if (/^\d+$/.test(arg)) {
                            seasonId = arg;
                        }
                        if (seasonId) {
                            const title = await subscriptionService.addBangumiSubscription(seasonId, groupId);
                            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `成功订阅番剧 ${title} 更新。` } }]);
                        } else {
                            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '使用方法: /订阅番剧 <season_id | md链接 | ep链接 | md123 | ep123>' } }]);
                        }
                    } catch (e) {
                        commandLog('error', 'bangumi-subscribe-parse-failed', {
                            groupId,
                            argument: arg,
                            error: logger.getErrorMessage(e)
                        });
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '订阅失败：无法解析参数，请使用 season_id、md 或 ep 链接。' } }]);
                    }
                })().catch(e => {
                    commandLog('error', 'bangumi-subscribe-handler-failed', {
                        groupId,
                        argument: arg,
                        error: logger.getErrorMessage(e)
                    });
                });
            } else {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '使用方法: /订阅番剧 <season_id | md链接 | ep链接 | md123 | ep123>' } }]);
            }
            return true;
        }

        if (rawMessage.startsWith('/取消订阅番剧 ')) {
            if (!config.isGroupAdmin(groupId, userId)) {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足：此命令仅限群管理员使用。' } }]);
                return true;
            }
            const parts = rawMessage.trim().split(/\s+/);
            if (parts.length >= 2) {
                const seasonId = String(parts[1] || '').trim();
                const result = await subscriptionService.removeBangumiSubscription(seasonId, groupId);
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: result ? `已取消订阅番剧 ${seasonId}。` : `未找到番剧 ${seasonId} 的订阅。` } }]);
            } else {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '使用方法: /取消订阅番剧 <season_id>' } }]);
            }
            return true;
        }

        // Command: /查询订阅 <uid>
        if (rawMessage.startsWith('/查询订阅 ') || rawMessage.startsWith('/checksub ')) {
            if (!config.isGroupAdmin(groupId, userId)) {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足：此命令仅限群管理员使用。' } }]);
                return true;
            }
            const parts = rawMessage.trim().split(/\s+/);
            if (parts.length >= 2) {
                const input = parts[1];
                let uidToCheck = input;

                // Check if input is a number (UID)
                if (!/^\d+$/.test(input)) {
                    // Try to resolve name to UID from current group subscriptions
                    const { users } = await subscriptionService.getSubscriptionsByGroup(groupId);
                    // Try exact match first
                    let userSub = users.find(s => s.name === input);

                    if (!userSub) {
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `未在本群找到用户名为 "${input}" 的订阅。请尝试使用 UID 或检查用户名是否完全正确。` } }]);
                        return true;
                    }
                    uidToCheck = userSub.uid;
                }

                const result = await subscriptionService.checkSubscriptionNow(uidToCheck, groupId);
                if (!result) {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `未找到用户 ${uidToCheck} 的动态订阅，或获取失败。` } }]);
                }
            } else {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '使用方法: /查询订阅 <uid|用户名>' } }]);
            }
            return true;
        }

        return false;
    }

    sendGroupMessage(ws, groupId, messageChain, userId = null) {
        if (typeof groupId === 'string' && groupId.startsWith('private_')) {
            const realUserId = groupId.replace('private_', '');
            notificationService.sendPrivateMessage(ws, realUserId, messageChain, 'SubscriptionCommand', true);
            return;
        }

        if (groupId) {
            notificationService.sendGroupMessage(ws, groupId, messageChain, 'SubscriptionCommand', true);
        } else if (userId) {
            notificationService.sendPrivateMessage(ws, userId, messageChain, 'SubscriptionCommand', true);
        } else {
            commandLog('warn', 'send-skipped', {
                reason: 'missing_target'
            });
        }
    }
}

module.exports = new SubscriptionCommand();
