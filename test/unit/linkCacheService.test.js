'use strict'

const assert = require('assert')

const config = require('../../src/config')
const linkCacheService = require('../../src/services/link/linkCacheService')

describe('linkCacheService', function () {
    beforeEach(function () {
        linkCacheService.__resetForTests()
        delete config.groupConfigs['test-group']
        delete config.groupConfigs['expire-group']
    })

    it('marks cache keys and reports hits before expiry', function () {
        config.groupConfigs['test-group'] = { linkCacheTimeout: 60 }

        const cacheKey = 'video|BV1xx411c7mD|test-group'
        const markedKey = linkCacheService.markProcessed(cacheKey)

        assert.strictEqual(markedKey, cacheKey)
        assert.strictEqual(linkCacheService.isCached(cacheKey), true)
    })

    it('builds cache keys from descriptors', function () {
        config.groupConfigs['test-group'] = { linkCacheTimeout: 60 }

        const cacheKey = linkCacheService.markProcessedDescriptor({
            type: 'favorite_list',
            id: '456',
            groupId: 'test-group',
            meta: { uniqueId: 'video:456' }
        })

        assert.strictEqual(cacheKey, 'favorite_list|video:456|test-group')
        assert.strictEqual(linkCacheService.isCached(cacheKey), true)
    })

    it('cleans up expired entries using the timeout snapped at write time', function () {
        config.groupConfigs['expire-group'] = { linkCacheTimeout: 1 }

        const cacheKey = 'dynamic|123456|expire-group'
        linkCacheService.markProcessed(cacheKey)
        linkCacheService.__setCacheTimeForTests(cacheKey, Date.now() - 1500)
        config.groupConfigs['expire-group'].linkCacheTimeout = 60

        linkCacheService.cleanupExpired()

        assert.strictEqual(linkCacheService.isCached(cacheKey), false)
    })

    it('keeps existing cache entry expiry unchanged after group timeout changes', function () {
        config.groupConfigs['test-group'] = { linkCacheTimeout: 60 }

        const cacheKey = 'video|BV1xx411c7mD|test-group'
        linkCacheService.markProcessed(cacheKey)
        linkCacheService.__setCacheTimeForTests(cacheKey, Date.now() - 30000)
        config.groupConfigs['test-group'].linkCacheTimeout = 10

        assert.strictEqual(linkCacheService.isCached(cacheKey), true)
    })
})
