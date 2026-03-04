const subscriptionManager = require('./subscriptionManager');
const notificationService = require('../../services/notificationService');
const biliApi = require('../../services/biliApi');
const imageGenerator = require('../../services/imageGenerator');
const config = require('../../config');
const logger = require('../../utils/logger');
const notificationHistory = require('../../utils/notificationHistory');

const VALID_AT_ALL_SOURCES = new Set(config.SUBSCRIPTION_AT_ALL_SOURCE_KEYS || ['manual', 'cookieSync']);
const VALID_AT_ALL_CATEGORIES = new Set(config.SUBSCRIPTION_AT_ALL_CATEGORY_KEYS || [
    'video',
    'dynamic',
    'live',
    'article',
    'bangumi',
    'movie',
    'tv',
    'guocha',
    'doc',
    'variety'
]);

function normalizeSourceList(value) {
    const list = Array.isArray(value) ? value : [value];
    const normalized = [];
    for (const item of list) {
        const source = String(item || '').trim();
        if (!source || !VALID_AT_ALL_SOURCES.has(source)) continue;
        if (!normalized.includes(source)) {
            normalized.push(source);
        }
    }
    return normalized;
}

function toUidString(value) {
    if (value === null || value === undefined) return null;
    const uid = String(value).trim();
    if (!/^\d+$/.test(uid)) return null;
    return uid;
}

/**
 * 解析专栏推送的实际类型和标题
 * 新版 B 站专栏（cv号）可能被重定向为 opus/动态格式，需按实际类型处理
 * @param {Object} info - biliApi.getArticleInfo 返回值
 * @returns {{ actualType: string, title: string }}
 */
function resolveArticleTitle(info) {
    const actualType = info.type || 'article'
    const title = actualType === 'dynamic'
        ? info.data?.item?.modules?.module_dynamic?.major?.opus?.title
        : info.data?.title
    return { actualType, title: title || '（无标题）' }
}

class UpdateChecker {
    constructor() {
        this.checkInterval = (config.subscriptionCheckInterval || 60) * 1000;
        this.syncInterval = 60 * 60 * 1000; // 1 hour
        this.timer = null;
        this.syncTimer = null;
        this.initTimer = null;
        this.initSyncTimer = null;
        this.ws = null;
        this.credentialRefreshTimer = null;
        this.CREDENTIAL_REFRESH_INTERVAL = 24 * 60 * 60 * 1000; // 24小时
        this.AT_ALL_CAPABILITY_CACHE_TTL_MS = 30 * 1000; // 30秒
        this.AT_ALL_SEND_FAILURE_CACHE_TTL_MS = 5 * 60 * 1000; // 5分钟
        this.AT_ALL_CAPABILITY_WARMUP_BATCH_SIZE = 5;
        this.groupAtAllCapabilityCache = new Map(); // groupId -> { canAtAll, expiresAt, reason, retcode }
        this.groupAtAllCapabilityInFlight = new Map(); // groupId -> Promise<capability>
        this.groupBotRoleCache = new Map(); // groupId -> { role, allowed, expiresAt, reason, retcode }
        this.groupBotRoleInFlight = new Map(); // groupId -> Promise<roleState>
        this._checkAllInFlight = false;
    }

    setWs(ws) {
        this.ws = ws;
        this.groupAtAllCapabilityCache.clear();
        this.groupAtAllCapabilityInFlight.clear();
        this.groupBotRoleCache.clear();
        this.groupBotRoleInFlight.clear();
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

        // 5. Cookie 自动刷新：Bot 启动时立即检查，之后每24小时一次
        this.checkAndRefreshCredential().catch(e => {
            logger.error('[UpdateChecker] Unexpected error in credential refresh:', e);
        });
        this.credentialRefreshTimer = setInterval(
            () => { this.checkAndRefreshCredential().catch(e => {
                logger.error('[UpdateChecker] Unexpected error in credential refresh:', e);
            }); },
            this.CREDENTIAL_REFRESH_INTERVAL
        );

        this.warmupGroupAtAllCapabilities(true).catch(e => {
            logger.error('[UpdateChecker] Failed to warmup @all capabilities:', e);
        });

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

        if (this.credentialRefreshTimer) {
            clearInterval(this.credentialRefreshTimer);
            this.credentialRefreshTimer = null;
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
     * 向 Admin 发送私聊通知
     * @param {string} message
     */
    notifyAdmin(message) {
        const adminQQ = config.adminQQ;
        if (!adminQQ) return;
        if (!this.ws) {
            logger.warn(`[UpdateChecker] Cannot notify admin (WebSocket not ready): ${message}`);
            return;
        }
        notificationService.sendPrivateMessage(this.ws, adminQQ, `[Bot通知] ${message}`);
    }

    /**
     * 检查并自动刷新 B站 Cookie
     */
    async checkAndRefreshCredential() {
        try {
            const result = await biliApi.refreshCredential();
            if (result.status === 'error') {
                logger.warn(`[UpdateChecker] Cookie状态异常: ${result.message}`);
                this.notifyAdmin(`⚠️ B站Cookie异常：${result.message}`);
            } else if (result.refreshed) {
                logger.info('[UpdateChecker] B站Cookie已自动刷新成功');
                this.notifyAdmin('✅ B站Cookie已自动刷新成功');
            } else {
                logger.debug('[UpdateChecker] B站Cookie有效，无需刷新');
            }
        } catch (e) {
            logger.error('[UpdateChecker] Cookie刷新检查失败:', e);
            // Python 服务不可用时静默（ServiceManager 会处理重启通知）
        }
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
                syncTimer: !!this.syncTimer,
                credentialRefreshTimer: !!this.credentialRefreshTimer
            },
            intervals: {
                check: `${this.checkInterval / 1000}s`,
                sync: `${this.syncInterval / 1000}s`,
                credentialRefresh: `${this.CREDENTIAL_REFRESH_INTERVAL / 1000}s`
            }
        };
    }

    updateCheckInterval(seconds) {
        this.checkInterval = seconds * 1000;
        this.stop();
        this.start();
    }

