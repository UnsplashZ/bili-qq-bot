const fs = require('fs').promises;
const path = require('path');
const logger = require('../../utils/logger');
const biliApi = require('../../services/biliApi');
const storageUtils = require('../../utils/storageUtils');

class SubscriptionManager {
    constructor() {
        this.userSubs = []; // [{ uid, name, groupIds: [], lastDynamicId, lastLiveStatus, type: 'user' }]
        this.bangumiSubs = []; // [{ seasonId, title, groupIds: [], lastEpId, type: 'bangumi' }]
        
        // Revised structure for multi-account support
        // cookieFollowings: Map<String(uid), Array<User>>
        this.cookieFollowings = {}; 
        // groupToAccountMap: Map<String(groupId), String(uid)>
        this.groupToAccountMap = {};

        this.staleFollowerState = new Map(); // Cache removed followers' state for re-follow recovery

        this.dataDir = path.join(process.cwd(), 'data');
        this.subFile = path.join(this.dataDir, 'subscriptions.json');
        this.followersFile = path.join(this.dataDir, 'subfollowers.json');

        // 异步加载状态管理
        this._loaded = false;
        this._loadingPromise = null;
        this._followersLoaded = false;
        this._followersLoadingPromise = null;
    }

    _normalizeNumericId(value) {
        if (value === null || value === undefined) return '';
        const normalized = String(value).trim();
        return /^\d+$/.test(normalized) ? normalized : '';
    }

    _normalizeGroupId(value) {
        if (value === null || value === undefined) return '';
        return String(value).trim();
    }

    _normalizeGroupIdList(groupIds) {
        if (!Array.isArray(groupIds)) return [];
        const normalized = [];
        const seen = new Set();

        for (const id of groupIds) {
            const gid = this._normalizeGroupId(id);
            if (!gid || seen.has(gid)) continue;
            seen.add(gid);
            normalized.push(gid);
        }

        return normalized;
    }

    _normalizeUserSub(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const uid = this._normalizeNumericId(raw.uid);
        if (!uid) return null;

        const name = String(raw.name || '').trim() || raw.name || `UID_${uid}`;
        const groupIds = this._normalizeGroupIdList(raw.groupIds);
        if (groupIds.length === 0) return null;

        return {
            ...raw,
            uid,
            name,
            groupIds,
            type: 'user'
        };
    }

    _normalizeBangumiSub(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const seasonId = this._normalizeNumericId(raw.seasonId);
        if (!seasonId) return null;

        const title = String(raw.title || '').trim() || raw.title || `番剧 ${seasonId}`;
        const groupIds = this._normalizeGroupIdList(raw.groupIds);
        if (groupIds.length === 0) return null;

        return {
            ...raw,
            seasonId,
            title,
            groupIds,
            type: 'bangumi'
        };
    }

    _mergeStateIfMissing(target, source, keys) {
        for (const key of keys) {
            if ((target[key] === undefined || target[key] === null) && source[key] !== undefined) {
                target[key] = source[key];
            }
        }
    }

