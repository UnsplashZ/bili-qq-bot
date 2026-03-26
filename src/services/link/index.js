'use strict'

const { extractLinksFromMessage } = require('./linkExtractor')
const linkCacheService = require('./linkCacheService')

function cacheResolvedText(text, groupId, traceContext = null) {
    if (!text || !groupId) {
        return {
            addedCount: 0,
            cacheKeys: []
        }
    }

    const links = extractLinksFromMessage(text, groupId, traceContext)
    const cacheKeys = []

    for (const descriptor of links) {
        const cacheKey = linkCacheService.markProcessedDescriptor(descriptor)
        if (cacheKey) {
            cacheKeys.push(cacheKey)
        }
    }

    return {
        addedCount: cacheKeys.length,
        cacheKeys
    }
}

module.exports = {
    cacheResolvedText,
    extractLinksFromMessage,
    isCached: linkCacheService.isCached.bind(linkCacheService),
    markProcessed: linkCacheService.markProcessed.bind(linkCacheService),
    markProcessedDescriptor: linkCacheService.markProcessedDescriptor.bind(linkCacheService),
    cleanupExpired: linkCacheService.cleanupExpired.bind(linkCacheService),
    __resetCacheForTests: linkCacheService.__resetForTests.bind(linkCacheService),
    __setCacheTimeForTests: linkCacheService.__setCacheTimeForTests.bind(linkCacheService)
}
