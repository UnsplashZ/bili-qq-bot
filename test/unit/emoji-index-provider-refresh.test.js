#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { EmojiIndexProvider } = require('../../src/services/imageGenerator/renderers/components/emojiIndexProvider')

async function testProviderServesStaleCacheWhileRefreshing() {
    let fakeNow = 1_000
    let loadCount = 0
    let releaseLoader = null
    let records = [{
        rawText: '[星星眼]',
        iconUrl: 'https://example.com/old.png'
    }]

    const provider = new EmojiIndexProvider({
        loader: () => {
            loadCount += 1
            return new Promise(resolve => {
                releaseLoader = () => resolve(records)
            })
        },
        ttlMs: 10,
        now: () => fakeNow
    })

    const firstLoad = provider.ensureLoaded()
    assert.ok(releaseLoader, '首次 ensureLoaded 应启动 loader')
    releaseLoader()
    await firstLoad

    const initial = provider.lookupEmojiByText('[星星眼]')
    assert.ok(initial, '首次加载后应可读取缓存')
    assert.strictEqual(initial.iconUrl, 'https://example.com/old.png')

    fakeNow += 20
    records = [{
        rawText: '[星星眼]',
        iconUrl: 'https://example.com/new.png'
    }]

    provider.refreshInBackground()
    const stale = provider.lookupEmojiByText('[星星眼]')

    assert.ok(stale, '后台刷新时应继续读取旧缓存')
    assert.strictEqual(stale.iconUrl, 'https://example.com/old.png')
    assert.strictEqual(loadCount, 2, 'TTL 过期后应触发一次新 loader')

    releaseLoader()
    await provider.loadingPromise

    const refreshed = provider.lookupEmojiByText('[星星眼]')
    assert.ok(refreshed, '后台刷新完成后应可读取新缓存')
    assert.strictEqual(refreshed.iconUrl, 'https://example.com/new.png')

    provider.refreshInBackground()
    provider.refreshInBackground()
    assert.strictEqual(loadCount, 2, '缓存未过期时重复 refreshInBackground 不应重复加载')
}

async function run() {
    await testProviderServesStaleCacheWhileRefreshing()
    console.log('PASS emoji-index-provider-refresh')
}

run().catch(error => {
    console.error(error)
    process.exit(1)
})
