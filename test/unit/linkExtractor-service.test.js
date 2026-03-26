'use strict'

const assert = require('assert')
const { extractLinksFromMessage } = require('../../src/services/link/linkExtractor')

describe('linkExtractor service', function () {
    it('保留现有 descriptor 结构', function () {
        const links = extractLinksFromMessage('https://www.bilibili.com/space/123/favlist?fid=456', '10001')

        assert.deepStrictEqual(links[0], {
            type: 'favorite_list',
            id: '456',
            cacheKey: 'favorite_list|video:456|10001',
            match: 'https://www.bilibili.com/space/123/favlist?fid=456',
            meta: {
                url: 'https://www.bilibili.com/space/123/favlist?fid=456',
                mediaId: '456',
                favoriteType: 'video',
                uniqueId: 'video:456'
            },
            sourceToken: 'https://www.bilibili.com/space/123/favlist?fid=456'
        })
    })
})
