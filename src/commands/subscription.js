const subscriptionService = require('../services/subscriptionService');
const biliApi = require('../services/biliApi');
const imageGenerator = require('../services/imageGenerator');
const logger = require('../utils/logger');
const config = require('../config');
const notificationService = require('../services/notificationService');

class SubscriptionCommand {
    constructor() {
        this.groupListCmdCd = new Map();
    }

    async handle(context) {
        const { ws, groupId, userId, rawMessage } = context;
        
        // Command: /订阅列表
        if (rawMessage.trim() === '/订阅列表' || rawMessage.trim() === '/listsub') {
            logger.info(`[SubscriptionCommand] Processing /订阅列表 for group: ${groupId} (type: ${typeof groupId})`);

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
                    let { users: groupUserSubs, bangumis: groupBangumiSubs } = subscriptionService.getSubscriptionsByGroup(groupId);
                    logger.info(`[SubscriptionCommand] Found ${groupUserSubs.length} users and ${groupBangumiSubs.length} bangumis for group ${groupId}`);
                    
                    if (groupUserSubs.length === 0 && groupBangumiSubs.length === 0) {
                        // Attempt to reload from disk in case memory is stale
                        logger.info('[SubscriptionCommand] No subscriptions found, attempting to reload from disk...');
                        try {
                            subscriptionService.reloadSubscriptions();
                            const res = subscriptionService.getSubscriptionsByGroup(groupId);
                            groupUserSubs = res.users;
                            groupBangumiSubs = res.bangumis;
                            logger.info(`[SubscriptionCommand] After reload: Found ${groupUserSubs.length} users and ${groupBangumiSubs.length} bangumis`);
                        } catch (e) {
                            logger.error('[SubscriptionCommand] Failed to reload subscriptions:', e);
                        }
                    }

                    if (groupUserSubs.length === 0 && groupBangumiSubs.length === 0) {
                        // Debug logging for troubleshooting
                        try {
                            const allUserSubs = subscriptionService.userSubs || [];
                            const allBangumiSubs = subscriptionService.bangumiSubs || [];
                            logger.info(`[SubscriptionCommand] DEBUG: Total global subs - Users: ${allUserSubs.length}, Bangumis: ${allBangumiSubs.length}`);
                            
                            // Check if any sub has this group ID (loose check)
                            const gidStr = String(groupId);
                            const userMatch = allUserSubs.find(s => s.groupIds && s.groupIds.some(id => String(id) === gidStr));
                            if (userMatch) {
                                logger.info(`[SubscriptionCommand] DEBUG: Found potential match in user subs: ${userMatch.name} with groups [${userMatch.groupIds.join(', ')}]`);
                            } else {
                                logger.info(`[SubscriptionCommand] DEBUG: No user sub matches group ${groupId} even with string check`);
                                if (allUserSubs.length > 0) {
                                    logger.info(`[SubscriptionCommand] DEBUG: First user sub groups: [${allUserSubs[0].groupIds.join(', ')}] (types: ${allUserSubs[0].groupIds.map(id => typeof id).join(', ')})`);
                                }
                            }
                        } catch (e) {
                            logger.error('[SubscriptionCommand] Debug logging failed:', e);
                        }
                    }

                    // Get Account Follows (merged view)
                    let followings = [];
                    try {
                         followings = subscriptionService.cookieFollowings || [];
                    } catch (e) {
                         logger.error('[SubscriptionCommand] Error fetching followings for merge view:', e);
                    }

                    if (groupUserSubs.length === 0 && groupBangumiSubs.length === 0 && followings.length === 0) {
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '本群暂无订阅，且账户关注列表为空。' } }]);
                        return;
                    }

                    userSubs = groupUserSubs;
                    bangumiSubs = groupBangumiSubs;

                    // Fetch user details for Group Subs (with concurrency limit and lightweight API)
                    const detailedUserSubs = [];
                    const CONCURRENCY_LIMIT = 3; // Limit parallel requests to avoid rate limits

                    for (let i = 0; i < userSubs.length; i += CONCURRENCY_LIMIT) {
                         const chunk = userSubs.slice(i, i + CONCURRENCY_LIMIT);
                         const chunkResults = await Promise.all(chunk.map(async (sub) => {
                            try {
                                // Use lighter getUserCard instead of full getUserInfo
                                const info = await biliApi.getUserCard(sub.uid);
                                if (info && info.status === 'success' && info.data) {
                                    logger.info(`[SubscriptionCommand] Fetched card for ${sub.uid}: face=${info.data.face}`);
                                    return {
                                        ...sub,
                                        name: info.data.name || sub.name,
                                        face: info.data.face || 'https://i0.hdslb.com/bfs/face/member/noface.jpg',
                                        level: 0,
                                        pendant: {},
                                        fans_medal: {}
                                    };
                                }
                            } catch (e) {
                                logger.error(`[SubscriptionCommand] Failed to fetch card for user ${sub.uid}`, e);
                            }
                            return {
                                ...sub,
                                face: 'https://i0.hdslb.com/bfs/face/member/noface.jpg',
                                level: 0,
                                pendant: {},
                                fans_medal: {}
                            };
                        }));
                        detailedUserSubs.push(...chunkResults);
                    }

                    const data = {
                        users: detailedUserSubs,
                        bangumis: bangumiSubs,
                        accountFollows: followings // Pass account follows
                    };

                    const showId = config.getGroupConfig(groupId, 'showId');

                    const enableSync = config.getGroupConfig(groupId, 'enableCookieSync');
                    const syncGroups = config.getGroupConfig(groupId, 'cookieSyncGroupNames') || [];

                    if (!enableSync) {
                        data.accountFollows = [];
                        data.accountFollowsTitle = '';
                    } else if (syncGroups.length > 0) {
                        data.accountFollows = data.accountFollows.filter(u => 
                            u.biliGroups && u.biliGroups.some(g => syncGroups.includes(g))
                        );
                        data.accountFollowsTitle = `关注列表 - ${syncGroups.join(' & ')}`;
                    } else {
                        data.accountFollows = [];
                        data.accountFollowsTitle = '关注列表 (未配置分组)';
                    }

                    if (data.users.length === 0 && data.bangumis.length === 0 && (!data.accountFollows || data.accountFollows.length === 0)) {
                         this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '本群暂无订阅' + (enableSync ? '，且符合条件的账户关注为空' : '') + '。' } }]);
                         return;
                    }

                    const base64Image = await imageGenerator.generateSubscriptionList(data, groupId, showId);
                    this.sendGroupMessage(ws, groupId, [{ type: 'image', data: { file: `base64://${base64Image}` } }]);

                } catch (e) {
                    logger.error('[SubscriptionCommand] Error generating subscription list image:', e);
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
                logger.error('[SubscriptionCommand] Unhandled error in /订阅列表 async handler:', e);
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
                    const { users } = subscriptionService.getSubscriptionsByGroup(groupId);
                    // Try exact match first
                    let userSub = users.find(s => s.name === input);
                    
                    if (!userSub) {
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `未在本群找到用户名为 "${input}" 的订阅。请尝试使用 UID 或检查用户名是否完全正确。` } }]);
                        return true;
                    }
                    uidToRemove = userSub.uid;
                }

                const result = subscriptionService.removeUserSubscription(uidToRemove, groupId);
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
            const parts = rawMessage.split(' ');
            if (parts.length === 2) {
                const uid = parts[1];
                (async () => {
                    try {
                        const name = await subscriptionService.addUserSubscription(uid, groupId);
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `成功订阅用户 ${name}（动态+直播）。` } }]);
                    } catch (e) {
                         logger.error('[SubscriptionCommand] Error adding user subscription:', e);
                         this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `订阅失败，请稍后重试。` } }]);
                    }
                })().catch(e => {
                    logger.error('[SubscriptionCommand] Unhandled error in /订阅用户 async handler:', e);
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
            const parts = rawMessage.split(' ');
            if (parts.length === 2) {
                const arg = parts[1].trim();
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
                        logger.error('[SubscriptionCommand] 订阅番剧解析失败:', e);
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '订阅失败：无法解析参数，请使用 season_id、md 或 ep 链接。' } }]);
                    }
                })().catch(e => {
                    logger.error('[SubscriptionCommand] Unhandled error in /订阅番剧 async handler:', e);
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
            const parts = rawMessage.split(' ');
            if (parts.length === 2) {
                const seasonId = parts[1];
                const result = subscriptionService.removeBangumiSubscription(seasonId, groupId);
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
                    const { users } = subscriptionService.getSubscriptionsByGroup(groupId);
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
            logger.warn('[SubscriptionCommand] Cannot send message: no groupId or userId provided');
        }
    }
}

module.exports = new SubscriptionCommand();
