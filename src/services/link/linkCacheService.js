'use strict'

const config = require('../../config')
const logger = require('../../utils/logger')

const LINK_CACHE_SCOPE = logger.createScope('svc', 'link-cache')
const DEFAULT_TIMEOUT_SECONDS = 300

function resolveGroupIdFromCacheKey(cacheKey) {
    const normalizedCacheKey = String(cacheKey || '')
    const lastSeparatorIndex = normalizedCacheKey.lastIndexOf('|')
    if (lastSeparatorIndex === -1) {
        return null
    }
    return normalizedCacheKey.substring(lastSeparatorIndex + 1) || null
}

function getTimeoutMs(groupId) {
    const timeoutSeconds = Number(config.getGroupConfig(groupId, 'linkCacheTimeout'))
    const normalizedSeconds = Number.isFinite(timeoutSeconds) && timeoutSeconds >= 0
        ? timeoutSeconds
        : DEFAULT_TIMEOUT_SECONDS
    return normalizedSeconds * 1000
}

function buildCacheKeyFromDescriptor(descriptor) {
    if (!descriptor || typeof descriptor !== 'object') {
        return null
    }

    if (descriptor.cacheKey) {
        return String(descriptor.cacheKey)
    }

    if (!descriptor.type) {
        return null
    }

    const uniqueId = descriptor.meta?.uniqueId
        || descriptor.id
        || descriptor.sourceToken
        || descriptor.match
        || descriptor.type

    if (!uniqueId) {
        return null
    }

    if (descriptor.groupId) {
        return `${descriptor.type}|${uniqueId}|${descriptor.groupId}`
    }

    return `${descriptor.type}|${uniqueId}`
}

class LinkCacheService {
    constructor() {
        this.cache = new Map()
    }

    isCached(cacheKey) {
        const normalizedCacheKey = String(cacheKey || '')
        if (!normalizedCacheKey || !this.cache.has(normalizedCacheKey)) {
            return false
        }

        const cacheEntry = this.cache.get(normalizedCacheKey)
        const cachedTime = cacheEntry?.cachedAt
        const timeoutMs = cacheEntry?.timeoutMs

        if (Number.isFinite(cachedTime) && Number.isFinite(timeoutMs) && Date.now() - cachedTime < timeoutMs) {
            logger.logEvent('info', 'LINK', LINK_CACHE_SCOPE, 'cache-hit', {
                cacheKey: normalizedCacheKey
            })
            return true
        }

        this.cache.delete(normalizedCacheKey)
        return false
    }

    markProcessed(cacheKey) {
        const normalizedCacheKey = String(cacheKey || '')
        if (!normalizedCacheKey) {
            return null
        }

        const groupId = resolveGroupIdFromCacheKey(normalizedCacheKey)
        const timeoutMs = getTimeoutMs(groupId)
        this.cache.set(normalizedCacheKey, {
            cachedAt: Date.now(),
            timeoutMs
        })
        this.cleanupExpired()
        return normalizedCacheKey
    }

    markProcessedDescriptor(descriptor) {
        const cacheKey = buildCacheKeyFromDescriptor(descriptor)
        if (!cacheKey) {
            return null
        }

        return this.markProcessed(cacheKey)
    }

    cleanupExpired() {
        const now = Date.now()
        for (const [cacheKey, cacheEntry] of this.cache.entries()) {
            const cachedTime = cacheEntry?.cachedAt
            const timeoutMs = cacheEntry?.timeoutMs
            if (!Number.isFinite(cachedTime) || !Number.isFinite(timeoutMs) || now - cachedTime >= timeoutMs) {
                this.cache.delete(cacheKey)
            }
        }
    }

    __resetForTests() {
        this.cache.clear()
    }

    __setCacheTimeForTests(cacheKey, timestamp) {
        const normalizedCacheKey = String(cacheKey)
        const existingEntry = this.cache.get(normalizedCacheKey)
        if (!existingEntry) {
            return
        }

        this.cache.set(normalizedCacheKey, {
            ...existingEntry,
            cachedAt: timestamp
        })
    }
}

module.exports = new LinkCacheService()
