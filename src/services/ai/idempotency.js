'use strict'

class AiIdempotencyService {
    constructor(options = {}) {
        const ttl = parseInt(options.ttlMs ?? process.env.AI_MESSAGE_DEDUP_TTL_MS ?? '120000', 10)
        const maxEntries = parseInt(options.maxEntries ?? process.env.AI_MESSAGE_DEDUP_MAX_ENTRIES ?? '50000', 10)
        const cleanupIntervalMs = parseInt(options.cleanupIntervalMs ?? process.env.AI_MESSAGE_DEDUP_CLEANUP_INTERVAL_MS ?? '30000', 10)
        this.ttlMs = Number.isFinite(ttl) && ttl > 0 ? ttl : 120000
        this.maxEntries = Number.isFinite(maxEntries) && maxEntries > 0 ? maxEntries : 50000
        this.cleanupIntervalMs = Number.isFinite(cleanupIntervalMs) && cleanupIntervalMs > 0 ? cleanupIntervalMs : 30000
        this.lastCleanupAt = 0
        this.cache = new Map() // key -> expiresAt
    }

    _cleanup(now = Date.now()) {
        for (const [key, expiresAt] of this.cache) {
            if (expiresAt <= now) this.cache.delete(key)
        }

        if (this.cache.size <= this.maxEntries) return

        const overflow = this.cache.size - this.maxEntries
        let removed = 0
        for (const key of this.cache.keys()) {
            this.cache.delete(key)
            removed += 1
            if (removed >= overflow) break
        }
    }

    markIfNew(key) {
        const normalized = String(key || '').trim()
        if (!normalized) return false

        const now = Date.now()
        if (this.lastCleanupAt === 0 || (now - this.lastCleanupAt) >= this.cleanupIntervalMs) {
            this._cleanup(now)
            this.lastCleanupAt = now
        }

        const existing = this.cache.get(normalized)
        if (existing && existing > now) {
            return false
        }
        if (existing && existing <= now) {
            this.cache.delete(normalized)
        }

        this.cache.set(normalized, now + this.ttlMs)
        if (this.cache.size > this.maxEntries) {
            this._cleanup(now)
            this.lastCleanupAt = now
        }
        return true
    }

    reset() {
        this.cache.clear()
        this.lastCleanupAt = 0
    }
}

module.exports = new AiIdempotencyService()
module.exports.AiIdempotencyService = AiIdempotencyService
