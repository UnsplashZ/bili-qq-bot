const fs = require('fs');
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

        this.init();
    }

    init() {
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }
        this.loadSubscriptions();
        this.loadFollowers();
    }

    // Load subscriptions from file
    loadSubscriptions() {
        // Check for .bak file if main file is missing or empty
        if (!fs.existsSync(this.subFile)) {
             const bakFile = this.subFile + '.bak';
             if (fs.existsSync(bakFile)) {
                 try {
                     fs.copyFileSync(bakFile, this.subFile);
                     logger.info('[SubscriptionManager] Restored subscriptions from backup.');
                 } catch (e) {
                     logger.error('[SubscriptionManager] Failed to restore backup:', e);
                 }
             }
        }

        if (fs.existsSync(this.subFile)) {
            try {
                const content = fs.readFileSync(this.subFile, 'utf8');
                if (!content || content.trim() === '') {
                     this.userSubs = [];
                     this.bangumiSubs = [];
                     return;
                }
                
                const data = JSON.parse(content);
                
                // Compatibility handling for old format (which was array of mixed types)
                // New format: { users: [], bangumis: [] } or mixed array?
                // Let's assume mixed array for backward compatibility if root is array
                if (Array.isArray(data)) {
                    // Check if it's the specific bugged format "[]" string or empty array
                    if (data.length === 0) {
                         this.userSubs = [];
                         this.bangumiSubs = [];
                    } else {
                         this.userSubs = data.filter(item => item.type === 'user' || !item.type); // Default to user
                         this.bangumiSubs = data.filter(item => item.type === 'bangumi');
                         // Normalize old format where type might be missing
                         this.userSubs.forEach(u => u.type = 'user');
                    }
                } else {
                    // Structured format
                    // IMPORTANT: JSON keys are "users" and "bangumis" based on user's file content
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

    // Save subscriptions to file
    saveSubscriptions() {
        try {
            // Save as mixed array for backward compatibility if needed, or structured?
            // Let's save as structured object for clarity, but if previous code expected array root, we might break it?
            // The original service used `this.subscriptions` which was a mixed array.
            // Let's verify how we want to persist. 
            // If we change format, we must ensure `load` handles it. `load` above handles both.
            // To be safe and cleaner, let's use structured object { users, bangumis }
            const data = {
                users: this.userSubs,
                bangumis: this.bangumiSubs
            };
            
            // Use atomic write with backup
            storageUtils.writeWithBackup(this.subFile, data);
        } catch (e) {
            logger.error('[SubscriptionManager] Failed to save subscriptions:', e);
        }
    }

    // Load followers cache
    loadFollowers() {
        if (fs.existsSync(this.followersFile)) {
            try {
                const data = JSON.parse(fs.readFileSync(this.followersFile, 'utf8'));
                this.cookieFollowings = Array.isArray(data) ? data : [];
                logger.info(`[SubscriptionManager] Loaded ${this.cookieFollowings.length} followers from cache.`);
            } catch (e) {
                logger.error('[SubscriptionManager] Failed to load followers:', e);
                this.cookieFollowings = [];
            }
        }
    }

    // Save followers cache
    saveFollowers() {
        try {
            storageUtils.writeWithBackup(this.followersFile, this.cookieFollowings);
        } catch (e) {
            logger.error('[SubscriptionManager] Failed to save followers:', e);
        }
    }

    setCookieFollowings(followings) {
        this.cookieFollowings = followings;
        this.saveFollowers();
    }

    // Add User Subscription
    async addUserSubscription(uid, groupId) {
        let sub = this.userSubs.find(s => s.uid == uid);
        const gid = String(groupId); // Normalize group ID
        
        if (sub) {
            if (!sub.groupIds.some(id => String(id) === gid)) {
                sub.groupIds.push(groupId); // Store original type if possible, or string?
                // Let's keep it mixed or whatever comes in, but checking is string-based
                this.saveSubscriptions();
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
        this.saveSubscriptions();
        logger.info(`[SubscriptionManager] Added user sub: ${newSub.name} (${uid}) for group ${groupId}`);
        return newSub.name;
    }

    // Remove User Subscription
    removeUserSubscription(uid, groupId) {
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
                this.saveSubscriptions();
                return true;
            }
        }
        return false;
    }

    // Add Bangumi Subscription
    async addBangumiSubscription(seasonId, groupId) {
        let sub = this.bangumiSubs.find(s => s.seasonId == seasonId);
        const gid = String(groupId);
        if (sub) {
            if (!sub.groupIds.some(id => String(id) === gid)) {
                sub.groupIds.push(groupId);
                this.saveSubscriptions();
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
        this.saveSubscriptions();
        logger.info(`[SubscriptionManager] Added bangumi sub: ${newSub.title} (${seasonId}) for group ${groupId}`);
        return newSub.title;
    }

    // Remove Bangumi Subscription
    removeBangumiSubscription(seasonId, groupId) {
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
                this.saveSubscriptions();
                return true;
            }
        }
        return false;
    }

    // Get all subscriptions for a group
    getSubscriptionsByGroup(groupId) {
        // Ensure groupId is compared as the same type (number or string)
        const gid = String(groupId);
        const users = this.userSubs.filter(s => s.groupIds.some(id => String(id) === gid));
        const bangumis = this.bangumiSubs.filter(s => s.groupIds.some(id => String(id) === gid));
        return { users, bangumis };
    }

    // Remove all subscriptions for a group (Clean command)
    removeAllGroupSubscriptions(groupId) {
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
            this.saveSubscriptions();
        }
        return changed;
    }

    updateUserSub(uid, updates) {
        const sub = this.userSubs.find(s => s.uid == uid);
        if (sub) {
            Object.assign(sub, updates);
            this.saveSubscriptions();
        }
    }

    updateBangumiSub(seasonId, updates) {
        const sub = this.bangumiSubs.find(s => s.seasonId == seasonId);
        if (sub) {
            Object.assign(sub, updates);
            this.saveSubscriptions();
        }
    }
}

module.exports = new SubscriptionManager();