    _normalizeLoadedSubscriptions() {
        let changed = false;

        const userMap = new Map();
        const userStateKeys = [
            'lastDynamicId',
            'lastLiveStatus',
            'lastVideoId',
            'lastVideoCreated',
            'lastArticleId',
            'lastArticlePublishTime',
            'roomId'
        ];

        for (const raw of this.userSubs) {
            const normalized = this._normalizeUserSub(raw);
            if (!normalized) {
                changed = true;
                continue;
            }

            const originalUid = String(raw?.uid ?? '');
            const originalName = String(raw?.name ?? '');
            if (originalUid !== normalized.uid || originalName !== normalized.name) {
                changed = true;
            }

            const existing = userMap.get(normalized.uid);
            if (!existing) {
                userMap.set(normalized.uid, normalized);
                continue;
            }

            changed = true;
            existing.groupIds = this._normalizeGroupIdList([...existing.groupIds, ...normalized.groupIds]);
            if ((!existing.name || existing.name.startsWith('UID_')) && normalized.name) {
                existing.name = normalized.name;
            }
            this._mergeStateIfMissing(existing, normalized, userStateKeys);
        }

        const bangumiMap = new Map();
        const bangumiStateKeys = ['lastEpId'];

        for (const raw of this.bangumiSubs) {
            const normalized = this._normalizeBangumiSub(raw);
            if (!normalized) {
                changed = true;
                continue;
            }

            const originalSeasonId = String(raw?.seasonId ?? '');
            const originalTitle = String(raw?.title ?? '');
            if (originalSeasonId !== normalized.seasonId || originalTitle !== normalized.title) {
                changed = true;
            }

            const existing = bangumiMap.get(normalized.seasonId);
            if (!existing) {
                bangumiMap.set(normalized.seasonId, normalized);
                continue;
            }

            changed = true;
            existing.groupIds = this._normalizeGroupIdList([...existing.groupIds, ...normalized.groupIds]);
            if ((!existing.title || existing.title.startsWith('番剧 ')) && normalized.title) {
                existing.title = normalized.title;
            }
            this._mergeStateIfMissing(existing, normalized, bangumiStateKeys);
        }

        const normalizedUsers = Array.from(userMap.values());
        const normalizedBangumis = Array.from(bangumiMap.values());

        if (normalizedUsers.length !== this.userSubs.length || normalizedBangumis.length !== this.bangumiSubs.length) {
            changed = true;
        }

        this.userSubs = normalizedUsers;
        this.bangumiSubs = normalizedBangumis;
        return changed;
    }

    /**
     * 确保目录存在（异步）
     */
    async _ensureDir() {
        try {
            await fs.mkdir(this.dataDir, { recursive: true });
        } catch (error) {
            if (error.code !== 'EEXIST') {
                throw error;
            }
        }
    }

    /**
     * 确保订阅数据已加载（异步懒加载）
     */
    async _ensureSubscriptionsLoaded() {
        if (this._loaded) return;
        if (this._loadingPromise) return this._loadingPromise;

        this._loadingPromise = (async () => {
            try {
                await this._ensureDir();
                await this._loadSubscriptions();
                this._loaded = true;
            } catch (error) {
                // Reset loading state on failure to allow retry
                this._loadingPromise = null;
                logger.error('[SubscriptionManager] Failed to load subscriptions, state reset for retry:', error);
                throw error;
            }
        })();

        return this._loadingPromise;
    }

    /**
     * 确保粉丝数据已加载（异步懒加载）
     */
    async _ensureFollowersLoaded() {
        if (this._followersLoaded) return;
        if (this._followersLoadingPromise) return this._followersLoadingPromise;

        this._followersLoadingPromise = (async () => {
            try {
                await this._ensureDir();
                await this._loadFollowers();
                this._followersLoaded = true;
            } catch (error) {
                // Reset loading state on failure to allow retry
                this._followersLoadingPromise = null;
                logger.error('[SubscriptionManager] Failed to load followers, state reset for retry:', error);
                throw error;
            }
        })();

        return this._followersLoadingPromise;
    }

