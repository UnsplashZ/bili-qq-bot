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
    set cookieFollowings(val) { subscriptionManager.setCookieFollowings(val); }

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

        // This is a bit tricky as updateChecker checks everyone.
        // We can implement a single check in updateChecker or just return current state?
        // The original method checked immediately.

        // Let's implement a single check logic reusing UpdateChecker's methods
        // But UpdateChecker methods are designed for loop.
        // We can create a temporary sub object and call checkUserDynamic
        const sub = subscriptionManager.userSubs.find(s => s.uid == uid && s.groupIds.includes(groupId));
        if (sub) {
            // Force check to generate card immediately
            // CRITICAL: Create a temporary sub object with ONLY the current group ID
            // This prevents the "Check Now" command from broadcasting to ALL subscribed groups
            const tempSub = {
                ...sub,
                groupIds: [groupId]
            };
            await updateChecker.checkUserDynamic(tempSub, true);
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
