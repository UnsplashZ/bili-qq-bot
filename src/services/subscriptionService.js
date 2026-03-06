const subscriptionManager = require('./subscription/subscriptionManager');
const updateChecker = require('./subscription/updateChecker');
const logger = require('../utils/logger');

class SubscriptionService {
    constructor() {
        // Expose properties for backward compatibility if accessed directly
        // Though ideally callers should use methods
    }

    // Proxy properties
    get userSubs() { return subscriptionManager.userSubs; }
    get bangumiSubs() { return subscriptionManager.bangumiSubs; }
    get cookieFollowings() { return subscriptionManager.cookieFollowings; }
    set cookieFollowings(val) {
        if (val && typeof val === 'object' && !Array.isArray(val)) {
            subscriptionManager.replaceCookieFollowingsMap(val).catch(error => {
                logger.error('[SubscriptionService] Failed to replace cookieFollowings via compatibility setter:', error);
            });
            return;
        }
        logger.warn('[SubscriptionService] cookieFollowings setter ignored: expected map object.');
    }

    // Ensure subscriptions are loaded (for direct access to userSubs/bangumiSubs)
    async ensureLoaded() {
        await subscriptionManager._ensureSubscriptionsLoaded();
    }

    start(ws) {
        updateChecker.setWs(ws);
        updateChecker.start();
    }

    stop() {
        updateChecker.stop();
    }

    updateCheckInterval(seconds) {
        updateChecker.updateCheckInterval(seconds);
    }

    // Proxy Methods
    async addUserSubscription(uid, groupId) {
        return await subscriptionManager.addUserSubscription(uid, groupId);
    }

    async removeUserSubscription(uid, groupId) {
        return await subscriptionManager.removeUserSubscription(uid, groupId);
    }

    async addBangumiSubscription(seasonId, groupId) {
        return await subscriptionManager.addBangumiSubscription(seasonId, groupId);
    }

    async removeBangumiSubscription(seasonId, groupId) {
        return await subscriptionManager.removeBangumiSubscription(seasonId, groupId);
    }

    async reloadSubscriptions() {
        // Reset loading state and reload
        subscriptionManager._loaded = false;
        subscriptionManager._loadingPromise = null;
        await subscriptionManager._ensureSubscriptionsLoaded();
    }

    async getSubscriptionsByGroup(groupId) {
        return await subscriptionManager.getSubscriptionsByGroup(groupId);
    }

    async getFollowingsForGroup(groupId) {
        await subscriptionManager._ensureFollowersLoaded();
        return subscriptionManager.getFollowingsForGroup(groupId);
    }

    async setCookieFollowings(accountUid, newFollowings) {
        return await subscriptionManager.setCookieFollowings(accountUid, newFollowings);
    }

    async removeAllGroupSubscriptions(groupId) {
        return await subscriptionManager.removeAllGroupSubscriptions(groupId);
    }

    async refreshCookieFollowings() {
        return await updateChecker.refreshCookieFollowings();
    }

    // Manual check trigger (e.g. for testing or commands)
    async checkSubscriptionNow(uid, groupId) {
        // Ensure subscriptions are loaded before checking
        await subscriptionManager._ensureSubscriptionsLoaded();

        // Type-safe comparison
        const targetGroupId = String(groupId).trim();
        const targetUid = String(uid).trim();
        const sub = subscriptionManager.userSubs.find(s =>
            String(s.uid).trim() === targetUid &&
            s.groupIds.map((id) => String(id).trim()).includes(targetGroupId)
        );

        if (sub) {
            // Force check to generate card immediately
            // CRITICAL: Create a temporary sub object with ONLY the current group ID
            const tempSub = {
                ...sub,
                groupIds: [targetGroupId]
            };
            // updateChecker.checkUserDynamic now internally uses bypassCache=true
            // 3rd arg true = force (process even if ID hasn't changed, needed for "Check Now" command)
            await updateChecker.checkUserDynamic(tempSub, null, true, {
                disableDedup: true
            });
            
            // Also force check live status
            await updateChecker.checkUserLive(tempSub, null, true, {
                disableDedup: true
            });

            // Force check video/article for this user in current group only
            const targetGroupSourceMap = typeof updateChecker.createGroupSourceMap === 'function'
                ? updateChecker.createGroupSourceMap([targetGroupId], ['manual'])
                : new Map([[targetGroupId, new Set(['manual'])]]);
            const manualUserItem = {
                uid: targetUid,
                name: sub.name,
                targetGroups: [targetGroupId],
                targetGroupSourceMap,
                source: 'manual',
                manualSub: sub
            };
            await updateChecker.checkUserVideoUnified(manualUserItem, true, {
                persistState: false,
                disableDedup: true
            });
            await updateChecker.checkUserArticleUnified(manualUserItem, true, {
                persistState: false,
                disableDedup: true
            });
            
            return true;
        }
        return false;
    }

    // Proxy to NotificationService for backward compatibility
    notifyGroups(groupIds, message) {
        const notificationService = require('./notificationService');
        // Need to get ws from somewhere? updateChecker has it.
        // Or notificationService needs it passed.
        // But notificationService methods require ws.
        // UpdateChecker has ws.
        // If we call this from outside, we might not have ws easily if we are just a service.
        // However, the original service stored ws. UpdateChecker stores ws now.
        if (updateChecker.ws) {
            notificationService.notifyGroups(updateChecker.ws, groupIds, message, 'SubscriptionService');
            return true;
        }
        return false;
    }

    saveImageAsFile(base64Data) {
        const notificationService = require('./notificationService');
        return notificationService.saveImageAsFile(base64Data, 'SubscriptionService');
    }

    cleanText(text) {
        const notificationService = require('./notificationService');
        return notificationService.cleanText(text);
    }
}

module.exports = new SubscriptionService();
