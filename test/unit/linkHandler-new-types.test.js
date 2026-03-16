'use strict'

const assert = require('assert')

const linkHandler = require('../../src/handlers/linkHandler')

describe('LinkHandler new resource extraction', function () {
    it('识别音频链接与短码', function () {
        const links = linkHandler.extractLinks('https://www.bilibili.com/audio/au123456 AU654321', '10001')
        assert.ok(links.some(link => link.type === 'audio' && link.id === '123456'))
        assert.ok(links.some(link => link.type === 'audio' && link.id === '654321'))
    })

    it('识别歌单与文集短码', function () {
        const links = linkHandler.extractLinks('AM98765 RL43210', '10001')
        assert.ok(links.some(link => link.type === 'audio_list' && link.id === '98765'))
        assert.ok(links.some(link => link.type === 'article_list' && link.id === '43210'))
    })

    it('识别收藏夹与笔记链接', function () {
        const links = linkHandler.extractLinks(
            'https://www.bilibili.com/medialist/detail/ml24680 https://www.bilibili.com/h5/note-app/view?cvid=13579',
            '10001'
        )
        assert.ok(links.some(link => link.type === 'favorite_list' && link.id === '24680'))
        assert.ok(links.some(link => link.type === 'note' && link.id === '13579'))
    })

    it('专栏与课程收藏页链接会被静默忽略', function () {
        const links = linkHandler.extractLinks(
            'https://space.bilibili.com/123/favlist?fid=articles https://space.bilibili.com/456/favlist?fid=pugvfav',
            '10001'
        )
        assert.deepStrictEqual(links, [])
    })

    it('支持 /space/<uid>/... 形态的空间链接', function () {
        const favoriteLinks = linkHandler.extractLinks(
            'https://www.bilibili.com/space/123/favlist?fid=456',
            '10001'
        )
        assert.deepStrictEqual(favoriteLinks.map(link => link.type), ['favorite_list'])

        const ignoredLinks = linkHandler.extractLinks(
            'https://www.bilibili.com/space/123/favlist?fid=articles',
            '10001'
        )
        assert.deepStrictEqual(ignoredLinks, [])

        const userLinks = linkHandler.extractLinks(
            'https://www.bilibili.com/space/24680',
            '10001'
        )
        assert.deepStrictEqual(userLinks.map(link => link.type), ['user'])
    })

    it('识别话题链接', function () {
        const links = linkHandler.extractLinks(
            'https://www.bilibili.com/v/topic/detail/?topic_id=112233 https://m.bilibili.com/topic-detail?topic_id=445566',
            '10001'
        )
        assert.ok(links.some(link => link.type === 'topic' && link.id === '112233'))
        assert.ok(links.some(link => link.type === 'topic' && link.id === '445566'))
    })

    it('识别合集与课程链接', function () {
        const links = linkHandler.extractLinks(
            'https://space.bilibili.com/51537052/channel/collectiondetail?sid=22780&ctype=0 https://www.bilibili.com/cheese/play/ep908070',
            '10001'
        )
        const channelLink = links.find(link => link.type === 'channel_series')
        const cheeseLink = links.find(link => link.type === 'cheese_video')
        assert.ok(channelLink)
        assert.strictEqual(channelLink.meta.seriesId, '22780')
        assert.strictEqual(channelLink.meta.seriesType, 'season')
        assert.ok(cheeseLink)
        assert.strictEqual(cheeseLink.meta.epId, '908070')
    })

    it('结构化空间资源链接会覆盖同 token 的 user 命中', function () {
        const favoriteLinks = linkHandler.extractLinks(
            'https://space.bilibili.com/123/favlist?fid=456',
            '10001'
        )
        assert.deepStrictEqual(favoriteLinks.map(link => link.type), ['favorite_list'])

        const seriesLinks = linkHandler.extractLinks(
            'https://space.bilibili.com/51537052/channel/collectiondetail?sid=22780&ctype=0',
            '10001'
        )
        assert.deepStrictEqual(seriesLinks.map(link => link.type), ['channel_series'])

        const userLinks = linkHandler.extractLinks(
            'https://space.bilibili.com/24680',
            '10001'
        )
        assert.deepStrictEqual(userLinks.map(link => link.type), ['user'])

        const ignoredFavoriteLinks = linkHandler.extractLinks(
            'https://space.bilibili.com/123/favlist?fid=articles',
            '10001'
        )
        assert.deepStrictEqual(ignoredFavoriteLinks, [])
    })

    it('同 UID 的主页链接和结构化资源链接不会串 sourceToken', function () {
        const links = linkHandler.extractLinks(
            'https://space.bilibili.com/123 https://space.bilibili.com/123/favlist?fid=456',
            '10001'
        )
        assert.deepStrictEqual(links.map(link => link.type), ['user', 'favorite_list'])
    })

    it('被包裹符包住的结构化链接仍能识别', function () {
        const links = linkHandler.extractLinks(
            '(https://www.bilibili.com/h5/note-app/view?cvid=13579) （https://www.bilibili.com/v/topic/detail/?topic_id=112233）',
            '10001'
        )
        assert.deepStrictEqual(links.map(link => link.type), ['note', 'topic'])

        const ignoredLinks = linkHandler.extractLinks(
            '(https://space.bilibili.com/123/favlist?fid=articles)',
            '10001'
        )
        assert.deepStrictEqual(ignoredLinks, [])
    })

    it('未知的空间子页不会回退成 user', function () {
        const links = linkHandler.extractLinks(
            'https://space.bilibili.com/24680/video',
            '10001'
        )
        assert.deepStrictEqual(links, [])
    })
})