    /**
     * 异步加载订阅数据
     */
    async _loadSubscriptions() {
        // 检查 .bak 文件
        const bakFile = this.subFile + '.bak';
        if (!await this._fileExists(this.subFile)) {
            if (await this._fileExists(bakFile)) {
                try {
                    await fs.copyFile(bakFile, this.subFile);
                    logger.info('[SubscriptionManager] Restored subscriptions from backup.');
                } catch (e) {
                    logger.error('[SubscriptionManager] Failed to restore backup:', e);
                }
            }
        }

        if (await this._fileExists(this.subFile)) {
            try {
                const content = await fs.readFile(this.subFile, 'utf8');
                if (!content || content.trim() === '') {
                    this.userSubs = [];
                    this.bangumiSubs = [];
                    return;
                }

                const data = JSON.parse(content);

                // 兼容性处理
                if (Array.isArray(data)) {
                    if (data.length === 0) {
                        this.userSubs = [];
                        this.bangumiSubs = [];
                    } else {
                        this.userSubs = data.filter(item => item.type === 'user' || !item.type);
                        this.bangumiSubs = data.filter(item => item.type === 'bangumi');
                        this.userSubs.forEach(u => u.type = 'user');
                    }
                } else {
                    this.userSubs = data.users || data.userSubs || [];
                    this.bangumiSubs = data.bangumis || data.bangumiSubs || [];
                }

                const normalized = this._normalizeLoadedSubscriptions();
                if (normalized) {
                    logger.info('[SubscriptionManager] Normalized subscription data on load.');
                    await this._saveSubscriptions();
                }
                logger.info(`[SubscriptionManager] Loaded ${this.userSubs.length} users and ${this.bangumiSubs.length} bangumis.`);
            } catch (e) {
                logger.error('[SubscriptionManager] Failed to load subscriptions:', e);
                this.userSubs = [];
                this.bangumiSubs = [];
            }
        }
    }

