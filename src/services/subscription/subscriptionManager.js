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

        this.dataDir = path.join(process.cwd(), 'data');
        this.subFile = path.join(this.dataDir, 'subscriptions.json');
        this.followersFile = path.join(this.dataDir, 'subfollowers.json');

        // 异步加载状态管理
        this._loaded = false;
        this._loadingPromise = null;
        this._followersLoaded = false;
        this._followersLoadingPromise = null;
    }

    // ... (keep existing methods)

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

    setCookieFollowings(accountUid, followings) {
        if (!accountUid) return;
        this.cookieFollowings[String(accountUid)] = followings;
        // Fire-and-forget save
        this._saveFollowers().catch(err => {
            logger.error('[SubscriptionManager] Failed to save followers after setCookieFollowings:', err);
        });
    }

    setGroupAccountMapping(groupId, accountUid) {
        if (!groupId || !accountUid) return;
        this.groupToAccountMap[String(groupId)] = String(accountUid);
        // We don't necessarily save on every mapping update if it's frequent, but let's be safe
        this._saveFollowers().catch(err => {
             logger.error('[SubscriptionManager] Failed to save followers after setGroupAccountMapping:', err);
        });
    }

    getFollowingsForGroup(groupId) {
        const gid = String(groupId);
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
        let sub = this.userSubs.find(s => s.uid == uid);
        const gid = String(groupId); // Normalize group ID

        if (sub) {
            if (!sub.groupIds.some(id => String(id) === gid)) {
                sub.groupIds.push(groupId);
                await this._saveSubscriptions();
            }
            return sub.name;
        }

        // Fetch info
        const info = await biliApi.getUserInfo(uid);
        if (info.status !== 'success') {
            throw new Error(info.message || '获取用户信息失败');
        }

        // Get latest dynamic to initialize
        const dynamicInfo = await biliApi.getUserDynamic(uid);
        const lastId = (dynamicInfo.status === 'success' && dynamicInfo.data.cards.length > 0)
            ? dynamicInfo.data.cards[0].desc.dynamic_id_str
            : null;

        const newSub = {
            uid: uid,
            name: info.data.name,
            groupIds: [groupId],
            lastDynamicId: lastId,
            lastLiveStatus: 0 // 0: offline, 1: online
        };

        this.userSubs.push(newSub);
        await this._saveSubscriptions();
        logger.info(`[SubscriptionManager] Added user sub: ${newSub.name} (${uid}) for group ${groupId}`);
        return newSub.name;
    }

    // Remove User Subscription
    async removeUserSubscription(uid, groupId) {
        await this._ensureSubscriptionsLoaded();
        const index = this.userSubs.findIndex(s => s.uid == uid);
        const gid = String(groupId);
        if (index > -1) {
            const sub = this.userSubs[index];
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
        let sub = this.bangumiSubs.find(s => s.seasonId == seasonId);
        const gid = String(groupId);
        if (sub) {
            if (!sub.groupIds.some(id => String(id) === gid)) {
                sub.groupIds.push(groupId);
                await this._saveSubscriptions();
            }
            return sub.title;
        }

        // Fetch info
        const info = await biliApi.getBangumiInfo(seasonId);
        if (info.status !== 'success') {
             throw new Error(info.message || '获取番剧信息失败');
        }

        const newSub = {
            seasonId: seasonId,
            title: info.data.title,
            groupIds: [groupId],
            lastEpId: null // Will be updated on first check
        };

        this.bangumiSubs.push(newSub);
        await this._saveSubscriptions();
        logger.info(`[SubscriptionManager] Added bangumi sub: ${newSub.title} (${seasonId}) for group ${groupId}`);
        return newSub.title;
    }

    // Remove Bangumi Subscription
    async removeBangumiSubscription(seasonId, groupId) {
        await this._ensureSubscriptionsLoaded();
        const index = this.bangumiSubs.findIndex(s => s.seasonId == seasonId);
        const gid = String(groupId);
        if (index > -1) {
            const sub = this.bangumiSubs[index];
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

    // Get all subscriptions for a group
    async getSubscriptionsByGroup(groupId) {
        await this._ensureSubscriptionsLoaded();
        const gid = String(groupId);
        const users = this.userSubs.filter(s => s.groupIds.some(id => String(id) === gid));
        const bangumis = this.bangumiSubs.filter(s => s.groupIds.some(id => String(id) === gid));
        return { users, bangumis };
    }

    // Remove all subscriptions for a group (Clean command)
    async removeAllGroupSubscriptions(groupId) {
        await this._ensureSubscriptionsLoaded();
        let changed = false;
        const gid = String(groupId);

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
        const sub = this.userSubs.find(s => s.uid == uid);
        if (sub) {
            Object.assign(sub, updates);
            await this._saveSubscriptions();
        }
    }

    async updateBangumiSub(seasonId, updates) {
        await this._ensureSubscriptionsLoaded();
        const sub = this.bangumiSubs.find(s => s.seasonId == seasonId);
        if (sub) {
            Object.assign(sub, updates);
            await this._saveSubscriptions();
        }
    }
}

module.exports = new SubscriptionManager();
