#!/usr/bin/env node
'use strict'

const assert = require('assert')
const {
    EmojiIndexProvider,
    warmupEmojiIndexProvider
} = require('../../src/services/imageGenerator/renderers/components/emojiIndexProvider')
const { createRenderEmojiContext } = require('../../src/services/imageGenerator/renderers/components/renderEmojiContext')

async function testContextCanLookupEmojiFromPreloadedProvider() {
    const provider = new EmojiIndexProvider({
        loader: async () => [{
            rawText: '[星星眼]',
            iconUrl: 'https://i0.hdslb.com/bfs/emote/63c9d1a31c0da745b61cdb35e0ecb28635675db2.png',
            emojiId: '1956',
            packageId: '1'
        }],
        ttlMs: 60_000
    })

    await provider.ensureLoaded()
    const emojiContext = await createRenderEmojiContext({ provider })
    const matched = emojiContext.lookupEmojiByText('[星星眼]')

    assert.ok(matched, '已预热 provider 时 context 应可命中官方表情')
    assert.strictEqual(matched.iconUrl, 'https://i0.hdslb.com/bfs/emote/63c9d1a31c0da745b61cdb35e0ecb28635675db2.png')
}

async function testContextRegistrationDoesNotLeakAcrossRequests() {
    const provider = new EmojiIndexProvider({
        loader: async () => [],
        ttlMs: 60_000
    })

    const left = await createRenderEmojiContext({ provider })
    const right = await createRenderEmojiContext({ provider })

    left.registerEmojiNode({
        type: 'RICH_TEXT_NODE_TYPE_EMOJI',
        text: '[汤圆]',
        orig_text: '[汤圆]',
        emoji: {
            text: '[汤圆]',
            icon_url: 'https://i0.hdslb.com/bfs/emote/tangyuan.png',
            id: '1000',
            package_id: '2'
        }
    })

    assert.ok(left.lookupEmojiByText('[汤圆]'), '当前请求内注册的表情应可回查')
    assert.strictEqual(right.lookupEmojiByText('[汤圆]'), null, '不同请求上下文之间不应泄漏注册结果')
}

async function testCreateRenderEmojiContextDoesNotAwaitSlowProvider() {
    let releaseLoader = null
    const provider = new EmojiIndexProvider({
        loader: () => new Promise(resolve => {
            releaseLoader = resolve
        }),
        ttlMs: 60_000
    })

    const startedAt = Date.now()
    const result = await Promise.race([
        createRenderEmojiContext({ provider }).then(context => ({ type: 'resolved', context })),
        new Promise(resolve => setTimeout(() => resolve({ type: 'timeout' }), 100))
    ])
    const elapsedMs = Date.now() - startedAt

    assert.strictEqual(result.type, 'resolved', 'createRenderEmojiContext 不应等待慢 loader')
    const context = result.context
    assert.ok(context, '应立即得到 context')
    assert.ok(elapsedMs < 100, 'createRenderEmojiContext 不应等待慢 loader')

    releaseLoader([])
}

function testWarmupEmojiIndexProviderTriggersBackgroundRefresh() {
    let called = 0
    const provider = {
        refreshInBackground() {
            called += 1
            return Promise.resolve()
        }
    }

    warmupEmojiIndexProvider(provider)
    assert.strictEqual(called, 1, '预热入口应触发一次后台刷新')
}

function testWarmupEmojiIndexProviderSwallowsProviderError() {
    const provider = {
        refreshInBackground() {
            throw new Error('boom')
        }
    }

    assert.doesNotThrow(() => warmupEmojiIndexProvider(provider), '预热入口不应把 provider 异常向外抛出')
}

async function run() {
    await testContextCanLookupEmojiFromPreloadedProvider()
    await testContextRegistrationDoesNotLeakAcrossRequests()
    await testCreateRenderEmojiContextDoesNotAwaitSlowProvider()
    testWarmupEmojiIndexProviderTriggersBackgroundRefresh()
    testWarmupEmojiIndexProviderSwallowsProviderError()
    console.log('PASS render-emoji-context')
}

run().catch(error => {
    console.error(error)
    process.exit(1)
})