    async checkAll() {
        if (this._checkAllInFlight) {
            logger.warn('[UpdateChecker] Scheduled check skipped: previous check is still running');
            return;
        }
        this._checkAllInFlight = true;
        logger.info('[UpdateChecker] Starting scheduled check...');
        try {
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

            // Prepare split coverage sets for feed checks (dynamic/live are independent)
            const feedCoverage = {
                dynamicUids: new Set(),
                liveUids: new Set()
            };

            // 1. Check Feed Updates (Cookie Sync)
            // This will populate feedCoverage with UIDs covered by feed checks
            await this.checkFeedUpdate(feedCoverage, activeGroups);
            logger.debug(`[UpdateChecker] Feed coverage: dynamic=${feedCoverage.dynamicUids.size}, live=${feedCoverage.liveUids.size}`);

            // 2. Check User Dynamics (Manual Subs)
            for (const sub of subscriptionManager.userSubs) {
                // Skip dynamic fallback only if dynamic feed has covered this user
                if (feedCoverage.dynamicUids.has(String(sub.uid))) {
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

            // 3. Build unified user check list (Manual Subs + Cookie Sync)
            const userCheckList = this.buildUserCheckList(activeGroups);
            logger.info(`[UpdateChecker] Built unified user check list: ${userCheckList.length} users (manual: ${subscriptionManager.userSubs.length}, after merge)`);

            // 4. Check User Videos (Manual Subs + Cookie Sync)
            logger.info('[UpdateChecker] Checking user videos (unified)...');
            for (const userItem of userCheckList) {
                await this.checkUserVideoUnified(userItem);
                // Slightly longer delay for video API
                await new Promise(r => setTimeout(r, 1500));
            }

            // 5. Check User Articles (Manual Subs + Cookie Sync)
            logger.info('[UpdateChecker] Checking user articles (unified)...');
            for (const userItem of userCheckList) {
                await this.checkUserArticleUnified(userItem);
                // Slightly longer delay for article API
                await new Promise(r => setTimeout(r, 1500));
            }

            // 6. Check User Live Status (Manual Subs)
            for (const sub of subscriptionManager.userSubs) {
                // Skip live fallback only if live feed has covered this user
                if (feedCoverage.liveUids.has(String(sub.uid))) {
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

            // 7. Check Bangumi Updates
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

            // 8. Refresh missing names (maintenance)
            await this.refreshMissingNames();
        } catch (error) {
            logger.error('[UpdateChecker] Scheduled check failed:', error);
        } finally {
            this._checkAllInFlight = false;
        }
    }

    createGroupSourceMap(groupIds = [], sources = ['manual']) {
        const map = new Map();
        const normalizedSources = normalizeSourceList(sources);
        const fallbackSources = normalizedSources.length > 0 ? normalizedSources : ['manual'];

        for (const groupId of groupIds || []) {
            const gid = String(groupId);
            if (!gid) continue;
            const sourceSet = new Set();
            fallbackSources.forEach(source => sourceSet.add(source));
            map.set(gid, sourceSet);
        }

        return map;
    }

    mergeGroupSourceMap(targetMap, groupId, sources) {
        if (!targetMap || !groupId) return;
        const gid = String(groupId);
        const normalizedSources = normalizeSourceList(sources);
        const sourceList = normalizedSources.length > 0 ? normalizedSources : ['manual'];

        if (!targetMap.has(gid)) {
            targetMap.set(gid, new Set(sourceList));
            return;
        }

        const existing = targetMap.get(gid);
        sourceList.forEach(source => existing.add(source));
    }

    getGroupIdsFromSourceMap(sourceMap) {
        if (!(sourceMap instanceof Map)) return [];
        return Array.from(sourceMap.keys());
    }

    normalizeGroupSourceMap(groupTargets, fallbackSource = 'manual') {
        if (groupTargets instanceof Map) {
            const cloned = new Map();
            for (const [groupId, sources] of groupTargets.entries()) {
                this.mergeGroupSourceMap(cloned, groupId, Array.isArray(sources) ? sources : Array.from(sources || []));
            }
            return cloned;
        }

        if (Array.isArray(groupTargets)) {
            return this.createGroupSourceMap(groupTargets, [fallbackSource]);
        }

        if (groupTargets && typeof groupTargets === 'object') {
            const normalized = new Map();
            for (const [groupId, sources] of Object.entries(groupTargets)) {
                this.mergeGroupSourceMap(normalized, groupId, Array.isArray(sources) ? sources : [sources]);
            }
            return normalized;
        }

        return new Map();
    }

    /**
     * 构建需要检查视频/专栏的统一用户列表
     * 合并手动订阅用户 + Cookie同步用户，自动去重
     * @param {Set} activeGroups - 活跃群组集合
     * @returns {Array<{uid, name, targetGroups, source, manualSub?, cookieFollower?, accountUid?}>} 用户检查列表
     */
    buildUserCheckList(activeGroups) {
        const userMap = new Map(); // uid -> {uid, name, targetGroups, source}

        // 1. 添加手动订阅用户
        for (const sub of subscriptionManager.userSubs) {
            const manualUid = String(sub?.uid ?? '').trim();
            if (!manualUid) continue;

            const targetGroups = sub.groupIds.filter(gid => activeGroups.has(gid));
            if (targetGroups.length === 0) continue;
            const sourceMap = this.createGroupSourceMap(targetGroups, ['manual']);

            userMap.set(manualUid, {
                uid: manualUid,
                name: sub.name,
                targetGroups: targetGroups,
                targetGroupSourceMap: sourceMap,
                source: 'manual',
                manualSub: sub // 保留原始订阅对象的引用
            });
        }

        // 2. 添加Cookie同步用户
        for (const [accountUid, followers] of Object.entries(subscriptionManager.cookieFollowings)) {
            for (const follower of followers) {
                const fid = subscriptionManager.getFollowerId(follower);
                if (!fid) continue;

                // 使用 findTargetGroupSourceMapForUser 判断哪些群组需要推送，并保留来源信息
                const targetGroupSourceMap = this.findTargetGroupSourceMapForUser(accountUid, follower, activeGroups);
                const targetGroups = this.getGroupIdsFromSourceMap(targetGroupSourceMap);
                if (targetGroups.length === 0) continue;

                // 如果用户已存在（手动订阅），合并目标群组
                if (userMap.has(fid)) {
                    const existing = userMap.get(fid);
                    // 合并群组和来源（去重）
                    targetGroupSourceMap.forEach((sources, gid) => {
                        this.mergeGroupSourceMap(existing.targetGroupSourceMap, gid, Array.from(sources));
                    });
                    existing.targetGroups = this.getGroupIdsFromSourceMap(existing.targetGroupSourceMap);
                    existing.source = 'both'; // 标记为双重来源
                    existing.cookieFollower = follower; // 添加Cookie follower引用
                    existing.accountUid = accountUid; // Cookie所属账号
                } else {
                    userMap.set(fid, {
                        uid: fid,
                        name: follower.name || `User_${fid}`,
                        targetGroups: targetGroups,
                        targetGroupSourceMap,
                        source: 'cookie',
                        cookieFollower: follower,
                        accountUid: accountUid // Cookie所属账号
                    });
                }
            }
        }

        return Array.from(userMap.values());
    }

    collectFeedCoveredUids(accountUid, activeGroups = null) {
        const followers = subscriptionManager.cookieFollowings[String(accountUid)] || [];
        const uidSet = new Set();

        for (const follower of followers) {
            const fid = subscriptionManager.getFollowerId(follower);
            if (!fid) continue;

            // This includes both:
            // 1. Cookie sync + tag matching groups
            // 2. Manual subscription groups (regardless of tag)
            const targetGroups = this.findTargetGroupsForUser(accountUid, follower, activeGroups);
            if (targetGroups.length > 0) {
                uidSet.add(fid);
            }
        }

        return Array.from(uidSet);
    }

    async checkFeedUpdate(feedCoverage = null, activeGroups = null) {
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

        const dynamicCoverage = feedCoverage && feedCoverage.dynamicUids instanceof Set ? feedCoverage.dynamicUids : null;
        const liveCoverage = feedCoverage && feedCoverage.liveUids instanceof Set ? feedCoverage.liveUids : null;

        // Loop through accounts
        for (const [uid, groupId] of accountGroups) {
            const uidsCoveredByFeed = (dynamicCoverage || liveCoverage)
                ? this.collectFeedCoveredUids(uid, activeGroups)
                : [];

            let dynamicSucceeded = false;
            try {
                // Process Dynamic Feed
                const dynamicResult = await this.processDynamicFeed(uid, groupId, activeGroups);
                dynamicSucceeded = dynamicResult?.ok === true;

                if (dynamicSucceeded && dynamicCoverage && uidsCoveredByFeed.length > 0) {
                    for (const fid of uidsCoveredByFeed) {
                        dynamicCoverage.add(fid);
                    }
                }
            } catch (e) {
                logger.error(`[UpdateChecker] Dynamic feed update failed for account ${uid}:`, e);
            }

            // Wait 2s between dynamic and live feed
            await new Promise(r => setTimeout(r, 2000));

            let liveSucceeded = false;
            try {
                // Process Live Feed
                const liveResult = await this.processLiveFeed(uid, groupId, activeGroups);
                liveSucceeded = liveResult?.ok === true;

                if (liveSucceeded && liveCoverage && uidsCoveredByFeed.length > 0) {
                    for (const fid of uidsCoveredByFeed) {
                        liveCoverage.add(fid);
                    }
                }
            } catch (e) {
                logger.error(`[UpdateChecker] Live feed update failed for account ${uid}:`, e);
            }

            logger.debug(`[UpdateChecker] Feed coverage commit for ${uid}: dynamic=${dynamicSucceeded}, live=${liveSucceeded}, candidates=${uidsCoveredByFeed.length}`);
        }
    }

    async processDynamicFeed(accountUid, groupId, activeGroups = null) {
        const followers = subscriptionManager.cookieFollowings[String(accountUid)];
        if (!followers || followers.length === 0) {
            return { ok: true, reason: 'no_followers' };
        }

        // Use safe ID generation
        const followerMap = new Map(followers.map(f => [subscriptionManager.getFollowerId(f), f]));
        let offset = '';
        let prevOffset = null;
        let hasMore = true;
        let page = 0;
        // 使用 pendingUpdates 追踪变更，而非直接修改 followers 元素，
        // 避免 refreshCookieFollowings 并发替换数组引用时发生竞态条件
        const pendingUpdates = new Map(); // uid → { lastDynamicId }

        while (hasMore && page < 5) {
            const res = await biliApi.getDynamicFeed(offset, groupId);
            if (res.status !== 'success' || !res.data) {
                logger.warn(`[UpdateChecker] Failed to get dynamic feed for account ${accountUid} (Group: ${groupId})`);
                return { ok: false, reason: 'dynamic_feed_fetch_failed' };
            }

            const allItems = res.data.items || [];
            const items = allItems.filter(item => !this.shouldSkipDynamic(item));

            if (items.length < allItems.length) {
                logger.info(`[UpdateChecker] Feed: Filtered ${allItems.length - items.length} auto-post dynamics`);
            }

            hasMore = res.data.has_more;
            offset = res.data.offset;
            if (offset === prevOffset) break; // Prevent infinite loop on unchanged offset
            prevOffset = offset;
            page++;

            if (items.length === 0) {
                logger.debug(`[UpdateChecker] Page ${page} all filtered, continuing to next page`);
                continue;
            }

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

                    const targetGroupSourceMap = this.findTargetGroupSourceMapForUser(accountUid, follower, activeGroups);
                    const targetGroups = this.getGroupIdsFromSourceMap(targetGroupSourceMap);

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
                        await this.notifyGroupsWithImageAndCache(
                            targetGroupSourceMap,
                            info,
                            info.type || 'dynamic',
                            url,
                            notificationText,
                            { actorUid: authorUid, fallbackSources: ['cookieSync'] }
                        );
                    }
                }

                // 追踪最新 dynamicId（取 follower 原始值与已记录的 pending 值中的最大值作为基准）
                const pendingMax = pendingUpdates.has(authorUid)
                    ? pendingUpdates.get(authorUid).lastDynamicId
                    : follower.lastDynamicId;
                try {
                    if (!pendingMax || BigInt(dynamicId) > BigInt(pendingMax || '0')) {
                        pendingUpdates.set(authorUid, { lastDynamicId: dynamicId });
                    }
                } catch (e) {
                    const a = String(dynamicId).padStart(20, '0')
                    const b = String(pendingMax || '0').padStart(20, '0')
                    if (!pendingMax || a > b) {
                        pendingUpdates.set(authorUid, { lastDynamicId: dynamicId })
                    }
                }
            }
        }

        // 使用 updateCookieFollowerState 逐一写入，始终操作 cookieFollowings 的当前引用，
        // 避免最终 setCookieFollowings 调用因竞态条件覆盖状态
        for (const [uid, updates] of pendingUpdates) {
            await subscriptionManager.updateCookieFollowerState(accountUid, uid, updates);
        }

        return { ok: true };
    }

    async processLiveFeed(accountUid, groupId, activeGroups = null) {
        const res = await biliApi.getLiveFeed(groupId);
        if (res.status !== 'success' || !res.data || !res.data.list) {
            return { ok: false, reason: 'live_feed_fetch_failed' };
        }

        const liveList = res.data.list;
        const followers = subscriptionManager.cookieFollowings[String(accountUid)];
        if (!followers) {
            return { ok: true, reason: 'no_followers' };
        }

        // Use safe ID generation
        const followerMap = new Map(followers.map(f => [subscriptionManager.getFollowerId(f), f]));
        // 使用 pendingUpdates 追踪变更，避免竞态条件
        const pendingUpdates = new Map(); // uid → { lastLiveStatus }
        const onlineUids = new Set();

        for (const item of liveList) {
            const uid = String(item.uid);
            onlineUids.add(uid);
            if (!followerMap.has(uid)) continue;

            const follower = followerMap.get(uid);
            const liveStatus = item.live_status; // Should be 1 in live feed

            // Check if status changed from 0 to 1
            if (liveStatus === 1 && follower.lastLiveStatus !== 1) {
                const targetGroupSourceMap = this.findTargetGroupSourceMapForUser(accountUid, follower, activeGroups);
                const targetGroups = this.getGroupIdsFromSourceMap(targetGroupSourceMap);

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

                    await this.notifyGroupsWithImageAndCache(
                        targetGroupSourceMap,
                        liveInfo,
                        'live',
                        roomUrl,
                        `${name} 开播了！`,
                        { actorUid: uid, fallbackSources: ['cookieSync'] }
                    );
                }
            }

            if (follower.lastLiveStatus !== liveStatus) {
                pendingUpdates.set(uid, { lastLiveStatus: liveStatus });
            }
        }

        // Handle offline users
        // If a user was live (lastLiveStatus === 1) but is no longer in the live list, set them to offline (0)
        for (const follower of followers) {
            const uid = subscriptionManager.getFollowerId(follower);
            if (follower.lastLiveStatus === 1 && !onlineUids.has(uid)) {
                pendingUpdates.set(uid, { lastLiveStatus: 0 });
            }
        }

        // 使用 updateCookieFollowerState 逐一写入，始终操作 cookieFollowings 的当前引用，
        // 避免最终 setCookieFollowings 调用因竞态条件覆盖状态
        for (const [uid, updates] of pendingUpdates) {
            await subscriptionManager.updateCookieFollowerState(accountUid, uid, updates);
        }

        return { ok: true };
    }

