#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { renderArticleContent } = require('../../src/services/imageGenerator/renderers/article')
const { renderLiveContent } = require('../../src/services/imageGenerator/renderers/live')
const { renderVideoContent } = require('../../src/services/imageGenerator/renderers/video')
const { renderBangumiContent } = require('../../src/services/imageGenerator/renderers/bangumi')
const { EmojiIndexProvider } = require('../../src/services/imageGenerator/renderers/components/emojiIndexProvider')
const { createRenderEmojiContext } = require('../../src/services/imageGenerator/renderers/components/renderEmojiContext')

async function buildContext() {
    return createRenderEmojiContext({
        provider: new EmojiIndexProvider({
            loader: async () => [{
                rawText: '[星星眼]',
                iconUrl: 'https://i0.hdslb.com/bfs/emote/63c9d1a31c0da745b61cdb35e0ecb28635675db2.png',
                emojiId: '1956',
                packageId: '1'
            }],
            ttlMs: 60_000
        })
    })
}

async function testArticleSummaryUsesSharedTextEntry() {
    const emojiContext = await buildContext()

    const html = renderArticleContent({
        data: {
            author_face: 'https://i0.hdslb.com/bfs/face/member/noface.jpg',
            author_name: 'tester',
            title: '专栏标题',
            summary: '专栏摘要[星星眼]',
            publish_time: 1700000000,
            stats: {}
        }
    }, emojiContext)

    assert.ok(html.includes('<img class="emoji"'), 'article 摘要应支持共享 emoji 文本渲染')
}

async function testLiveTitleUsesSharedTextEntry() {
    const emojiContext = await buildContext()

    const html = renderLiveContent({
        data: {
            room_info: {
                room_id: 1,
                title: '直播间标题[星星眼]',
                live_status: 1,
                parent_area_name: '游戏',
                area_name: '动作游戏'
            },
            anchor_info: {
                base_info: {
                    face: 'https://i0.hdslb.com/bfs/face/member/noface.jpg',
                    uname: '主播'
                }
            },
            watched_show: {
                text_large: '1.2万'
            }
        }
    }, emojiContext)

    assert.ok(html.includes('<img class="emoji"'), 'live 标题应支持共享 emoji 文本渲染')
}

async function testVideoDescUsesSharedTextEntry() {
    const emojiContext = await buildContext()

    const html = renderVideoContent({
        data: {
            pic: 'https://i0.hdslb.com/bfs/archive/test.jpg',
            title: '视频标题',
            desc: '视频简介[星星眼]',
            pubdate: 1700000000,
            stat: { view: 1, like: 2, reply: 3 },
            owner: {
                name: 'UP主',
                face: 'https://i0.hdslb.com/bfs/face/member/noface.jpg',
                official_verify: { type: -1 }
            }
        }
    }, emojiContext)

    assert.ok(html.includes('<img class="emoji"'), 'video 简介应支持共享 emoji 文本渲染')
}

async function testBangumiDescUsesSharedTextEntry() {
    const emojiContext = await buildContext()

    const html = renderBangumiContent({
        data: {
            cover: 'https://i0.hdslb.com/bfs/bangumi/test.jpg',
            title: '番剧标题',
            desc: '番剧简介[星星眼]',
            season_type: 1,
            type_desc: '番剧',
            styles: [],
            areas: [],
            publish: {
                release_date_show: '2026-03-07',
                is_finish: 1
            },
            new_ep: { desc: '全1话' },
            stat: { views: 1, follow: 2, danmakus: 3 },
            rating: { score: 9.9 }
        }
    }, emojiContext)

    assert.ok(html.includes('<img class="emoji"'), 'bangumi 简介应支持共享 emoji 文本渲染')
}

async function run() {
    await testArticleSummaryUsesSharedTextEntry()
    await testLiveTitleUsesSharedTextEntry()
    await testVideoDescUsesSharedTextEntry()
    await testBangumiDescUsesSharedTextEntry()
    console.log('PASS card-text-normalization-entry')
}

run().catch(error => {
    console.error(error)
    process.exit(1)
})
