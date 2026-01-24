const logger = require('./logger');

class NotificationHistory {
    constructor() {
        // Map<string, object> where key is `${groupId}:${dynamicId}` and value stores timestamp/ttl
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
    add(groupId, uniqueId, ttlMs) {
        if (!groupId || !uniqueId) return;
        const key = `${groupId}:${uniqueId}`;
        const resolvedTtl = Number.isFinite(ttlMs) ? ttlMs : this.ttl;
        this.history.set(key, { timestamp: Date.now(), ttlMs: resolvedTtl });
        logger.debug(`[NotificationHistory] Added record: ${key}`);
    }

    /**
     * Check if a record exists
     * @param {string|number} groupId 
     * @param {string} uniqueId 
     * @returns {boolean}
     */
    has(groupId, uniqueId, ttlMs) {
        if (!groupId || !uniqueId) return false;
        const key = `${groupId}:${uniqueId}`;
        const record = this.history.get(key);
        if (!record) return false;
        const now = Date.now();
        const resolvedTtl = Number.isFinite(ttlMs) ? ttlMs : (Number.isFinite(record.ttlMs) ? record.ttlMs : this.ttl);
        if (now - record.timestamp > resolvedTtl) {
            this.history.delete(key);
            return false;
        }
        return true;
    }

    /**
     * Remove expired entries
     */
    cleanup() {
        const now = Date.now();
        let count = 0;
        for (const [key, record] of this.history.entries()) {
            const resolvedTtl = Number.isFinite(record?.ttlMs) ? record.ttlMs : this.ttl;
            if (now - record.timestamp > resolvedTtl) {
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