    findTargetGroupSourceMapForUser(accountUid, follower, activeGroups = null) {
        const targetMap = new Map();
        const followerId = subscriptionManager.getFollowerId(follower);
        const followerTags = Array.isArray(follower?.biliGroups)
            ? follower.biliGroups.map(tag => String(tag))
            : [];

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
                allowedTags = allowedTags.split(',').map(s => s.trim()).filter(Boolean);
            }
            if (!Array.isArray(allowedTags)) {
                allowedTags = [];
            }
            if (allowedTags.length > 0) {
                const hasTag = allowedTags.some(tag => followerTags.includes(tag));
                if (!hasTag) continue;
            }

            this.mergeGroupSourceMap(targetMap, gid, ['cookieSync']);
        }

        // 2. Find manual subscriptions for this user (Group Subscription)
        // Even if the group didn't enable sync, if they manually subscribed, they should get it.
        // And since we are in the Feed flow, we know this user updated.
        const manualSub = subscriptionManager.userSubs.find(s => String(s.uid) === followerId);
        if (manualSub) {
            manualSub.groupIds.forEach(gid => {
                // Filter out inactive groups
                if (activeGroups && !activeGroups.has(String(gid))) return;
                this.mergeGroupSourceMap(targetMap, gid, ['manual']);
            });
        }

        return targetMap;
    }

    findTargetGroupsForUser(accountUid, follower, activeGroups = null) {
        const sourceMap = this.findTargetGroupSourceMapForUser(accountUid, follower, activeGroups);
        return this.getGroupIdsFromSourceMap(sourceMap);
    }

    isLiveDynamic(card) {
        const t = card.type || (card.desc && card.desc.type);
        return t === 'DYNAMIC_TYPE_LIVE_RCMD' ||
               t === 4308 ||
               (card.modules?.module_dynamic?.major?.type === 'MAJOR_TYPE_LIVE_RCMD');
    }

    /**
     * Check if a dynamic should be skipped (video/article auto-post dynamics)
     * @param {object} item - Dynamic item from API
     * @returns {boolean} - True if should skip this dynamic
     */
    shouldSkipDynamic(item) {
        if (!item) return false;

        const major = item?.modules?.module_dynamic?.major;

        // Skip video post auto-dynamic
        if (major?.type === 'MAJOR_TYPE_ARCHIVE' || item.type === 'DYNAMIC_TYPE_AV') {
            logger.debug(`[UpdateChecker] Skipping video dynamic: ${item.id_str}`);
            return true;
        }

        // Skip article post auto-dynamic (check for cv ID in jump URL)
        if (major?.type === 'MAJOR_TYPE_OPUS') {
            const jumpUrl = major.opus?.jump_url || '';
            if (/\/read\/cv\d+/i.test(jumpUrl)) {
                logger.debug(`[UpdateChecker] Skipping article dynamic: ${item.id_str}`);
                return true;
            }
        }

        return false;
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
        const targetGroupSourceMap = this.createGroupSourceMap(groupsToNotify, ['manual']);
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

            const allCards = res.data.cards;
            const cards = allCards.filter(card => !this.shouldSkipDynamic(card));

            if (cards.length < allCards.length) {
                logger.info(`[UpdateChecker] Filtered ${allCards.length - cards.length} auto-post dynamics for ${sub.name}`);
            }

            if (cards.length === 0) return;

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
                        await this.notifyGroupsWithImageAndCache(
                            targetGroupSourceMap,
                            info,
                            info.type || 'dynamic',
                            url,
                            notificationText,
                            { actorUid: sub.uid, fallbackSources: ['manual'] }
                        );

                    } catch (e) {
                        logger.error(`[UpdateChecker] Failed to generate image for dynamic ${cardId}:`, e);
                        // Fallback text
                        const msg = `${notificationText}\nhttps://t.bilibili.com/${cardId}`;
                        this.notifyGroups(
                            targetGroupSourceMap,
                            msg,
                            cardId,
                            { actorUid: sub.uid, category: info.type || 'dynamic', fallbackSources: ['manual'] }
                        );
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
        const targetGroupSourceMap = this.createGroupSourceMap(groupsToNotify, ['manual']);
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
                    await this.notifyGroupsWithImageAndCache(
                        targetGroupSourceMap,
                        liveInfo,
                        'live',
                        roomUrl,
                        `${sub.name} 开播了！`,
                        { actorUid: sub.uid, fallbackSources: ['manual'] }
                    );
                }
            }

            // Guard against transient API anomalies: do not overwrite status with undefined/null.
            if ((liveStatus === 0 || liveStatus === 1) && liveStatus !== sub.lastLiveStatus) {
                await subscriptionManager.updateUserSub(sub.uid, { lastLiveStatus: liveStatus });
            }
        } catch (e) {
            logger.error(`[UpdateChecker] Error checking live for ${sub.name}:`, e);
        }
    }

    async checkBangumi(sub, targetGroups = null) {
        // Use provided targetGroups or fall back to sub.groupIds
        const groupsToNotify = targetGroups || sub.groupIds;
        const targetGroupSourceMap = this.createGroupSourceMap(groupsToNotify, ['manual']);
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
                    await this.notifyGroupsWithImageAndCache(
                        targetGroupSourceMap,
                        res,
                        'bangumi',
                        url,
                        notificationText,
                        { actorUid: null, fallbackSources: ['manual'] }
                    );
                } catch (e) {
                    logger.error(`[UpdateChecker] Failed to generate image for bangumi ${sub.seasonId}:`, e);
                    this.notifyGroups(
                        targetGroupSourceMap,
                        `${notificationText}\n${url}`,
                        newEp.id,
                        { actorUid: null, category: 'bangumi', fallbackSources: ['manual'] }
                    );
                }

                await subscriptionManager.updateBangumiSub(sub.seasonId, { lastEpId: newEp.id });
            }
        } catch (e) {
            logger.error(`[UpdateChecker] Error checking bangumi ${sub.title}:`, e);
        }
    }

    /**
     * 统一的视频检查方法（支持手动订阅和Cookie同步）
     * @param {Object} userItem - 从buildUserCheckList返回的用户对象
     * @param {boolean} force - 是否强制检查
     */
    async checkUserVideoUnified(userItem, force = false) {
        const {
            uid,
            name,
            targetGroups: rawTargetGroups,
            source,
            manualSub,
            cookieFollower,
            accountUid,
            targetGroupSourceMap
        } = userItem;

        const fallbackSource = source === 'cookie' ? 'cookieSync' : 'manual';
        const normalizedTargetGroupSourceMap = this.normalizeGroupSourceMap(targetGroupSourceMap || rawTargetGroups, fallbackSource);
        const targetGroups = this.getGroupIdsFromSourceMap(normalizedTargetGroupSourceMap);

        try {
            if (targetGroups.length === 0) return;
            const groupId = targetGroups[0];
            const res = await biliApi.getUserVideos(uid, groupId);

            if (res.status !== 'success' || !res.data.videos || res.data.videos.length === 0) {
                return;
            }

            const videos = res.data.videos;
            videos.sort((a, b) => b.created - a.created);
            const latestVideo = videos[0];
            const latestBvid = latestVideo.bvid;
            const latestVideoCreatedRaw = Number(latestVideo.created);
            const latestVideoCreated = Number.isFinite(latestVideoCreatedRaw) ? latestVideoCreatedRaw : null;

            // 获取lastVideoId（优先从手动订阅，其次从Cookie follower）
            let lastVideoId = null;
            let lastVideoCreated = null;
            if (manualSub) {
                lastVideoId = manualSub.lastVideoId;
                lastVideoCreated = manualSub.lastVideoCreated;
            } else if (cookieFollower) {
                lastVideoId = cookieFollower.lastVideoId;
                lastVideoCreated = cookieFollower.lastVideoCreated;
            }
            const normalizeTimestamp = value => {
                if (value === null || value === undefined || value === '') return null;
                const num = Number(value);
                return Number.isFinite(num) ? num : null;
            };
            lastVideoCreated = normalizeTimestamp(lastVideoCreated);

            // 首次检查：记录最新视频但不推送
            if (!lastVideoId && !force) {
                await this.updateVideoState(userItem, { videoId: latestBvid, videoCreated: latestVideoCreated });
                logger.info(`[UpdateChecker] Initialized lastVideoId for ${name} (${source}): ${latestBvid}`);
                return;
            }

            // 检查是否有新视频
            if (latestBvid !== lastVideoId || force) {
                // 兼容旧状态：仅有 lastVideoId 无时间戳，且 lastVideoId 已不在列表中
                // 避免升级后的首轮回放旧视频
                if (!force && lastVideoId && lastVideoCreated === null && !videos.some(v => v.bvid === lastVideoId)) {
                    await this.updateVideoState(userItem, { videoId: latestBvid, videoCreated: latestVideoCreated });
                    logger.debug(`[UpdateChecker] Legacy video anchor missing for ${name}, refreshed to ${latestBvid}`);
                    return;
                }

                const newVideos = [];
                for (const video of videos) {
                    if (video.bvid === lastVideoId) break;

                    if (!force && lastVideoCreated !== null) {
                        const createdRaw = Number(video.created);
                        const created = Number.isFinite(createdRaw) ? createdRaw : null;
                        if (created !== null && created <= lastVideoCreated) break;
                    }

                    newVideos.push(video);
                }

                let videoToPush;
                if (newVideos.length === 0) {
                    if (!force) {
                        await this.updateVideoState(userItem, { videoId: latestBvid, videoCreated: latestVideoCreated });
                        logger.debug(`[UpdateChecker] No new videos for ${name}, updated tracking to ${latestBvid}`);
                        return;
                    } else {
                        logger.debug(`[UpdateChecker] Force check: pushing latest video for ${name}: ${latestBvid}`);
                        videoToPush = [latestVideo];
                    }
                } else {
                    videoToPush = [newVideos[0]];
                    logger.debug(`[UpdateChecker] Found ${newVideos.length} new video(s) for ${name}, pushing latest: ${newVideos[0].bvid}`);
                }

                for (const video of videoToPush) {
                    try {
                        const bvid = video.bvid;
                        const info = await biliApi.getVideoInfo(bvid, groupId);

                        if (info.status !== 'success') {
                            logger.warn(`[UpdateChecker] Failed to get video detail for ${bvid}`);
                            continue;
                        }

                        if (video.is_charging_arc || video.is_upower_exclusive) {
                            info.data.is_charging_arc = true;
                            info.data.is_upower_exclusive = true;
                        }

                        const notificationText = `${name} 投稿了新视频：\n${info.data.title}`;
                        const url = `https://www.bilibili.com/video/${bvid}`;
                        await this.notifyGroupsWithImageAndCache(
                            normalizedTargetGroupSourceMap,
                            info,
                            'video',
                            url,
                            notificationText,
                            { actorUid: uid, fallbackSources: [fallbackSource] }
                        );

                        // 订阅推送后下载视频一次，发送到所有目标群
                        const videoDownloadService = require('../../services/videoDownloadService')
                        videoDownloadService.downloadAndSendToGroups(this.ws, targetGroups, bvid, info).catch(e => {
                            logger.error(`[UpdateChecker] downloadAndSendToGroups failed for ${bvid}:`, e)
                        })

                        logger.info(`[UpdateChecker] Pushed new video for ${name} (${source}): ${bvid}`);
                    } catch (e) {
                        logger.error(`[UpdateChecker] Failed to push video ${video.bvid}:`, e);
                    }
                }

                await this.updateVideoState(userItem, { videoId: latestBvid, videoCreated: latestVideoCreated });
            }
        } catch (e) {
            logger.error(`[UpdateChecker] Error checking videos for ${name} (${source}):`, e);
        }
    }

    /**
     * 统一的专栏检查方法（支持手动订阅和Cookie同步）
     * @param {Object} userItem - 从buildUserCheckList返回的用户对象
     * @param {boolean} force - 是否强制检查
     */
    async checkUserArticleUnified(userItem, force = false) {
        const {
            uid,
            name,
            targetGroups: rawTargetGroups,
            source,
            manualSub,
            cookieFollower,
            accountUid,
            targetGroupSourceMap
        } = userItem;

        const fallbackSource = source === 'cookie' ? 'cookieSync' : 'manual';
        const normalizedTargetGroupSourceMap = this.normalizeGroupSourceMap(targetGroupSourceMap || rawTargetGroups, fallbackSource);
        const targetGroups = this.getGroupIdsFromSourceMap(normalizedTargetGroupSourceMap);

        try {
            if (targetGroups.length === 0) return;
            const groupId = targetGroups[0];
            const res = await biliApi.getUserArticles(uid, groupId);

            if (res.status !== 'success' || !res.data.articles || res.data.articles.length === 0) {
                return;
            }

            const articles = res.data.articles;
            articles.sort((a, b) => b.publish_time - a.publish_time);
            const latestArticle = articles[0];
            const latestCvid = `cv${latestArticle.id}`;
            const latestArticlePublishRaw = Number(latestArticle.publish_time);
            const latestArticlePublishTime = Number.isFinite(latestArticlePublishRaw) ? latestArticlePublishRaw : null;

            // 获取lastArticleId（优先从手动订阅，其次从Cookie follower）
            let lastArticleId = null;
            let lastArticlePublishTime = null;
            if (manualSub) {
                lastArticleId = manualSub.lastArticleId;
                lastArticlePublishTime = manualSub.lastArticlePublishTime;
            } else if (cookieFollower) {
                lastArticleId = cookieFollower.lastArticleId;
                lastArticlePublishTime = cookieFollower.lastArticlePublishTime;
            }
            const normalizeTimestamp = value => {
                if (value === null || value === undefined || value === '') return null;
                const num = Number(value);
                return Number.isFinite(num) ? num : null;
            };
            lastArticlePublishTime = normalizeTimestamp(lastArticlePublishTime);

            // 首次检查：记录最新专栏但不推送
            if (!lastArticleId && !force) {
                await this.updateArticleState(userItem, { articleId: latestCvid, articlePublishTime: latestArticlePublishTime });
                logger.info(`[UpdateChecker] Initialized lastArticleId for ${name} (${source}): ${latestCvid}`);
                return;
            }

            // 检查是否有新专栏
            if (latestCvid !== lastArticleId || force) {
                // 兼容旧状态：仅有 lastArticleId 无时间戳，且 lastArticleId 已不在列表中
                // 避免升级后的首轮回放旧专栏
                if (!force && lastArticleId && lastArticlePublishTime === null && !articles.some(a => `cv${a.id}` === lastArticleId)) {
                    await this.updateArticleState(userItem, { articleId: latestCvid, articlePublishTime: latestArticlePublishTime });
                    logger.debug(`[UpdateChecker] Legacy article anchor missing for ${name}, refreshed to ${latestCvid}`);
                    return;
                }

                const newArticles = [];
                for (const article of articles) {
                    const cvid = `cv${article.id}`;
                    if (cvid === lastArticleId) break;

                    if (!force && lastArticlePublishTime !== null) {
                        const publishRaw = Number(article.publish_time);
                        const publishTime = Number.isFinite(publishRaw) ? publishRaw : null;
                        if (publishTime !== null && publishTime <= lastArticlePublishTime) break;
                    }

                    newArticles.push(article);
                }

                let articleToPush;
                if (newArticles.length === 0) {
                    if (!force) {
                        await this.updateArticleState(userItem, { articleId: latestCvid, articlePublishTime: latestArticlePublishTime });
                        logger.debug(`[UpdateChecker] No new articles for ${name}, updated tracking to ${latestCvid}`);
                        return;
                    } else {
                        logger.debug(`[UpdateChecker] Force check: pushing latest article for ${name}: ${latestCvid}`);
                        articleToPush = [latestArticle];
                    }
                } else {
                    articleToPush = [newArticles[0]];
                    logger.debug(`[UpdateChecker] Found ${newArticles.length} new article(s) for ${name}, pushing latest: cv${newArticles[0].id}`);
                }

                for (const article of articleToPush) {
                    try {
                        const cvid = `cv${article.id}`;
                        const info = await biliApi.getArticleInfo(cvid, groupId);

                        if (info.status !== 'success') {
                            logger.warn(`[UpdateChecker] Failed to get article detail for ${cvid}`);
                            continue;
                        }

                        const { actualType, title: articleTitle } = resolveArticleTitle(info)
                        const notificationText = `${name} 发布了新专栏：\n${articleTitle}`;
                        const url = `https://www.bilibili.com/read/${cvid}`;
                        await this.notifyGroupsWithImageAndCache(
                            normalizedTargetGroupSourceMap,
                            info,
                            actualType,
                            url,
                            notificationText,
                            { actorUid: uid, fallbackSources: [fallbackSource] }
                        );

                        logger.info(`[UpdateChecker] Pushed new article for ${name} (${source}): ${cvid}`);
                    } catch (e) {
                        logger.error(`[UpdateChecker] Failed to push article cv${article.id}:`, e);
                    }
                }

                await this.updateArticleState(userItem, { articleId: latestCvid, articlePublishTime: latestArticlePublishTime });
            }
        } catch (e) {
            logger.error(`[UpdateChecker] Error checking articles for ${name} (${source}):`, e);
        }
    }

    /**
     * 更新用户的视频状态
     * @param {Object} userItem - 用户对象
     * @param {Object|string} videoState - 最新视频状态或视频ID
     */
    async updateVideoState(userItem, videoState) {
        const { source, manualSub, cookieFollower, accountUid, uid } = userItem;
        const state = typeof videoState === 'string'
            ? { videoId: videoState, videoCreated: null }
            : (videoState || {});
        const normalizeTimestamp = value => {
            if (value === null || value === undefined || value === '') return null
            const num = Number(value)
            return Number.isFinite(num) ? num : null
        }
        const updates = {
            lastVideoId: state.videoId || null,
            lastVideoCreated: normalizeTimestamp(state.videoCreated)
        };

        try {
            // 更新手动订阅的状态
            if (manualSub) {
                await subscriptionManager.updateUserSub(uid, updates);
            }

            // 更新Cookie follower的状态
            // 使用 updateCookieFollowerState 直接操作当前数组中的对象，
            // 避免 refreshCookieFollowings 并发替换数组引用导致的竞态条件
            if (cookieFollower) {
                await subscriptionManager.updateCookieFollowerState(accountUid, uid, updates);
            }
        } catch (e) {
            logger.error(`[UpdateChecker] Failed to update video state for ${uid} (${source}):`, e);
        }
    }

    /**
     * 更新用户的专栏状态
     * @param {Object} userItem - 用户对象
     * @param {Object|string} articleState - 最新专栏状态或专栏ID
     */
    async updateArticleState(userItem, articleState) {
        const { source, manualSub, cookieFollower, accountUid, uid } = userItem;
        const state = typeof articleState === 'string'
            ? { articleId: articleState, articlePublishTime: null }
            : (articleState || {});
        const normalizeTimestamp = value => {
            if (value === null || value === undefined || value === '') return null
            const num = Number(value)
            return Number.isFinite(num) ? num : null
        }
        const updates = {
            lastArticleId: state.articleId || null,
            lastArticlePublishTime: normalizeTimestamp(state.articlePublishTime)
        };

        try {
            // 更新手动订阅的状态
            if (manualSub) {
                await subscriptionManager.updateUserSub(uid, updates);
            }

            // 更新Cookie follower的状态
            // 使用 updateCookieFollowerState 直接操作当前数组中的对象，
            // 避免 refreshCookieFollowings 并发替换数组引用导致的竞态条件
            if (cookieFollower) {
                await subscriptionManager.updateCookieFollowerState(accountUid, uid, updates);
            }
        } catch (e) {
            logger.error(`[UpdateChecker] Failed to update article state for ${uid} (${source}):`, e);
        }
    }

    isSubscriptionAtAllEnabled(groupId) {
        return config.getGroupConfig(groupId, 'subscriptionAtAll') === true;
    }

    getSubscriptionAtAllRules(groupId) {
        const rules = config.getGroupConfig(groupId, 'subscriptionAtAllRules');
        return config.normalizeSubscriptionAtAllRules(rules);
    }

    resolveContentSubtype(type, data) {
        let subtype = type;

        if (type === 'bangumi') {
            const seasonType = data?.season_type ?? data?.data?.season_type;
            if (seasonType === 2) subtype = 'movie';
            else if (seasonType === 3) subtype = 'doc';
            else if (seasonType === 4) subtype = 'guocha';
            else if (seasonType === 5) subtype = 'tv';
            else if (seasonType === 7) subtype = 'variety';
        } else if (type === 'dynamic' && data && data.item && data.item.desc) {
            if (data.item.desc.type === 8) subtype = 'video';
            else if (data.item.desc.type === 64) subtype = 'article';
        }

        return subtype;
    }

    resolveAtAllCategory(type, data) {
        const subtype = this.resolveContentSubtype(type, data);
        if (VALID_AT_ALL_CATEGORIES.has(subtype)) return subtype;

        if (subtype === 'forward') return 'dynamic';
        if (type === 'bangumi') return 'bangumi';
        if (type === 'live') return 'live';
        if (type === 'video') return 'video';
        if (type === 'article') return 'article';
        return 'dynamic';
    }

    buildAtAllMetaForGroup(groupId, groupSourceMap, rawMeta = {}, type = null, data = null) {
        const gid = String(groupId);
        const sourcesFromMap = groupSourceMap instanceof Map && groupSourceMap.has(gid)
            ? normalizeSourceList(Array.from(groupSourceMap.get(gid) || []))
            : [];
        const sourcesFromMeta = normalizeSourceList(rawMeta?.sources || rawMeta?.fallbackSources || ['manual', 'cookieSync']);
        const sources = sourcesFromMap.length > 0 ? sourcesFromMap : sourcesFromMeta;

        const categoryFromMeta = String(rawMeta?.category || '').trim();
        const category = VALID_AT_ALL_CATEGORIES.has(categoryFromMeta)
            ? categoryFromMeta
            : (type ? this.resolveAtAllCategory(type, data) : null);

        const actorUid = toUidString(rawMeta?.actorUid);

        return {
            sources,
            category,
            actorUid
        };
    }

    shouldAtAll(groupId, meta = {}) {
        const rules = this.getSubscriptionAtAllRules(groupId);
        const sources = normalizeSourceList(meta.sources);
        const effectiveSources = sources.length > 0 ? sources : ['manual', 'cookieSync'];
        const category = String(meta.category || '').trim();
        const actorUid = toUidString(meta.actorUid);

        if (category && VALID_AT_ALL_CATEGORIES.has(category) && rules.categories[category] === false) {
            return false;
        }

        for (const source of effectiveSources) {
            if (rules.sources[source] !== true) continue;

            if (actorUid) {
                const disabledIds = source === 'cookieSync'
                    ? rules.cookieSyncDisabledIds
                    : rules.manualDisabledIds;
                if (Array.isArray(disabledIds) && disabledIds.includes(actorUid)) {
                    continue;
                }
            }

            return true;
        }

        return false;
    }

    getSubscriptionAtAllWarmupGroups() {
        const result = [];
        const groupConfigs = config.groupConfigs || {};

        for (const [groupId, groupConfig] of Object.entries(groupConfigs)) {
            if (!groupConfig || groupConfig.isInGroup === false) continue;
            if (!config.isGroupEnabled(groupId)) continue;
            if (!this.isSubscriptionAtAllEnabled(groupId)) continue;
            result.push(String(groupId));
        }

        return result;
    }

    async warmupGroupAtAllCapabilities(forceRefresh = true) {
        const groupIds = this.getSubscriptionAtAllWarmupGroups();
        if (groupIds.length === 0) return;

        logger.info(`[UpdateChecker] Pre-checking @all capability for ${groupIds.length} groups at startup`);
        const batchSize = this.AT_ALL_CAPABILITY_WARMUP_BATCH_SIZE;

        for (let i = 0; i < groupIds.length; i += batchSize) {
            const batch = groupIds.slice(i, i + batchSize);
            await Promise.all(batch.map(gid => this.queryGroupAtAllCapability(gid, { forceRefresh })));
        }
    }

    markGroupAtAllUnavailable(groupId, reason = 'unknown', retcode = null, ttlMs = this.AT_ALL_SEND_FAILURE_CACHE_TTL_MS) {
        const cacheKey = String(groupId);
        const now = Date.now();
        this.groupAtAllCapabilityCache.set(cacheKey, {
            canAtAll: false,
            reason,
            retcode,
            expiresAt: now + Math.max(0, Number(ttlMs) || 0)
        });
    }

    async resolveBotSelfId() {
        const selfId = String(global?.bot?.selfId || '');
        if (selfId && selfId !== '0') {
            return selfId;
        }

        if (!this.ws) return null;

        try {
            const response = await notificationService.callAction(
                this.ws,
                'get_login_info',
                {},
                'UpdateChecker',
                4000
            );
            const uid = response?.data?.user_id;
            if (uid === undefined || uid === null) return null;
            const resolved = String(uid);
            global.bot = global.bot || {};
            global.bot.selfId = resolved;
            return resolved;
        } catch {
            return null;
        }
    }

    async queryBotGroupRole(groupId, options = {}) {
        const { forceRefresh = false } = options;
        const cacheKey = String(groupId);
        const now = Date.now();
        const cached = this.groupBotRoleCache.get(cacheKey);

        if (!forceRefresh && cached && cached.expiresAt > now) {
            return cached;
        }

        if (this.groupBotRoleInFlight.has(cacheKey)) {
            return this.groupBotRoleInFlight.get(cacheKey);
        }

        const queryPromise = (async () => {
            const result = {
                role: null,
                allowed: false,
                reason: 'unknown',
                retcode: null,
                expiresAt: now + this.AT_ALL_CAPABILITY_CACHE_TTL_MS
            };

            if (!this.ws) {
                result.reason = 'ws_unavailable';
                this.groupBotRoleCache.set(cacheKey, result);
                return result;
            }

            const selfId = await this.resolveBotSelfId();
            if (!selfId) {
                result.reason = 'self_id_unavailable';
                this.groupBotRoleCache.set(cacheKey, result);
                return result;
            }

            try {
                const response = await notificationService.callAction(
                    this.ws,
                    'get_group_member_info',
                    {
                        group_id: groupId,
                        user_id: Number(selfId),
                        no_cache: true
                    },
                    'UpdateChecker',
                    4000
                );

                result.retcode = response?.retcode ?? null;

                if (response?.status === 'ok') {
                    const role = String(response?.data?.role || '').toLowerCase();
                    result.role = role || null;
                    result.allowed = role === 'admin' || role === 'owner';
                    result.reason = result.allowed
                        ? 'ok'
                        : `insufficient_role:${role || 'unknown'}`;
                } else {
                    const wording = response?.wording || response?.message;
                    result.reason = wording ? `action_failed:${wording}` : 'action_failed';
                }
            } catch (e) {
                result.reason = `query_failed:${e.message}`;
            }

            this.groupBotRoleCache.set(cacheKey, result);
            return result;
        })();

        this.groupBotRoleInFlight.set(cacheKey, queryPromise);
        try {
            return await queryPromise;
        } finally {
            this.groupBotRoleInFlight.delete(cacheKey);
        }
    }

    async queryGroupAtAllCapability(groupId, options = {}) {
        const { forceRefresh = false } = options;
        const cacheKey = String(groupId);
        const now = Date.now();
        const cached = this.groupAtAllCapabilityCache.get(cacheKey);

        if (!forceRefresh && cached && cached.expiresAt > now) {
            return cached;
        }

        if (this.groupAtAllCapabilityInFlight.has(cacheKey)) {
            return this.groupAtAllCapabilityInFlight.get(cacheKey);
        }

        const queryPromise = (async () => {
            const result = {
                canAtAll: false,
                reason: 'unknown',
                retcode: null,
                botRole: null,
                expiresAt: now + this.AT_ALL_CAPABILITY_CACHE_TTL_MS
            };

            if (!this.ws) {
                result.reason = 'ws_unavailable';
                this.groupAtAllCapabilityCache.set(cacheKey, result);
                return result;
            }

            try {
                const response = await notificationService.callAction(
                    this.ws,
                    'get_group_at_all_remain',
                    { group_id: groupId },
                    'UpdateChecker',
                    4000
                );

                result.retcode = response?.retcode ?? null;

                if (response?.status === 'ok') {
                    const data = response?.data || {};
                    if (typeof data.can_at_all === 'boolean') {
                        result.canAtAll = data.can_at_all;
                    } else {
                        const remainForUin = Number(data.remain_at_all_count_for_uin);
                        const remainForGroup = Number(data.remain_at_all_count_for_group);
                        const validUinRemain = Number.isFinite(remainForUin);
                        const validGroupRemain = Number.isFinite(remainForGroup);

                        if (validUinRemain && validGroupRemain) {
                            result.canAtAll = remainForUin > 0 && remainForGroup > 0;
                        } else if (validUinRemain) {
                            result.canAtAll = remainForUin > 0;
                        } else {
                            result.canAtAll = false;
                        }
                    }

                    if (!result.canAtAll) {
                        result.reason = 'no_permission_or_quota';
                    } else {
                        const roleState = await this.queryBotGroupRole(groupId, { forceRefresh });
                        result.botRole = roleState.role;
                        if (roleState.allowed) {
                            result.reason = 'ok';
                        } else {
                            result.canAtAll = false;
                            result.reason = roleState.reason;
                        }
                    }
                } else {
                    const wording = response?.wording || response?.message;
                    result.reason = wording ? `action_failed:${wording}` : 'action_failed';
                }
            } catch (e) {
                result.reason = `query_failed:${e.message}`;
            }

            this.groupAtAllCapabilityCache.set(cacheKey, result);

            if (!result.canAtAll) {
                logger.info(`[UpdateChecker] Group ${groupId} @all unavailable, fallback to plain message (reason: ${result.reason}, retcode: ${result.retcode ?? 'N/A'})`);
            }

            return result;
        })();

        this.groupAtAllCapabilityInFlight.set(cacheKey, queryPromise);
        try {
            return await queryPromise;
        } finally {
            this.groupAtAllCapabilityInFlight.delete(cacheKey);
        }
    }

    async buildSubscriptionMessageChain(groupId, messageChain, atAllMeta = {}) {
        if (!this.isSubscriptionAtAllEnabled(groupId)) {
            return messageChain;
        }

        if (!this.shouldAtAll(groupId, atAllMeta)) {
            return messageChain;
        }

        const capability = await this.queryGroupAtAllCapability(groupId);
        if (!capability.canAtAll) {
            return messageChain;
        }

        return [{ type: 'at', data: { qq: 'all' } }, ...messageChain];
    }

    async sendGroupMessageByAction(groupId, messageChain) {
        try {
            const response = await notificationService.callAction(
                this.ws,
                'send_group_msg',
                { group_id: groupId, message: messageChain },
                'UpdateChecker',
                10000
            );

            const status = response?.status;
            const retcode = response?.retcode ?? null;
            const isOk = status === 'ok' && (retcode === null || retcode === 0);
            const wording = response?.wording || response?.message || '';

            return {
                ok: isOk,
                reason: isOk ? 'ok' : (wording ? `action_failed:${wording}` : 'action_failed'),
                retcode
            };
        } catch (e) {
            return { ok: false, reason: `send_failed:${e.message}`, retcode: null };
        }
    }

    hasAtAllSegment(messageChain) {
        if (!Array.isArray(messageChain)) return false;
        return messageChain.some(seg => seg?.type === 'at' && String(seg?.data?.qq) === 'all');
    }

    async sendSubscriptionMessage(groupId, baseMessageChain, atAllMeta = {}) {
        if (!this.ws) return;

        try {
            const processedBaseMessageChain = notificationService.processMessageChain(baseMessageChain, 'UpdateChecker');
            const messageChain = await this.buildSubscriptionMessageChain(groupId, processedBaseMessageChain, atAllMeta);

            const firstSendResult = await this.sendGroupMessageByAction(groupId, messageChain);
            if (firstSendResult.ok) {
                return;
            }

            if (this.hasAtAllSegment(messageChain)) {
                this.markGroupAtAllUnavailable(groupId, firstSendResult.reason, firstSendResult.retcode);
                logger.warn(
                    `[UpdateChecker] send_group_msg with @all failed for group ${groupId}, retrying without @all ` +
                    `(reason: ${firstSendResult.reason}, retcode: ${firstSendResult.retcode ?? 'N/A'})`
                );

                const retryResult = await this.sendGroupMessageByAction(groupId, processedBaseMessageChain);
                if (retryResult.ok) {
                    logger.info(`[UpdateChecker] Fallback to plain message succeeded for group ${groupId}`);
                    return;
                }

                throw new Error(
                    `send_group_msg failed after @all fallback: ` +
                    `${firstSendResult.reason} -> ${retryResult.reason}`
                );
            }

            throw new Error(`send_group_msg failed: ${firstSendResult.reason}`);
        } catch (e) {
            logger.error(`[UpdateChecker] Failed to send subscription message to group ${groupId}:`, e);
            notificationService.sendGroupMessage(this.ws, groupId, baseMessageChain);
        }
    }

    notifyGroups(groupTargets, text, dedupKey = null, atAllMeta = {}) {
        if (!this.ws) return;

        const fallbackSources = normalizeSourceList(atAllMeta?.fallbackSources || atAllMeta?.sources || ['manual']);
        const fallbackSource = fallbackSources[0] || 'manual';
        const groupSourceMap = this.normalizeGroupSourceMap(groupTargets, fallbackSource);

        groupSourceMap.forEach((_sources, gid) => {
            // Check for deduplication if key is provided
            const ttlSeconds = Number(config.getGroupConfig(gid, 'linkCacheTimeout'));
            const ttlMs = Number.isFinite(ttlSeconds) ? ttlSeconds * 1000 : 0;
            if (dedupKey && notificationHistory.has(gid, dedupKey, ttlMs)) {
                logger.info(`[UpdateChecker] Skipping duplicate text notification for group ${gid} (key: ${dedupKey})`);
                return;
            }

            if (!config.isGroupEnabled(gid)) return;

            const messageChain = [{ type: 'text', data: { text } }];
            const resolvedMeta = this.buildAtAllMetaForGroup(gid, groupSourceMap, atAllMeta);
            this.sendSubscriptionMessage(gid, messageChain, resolvedMeta).catch(e => {
                logger.error(`[UpdateChecker] Error in text notification task for group ${gid}:`, e);
            });

            // Record notification history if key provided
            if (dedupKey) {
                notificationHistory.add(gid, dedupKey, ttlMs);
            }
        });
    }

    async notifyGroupsWithImage(groupTargets, data, type, textUrl, descriptionText = '', atAllMeta = {}) {
        const fallbackSources = normalizeSourceList(atAllMeta?.fallbackSources || atAllMeta?.sources || ['manual']);
        const fallbackSource = fallbackSources[0] || 'manual';
        const groupSourceMap = this.normalizeGroupSourceMap(groupTargets, fallbackSource);
        const groupIds = this.getGroupIdsFromSourceMap(groupSourceMap);

        if (!this.ws || groupIds.length === 0) return;

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
            const subtype = this.resolveContentSubtype(type, data);

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
                await Promise.all(targetGroupIds.map(async gid => {
                    const baseMessageChain = [
                        { type: 'image', data: { file: `base64://${base64Image}` } },
                        { type: 'text', data: { text: textMsg } }
                    ];
                    const resolvedMeta = this.buildAtAllMetaForGroup(
                        gid,
                        groupSourceMap,
                        {
                            ...atAllMeta,
                            category: atAllMeta?.category || this.resolveAtAllCategory(type, data),
                            fallbackSources
                        },
                        type,
                        data
                    );
                    await this.sendSubscriptionMessage(gid, baseMessageChain, resolvedMeta);
                    
                    // Record history
                    if (dedupId) {
                        const ttlSeconds = Number(config.getGroupConfig(gid, 'linkCacheTimeout'));
                        const ttlMs = Number.isFinite(ttlSeconds) ? ttlSeconds * 1000 : 0;
                        notificationHistory.add(gid, dedupId, ttlMs);
                    }
                }));
                
            } catch (e) {
                logger.error(`[UpdateChecker] Error generating image for config group [${key}]:`, e);
                // Fallback to text for these groups
                const textMsg = descriptionText ? `${descriptionText}\n${textUrl}` : textUrl;
                const fallbackGroupSourceMap = new Map();
                targetGroupIds.forEach(gid => {
                    const groupSources = groupSourceMap.get(String(gid));
                    this.mergeGroupSourceMap(
                        fallbackGroupSourceMap,
                        gid,
                        groupSources ? Array.from(groupSources) : fallbackSources
                    );
                });
                this.notifyGroups(
                    fallbackGroupSourceMap,
                    `预览生成失败，已降级为文本链接：\n${textMsg}`,
                    dedupId,
                    {
                        ...atAllMeta,
                        category: atAllMeta?.category || this.resolveAtAllCategory(type, data),
                        fallbackSources
                    }
                );
            }
        }
    }

    /**
     * 🆕 推送消息并添加链接到缓存
     * 封装notifyGroupsWithImage + 缓存逻辑，避免重复代码
     */
    async notifyGroupsWithImageAndCache(groupTargets, data, type, textUrl, descriptionText = '', atAllMeta = {}) {
        const fallbackSources = normalizeSourceList(atAllMeta?.fallbackSources || atAllMeta?.sources || ['manual']);
        const fallbackSource = fallbackSources[0] || 'manual';
        const groupSourceMap = this.normalizeGroupSourceMap(groupTargets, fallbackSource);
        const groupIds = this.getGroupIdsFromSourceMap(groupSourceMap);
        if (groupIds.length === 0) return;

        // 推送消息
        await this.notifyGroupsWithImage(groupSourceMap, data, type, textUrl, descriptionText, {
            ...atAllMeta,
            fallbackSources
        });

        // 添加链接到缓存
        const linkHandler = require('../../handlers/linkHandler');
        for (const groupId of groupIds) {
            linkHandler.addUrlToCache(textUrl, groupId);
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
        const failedGroups = [];

        for (const groupId of groupsWithSync) {
            try {
                // First, check who is logged in for this group
                const myInfo = await biliApi.getMyInfo(groupId);
                if (myInfo.status !== 'success') {
                    // Maybe cookie expired or not set
                    logger.warn(`[UpdateChecker] Failed to get user info for group ${groupId}: ${myInfo.message}`);
                    failedGroups.push(groupId);
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
                    failedGroups.push(groupId);
                }

                // Sleep to avoid rate limiting
                await new Promise(r => setTimeout(r, 2000));

            } catch (e) {
                logger.error(`[UpdateChecker] Error refreshing cookie followings for group ${groupId}:`, e);
                failedGroups.push(groupId);
            }
        }

        // 若所有群的 Cookie 同步均失败，通知 admin
        if (failedGroups.length > 0 && failedGroups.length === groupsWithSync.length) {
            this.notifyAdmin(`⚠️ B站关注列表同步失败（${failedGroups.length}个群均失败），订阅推送可能中断。请检查Cookie状态。`);
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

const updateCheckerInstance = new UpdateChecker()
// resolveArticleTitle 是模块级工具函数，仅用于测试访问，不属于 UpdateChecker 类方法
module.exports = updateCheckerInstance
module.exports.resolveArticleTitle = resolveArticleTitle
