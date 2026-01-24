const subscriptionManager = require('./subscriptionManager');
const notificationService = require('../../services/notificationService');
const biliApi = require('../../services/biliApi');
const imageGenerator = require('../../services/imageGenerator');
const config = require('../../config');
const logger = require('../../utils/logger');
const notificationHistory = require('../../utils/notificationHistory');

class UpdateChecker {
    constructor() {
        this.checkInterval = (config.subscriptionCheckInterval || 60) * 1000;
        this.timer = null;
        this.initTimer = null;
        this.ws = null;
    }

    setWs(ws) {
        this.ws = ws;
    }

    start() {
        if (this.timer) return;
        
        // Initial check after 10 seconds
        this.initTimer = setTimeout(() => {
            this.checkAll();
            this.initTimer = null;
        }, 10000);

        this.timer = setInterval(() => {
            this.checkAll();
        }, this.checkInterval);
        
        logger.info(`[UpdateChecker] Started polling every ${this.checkInterval / 1000}s`);
    }

    stop() {
        if (this.initTimer) {
            clearTimeout(this.initTimer);
            this.initTimer = null;
        }
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    updateCheckInterval(seconds) {
        this.checkInterval = seconds * 1000;
        this.stop();
        this.start();
    }

    async checkAll() {
        logger.info('[UpdateChecker] Starting scheduled check...');

        // Ensure subscriptions are loaded before checking
        await subscriptionManager._ensureSubscriptionsLoaded();

        // Refresh cookie followings if enabled for any group
        await this.refreshCookieFollowings();

        // 1. Check User Dynamics
        for (const sub of subscriptionManager.userSubs) {
            await this.checkUserDynamic(sub);
            // Small delay to be nice to API
            await new Promise(r => setTimeout(r, 1000));
        }

        // 2. Check User Live Status
        for (const sub of subscriptionManager.userSubs) {
            await this.checkUserLive(sub);
            await new Promise(r => setTimeout(r, 1000));
        }

        // 3. Check Bangumi Updates
        for (const sub of subscriptionManager.bangumiSubs) {
            await this.checkBangumi(sub);
            await new Promise(r => setTimeout(r, 1000));
        }

        // 4. Refresh missing names (maintenance)
        await this.refreshMissingNames();
    }

    async checkUserDynamic(sub, force = false) {
        try {
            const res = await biliApi.getUserDynamic(sub.uid);
            if (res.status !== 'success') {
                logger.warn(`[UpdateChecker] Failed to fetch dynamics for ${sub.name} (${sub.uid}): ${res.message}`);
                return;
            }
            
            // Compatible with both 'items' (new API) and 'cards' (old logic)
            // But actually bili_service.py get_user_dynamic now returns { data: { cards: [...] } }
            // Wait, looking at bili_service.py:
            // return {"status": "success", "data": {"cards": result_items}}
            // So res.data.cards IS correct for the Python output wrapper.
            // BUT, the fields INSIDE the card objects have changed/expanded.
            
            if (!res.data.cards || res.data.cards.length === 0) return;

            const cards = res.data.cards;

            // Sort cards by ID descending to handle sticky posts (which might be old but at top)
            // ensuring the first card is truly the latest one in time.
            cards.sort((a, b) => {
                try {
                    // Try id_str first (new API), then desc.dynamic_id_str (old API)
                    const idAStr = a.id_str || (a.desc && a.desc.dynamic_id_str);
                    const idBStr = b.id_str || (b.desc && b.desc.dynamic_id_str);
                    
                    if (!idAStr || !idBStr) return 0;

                    const idA = BigInt(idAStr);
                    const idB = BigInt(idBStr);
                    return idA < idB ? 1 : idA > idB ? -1 : 0;
                } catch (e) {
                    return 0;
                }
            });

            const latestCard = cards[0];
            const latestId = latestCard.id_str || (latestCard.desc && latestCard.desc.dynamic_id_str);

            if (!latestId) {
                logger.warn(`[UpdateChecker] Could not find dynamic ID for ${sub.name}`);
                return;
            }

            // If first time (no lastId), just update and return
            if (!sub.lastDynamicId && !force) {
                await subscriptionManager.updateUserSub(sub.uid, { lastDynamicId: latestId });
                return;
            }

            if (latestId !== sub.lastDynamicId || force) {
                // Find all new dynamics or just the latest if force
                let newCards = [];
                
                if (force) {
                    newCards = [latestCard];
                    logger.info(`[UpdateChecker] Force checking dynamic for ${sub.name} (ID: ${latestId})`);
                } else {
                    for (const card of cards) {
                        const currentId = card.id_str || (card.desc && card.desc.dynamic_id_str);
                        if (!currentId) continue;
                        
                        if (currentId === sub.lastDynamicId) break;
                        
                        // Prevent re-pushing old dynamics if the last seen dynamic was deleted
                        // If we encounter a dynamic ID smaller (older) than our last seen ID, stop.
                        try {
                            if (BigInt(currentId) < BigInt(sub.lastDynamicId)) break;
                        } catch (e) {
                            // Fallback for non-numeric IDs if any
                        }
                        newCards.push(card);
                    }
                    // Process from oldest to newest
                    newCards.reverse();
                }

                for (const card of newCards) {
                    const cardId = card.id_str || (card.desc && card.desc.dynamic_id_str);
                    const cardType = card.type || (card.desc && card.desc.type);

                    // Check if this is a live stream start notification
                    // These are auto-posted by Bilibili when a user starts streaming
                    // We want to skip these and let checkUserLive handle the notification to avoid duplicates
                    const isLiveDynamic = cardType === 'DYNAMIC_TYPE_LIVE_RCMD' ||
                                          cardType === 4308 || // OLD API Live type
                                          (card.modules?.module_dynamic?.major?.type === 'MAJOR_TYPE_LIVE_RCMD');

                    if (isLiveDynamic) {
                        logger.info(`[UpdateChecker] Skipping live dynamic for ${sub.name} (ID: ${cardId}) - expecting checkUserLive to handle it`);
                        continue;
                    }

                    // Generate Preview
                    // Construct info object compatible with generator
                    // The renderer expects { data: { item: { modules: ... } } }
                    // We need to map our card structure to what the renderer expects
                    
                    // Python backend normalizes this somewhat, let's use what we have
                    const info = {
                        id: cardId,
                        type: 'dynamic',
                        data: {
                            pub_ts: card.modules?.module_author?.pub_ts || card.desc?.timestamp,
                            item: {
                                modules: card.modules,
                                orig: card.orig,
                                id_str: cardId,
                                type: cardType,
                                desc: {
                                    type: cardType
                                },
                                author: card.author
                            }
                        }
                    };

                    // Detect specific types for label filtering and message
                    let typeLabel = '动态';
                    
                    // Handle both numeric and string types
                    if (cardType === 8 || cardType === 'DYNAMIC_TYPE_AV') typeLabel = '视频';
                    else if (cardType === 64 || cardType === 'DYNAMIC_TYPE_ARTICLE') typeLabel = '专栏';
                    else if (cardType === 'DYNAMIC_TYPE_FORWARD') typeLabel = '转发';
                    
                    // Notify
                    try {
                        const url = `https://t.bilibili.com/${cardId}`;
                        await this.notifyGroupsWithImage(sub.groupIds, info, 'dynamic', url, `${sub.name} 发布了新${typeLabel}！`);
                        
                    } catch (e) {
                        logger.error(`[UpdateChecker] Failed to generate image for dynamic ${cardId}:`, e);
                        // Fallback text
                        const msg = `${sub.name} 发布了新${typeLabel}：\nhttps://t.bilibili.com/${cardId}`;
                        this.notifyGroups(sub.groupIds, msg, cardId);
                    }
                }

                // Update lastId (only if not forced check)
                if (!force) {
                    await subscriptionManager.updateUserSub(sub.uid, { lastDynamicId: latestId });
                }
            }
        } catch (e) {
            logger.error(`[UpdateChecker] Error checking dynamic for ${sub.name}:`, e);
        }
    }

    async checkUserLive(sub) {
        try {
            const res = await biliApi.getUserInfo(sub.uid); // getUserInfo contains live_room
            if (res.status !== 'success') return;

            const liveStatus = res.data.live_room?.liveStatus; // 1: live, 0: offline
            const roomUrl = res.data.live_room?.url;
            const title = res.data.live_room?.title;
            const cover = res.data.live_room?.cover;

            if (liveStatus === 1 && sub.lastLiveStatus === 0) {
                // Started Streaming
                const msg = `${sub.name} 开播了！\n标题：${title}\n地址：${roomUrl}`;
                
                // Try to generate image? Or just text + cover
                // If cover exists, we can send it. 
                // Using generic notify with image support if we download cover?
                // Or just text for now as per original simple logic, or upgrade?
                // Original code might have used generatePreviewCard for live
                
                // Let's try generatePreviewCard for live
                try {
                     // Build data structure matching what the live renderer expects
                     const liveData = {
                         data: {
                             room_info: {
                                 room_id: sub.uid,
                                 title: title,
                                 cover: cover,
                                 live_status: 1 // 1 = live
                             },
                             anchor_info: {
                                 base_info: {
                                     uname: sub.name,
                                     face: res.data.face
                                 }
                             },
                             watched_show: {
                                 text_large: '',
                                 num: 0
                             }
                         }
                     };
                     await this.notifyGroupsWithImage(sub.groupIds, liveData, 'live', roomUrl, `${sub.name} 开播了！`);
                } catch (e) {
                    this.notifyGroups(sub.groupIds, msg, `live_${sub.uid}`);
                }
            }

            if (liveStatus !== sub.lastLiveStatus) {
                await subscriptionManager.updateUserSub(sub.uid, { lastLiveStatus: liveStatus });
            }
        } catch (e) {
            logger.error(`[UpdateChecker] Error checking live for ${sub.name}:`, e);
        }
    }

    async checkBangumi(sub) {
        try {
            const res = await biliApi.getBangumiInfo(sub.seasonId);
            if (res.status !== 'success') return;

            const newEp = res.data.new_ep;
            if (!newEp || !newEp.id) return;

            // Initialize if needed
            if (!sub.lastEpId) {
                await subscriptionManager.updateBangumiSub(sub.seasonId, { lastEpId: newEp.id });
                return;
            }

            if (newEp.id !== sub.lastEpId) {
                // New Episode
                const msg = `番剧 ${sub.title} 更新了！\n${newEp.index_show}\nhttps://www.bilibili.com/bangumi/play/ep${newEp.id}`;

                try {
                    // Generate preview (pass full res object, not res.data)
                    await this.notifyGroupsWithImage(sub.groupIds, res, 'bangumi', `https://www.bilibili.com/bangumi/play/ep${newEp.id}`, `番剧 ${sub.title} 更新了！`);
                } catch (e) {
                    this.notifyGroups(sub.groupIds, msg, newEp.id);
                }

                await subscriptionManager.updateBangumiSub(sub.seasonId, { lastEpId: newEp.id });
            }
        } catch (e) {
            logger.error(`[UpdateChecker] Error checking bangumi ${sub.title}:`, e);
        }
    }

    notifyGroups(groupIds, text, dedupKey = null) {
        if (!this.ws) return;
        groupIds.forEach(gid => {
            // Check for deduplication if key is provided
            if (dedupKey && notificationHistory.has(gid, dedupKey)) {
                logger.info(`[UpdateChecker] Skipping duplicate text notification for group ${gid} (key: ${dedupKey})`);
                return;
            }

            if (config.isGroupEnabled(gid)) {
                notificationService.sendGroupMessage(this.ws, gid, [{ type: 'text', data: { text } }]);
                
                // Record notification history if key provided
                if (dedupKey) {
                    notificationHistory.add(gid, dedupKey);
                }
            }
        });
    }

    async notifyGroupsWithImage(groupIds, data, type, textUrl, descriptionText = '') {
        if (!this.ws || !groupIds || groupIds.length === 0) return;

        // Deduplication Logic
        // Determine unique ID based on data
        let dedupId = null;
        if (data && data.id) dedupId = data.id; // dynamic id
        else if (data && data.ep_id) dedupId = data.ep_id; // bangumi ep id (if available)
        else if (type === 'live' && data && data.id) dedupId = `live_${data.id}`; // live room/user id
        
        // Filter out groups that already received this notification
        const pendingGroupIds = [];
        if (dedupId) {
            for (const gid of groupIds) {
                if (notificationHistory.has(gid, dedupId)) {
                    logger.info(`[UpdateChecker] Skipping duplicate notification for group ${gid} (ID: ${dedupId})`);
                } else {
                    pendingGroupIds.push(gid);
                }
            }
        } else {
            // Fallback: process all if no ID found (shouldn't happen for std types)
            pendingGroupIds.push(...groupIds);
        }

        if (pendingGroupIds.length === 0) return;

        // Group by config signature to handle Night Mode / Show ID differences
        const groupsByConfig = new Map(); // Key: "night:T|F_label:T|F_showId:T|F" -> [groupIds]

        for (const groupId of pendingGroupIds) {
            if (!config.isGroupEnabled(groupId)) continue;

            const isNight = imageGenerator.isNightMode(groupId);
            const showId = config.getGroupConfig(groupId, 'showId');
            
            // Label Config Check
            const labelConfig = config.getGroupConfig(groupId, 'labelConfig');
            let subtype = type;
            // Attempt to refine subtype from data if possible
            if (type === 'bangumi' && data && data.season_type) {
                const st = data.season_type;
                if (st === 2) subtype = 'movie';
                else if (st === 3) subtype = 'doc';
                else if (st === 4) subtype = 'guocha';
                else if (st === 5) subtype = 'tv';
                else if (st === 7) subtype = 'variety';
            } else if (type === 'dynamic' && data && data.item && data.item.desc) {
                 if (data.item.desc.type === 8) subtype = 'video';
                 else if (data.item.desc.type === 64) subtype = 'article';
            }

            const showLabel = (labelConfig && labelConfig[subtype] !== undefined) 
                ? labelConfig[subtype] 
                : (labelConfig && labelConfig[type] !== false); // Default true

            const key = `night:${isNight}_showId:${showId}_showLabel:${showLabel}`;
            
            if (!groupsByConfig.has(key)) {
                groupsByConfig.set(key, []);
            }
            groupsByConfig.get(key).push(groupId);
        }

        // Process each group configuration
        for (const [key, targetGroupIds] of groupsByConfig) {
            try {
                // Use the first group as representative for generation
                const representativeGroupId = targetGroupIds[0];
                const showId = config.getGroupConfig(representativeGroupId, 'showId');
                
                // Generate image for this configuration
                const base64Image = await imageGenerator.generatePreviewCard(data, type, representativeGroupId, showId);
                
                // Construct text message
                const textMsg = descriptionText ? `\n${descriptionText}\n${textUrl}` : textUrl;

                // Send to all groups in this configuration batch
                targetGroupIds.forEach(gid => {
                    notificationService.sendGroupMessage(this.ws, gid, [
                        { type: 'image', data: { file: `base64://${base64Image}` } },
                        { type: 'text', data: { text: textMsg } }
                    ]);
                    
                    // Record history
                    if (dedupId) {
                        notificationHistory.add(gid, dedupId);
                    }
                });
                
            } catch (e) {
                logger.error(`[UpdateChecker] Error generating image for config group [${key}]:`, e);
                // Fallback to text for these groups
                const textMsg = descriptionText ? `${descriptionText}\n${textUrl}` : textUrl;
                this.notifyGroups(targetGroupIds, `预览生成失败，已降级为文本链接：\n${textMsg}`, dedupId);
            }
        }
    }

    async refreshCookieFollowings() {
        // Ensure followers are loaded before updating to prevent overwriting with old data
        await subscriptionManager._ensureFollowersLoaded();

        // Get all groups with sync enabled
        const groupsWithSync = Object.keys(config.groupConfigs || {}).filter(gid =>
            config.getGroupConfig(gid, 'enableCookieSync')
        );

        if (groupsWithSync.length === 0) return;

        const visitedUids = new Set();
        
        for (const groupId of groupsWithSync) {
            try {
                // First, check who is logged in for this group
                const myInfo = await biliApi.getMyInfo(groupId);
                if (myInfo.status !== 'success') {
                    // Maybe cookie expired or not set
                    logger.warn(`[UpdateChecker] Failed to get user info for group ${groupId}: ${myInfo.message}`);
                    continue;
                }
                
                const myUid = String(myInfo.data.mid);
                
                // Update mapping
                subscriptionManager.setGroupAccountMapping(groupId, myUid);
                
                // If we already refreshed this account in this cycle, skip fetching
                if (visitedUids.has(myUid)) {
                    continue;
                }
                
                // Fetch followings
                logger.info(`[UpdateChecker] Refreshing followings for account ${myUid} via group ${groupId}`);
                const res = await biliApi.getMyFollowings(null, groupId);
                
                if (res.status === 'success' && res.data) {
                    subscriptionManager.setCookieFollowings(myUid, res.data);
                    visitedUids.add(myUid);
                } else {
                    logger.error(`[UpdateChecker] Failed to refresh followings for group ${groupId}:`, res.message);
                }
                
                // Sleep to avoid rate limiting
                await new Promise(r => setTimeout(r, 2000));
                
            } catch (e) {
                logger.error(`[UpdateChecker] Error refreshing cookie followings for group ${groupId}:`, e);
            }
        }
    }

    async refreshMissingNames() {
        // For users with no name
        for (const sub of subscriptionManager.userSubs) {
            if (!sub.name) {
                try {
                    const info = await biliApi.getUserInfo(sub.uid);
                    if (info.status === 'success') {
                        await subscriptionManager.updateUserSub(sub.uid, { name: info.data.name });
                    }
                } catch (e) {}
            }
        }
    }
}

module.exports = new UpdateChecker();
