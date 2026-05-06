'use strict'

const assert = require('assert')

const { renderGenericContent } = require('../../../src/services/imageGenerator/renderers/generic')

describe('generic renderer', function () {
    it('渲染轻量资源卡片', function () {
        const html = renderGenericContent({
            data: {
                title: '测试收藏夹',
                subtitle: '视频收藏夹',
                desc: '这是一个用于断言的描述',
                cover: 'https://example.com/cover.jpg',
                owner: {
                    name: '测试用户',
                    face: 'https://example.com/avatar.jpg'
                },
                stats: [
                    { label: '内容', value: 12 },
                    { label: '播放', value: 3456 }
                ]
            }
        })

        assert.ok(html.includes('测试收藏夹'))
        assert.ok(html.includes('视频收藏夹'))
        assert.ok(html.includes('测试用户'))
        assert.ok(html.includes('内容 12'))
        assert.ok(html.includes('播放 3456'))
        assert.ok(html.includes('embedded-resource-card'))
    })
})
