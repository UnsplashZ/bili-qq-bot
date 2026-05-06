#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { renderDynamicContent } = require('../../../src/services/imageGenerator/renderers/dynamic')
const { EmojiIndexProvider } = require('../../../src/services/imageGenerator/renderers/components/emojiIndexProvider')
const { createRenderEmojiContext } = require('../../../src/services/imageGenerator/renderers/components/renderEmojiContext')

function buildDynamicPayload(nodes, text) {
    return {
        data: {
            item: {
                id_str: '1175799579948351508',
                type: 'DYNAMIC_TYPE_WORD',
                modules: {
                    module_author: {
                        name: 'tester',
                        face: 'https://i0.hdslb.com/bfs/face/member/noface.jpg',
                        pub_time: '2026-03-07 00:00:00'
                    },
                    module_dynamic: {
                        desc: {
                            text,
                            rich_text_nodes: nodes
                        },
                        major: null
                    },
                    module_stat: {
                        forward: { count: 1 },
                        like: { count: 2 },
                        comment: { count: 3 }
                    }
                }
            },
            pub_ts: 1700000000
        }
    }
}

async function buildContext(records) {
    return createRenderEmojiContext({
        provider: new EmojiIndexProvider({
            loader: async () => records,
            ttlMs: 60_000
        })
    })
}

async function testDynamicRendererSupportsPlainTextFallbackWithinCurrentContext() {
    const emojiContext = await buildContext([])

    renderDynamicContent(buildDynamicPayload([
        {
            type: 'RICH_TEXT_NODE_TYPE_TEXT',
            text: '可爱捏',
            orig_text: '可爱捏'
        },
        {
            type: 'RICH_TEXT_NODE_TYPE_EMOJI',
            text: '[星星眼]',
            orig_text: '[星星眼]',
            emoji: {
                text: '[星星眼]',
                icon_url: 'https://i0.hdslb.com/bfs/emote/63c9d1a31c0da745b61cdb35e0ecb28635675db2.png',
                id: '1956',
                package_id: '1'
            }
        }
    ], '可爱捏[星星眼]'), emojiContext)

    const html = renderDynamicContent(buildDynamicPayload(null, '再次看到[星星眼]'), emojiContext)

    assert.ok(html.includes('<img class="emoji"'), '同一卡片上下文内应支持节点注册后的纯文本补图')
    assert.ok(html.includes('再次看到'), '非表情文本应保留')
}

async function run() {
    await testDynamicRendererSupportsPlainTextFallbackWithinCurrentContext()
    console.log('PASS dynamic-emoji-registry-integration')
}

run().catch(error => {
    console.error(error)
    process.exit(1)
})
