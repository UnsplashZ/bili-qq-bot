const logger = require('./logger');

class NotificationHistory {
    constructor() {
        // Map<string, number> where key is `${groupId}:${dynamicId}` and value is timestamp
        this.history = new Map();
        // TTL in milliseconds (10 minutes)
        // This is sufficient because the main loop runs every few minutes (default 5 min),
        // and we only need to prevent duplicates between a "Check Now" and the next scheduled check.
        this.ttl = 10 * 60 * 1000;

        // Cleanup interval (run every 5 minutes)
        this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    }

    /**
     * Add a record to history
     * @param {string|number} groupId 
     * @param {string} uniqueId - The unique ID of the content (dynamic ID, etc.)
     */
    add(groupId, uniqueId) {
        if (!groupId || !uniqueId) return;
        const key = `${groupId}:${uniqueId}`;
        this.history.set(key, Date.now());
        logger.debug(`[NotificationHistory] Added record: ${key}`);
    }

    /**
     * Check if a record exists
     * @param {string|number} groupId 
     * @param {string} uniqueId 
     * @returns {boolean}
     */
    has(groupId, uniqueId) {
        if (!groupId || !uniqueId) return false;
        const key = `${groupId}:${uniqueId}`;
        return this.history.has(key);
    }

    /**
     * Remove expired entries
     */
    cleanup() {
        const now = Date.now();
        let count = 0;
        for (const [key, timestamp] of this.history.entries()) {
            if (now - timestamp > this.ttl) {
                this.history.delete(key);
                count++;
            }
        }
        if (count > 0) {
            logger.debug(`[NotificationHistory] Cleaned up ${count} expired records`);
        }
    }

    /**
     * Destroy the service and cleanup resources
     */
    destroy() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
            logger.debug('[NotificationHistory] Cleanup timer cleared');
        }
    }
}

module.exports = new NotificationHistory();
