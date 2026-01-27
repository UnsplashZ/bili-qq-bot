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
        this.syncInterval = 60 * 60 * 1000; // 1 hour
        this.timer = null;
        this.syncTimer = null;
        this.initTimer = null;
        this.initSyncTimer = null;
        this.ws = null;
    }

    setWs(ws) {
        this.ws = ws;
    }

    start() {
        if (this.timer) return;

        // Initial check after 10 seconds (Feed & Subs)
        this.initTimer = setTimeout(() => {
            this.checkAll();
            this.initTimer = null;
        }, 10000);

        this.timer = setInterval(() => {
            this.checkAll();
        }, this.checkInterval);

        // Initial check after 5 seconds (List Sync)
        this.initSyncTimer = setTimeout(() => {
            this.refreshCookieFollowings();
            this.initSyncTimer = null;
        }, 5000);

        this.syncTimer = setInterval(() => {
            this.refreshCookieFollowings();
        }, this.syncInterval);

        logger.info(`[UpdateChecker] Started polling: Feed/Subs every ${this.checkInterval / 1000}s, List Sync every ${this.syncInterval / 1000}s`);
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
        if (this.initSyncTimer) {
            clearTimeout(this.initSyncTimer);
            this.initSyncTimer = null;
        }
        if (this.syncTimer) {
            clearInterval(this.syncTimer);
            this.syncTimer = null;
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

        // Prepare set to track UIDs covered by feed check (to avoid duplicate check)
        const feedMonitoredUids = new Set();

        // 1. Check Feed Updates (Cookie Sync)
        // This will populate feedMonitoredUids with UIDs that were checked via feed
        await this.checkFeedUpdate(feedMonitoredUids);

        // 2. Check User Dynamics (Manual Subs)
        for (const sub of subscriptionManager.userSubs) {
            // Skip if this user is already monitored by feed check
            if (feedMonitoredUids.has(String(sub.uid))) {
                continue;
            }

            await this.checkUserDynamic(sub);
            // Small delay to be nice to API
            await new Promise(r => setTimeout(r, 1000));
        }

        // 3. Check User Live Status (Manual Subs)
        for (const sub of subscriptionManager.userSubs) {
             // Skip if this user is already monitored by feed check
            if (feedMonitoredUids.has(String(sub.uid))) {
                continue;
            }

            await this.checkUserLive(sub);
            await new Promise(r => setTimeout(r, 1000));
        }

        // 4. Check Bangumi Updates
        for (const sub of subscriptionManager.bangumiSubs) {
            await this.checkBangumi(sub);
            await new Promise(r => setTimeout(r, 1000));
        }

        // 5. Refresh missing names (maintenance)
        await this.refreshMissingNames();
    }

    async checkFeedUpdate(monitoredUidsSet = null) {
        const groupsWithSync = Object.keys(config.groupConfigs || {}).filter(gid =>
            config.getGroupConfig(gid, 'enableCookieSync')
        );

        if (groupsWithSync.length === 0) return;

        // Identify unique accounts
        const accountGroups = new Map(); // uid -> groupId (representative)

        for (const gid of groupsWithSync) {
            const accountUid = subscriptionManager.groupToAccountMap[String(gid)];
            if (accountUid && !accountGroups.has(accountUid)) {
                accountGroups.set(accountUid, gid);
            }
        }

        // Loop through accounts
        for (const [uid, groupId] of accountGroups) {
            try {
                // Collect UIDs monitored by this account
                if (monitoredUidsSet) {
                    const followers = subscriptionManager.cookieFollowings[String(uid)] || [];
                    followers.forEach(f => {
                         const fid = subscriptionManager.getFollowerId(f);
                         if (fid) monitoredUidsSet.add(fid);
                    });
                }

                // Process Dynamic Feed
                await this.processDynamicFeed(uid, groupId);

                // Wait 2s
                await new Promise(r => setTimeout(r, 2000));

                // Process Live Feed
                await this.processLiveFeed(uid, groupId);
            } catch (e) {
                logger.error(`[UpdateChecker] Feed update failed for account ${uid}:`, e);
            }
        }
    }

    async processDynamicFeed(accountUid, groupId) {
        const followers = subscriptionManager.cookieFollowings[String(accountUid)];
        if (!followers || followers.length === 0) return;

        // Use safe ID generation
        const followerMap = new Map(followers.map(f => [subscriptionManager.getFollowerId(f), f]));
        let offset = '';
        let hasMore = true;
        let page = 0;
        let stateChanged = false;

        while (hasMore && page < 5) {
            const res = await biliApi.getDynamicFeed(offset, groupId);
            if (res.status !== 'success' || !res.data) {
                logger.warn(`[UpdateChecker] Failed to get dynamic feed for account ${accountUid} (Group: ${groupId})`);
                break;
            }

            const items = res.data.items || [];
            hasMore = res.data.has_more;
            offset = res.data.offset;
            page++;

            if (items.length === 0) break;

            for (const item of items) {
                const authorUid = String(item.modules?.module_author?.mid);
                if (!authorUid || !followerMap.has(authorUid)) continue;

                const follower = followerMap.get(authorUid);
                const dynamicId = item.id_str;
                const dynamicType = item.type;

                // Check if new (ID > lastDynamicId)
                let isNew = false;
                if (!follower.lastDynamicId) {
                    isNew = true; // First time seeing this user's dynamic in feed?
                    // Maybe we shouldn't notify everything if it's the first run.
                    // But usually lastDynamicId is populated by sync.
                    // If it's missing, treat as seen to avoid spam, just update ID?
                    // Let's assume if missing, we just update it.
                    isNew = false;
                } else {
                    try {
                        if (BigInt(dynamicId) > BigInt(follower.lastDynamicId)) {
                            isNew = true;
                        }
                    } catch (e) {
                        // Fallback string compare if BigInt fails
                        if (dynamicId !== follower.lastDynamicId) isNew = true;
                    }
                }

                if (isNew) {
                    const targetGroups = this.findTargetGroupsForUser(accountUid, follower);

                    if (targetGroups.length > 0) {
                        // Notify
                        const renderInfo = {
                            id: dynamicId,
                            type: 'dynamic',
                            data: {
                                pub_ts: item.modules?.module_author?.pub_ts,
                                item: {
                                    modules: item.modules,
                                    orig: item.orig,
                                    id_str: dynamicId,
                                    type: dynamicType,
                                    desc: { type: dynamicType },
                                    author: item.modules?.module_author
                                }
                            }
                        };

                        let typeLabel = '动态';
                        if (dynamicType === 'DYNAMIC_TYPE_AV') typeLabel = '视频';
                        else if (dynamicType === 'DYNAMIC_TYPE_ARTICLE') typeLabel = '专栏';
                        else if (dynamicType === 'DYNAMIC_TYPE_FORWARD') typeLabel = '转发';

                        const url = `https://t.bilibili.com/${dynamicId}`;
                        const name = follower.uname || item.modules?.module_author?.name;

                        // Prevent sending duplicate notifications if multiple accounts follow same user
                        // handled by dedupKey in notifyGroupsWithImage (using dynamicId)

                        // Construct Notification Text
                        let notificationText = `${name} 发布了新${typeLabel}！`; // Default

                        if (dynamicType === 'DYNAMIC_TYPE_AV' && item.modules?.module_dynamic?.major?.archive) {
                            const title = item.modules.module_dynamic.major.archive.title;
                            notificationText = `${name} 投稿了新视频：\n${title}`;
                        } else if (dynamicType === 'DYNAMIC_TYPE_ARTICLE' && item.modules?.module_dynamic?.major?.opus) {
                             const title = item.modules.module_dynamic.major.opus.title;
                             notificationText = `${name} 投稿了新专栏：\n${title}`;
                        } else if (dynamicType === 'DYNAMIC_TYPE_FORWARD') {
                            const orig = item.orig;
                            if (orig) {
                                if (orig.type === 'DYNAMIC_TYPE_AV' && orig.modules?.module_dynamic?.major?.archive) {
                                     const title = orig.modules.module_dynamic.major.archive.title;
                                     notificationText = `${name} 转发了视频：\n${title}`;
                                } else if (orig.type === 'DYNAMIC_TYPE_ARTICLE' && orig.modules?.module_dynamic?.major?.opus) {
                                     const title = orig.modules.module_dynamic.major.opus.title;
                                     notificationText = `${name} 转发了专栏：\n${title}`;
                                } else {
                                     notificationText = `${name} 转发了一条动态`;
                                }
                            }
                        } else if (dynamicType === 'DYNAMIC_TYPE_WORD') {
                             notificationText = `${name} 发布了新动态`;
                        }

                        await this.notifyGroupsWithImage(targetGroups, renderInfo, 'dynamic', url, notificationText);
                    }
                }

                // Update state if id is newer or missing
                if (!follower.lastDynamicId || BigInt(dynamicId) > BigInt(follower.lastDynamicId || 0n)) {
                    follower.lastDynamicId = dynamicId;
                    stateChanged = true;
                }
            }
        }

        if (stateChanged) {
            subscriptionManager.setCookieFollowings(accountUid, followers);
        }
    }

    async processLiveFeed(accountUid, groupId) {
        const res = await biliApi.getLiveFeed(groupId);
        if (res.status !== 'success' || !res.data || !res.data.list) return;

        const liveList = res.data.list;
        const followers = subscriptionManager.cookieFollowings[String(accountUid)];
        if (!followers) return;

        // Use safe ID generation
        const followerMap = new Map(followers.map(f => [subscriptionManager.getFollowerId(f), f]));
        let stateChanged = false;

        for (const item of liveList) {
            const uid = String(item.uid);
            if (!followerMap.has(uid)) continue;

            const follower = followerMap.get(uid);
            const liveStatus = item.live_status; // Should be 1 in live feed

            // Check if status changed from 0 to 1
            if (liveStatus === 1 && follower.lastLiveStatus !== 1) {
                const targetGroups = this.findTargetGroupsForUser(accountUid, follower);

                if (targetGroups.length > 0) {
                    const roomUrl = item.link;
                    const title = item.title;
                    const cover = item.cover;
                    const name = item.uname;

                    // Construct live data for renderer
                    const liveData = {
                        id: item.room_id || uid, // for dedup
                        data: {
                            room_info: {
                                room_id: item.room_id,
                                title: title,
                                cover: cover,
                                live_status: 1
                            },
                            anchor_info: {
                                base_info: {
                                    uname: name,
                                    face: item.face
                                }
                            }
                        }
                    };

                    await this.notifyGroupsWithImage(targetGroups, liveData, 'live', roomUrl, `${name} 开播了！`);
                }
            }

            if (follower.lastLiveStatus !== liveStatus) {
                follower.lastLiveStatus = liveStatus;
                stateChanged = true;
            }
        }

        // Note: Live Feed only returns online users.
        // We might want to set offline status for those not in the list?
        // But for "Feed Polling", we only care about *updates* (going live).
        // Setting offline status is tricky without full list scan.
        // We'll stick to detecting "Started Streaming" based on local state vs feed presence.
        // Actually, if they disappear from feed, they are offline.
        // But iterating all followers to set offline might be expensive every minute if there are 1000 followers.
        // For now, let's just update those we see.

        if (stateChanged) {
            subscriptionManager.setCookieFollowings(accountUid, followers);
        }
    }

    findTargetGroupsForUser(accountUid, follower) {
        const targetGroups = [];
        const followerId = subscriptionManager.getFollowerId(follower);

        // 1. Find all groups bound to this account (Cookie Sync)
        for (const [gid, uid] of Object.entries(subscriptionManager.groupToAccountMap)) {
            if (uid !== String(accountUid)) continue;

            // Check if sync enabled
            if (!config.getGroupConfig(gid, 'enableCookieSync')) continue;

            // Check Tag filtering
            let allowedTags = config.getGroupConfig(gid, 'cookieSyncGroupNames');
            if (typeof allowedTags === 'string') {
                allowedTags = allowedTags.split(',').map(s => s.trim());
            }
            if (Array.isArray(allowedTags) && allowedTags.length > 0) {
                // follower.biliGroups should be an array of tag names
                const followerTags = follower.biliGroups || [];
                // Check intersection
                const hasTag = allowedTags.some(tag => followerTags.includes(tag));
                if (!hasTag) continue;
            }

            targetGroups.push(gid);
        }

        // 2. Find manual subscriptions for this user (Group Subscription)
        // Even if the group didn't enable sync, if they manually subscribed, they should get it.
        // And since we are in the Feed flow, we know this user updated.
        const manualSub = subscriptionManager.userSubs.find(s => String(s.uid) === followerId);
        if (manualSub) {
            manualSub.groupIds.forEach(gid => {
                // Deduplicate: avoid adding if already added via sync
                if (!targetGroups.includes(String(gid))) {
                    targetGroups.push(String(gid));
                }
            });
        }

        return targetGroups;
    }

    async checkUserDynamic(sub, force = false) {
        try {
            const res = await biliApi.getUserDynamic(sub.uid, null, true);
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

                    // Construct Notification Text
                    let notificationText = `${sub.name} 发布了新${typeLabel}！`; // Default

                    if (cardType === 'DYNAMIC_TYPE_AV' || cardType === 8) {
                         const title = card.modules?.module_dynamic?.major?.archive?.title || card.desc?.title || '';
                         if (title) notificationText = `${sub.name} 投稿了新视频：\n${title}`;
                    } else if (cardType === 'DYNAMIC_TYPE_ARTICLE' || cardType === 64) {
                         const title = card.modules?.module_dynamic?.major?.opus?.title || card.desc?.title || '';
                         if (title) notificationText = `${sub.name} 投稿了新专栏：\n${title}`;
                    } else if (cardType === 'DYNAMIC_TYPE_FORWARD') {
                         const orig = card.orig;
                         if (orig) {
                              const oType = orig.type;
                              if (oType === 'DYNAMIC_TYPE_AV' || oType === 8) {
                                   const title = orig.modules?.module_dynamic?.major?.archive?.title || '';
                                   if (title) notificationText = `${sub.name} 转发了视频：\n${title}`;
                                   else notificationText = `${sub.name} 转发了视频`;
                              } else if (oType === 'DYNAMIC_TYPE_ARTICLE' || oType === 64) {
                                   const title = orig.modules?.module_dynamic?.major?.opus?.title || '';
                                   if (title) notificationText = `${sub.name} 转发了专栏：\n${title}`;
                                   else notificationText = `${sub.name} 转发了专栏`;
                              } else {
                                   notificationText = `${sub.name} 转发了一条动态`;
                              }
                         }
                    } else if (cardType === 'DYNAMIC_TYPE_WORD') {
                         notificationText = `${sub.name} 发布了新动态`;
                    }

                    // Notify
                    try {
                        const url = `https://t.bilibili.com/${cardId}`;
                        await this.notifyGroupsWithImage(sub.groupIds, info, 'dynamic', url, notificationText);

                    } catch (e) {
                        logger.error(`[UpdateChecker] Failed to generate image for dynamic ${cardId}:`, e);
                        // Fallback text
                        const msg = `${notificationText}\nhttps://t.bilibili.com/${cardId}`;
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

            const liveRoom = res.data.live_room || {};
            const liveStatus = liveRoom.liveStatus; // 1: live, 0: offline
            const roomId = liveRoom.roomid || liveRoom.room_id || sub.uid; // Extract room_id with fallback
            const roomUrl = liveRoom.url;
            const title = liveRoom.title;
            const cover = liveRoom.cover;

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
                         id: roomId, // Use room_id for deduplication and imageGenerator
                         data: {
                             room_info: {
                                 room_id: roomId, // Pass actual room_id
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
                    this.notifyGroups(sub.groupIds, msg, `live_${roomId}`);
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
                    await this.notifyGroupsWithImage(sub.groupIds, res.data, 'bangumi', `https://www.bilibili.com/bangumi/play/ep${newEp.id}`, `${sub.title} 更新了：${newEp.index_show}`);
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
            const ttlSeconds = Number(config.getGroupConfig(gid, 'linkCacheTimeout'));
            const ttlMs = Number.isFinite(ttlSeconds) ? ttlSeconds * 1000 : 0;
            if (dedupKey && notificationHistory.has(gid, dedupKey, ttlMs)) {
                logger.info(`[UpdateChecker] Skipping duplicate text notification for group ${gid} (key: ${dedupKey})`);
                return;
            }

            if (config.isGroupEnabled(gid)) {
                notificationService.sendGroupMessage(this.ws, gid, [{ type: 'text', data: { text } }]);
                
                // Record notification history if key provided
                if (dedupKey) {
                    notificationHistory.add(gid, dedupKey, ttlMs);
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
                const ttlSeconds = Number(config.getGroupConfig(gid, 'linkCacheTimeout'));
                const ttlMs = Number.isFinite(ttlSeconds) ? ttlSeconds * 1000 : 0;
                if (notificationHistory.has(gid, dedupId, ttlMs)) {
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
                        const ttlSeconds = Number(config.getGroupConfig(gid, 'linkCacheTimeout'));
                        const ttlMs = Number.isFinite(ttlSeconds) ? ttlSeconds * 1000 : 0;
                        notificationHistory.add(gid, dedupId, ttlMs);
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
