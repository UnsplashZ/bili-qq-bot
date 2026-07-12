'use strict'

const assert = require('assert')

const config = require('../../../src/config')
const linkCacheService = require('../../../src/services/link/linkCacheService')

describe('linkCacheService', function () {
    beforeEach(function () {
        linkCacheService.__resetForTests()
        delete config.__getMutableCompatStateForTests().groupConfigs['test-group']
        delete config.__getMutableCompatStateForTests().groupConfigs['expire-group']
    })

    it('marks cache keys and reports hits before expiry', function () {
        config.__getMutableCompatStateForTests().groupConfigs['test-group'] = { linkCacheTimeout: 60 }

        const cacheKey = 'video|BV1xx411c7mD|test-group'
        const markedKey = linkCacheService.markProcessed(cacheKey)

        assert.strictEqual(markedKey, cacheKey)
        assert.strictEqual(linkCacheService.isCached(cacheKey), true)
    })

    it('builds cache keys from descriptors', function () {
        config.__getMutableCompatStateForTests().groupConfigs['test-group'] = { linkCacheTimeout: 60 }

        const cacheKey = linkCacheService.markProcessedDescriptor({
            type: 'favorite_list',
            id: '456',
            groupId: 'test-group',
            meta: { uniqueId: 'video:456' }
        })

        assert.strictEqual(cacheKey, 'favorite_list|video:456|test-group')
        assert.strictEqual(linkCacheService.isCached(cacheKey), true)
    })

    it('keeps existing entries when the group timeout is extended before cleanup', function () {
        config.__getMutableCompatStateForTests().groupConfigs['expire-group'] = { linkCacheTimeout: 1 }

        const cacheKey = 'dynamic|123456|expire-group'
        linkCacheService.markProcessed(cacheKey)
        linkCacheService.__setCacheTimeForTests(cacheKey, Date.now() - 1500)
        config.__getMutableCompatStateForTests().groupConfigs['expire-group'].linkCacheTimeout = 60

        linkCacheService.cleanupExpired()

        assert.strictEqual(linkCacheService.isCached(cacheKey), true)
    })

    it('expires existing cache entries immediately when the group timeout is shortened', function () {
        config.__getMutableCompatStateForTests().groupConfigs['test-group'] = { linkCacheTimeout: 60 }

        const cacheKey = 'video|BV1xx411c7mD|test-group'
        linkCacheService.markProcessed(cacheKey)
        linkCacheService.__setCacheTimeForTests(cacheKey, Date.now() - 30000)
        config.__getMutableCompatStateForTests().groupConfigs['test-group'].linkCacheTimeout = 10

        assert.strictEqual(linkCacheService.isCached(cacheKey), false)
    })
})