    /**
     * 检查文件是否存在（异步）
     */
    async _fileExists(filePath) {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * 异步保存订阅数据
     */
    async _saveSubscriptions() {
        try {
            const data = {
                users: this.userSubs,
                bangumis: this.bangumiSubs
            };
            await storageUtils.asyncWriteWithBackup(this.subFile, data);
            logger.debug('[SubscriptionManager] Subscriptions saved successfully.');
        } catch (error) {
            logger.error('[SubscriptionManager] Failed to save subscriptions:', error);
            throw error; // Re-throw to let caller handle
        }
    }
    
    /**
     * Helper to normalize follower state fields
     */
    _normalizeFollowerState(f) {
        if (!f) return f;
        if (f.lastDynamicId === undefined) f.lastDynamicId = null;
        if (f.lastLiveStatus === undefined) f.lastLiveStatus = 0;
        if (f.lastVideoId === undefined) f.lastVideoId = null;
        if (f.lastVideoCreated === undefined) f.lastVideoCreated = null;
        if (f.lastArticleId === undefined) f.lastArticleId = null;
        if (f.lastArticlePublishTime === undefined) f.lastArticlePublishTime = null;
        return f;
    }

    /**
     * Helper to get safe ID from follower object
     */
    getFollowerId(f) {
        if (!f) return '';
        return String(f.mid || f.uid || f.id || '');
    }

    /**
     * 异步加载粉丝数据
     */
    async _loadFollowers() {
        if (await this._fileExists(this.followersFile)) {
            try {
                const data = await storageUtils.safeReadJSON(this.followersFile, {});

                // Compatibility check: if it's an array (old format), migrate it or discard
                if (Array.isArray(data)) {
                    logger.warn('[SubscriptionManager] Old array format detected in subfollowers.json. Data will be reset on next sync.');
                    this.cookieFollowings = {};
                    this.groupToAccountMap = {};
                } else {
                    this.cookieFollowings = data.followings || {};
                    this.groupToAccountMap = data.groupMap || {};

                    // Normalize state for all loaded followers
                    for (const uid in this.cookieFollowings) {
                        if (Array.isArray(this.cookieFollowings[uid])) {
                            this.cookieFollowings[uid].forEach(f => this._normalizeFollowerState(f));
                        }
                    }
                }
                logger.info(`[SubscriptionManager] Loaded followers for ${Object.keys(this.cookieFollowings).length} accounts.`);
            } catch (e) {
                logger.error('[SubscriptionManager] Failed to load followers:', e);
                this.cookieFollowings = {};
                this.groupToAccountMap = {};
            }
        }
    }

    /**
     * 异步保存粉丝数据
     */
    async _saveFollowers() {
        try {
            const data = {
                followings: this.cookieFollowings,
                groupMap: this.groupToAccountMap
            };
            await storageUtils.asyncWriteWithBackup(this.followersFile, data);
            logger.debug('[SubscriptionManager] Followers saved successfully.');
        } catch (error) {
            logger.error('[SubscriptionManager] Failed to save followers:', error);
            throw error; // Re-throw to let caller handle
        }
    }

    async setCookieFollowings(accountUid, newFollowings) {
        if (!accountUid) return;
        const uidStr = String(accountUid);
        const oldFollowings = this.cookieFollowings[uidStr] || [];

        // Helper to get ID from follower object safely
        const getId = this.getFollowerId.bind(this);

        // Index old followers
        const oldMap = new Map();
        oldFollowings.forEach(f => {
            const id = getId(f);
            if (id) oldMap.set(id, f);
        });

        // Index new followers
        const newMap = new Map();
        newFollowings.forEach(f => {
            const id = getId(f);
            if (id) newMap.set(id, f);
        });

        // Save removed followers' state for potential re-follow recovery
        for (const [id, f] of oldMap) {
            const hasRecoverableState = Boolean(
                f.lastDynamicId ||
                f.lastLiveStatus ||
                f.lastVideoId ||
                f.lastArticleId ||
                f.lastVideoCreated !== undefined && f.lastVideoCreated !== null ||
                f.lastArticlePublishTime !== undefined && f.lastArticlePublishTime !== null
            )

            if (!newMap.has(id) && hasRecoverableState) {
                this.staleFollowerState.set(id, {
                    lastDynamicId: f.lastDynamicId,
                    lastLiveStatus: f.lastLiveStatus,
                    lastVideoId: f.lastVideoId,
                    lastVideoCreated: f.lastVideoCreated,
                    lastArticleId: f.lastArticleId,
                    lastArticlePublishTime: f.lastArticlePublishTime
                });
            }
        }

        // Trim staleFollowerState to 1000 entries
        if (this.staleFollowerState.size > 1000) {
            const excess = this.staleFollowerState.size - 1000;
            const iter = this.staleFollowerState.keys();
            for (let i = 0; i < excess; i++) {
                this.staleFollowerState.delete(iter.next().value);
            }
        }

        // Merge new list with old state
        const merged = newFollowings.map(newF => {
            const id = getId(newF);
            const oldF = oldMap.get(id);

            if (oldF) {
                // Preserve state
                return {
                    ...newF,
                    lastDynamicId: oldF.lastDynamicId !== undefined ? oldF.lastDynamicId : null,
                    lastLiveStatus: oldF.lastLiveStatus !== undefined ? oldF.lastLiveStatus : 0,
                    lastVideoId: oldF.lastVideoId !== undefined ? oldF.lastVideoId : null,
                    lastVideoCreated: oldF.lastVideoCreated !== undefined ? oldF.lastVideoCreated : null,
                    lastArticleId: oldF.lastArticleId !== undefined ? oldF.lastArticleId : null,
                    lastArticlePublishTime: oldF.lastArticlePublishTime !== undefined ? oldF.lastArticlePublishTime : null
                };
            } else {
                // Initialize state - check stale cache for re-follow recovery
                const stale = this.staleFollowerState.get(id);
                if (stale) {
                    return {
                        ...newF,
                        lastDynamicId: stale.lastDynamicId,
                        lastLiveStatus: stale.lastLiveStatus,
                        lastVideoId: stale.lastVideoId,
                        lastVideoCreated: stale.lastVideoCreated !== undefined ? stale.lastVideoCreated : null,
                        lastArticleId: stale.lastArticleId,
                        lastArticlePublishTime: stale.lastArticlePublishTime !== undefined ? stale.lastArticlePublishTime : null
                    };
                }
                return {
                    ...newF,
                    lastDynamicId: null,
                    lastLiveStatus: 0,
                    lastVideoId: null,
                    lastVideoCreated: null,
                    lastArticleId: null,
                    lastArticlePublishTime: null
                };
            }
        });

        this.cookieFollowings[uidStr] = merged;
        await this._saveFollowers();
    }

    async updateCookieFollowerState(accountUid, targetUid, updates) {
        if (!accountUid || !targetUid) return;
        const accountStr = String(accountUid);
        const targetStr = String(targetUid);

        const followings = this.cookieFollowings[accountStr];
        if (!followings) return;

        const follower = followings.find(f => this.getFollowerId(f) === targetStr);
        if (follower) {
            Object.assign(follower, updates);
            await this._saveFollowers();
        }
    }

    async setGroupAccountMapping(groupId, accountUid) {
        if (!groupId || !accountUid) return;
        this.groupToAccountMap[this._normalizeGroupId(groupId)] = String(accountUid).trim();
        await this._saveFollowers();
    }

    getFollowingsForGroup(groupId) {
        const gid = this._normalizeGroupId(groupId);
        const accountUid = this.groupToAccountMap[gid];
        if (accountUid && this.cookieFollowings[accountUid]) {
            return this.cookieFollowings[accountUid];
        }
        
        // Fallback: If no mapping found but we have only 1 account, maybe return that?
        // Or check if there's any data?
        // For now, return empty array to avoid showing wrong data
        const accountKeys = Object.keys(this.cookieFollowings);
        if (!accountUid && accountKeys.length === 1) {
            // If only one account exists globally, assume it's the one (Backward compatibility behavior)
            return this.cookieFollowings[accountKeys[0]];
        }

        return [];
    }

    // Add User Subscription
    async addUserSubscription(uid, groupId) {
        await this._ensureSubscriptionsLoaded();
        const normalizedUid = this._normalizeNumericId(uid);
        if (!normalizedUid) {
            throw new Error('无效 UID：必须为纯数字');
        }

        const gid = this._normalizeGroupId(groupId); // Normalize group ID
        if (!gid) {
            throw new Error('无效群号');
        }

        let sub = this.userSubs.find((item) => this._normalizeNumericId(item.uid) === normalizedUid);

        if (sub) {
            let changed = false;
            if (sub.uid !== normalizedUid) {
                sub.uid = normalizedUid;
                changed = true;
            }
            if (!sub.groupIds.some(id => String(id) === gid)) {
                sub.groupIds.push(gid);
                changed = true;
            }
            if (changed) {
                sub.groupIds = this._normalizeGroupIdList(sub.groupIds);
                await this._saveSubscriptions();
            }
            return sub.name;
        }

        // Fetch info
        const info = await biliApi.getUserInfo(normalizedUid);
        if (info.status !== 'success') {
            throw new Error(info.message || '获取用户信息失败');
        }

        // Get latest dynamic to initialize
        const dynamicInfo = await biliApi.getUserDynamic(normalizedUid);
        let lastId = null;

        if (dynamicInfo.status === 'success' && dynamicInfo.data.cards && dynamicInfo.data.cards.length > 0) {
            const cards = dynamicInfo.data.cards;

            // Sort cards by ID descending to handle sticky posts (which might be old but at top)
            // This ensures we get the truly latest dynamic ID, not a pinned old one
            cards.sort((a, b) => {
                try {
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

            const card = cards[0];
            // Try id_str first (new API), then desc.dynamic_id_str (old API)
            lastId = card.id_str || (card.desc && card.desc.dynamic_id_str) || null;
        }

        const newSub = {
            uid: normalizedUid,
            name: info.data.name,
            groupIds: [gid],
            lastDynamicId: lastId,
            lastLiveStatus: 0 // 0: offline, 1: online
        };

        this.userSubs.push(newSub);
        await this._saveSubscriptions();
        logger.info(`[SubscriptionManager] Added user sub: ${newSub.name} (${normalizedUid}) for group ${groupId}`);
        return newSub.name;
    }

    // Remove User Subscription
    async removeUserSubscription(uid, groupId) {
        await this._ensureSubscriptionsLoaded();
        const normalizedUid = this._normalizeNumericId(uid);
        if (!normalizedUid) return false;

        const index = this.userSubs.findIndex((sub) => this._normalizeNumericId(sub.uid) === normalizedUid);
        const gid = this._normalizeGroupId(groupId);
        if (index > -1) {
            const sub = this.userSubs[index];
            if (sub.uid !== normalizedUid) {
                sub.uid = normalizedUid;
            }
            const groupIndex = sub.groupIds.findIndex(id => String(id) === gid);
            if (groupIndex > -1) {
                sub.groupIds.splice(groupIndex, 1);
                if (sub.groupIds.length === 0) {
                    this.userSubs.splice(index, 1);
                }
                await this._saveSubscriptions();
                return true;
            }
        }
        return false;
    }

    // Add Bangumi Subscription
    async addBangumiSubscription(seasonId, groupId) {
        await this._ensureSubscriptionsLoaded();
        const normalizedSeasonId = this._normalizeNumericId(seasonId);
        if (!normalizedSeasonId) {
            throw new Error('无效 seasonId：必须为纯数字');
        }

        const gid = this._normalizeGroupId(groupId);
        if (!gid) {
            throw new Error('无效群号');
        }

        let sub = this.bangumiSubs.find((item) => this._normalizeNumericId(item.seasonId) === normalizedSeasonId);
        if (sub) {
            let changed = false;
            if (sub.seasonId !== normalizedSeasonId) {
                sub.seasonId = normalizedSeasonId;
                changed = true;
            }
            if (!sub.groupIds.some(id => String(id) === gid)) {
                sub.groupIds.push(gid);
                changed = true;
            }
            if (changed) {
                sub.groupIds = this._normalizeGroupIdList(sub.groupIds);
                await this._saveSubscriptions();
            }
            return sub.title;
        }

        // Fetch info
        const info = await biliApi.getBangumiInfo(normalizedSeasonId);
        if (info.status !== 'success') {
             throw new Error(info.message || '获取番剧信息失败');
        }

        const newSub = {
            seasonId: normalizedSeasonId,
            title: info.data.title,
            groupIds: [gid],
            lastEpId: null // Will be updated on first check
        };

        this.bangumiSubs.push(newSub);
        await this._saveSubscriptions();
        logger.info(`[SubscriptionManager] Added bangumi sub: ${newSub.title} (${normalizedSeasonId}) for group ${groupId}`);
        return newSub.title;
    }

    // Remove Bangumi Subscription
    async removeBangumiSubscription(seasonId, groupId) {
        await this._ensureSubscriptionsLoaded();
        const normalizedSeasonId = this._normalizeNumericId(seasonId);
        if (!normalizedSeasonId) return false;

        const index = this.bangumiSubs.findIndex((sub) => this._normalizeNumericId(sub.seasonId) === normalizedSeasonId);
        const gid = this._normalizeGroupId(groupId);
        if (index > -1) {
            const sub = this.bangumiSubs[index];
            if (sub.seasonId !== normalizedSeasonId) {
                sub.seasonId = normalizedSeasonId;
            }
            const groupIndex = sub.groupIds.findIndex(id => String(id) === gid);
            if (groupIndex > -1) {
                sub.groupIds.splice(groupIndex, 1);
                if (sub.groupIds.length === 0) {
                    this.bangumiSubs.splice(index, 1);
                }
                await this._saveSubscriptions();
                return true;
            }
        }
        return false;
    }

    // Remove a group from all subscriptions (used when bot leaves a group)
    async removeGroupFromAllSubscriptions(groupId) {
        await this._ensureSubscriptionsLoaded();
        const gid = this._normalizeGroupId(groupId);
        let modified = false;

        // Remove from user subscriptions
        for (let i = this.userSubs.length - 1; i >= 0; i--) {
            const sub = this.userSubs[i];
            const groupIndex = sub.groupIds.findIndex(id => String(id) === gid);
            if (groupIndex > -1) {
                sub.groupIds.splice(groupIndex, 1);
                modified = true;

                // Remove subscription entirely if no groups left
                if (sub.groupIds.length === 0) {
                    this.userSubs.splice(i, 1);
                    logger.debug(`[SubscriptionManager] Removed user sub ${sub.uid} (${sub.name}) - no groups remaining`);
                }
            }
        }

        // Remove from bangumi subscriptions
        for (let i = this.bangumiSubs.length - 1; i >= 0; i--) {
            const sub = this.bangumiSubs[i];
            const groupIndex = sub.groupIds.findIndex(id => String(id) === gid);
            if (groupIndex > -1) {
                sub.groupIds.splice(groupIndex, 1);
                modified = true;

                // Remove subscription entirely if no groups left
                if (sub.groupIds.length === 0) {
                    this.bangumiSubs.splice(i, 1);
                    logger.debug(`[SubscriptionManager] Removed bangumi sub ${sub.seasonId} (${sub.title}) - no groups remaining`);
                }
            }
        }

        if (modified) {
            await this._saveSubscriptions();
            logger.info(`[SubscriptionManager] Removed group ${groupId} from all subscriptions`);
        }

        return modified;
    }

    async getSubscriptionsByGroup(groupId) {
        await this._ensureSubscriptionsLoaded();
        const gid = this._normalizeGroupId(groupId);
        
        const users = this.userSubs.filter(sub => sub.groupIds.some(id => String(id) === gid));
        const bangumis = this.bangumiSubs.filter(sub => sub.groupIds.some(id => String(id) === gid));
        
        return { users, bangumis };
    }

    async removeAllGroupSubscriptions(groupId) {
        await this._ensureSubscriptionsLoaded();
        const gid = this._normalizeGroupId(groupId);
        let changed = false;

        // Clean users
        for (let i = this.userSubs.length - 1; i >= 0; i--) {
            const sub = this.userSubs[i];
            const idx = sub.groupIds.findIndex(id => String(id) === gid);
            if (idx > -1) {
                sub.groupIds.splice(idx, 1);
                changed = true;
                if (sub.groupIds.length === 0) {
                    this.userSubs.splice(i, 1);
                }
            }
        }

        // Clean bangumis
        for (let i = this.bangumiSubs.length - 1; i >= 0; i--) {
            const sub = this.bangumiSubs[i];
            const idx = sub.groupIds.findIndex(id => String(id) === gid);
            if (idx > -1) {
                sub.groupIds.splice(idx, 1);
                changed = true;
                if (sub.groupIds.length === 0) {
                    this.bangumiSubs.splice(i, 1);
                }
            }
        }

        if (changed) {
            await this._saveSubscriptions();
        }
        return changed;
    }

    async updateUserSub(uid, updates) {
        await this._ensureSubscriptionsLoaded();
        const normalizedUid = this._normalizeNumericId(uid);
        if (!normalizedUid) return;

        const sub = this.userSubs.find((item) => this._normalizeNumericId(item.uid) === normalizedUid);
        if (sub) {
            sub.uid = normalizedUid;
            Object.assign(sub, updates);
            await this._saveSubscriptions();
        }
    }

    async updateBangumiSub(seasonId, updates) {
        await this._ensureSubscriptionsLoaded();
        const normalizedSeasonId = this._normalizeNumericId(seasonId);
        if (!normalizedSeasonId) return;

        const sub = this.bangumiSubs.find((item) => this._normalizeNumericId(item.seasonId) === normalizedSeasonId);
        if (sub) {
            sub.seasonId = normalizedSeasonId;
            Object.assign(sub, updates);
            await this._saveSubscriptions();
        }
    }
}

module.exports = new SubscriptionManager();
