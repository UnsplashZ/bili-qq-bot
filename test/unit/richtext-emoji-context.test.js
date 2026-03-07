#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { parseRichText } = require('../../src/services/imageGenerator/renderers/components/richtext')
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

async function testEmojiNodeUsesNodeIconUrl() {
    const emojiContext = await buildContext([])
    const html = parseRichText([
        {
            type: 'RICH_TEXT_NODE_TYPE_EMOJI',
            text: '[汤圆]',
            orig_text: '[汤圆]',
            emoji: {
                text: '[汤圆]',
                icon_url: 'https://i0.hdslb.com/bfs/emote/tangyuan.png'
            }
        }
    ], '', emojiContext)

    assert.ok(html.includes('https://i0.hdslb.com/bfs/emote/tangyuan.png'), 'emoji 节点应直接使用节点 icon_url')
}

async function testPlainTextEmojiUsesCurrentContextOnly() {
    const left = await buildContext([{
        rawText: '[星星眼]',
        iconUrl: 'https://i0.hdslb.com/bfs/emote/63c9d1a31c0da745b61cdb35e0ecb28635675db2.png'
    }])
    const right = await buildContext([])

    const withEmoji = parseRichText(null, '可爱捏[星星眼]', left)
    const withoutEmoji = parseRichText(null, '可爱捏[星星眼]', right)

    assert.ok(withEmoji.includes('<img class="emoji"'), '当前 context 命中官方索引时应补图')
    assert.ok(!withoutEmoji.includes('<img class="emoji"'), '未命中的 context 不应被其他 context 污染')
    assert.ok(withoutEmoji.includes('可爱捏[星星眼]'), '未命中时应保留原始文本')
}

async function run() {
    await testEmojiNodeUsesNodeIconUrl()
    await testPlainTextEmojiUsesCurrentContextOnly()
    console.log('PASS richtext-emoji-context')
}

run().catch(error => {
    console.error(error)
    process.exit(1)
})
