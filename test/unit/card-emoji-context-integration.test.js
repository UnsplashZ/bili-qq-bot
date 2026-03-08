#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { renderVideoContent } = require('../../src/services/imageGenerator/renderers/video')
const { renderArticleContent } = require('../../src/services/imageGenerator/renderers/article')
const { EmojiIndexProvider } = require('../../src/services/imageGenerator/renderers/components/emojiIndexProvider')
const { createRenderEmojiContext } = require('../../src/services/imageGenerator/renderers/components/renderEmojiContext')

async function buildContext(records) {
    return createRenderEmojiContext({
        provider: new EmojiIndexProvider({
            loader: async () => records,
            ttlMs: 60_000
        })
    })
}

async function testVideoRendererSupportsPlainTextEmojiThroughContext() {
    const emojiContext = await buildContext([{
        rawText: '[星星眼]',
        iconUrl: 'https://i0.hdslb.com/bfs/emote/63c9d1a31c0da745b61cdb35e0ecb28635675db2.png'
    }])

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

    assert.ok(html.includes('<img class="emoji"'), '卡片 renderer 应接入请求级 emojiContext')
}

async function testCardContextsDoNotLeakBetweenRequests() {
    const warmContext = await buildContext([{
        rawText: '[星星眼]',
        iconUrl: 'https://i0.hdslb.com/bfs/emote/63c9d1a31c0da745b61cdb35e0ecb28635675db2.png'
    }])
    const cleanContext = await buildContext([])

    renderVideoContent({
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
    }, warmContext)

    const cleanHtml = renderArticleContent({
        data: {
            author_face: 'https://i0.hdslb.com/bfs/face/member/noface.jpg',
            author_name: 'tester',
            title: '专栏标题',
            summary: '普通文本[星星眼]',
            publish_time: 1700000000,
            stats: {}
        }
    }, cleanContext)

    assert.ok(!cleanHtml.includes('<img class="emoji"'), '新卡片上下文未命中时不应继承上一张卡片的表情状态')
}

async function testSlowProviderDoesNotBlockCardRendererAndFallsBackToPlainText() {
    let releaseLoader = null
    const emojiContext = await createRenderEmojiContext({
        provider: new EmojiIndexProvider({
            loader: () => new Promise(resolve => {
                releaseLoader = resolve
            }),
            ttlMs: 60_000
        })
    })

    const startedAt = Date.now()
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
    const elapsedMs = Date.now() - startedAt

    assert.ok(elapsedMs < 100, '慢 provider 不应阻塞卡片 renderer')
    assert.ok(html.includes('视频简介[星星眼]'), 'provider 尚未就绪时应降级保留原文')
    assert.ok(!html.includes('<img class="emoji"'), 'provider 尚未就绪时不应错误补图')

    releaseLoader([])
}

async function run() {
    await testVideoRendererSupportsPlainTextEmojiThroughContext()
    await testCardContextsDoNotLeakBetweenRequests()
    await testSlowProviderDoesNotBlockCardRendererAndFallsBackToPlainText()
    console.log('PASS card-emoji-context-integration')
}

run().catch(error => {
    console.error(error)
    process.exit(1)
})
