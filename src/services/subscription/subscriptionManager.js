const fs = require('fs').promises;
const path = require('path');
const logger = require('../../utils/logger');
const biliApi = require('../../services/biliApi');
const storageUtils = require('../../utils/storageUtils');

class SubscriptionManager {
    constructor() {
        this.userSubs = []; // [{ uid, name, groupIds: [], lastDynamicId, lastLiveStatus, type: 'user' }]
        this.bangumiSubs = []; // [{ seasonId, title, groupIds: [], lastEpId, type: 'bangumi' }]
        this.cookieFollowings = []; // [{ uid, name, face, sign, biliGroups: [] }]

        this.dataDir = path.join(process.cwd(), 'data');
        this.subFile = path.join(this.dataDir, 'subscriptions.json');
        this.followersFile = path.join(this.dataDir, 'subfollowers.json');

        // 异步加载状态管理
        this._loaded = false;
        this._loadingPromise = null;
        this._followersLoaded = false;
        this._followersLoadingPromise = null;
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
                logger.info(`[SubscriptionManager] Loaded ${this.userSubs.length} users and ${this.bangumiSubs.length} bangumis.`);
            } catch (e) {
                logger.error('[SubscriptionManager] Failed to load subscriptions:', e);
                this.userSubs = [];
                this.bangumiSubs = [];
            }
        }
    }

    /**
     * 异步加载粉丝数据
     */
    async _loadFollowers() {
        if (await this._fileExists(this.followersFile)) {
            try {
                const data = await storageUtils.safeReadJSON(this.followersFile, []);
                this.cookieFollowings = Array.isArray(data) ? data : [];
                logger.info(`[SubscriptionManager] Loaded ${this.cookieFollowings.length} followers from cache.`);
            } catch (e) {
                logger.error('[SubscriptionManager] Failed to load followers:', e);
                this.cookieFollowings = [];
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
     * 异步保存粉丝数据
     */
    async _saveFollowers() {
        try {
            await storageUtils.asyncWriteWithBackup(this.followersFile, this.cookieFollowings);
            logger.debug('[SubscriptionManager] Followers saved successfully.');
        } catch (error) {
            logger.error('[SubscriptionManager] Failed to save followers:', error);
            throw error; // Re-throw to let caller handle
        }
    }

    setCookieFollowings(followings) {
        this.cookieFollowings = followings;
        // Fire-and-forget save with error handling
        this._saveFollowers().catch(err => {
            logger.error('[SubscriptionManager] Failed to save followers after setCookieFollowings:', err);
        });
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
