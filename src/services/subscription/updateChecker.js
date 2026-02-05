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

    /**
     * 启动订阅检查器
     * @param {boolean} skipInitialDelay - 是否跳过初始延迟
     */
    start(skipInitialDelay = false) {
        // 🆕 先停止现有定时器，防止泄漏
        this.stop();

        logger.info('[UpdateChecker] Starting subscription checker', {
            checkInterval: `${this.checkInterval / 1000}s`,
            syncInterval: `${this.syncInterval / 1000}s`,
            skipInitialDelay
        });

        // Initial check after 10 seconds (Feed & Subs) - or immediately if skipInitialDelay
        const initialDelay = skipInitialDelay ? 0 : 10000;
        this.initTimer = setTimeout(() => {
            this.checkAll();
            this.initTimer = null;
        }, initialDelay);

        this.timer = setInterval(() => {
            this.checkAll();
        }, this.checkInterval);

        // Initial check after 5 seconds (List Sync)
        const syncDelay = skipInitialDelay ? 0 : 5000;
        this.initSyncTimer = setTimeout(() => {
            this.refreshCookieFollowings();
            this.initSyncTimer = null;
        }, syncDelay);

        this.syncTimer = setInterval(() => {
            this.refreshCookieFollowings();
        }, this.syncInterval);

        logger.info('[UpdateChecker] All timers started successfully');
    }

    /**
     * 停止订阅检查器
     */
    stop() {
        let clearedCount = 0;

        if (this.initTimer) {
            clearTimeout(this.initTimer);
            this.initTimer = null;
            clearedCount++;
        }

        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
            clearedCount++;
        }

        if (this.initSyncTimer) {
            clearTimeout(this.initSyncTimer);
            this.initSyncTimer = null;
            clearedCount++;
        }

        if (this.syncTimer) {
            clearInterval(this.syncTimer);
            this.syncTimer = null;
            clearedCount++;
        }

        if (clearedCount > 0) {
            logger.info(`[UpdateChecker] Stopped subscription checker, cleared ${clearedCount} timers`);
        }
    }

    /**
     * 🆕 重启订阅检查器（先停止再启动）
     */
    restart() {
        logger.info('[UpdateChecker] Restarting subscription checker...');
        this.stop();
        this.start(true); // Skip initial delay on restart
    }

    /**
     * 🆕 获取定时器状态（用于调试）
     */
    getStatus() {
        return {
            running: !!(this.timer || this.syncTimer),
            timers: {
                initTimer: !!this.initTimer,
                mainTimer: !!this.timer,
                initSyncTimer: !!this.initSyncTimer,
                syncTimer: !!this.syncTimer
            },
            intervals: {
                check: `${this.checkInterval / 1000}s`,
                sync: `${this.syncInterval / 1000}s`
            }
        };
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

        // Build active groups set (only groups where isInGroup !== false)
        const activeGroups = new Set();
        const groupConfigs = config.groupConfigs || {};

        for (const [groupId, groupConfig] of Object.entries(groupConfigs)) {
            if (groupConfig.isInGroup !== false) {
                activeGroups.add(groupId);
            }
        }

        logger.debug(`[UpdateChecker] Active groups: ${activeGroups.size} of ${Object.keys(groupConfigs).length} total`);

        // Prepare set to track UIDs covered by feed check (to avoid duplicate check)
        const feedMonitoredUids = new Set();

        // 1. Check Feed Updates (Cookie Sync)
        // This will populate feedMonitoredUids with UIDs that were checked via feed
        await this.checkFeedUpdate(feedMonitoredUids, activeGroups);

        // 2. Check User Dynamics (Manual Subs)
        for (const sub of subscriptionManager.userSubs) {
            // Skip if this user is already monitored by feed check
            if (feedMonitoredUids.has(String(sub.uid))) {
                continue;
            }

            // Filter out inactive groups
            const targetGroups = sub.groupIds.filter(gid => activeGroups.has(gid));
            if (targetGroups.length === 0) {
                logger.debug(`[UpdateChecker] Skipped dynamic check for UID ${sub.uid} (${sub.name}): all subscribed groups have left`);
                continue;
            }

            await this.checkUserDynamic(sub, targetGroups);
            // Small delay to be nice to API
            await new Promise(r => setTimeout(r, 1000));
        }

        // 3. Check User Live Status (Manual Subs)
        for (const sub of subscriptionManager.userSubs) {
             // Skip if this user is already monitored by feed check
            if (feedMonitoredUids.has(String(sub.uid))) {
                continue;
            }

            // Filter out inactive groups
            const targetGroups = sub.groupIds.filter(gid => activeGroups.has(gid));
            if (targetGroups.length === 0) {
                logger.debug(`[UpdateChecker] Skipped live check for UID ${sub.uid} (${sub.name}): all subscribed groups have left`);
                continue;
            }

            await this.checkUserLive(sub, targetGroups);
            await new Promise(r => setTimeout(r, 1000));
        }

        // 4. Check Bangumi Updates
        for (const sub of subscriptionManager.bangumiSubs) {
            // Filter out inactive groups
            const targetGroups = sub.groupIds.filter(gid => activeGroups.has(gid));
            if (targetGroups.length === 0) {
                logger.debug(`[UpdateChecker] Skipped bangumi check for ${sub.seasonId} (${sub.title}): all subscribed groups have left`);
                continue;
            }

            await this.checkBangumi(sub, targetGroups);
            await new Promise(r => setTimeout(r, 1000));
        }

        // 5. Refresh missing names (maintenance)
        await this.refreshMissingNames();
    }

    async checkFeedUpdate(monitoredUidsSet = null, activeGroups = null) {
        const groupsWithSync = Object.keys(config.groupConfigs || {}).filter(gid => {
            // Only check groups that are active (not left)
            if (activeGroups && !activeGroups.has(gid)) {
                return false;
            }
            return config.getGroupConfig(gid, 'enableCookieSync');
        });

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
                // IMPORTANT: Add users that will be pushed via feed (tag match OR manual subscription)
                // This optimizes performance by using feed data instead of individual API calls
                if (monitoredUidsSet) {
                    const followers = subscriptionManager.cookieFollowings[String(uid)] || [];
                    for (const f of followers) {
                        const fid = subscriptionManager.getFollowerId(f);
                        if (!fid) continue;

                        // Use findTargetGroupsForUser to determine if this user will be pushed
                        // This includes both:
                        // 1. Cookie sync + tag matching groups
                        // 2. Manual subscription groups (regardless of tag)
                        const targetGroups = this.findTargetGroupsForUser(uid, f, activeGroups);

                        // If any group will receive this user's updates via feed, mark as monitored
                        // This prevents redundant API calls in checkUserDynamic
                        if (targetGroups.length > 0) {
                            monitoredUidsSet.add(fid);
                        }
                    }
                }

                // Process Dynamic Feed
                await this.processDynamicFeed(uid, groupId, activeGroups);

                // Wait 2s
                await new Promise(r => setTimeout(r, 2000));

                // Process Live Feed
                await this.processLiveFeed(uid, groupId, activeGroups);
            } catch (e) {
                logger.error(`[UpdateChecker] Feed update failed for account ${uid}:`, e);
            }
        }
    }

    async processDynamicFeed(accountUid, groupId, activeGroups = null) {
        const followers = subscriptionManager.cookieFollowings[String(accountUid)];
        if (!followers || followers.length === 0) return;

        // Use safe ID generation
        const followerMap = new Map(followers.map(f => [subscriptionManager.getFollowerId(f), f]));
        let offset = '';
        let prevOffset = null;
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
            if (offset === prevOffset) break; // Prevent infinite loop on unchanged offset
            prevOffset = offset;
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
                        // Fallback: zero-padded string comparison (safe for large IDs)
                        const a = dynamicId.padStart(20, '0')
                        const b = follower.lastDynamicId.padStart(20, '0')
                        if (a > b) isNew = true
                    }
                }

                if (isNew) {
                    // Check for live dynamic to skip (handled by processLiveFeed)
                    if (this.isLiveDynamic(item)) {
                        continue;
                    }

                    const targetGroups = this.findTargetGroupsForUser(accountUid, follower, activeGroups);

                    if (targetGroups.length > 0) {
                        // Fetch dynamic detail using standard API (unified with linkHandler)
                        // This ensures data format consistency with manual subscriptions
                        const info = await biliApi.getDynamicInfo(dynamicId, groupId);

                        if (info.status !== 'success') {
                            logger.warn(`[UpdateChecker] Failed to get dynamic detail for ${dynamicId} in feed, skipping`);
                            continue;
                        }

                        const name = follower.uname || item.modules?.module_author?.name;
                        const url = `https://t.bilibili.com/${dynamicId}`;

                        // Generate notification text using unified function
                        const notificationText = this.generateNotificationText(name, info);

                        // Prevent sending duplicate notifications if multiple accounts follow same user
                        // handled by dedupKey in notifyGroupsWithImage (using dynamicId)
                        await this.notifyGroupsWithImage(targetGroups, info, info.type || 'dynamic', url, notificationText);
                    }
                }

                // Update state if id is newer or missing
                try {
                    if (!follower.lastDynamicId || BigInt(dynamicId) > BigInt(follower.lastDynamicId || '0')) {
                        follower.lastDynamicId = dynamicId;
                        stateChanged = true;
                    }
                } catch (e) {
                    const a = String(dynamicId).padStart(20, '0')
                    const b = String(follower.lastDynamicId || '0').padStart(20, '0')
                    if (!follower.lastDynamicId || a > b) {
                        follower.lastDynamicId = dynamicId;
                        stateChanged = true;
                    }
                }
            }
        }

        if (stateChanged) {
            await subscriptionManager.setCookieFollowings(accountUid, followers);
        }
    }

    async processLiveFeed(accountUid, groupId, activeGroups = null) {
        const res = await biliApi.getLiveFeed(groupId);
        if (res.status !== 'success' || !res.data || !res.data.list) return;

        const liveList = res.data.list;
        const followers = subscriptionManager.cookieFollowings[String(accountUid)];
        if (!followers) return;

        // Use safe ID generation
        const followerMap = new Map(followers.map(f => [subscriptionManager.getFollowerId(f), f]));
        let stateChanged = false;
        const onlineUids = new Set();

        for (const item of liveList) {
            const uid = String(item.uid);
            onlineUids.add(uid);
            if (!followerMap.has(uid)) continue;

            const follower = followerMap.get(uid);
            const liveStatus = item.live_status; // Should be 1 in live feed

            // Check if status changed from 0 to 1
            if (liveStatus === 1 && follower.lastLiveStatus !== 1) {
                const targetGroups = this.findTargetGroupsForUser(accountUid, follower, activeGroups);

                if (targetGroups.length > 0) {
                    const roomId = item.room_id || item.roomid;
                    const name = item.uname;

                    if (!roomId) {
                        logger.warn(`[UpdateChecker] No room ID for user ${uid} (${name}), skipping live notification`);
                        continue;
                    }

                    // Fetch live room detail using standard API (unified with linkHandler)
                    const liveInfo = await biliApi.getLiveRoomInfo(roomId, groupId);
                    if (liveInfo.status !== 'success') {
                        logger.warn(`[UpdateChecker] Failed to get live room info for ${roomId} (${name}), skipping`);
                        continue;
                    }

                    liveInfo.id = roomId;
                    const roomUrl = `https://live.bilibili.com/${roomId}`;

                    await this.notifyGroupsWithImage(targetGroups, liveInfo, 'live', roomUrl, `${name} 开播了！`);
                }
            }

            if (follower.lastLiveStatus !== liveStatus) {
                follower.lastLiveStatus = liveStatus;
                stateChanged = true;
            }
        }

        // Handle offline users
        // If a user was live (lastLiveStatus === 1) but is no longer in the live list, set them to offline (0)
        for (const follower of followers) {
             const uid = subscriptionManager.getFollowerId(follower);
             if (follower.lastLiveStatus === 1 && !onlineUids.has(uid)) {
                 follower.lastLiveStatus = 0;
                 stateChanged = true;
             }
        }

        if (stateChanged) {
            await subscriptionManager.setCookieFollowings(accountUid, followers);
        }
    }

    findTargetGroupsForUser(accountUid, follower, activeGroups = null) {
        const targetGroups = [];
        const followerId = subscriptionManager.getFollowerId(follower);

        // 1. Find all groups bound to this account (Cookie Sync)
        for (const [gid, uid] of Object.entries(subscriptionManager.groupToAccountMap)) {
            if (uid !== String(accountUid)) continue;

            // Filter out inactive groups
            if (activeGroups && !activeGroups.has(gid)) continue;

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
                // Filter out inactive groups
                if (activeGroups && !activeGroups.has(gid)) return;

                // Deduplicate: avoid adding if already added via sync
                if (!targetGroups.includes(String(gid))) {
                    targetGroups.push(String(gid));
                }
            });
        }

        return targetGroups;
    }

    isLiveDynamic(card) {
        const t = card.type || (card.desc && card.desc.type);
        return t === 'DYNAMIC_TYPE_LIVE_RCMD' ||
               t === 4308 ||
               (card.modules?.module_dynamic?.major?.type === 'MAJOR_TYPE_LIVE_RCMD');
    }

    /**
     * Generate notification text for different content types
     * Unified logic for both feed and manual subscription pushes
     * @param {string} userName - User name to display
     * @param {object} info - Content info object from API (standard format)
     * @returns {string} - Notification text
     */
    generateNotificationText(userName, info) {
        const type = info.type || 'dynamic';
        const data = info.data || {};
        const item = data.item || {};
        const modules = item.modules || {};
        const dynamic = modules.module_dynamic || {};
        const major = dynamic.major || {};
        const extractCvId = value => {
            if (!value) return '';
            const str = String(value);
            const match = str.match(/\/read\/cv(\d+)/i) || str.match(/(?:^|[^a-z0-9])cv(\d+)/i);
            if (match) return match[1];
            if (/^\d+$/.test(str)) return str;
            return '';
        };
        const resolveCvId = (majorData, itemData, dataRoot) => {
            const jumpUrl = majorData?.opus?.jump_url || itemData?.basic?.jump_url || dataRoot?.basic?.jump_url;
            let cvId = extractCvId(jumpUrl);
            if (!cvId) {
                cvId = extractCvId(dataRoot?.id || dataRoot?.cvid);
            }
            return cvId;
        };

        // Video (in dynamic)
        if (type === 'video' || major.type === 'MAJOR_TYPE_ARCHIVE') {
            const title = major.archive?.title || '';
            return title ? `${userName} 投稿了新视频：\n${title}` : `${userName} 投稿了新视频`;
        }

        // Article/Opus (in dynamic)
        if (type === 'article' || major.type === 'MAJOR_TYPE_OPUS') {
            const title = major.opus?.title || data.title || '';
            const cvId = resolveCvId(major, item, data);
            if (cvId) {
                return title ? `${userName} 投稿了新专栏：\n${title}` : `${userName} 投稿了新专栏`;
            }
            return `${userName} 发布了新动态`;
        }

        // Forward
        if (type === 'forward' || item.type === 'DYNAMIC_TYPE_FORWARD') {
            const orig = item.orig || {};
            const origItem = orig.item || orig;
            const origModules = origItem.modules || {};
            const origDynamic = origModules.module_dynamic || {};
            const origMajor = origDynamic.major || {};

            if (origMajor.type === 'MAJOR_TYPE_ARCHIVE') {
                const title = origMajor.archive?.title || '';
                return title ? `${userName} 转发了视频：\n${title}` : `${userName} 转发了视频`;
            }
            if (origMajor.type === 'MAJOR_TYPE_OPUS') {
                const title = origMajor.opus?.title || '';
                const cvId = resolveCvId(origMajor, origItem, orig);
                if (cvId) {
                    return title ? `${userName} 转发了专栏：\n${title}` : `${userName} 转发了专栏`;
                }
                return `${userName} 转发了一条动态`;
            }
            return `${userName} 转发了一条动态`;
        }

        // Plain text dynamic
        if (item.type === 'DYNAMIC_TYPE_WORD') {
            return `${userName} 发布了新动态`;
        }

        // Default
        return `${userName} 发布了新动态`;
    }

    async checkUserDynamic(sub, targetGroups = null, force = false) {
        // Use provided targetGroups or fall back to sub.groupIds
        const groupsToNotify = targetGroups || sub.groupIds;
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

            let latestNonLiveCard = null;
            let latestNonLiveId = null;
            for (const c of cards) {
                if (!this.isLiveDynamic(c)) {
                    latestNonLiveCard = c;
                    latestNonLiveId = c.id_str || (c.desc && c.desc.dynamic_id_str);
                    break;
                }
            }

            if (!sub.lastDynamicId && !force) {
                if (latestNonLiveId) {
                    await subscriptionManager.updateUserSub(sub.uid, { lastDynamicId: latestNonLiveId });
                }
                return;
            }

            if (latestId !== sub.lastDynamicId || force) {
                let newCards = [];
                
                if (force) {
                    if (latestNonLiveCard) {
                        newCards = [latestNonLiveCard];
                        logger.info(`[UpdateChecker] Force checking dynamic for ${sub.name} (ID: ${latestNonLiveId})`);
                    } else {
                        newCards = [];
                        logger.info(`[UpdateChecker] Force check found only live dynamic for ${sub.name}, skipping`);
                    }
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
                    if (this.isLiveDynamic(card)) {
                        logger.info(`[UpdateChecker] Skipping live dynamic for ${sub.name} (ID: ${cardId}) - expecting checkUserLive to handle it`);
                        continue;
                    }

                    // Fetch dynamic detail using standard API (unified with linkHandler)
                    // This ensures data format consistency and completeness
                    const groupId = groupsToNotify[0];  // Use first group's cookie for API call
                    const info = await biliApi.getDynamicInfo(cardId, groupId);

                    if (info.status !== 'success') {
                        logger.warn(`[UpdateChecker] Failed to get dynamic detail for ${cardId}, skipping`);
                        continue;
                    }

                    // Generate notification text using unified function
                    const notificationText = this.generateNotificationText(sub.name, info);

                    // Notify
                    try {
                        const url = `https://t.bilibili.com/${cardId}`;
                        await this.notifyGroupsWithImage(groupsToNotify, info, info.type || 'dynamic', url, notificationText);

                    } catch (e) {
                        logger.error(`[UpdateChecker] Failed to generate image for dynamic ${cardId}:`, e);
                        // Fallback text
                        const msg = `${notificationText}\nhttps://t.bilibili.com/${cardId}`;
                        this.notifyGroups(groupsToNotify, msg, cardId);
                    }
                }

                if (!force) {
                    if (latestNonLiveId) {
                        await subscriptionManager.updateUserSub(sub.uid, { lastDynamicId: latestNonLiveId });
                    }
                }
            }
        } catch (e) {
            logger.error(`[UpdateChecker] Error checking dynamic for ${sub.name}:`, e);
        }
    }

    async checkUserLive(sub, targetGroups = null, force = false) {
        // Use provided targetGroups or fall back to sub.groupIds
        const groupsToNotify = targetGroups || sub.groupIds;
        // 使用第一个群组的cookie获取用户信息
        const groupId = groupsToNotify[0];
        try {
            const res = await biliApi.getUserInfo(sub.uid, groupId); // getUserInfo contains live_room
            if (res.status !== 'success') return;

            const liveRoom = res.data.live_room || {};

            let liveStatus = liveRoom.liveStatus; // 1: live, 0: offline
            let roomId = liveRoom.roomid || liveRoom.room_id;

            // roomId 缓存逻辑：如果API返回了roomId，保存到subscription；如果没有，使用缓存的
            if (roomId) {
                // API返回了roomId，缓存它
                if (sub.roomId !== roomId) {
                    logger.info(`[UpdateChecker] Caching roomId ${roomId} for user ${sub.uid} (${sub.name})`);
                    await subscriptionManager.updateUserSub(sub.uid, { roomId });
                    sub.roomId = roomId; // 同步更新内存中的值
                }
            } else if (sub.roomId) {
                // API没有返回roomId，但subscription中有缓存
                roomId = sub.roomId;
                logger.debug(`[UpdateChecker] API returned empty live_room for user ${sub.uid} (${sub.name}), using cached roomId ${roomId}`);
                // 注意：此时liveStatus为undefined，不会触发开播通知，这是期望的行为
                // 下次API正常时会恢复检查
            } else {
                // API没有返回，缓存中也没有，跳过检查
                logger.warn(`[UpdateChecker] No room ID available for user ${sub.uid} (${sub.name}), skipping live check. User may not have a live room.`);
                return;
            }

            const roomUrl = liveRoom.url || `https://live.bilibili.com/${roomId}`;
            const title = liveRoom.title || '直播间';
            const cover = liveRoom.cover;

            if ((liveStatus === 1 && sub.lastLiveStatus === 0) || (force && liveStatus === 1)) {
                // Started Streaming or Force Check
                // Fetch live room detail using standard API (unified with linkHandler)
                const liveInfo = await biliApi.getLiveRoomInfo(roomId, groupId);

                if (liveInfo.status !== 'success') {
                    logger.warn(`[UpdateChecker] Failed to get live room info for ${roomId} (${sub.name}), skipping notification`);
                } else {
                    liveInfo.id = roomId;
                    await this.notifyGroupsWithImage(groupsToNotify, liveInfo, 'live', roomUrl, `${sub.name} 开播了！`);
                }
            }

            if (liveStatus !== sub.lastLiveStatus) {
                await subscriptionManager.updateUserSub(sub.uid, { lastLiveStatus: liveStatus });
            }
        } catch (e) {
            logger.error(`[UpdateChecker] Error checking live for ${sub.name}:`, e);
        }
    }

    async checkBangumi(sub, targetGroups = null) {
        // Use provided targetGroups or fall back to sub.groupIds
        const groupsToNotify = targetGroups || sub.groupIds;
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
                // New Episode - use standard API response format (unified with linkHandler)
                const url = `https://www.bilibili.com/bangumi/play/ep${newEp.id}`;
                const notificationText = `${sub.title} 更新了：${newEp.index_show}`;

                try {
                    await this.notifyGroupsWithImage(groupsToNotify, res, 'bangumi', url, notificationText);
                } catch (e) {
                    logger.error(`[UpdateChecker] Failed to generate image for bangumi ${sub.seasonId}:`, e);
                    this.notifyGroups(groupsToNotify, `${notificationText}\n${url}`, newEp.id);
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
            if (type === 'bangumi') {
                const st = data?.season_type ?? data?.data?.season_type;
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

        // Get all groups with sync enabled and bot is still in
        const groupsWithSync = Object.keys(config.groupConfigs || {}).filter(gid => {
            const groupConfig = config.groupConfigs[gid];
            // Skip groups bot has left
            if (groupConfig && groupConfig.isInGroup === false) {
                return false;
            }
            return config.getGroupConfig(gid, 'enableCookieSync');
        });

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
                await subscriptionManager.setGroupAccountMapping(groupId, myUid);
                
                // If we already refreshed this account in this cycle, skip fetching
                if (visitedUids.has(myUid)) {
                    continue;
                }
                
                // Fetch followings
                logger.info(`[UpdateChecker] Refreshing followings for account ${myUid} via group ${groupId}`);
                const res = await biliApi.getMyFollowings(null, groupId);
                
                if (res.status === 'success' && res.data) {
                    await subscriptionManager.setCookieFollowings(myUid, res.data);
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
