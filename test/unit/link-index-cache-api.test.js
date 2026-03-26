'use strict'

const assert = require('assert')

const config = require('../../src/config')
const linkDomain = require('../../src/services/link')

describe('link domain cache convenience API', function () {
    beforeEach(function () {
        linkDomain.__resetCacheForTests()
        delete config.groupConfigs['10001']
        config.groupConfigs['10001'] = { linkCacheTimeout: 60 }
    })

    it('extracts links from text and caches all resolved keys', function () {
        const result = linkDomain.cacheResolvedText(
            'https://www.bilibili.com/video/BV1xx411c7mD https://space.bilibili.com/123/favlist?fid=456',
            '10001'
        )

        assert.strictEqual(result.addedCount, 2)
        assert.deepStrictEqual(result.cacheKeys, [
            'video|BV1xx411c7mD|10001',
            'favorite_list|video:456|10001'
        ])
        assert.strictEqual(linkDomain.isCached('video|BV1xx411c7mD|10001'), true)
        assert.strictEqual(linkDomain.isCached('favorite_list|video:456|10001'), true)
    })

    it('returns an empty result when text has no supported links', function () {
        const result = linkDomain.cacheResolvedText('hello world', '10001')

        assert.deepStrictEqual(result, {
            addedCount: 0,
            cacheKeys: []
        })
    })
})
