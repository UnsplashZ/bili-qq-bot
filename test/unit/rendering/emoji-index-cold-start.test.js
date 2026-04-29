#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { parseRichText } = require('../../../src/services/imageGenerator/renderers/components/richtext')
const { EmojiIndexProvider } = require('../../../src/services/imageGenerator/renderers/components/emojiIndexProvider')
const { createRenderEmojiContext } = require('../../../src/services/imageGenerator/renderers/components/renderEmojiContext')

async function testPreloadedProviderPlainTextEmojiUsesProviderIndex() {
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
    const html = parseRichText([
        {
            type: 'RICH_TEXT_NODE_TYPE_TEXT',
            text: '可爱捏[星星眼]',
            orig_text: '可爱捏[星星眼]'
        }
    ], '', emojiContext)

    assert.ok(html.includes('<img class="emoji"'), '已预热 provider 时纯文本官方表情应能通过 provider 索引补图')
    assert.ok(html.includes('可爱捏'), '普通文本应继续保留')
}

async function run() {
    await testPreloadedProviderPlainTextEmojiUsesProviderIndex()
    console.log('PASS emoji-index-cold-start')
}

run().catch(error => {
    console.error(error)
    process.exit(1)
})
