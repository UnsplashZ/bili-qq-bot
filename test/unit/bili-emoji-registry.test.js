#!/usr/bin/env node
'use strict'

const assert = require('assert')
const {
    collectEmojiNodes,
    createEmojiRecordFromNode,
    isEmojiToken,
    normalizeEmojiText,
    splitEmojiTokens
} = require('../../src/services/imageGenerator/renderers/components/biliEmojiRegistry')

function testCreateEmojiRecordFromNode() {
    const record = createEmojiRecordFromNode({
        type: 'RICH_TEXT_NODE_TYPE_EMOJI',
        text: '[星星眼]',
        orig_text: '[星星眼]',
        emoji: {
            text: '[星星眼]',
            icon_url: 'https://i0.hdslb.com/bfs/emote/63c9d1a31c0da745b61cdb35e0ecb28635675db2.png',
            id: '1956',
            package_id: '1'
        }
    })

    assert.ok(record, 'emoji 节点应能转换成标准记录')
    assert.strictEqual(record.rawText, '[星星眼]')
    assert.strictEqual(record.iconUrl, 'https://i0.hdslb.com/bfs/emote/63c9d1a31c0da745b61cdb35e0ecb28635675db2.png')
}

function testCollectEmojiNodesFindsNestedEmojiNodes() {
    const nodes = collectEmojiNodes({
        item: {
            modules: {
                module_dynamic: {
                    desc: {
                        rich_text_nodes: [
                            { type: 'RICH_TEXT_NODE_TYPE_TEXT', text: '可爱捏' },
                            {
                                type: 'RICH_TEXT_NODE_TYPE_EMOJI',
                                text: '[星星眼]',
                                emoji: {
                                    text: '[星星眼]',
                                    icon_url: 'https://i0.hdslb.com/bfs/emote/63c9d1a31c0da745b61cdb35e0ecb28635675db2.png'
                                }
                            }
                        ]
                    }
                }
            }
        }
    })

    assert.strictEqual(nodes.length, 1, '应能从嵌套卡片数据里收集 emoji 节点')
    assert.strictEqual(nodes[0].text, '[星星眼]')
}

function testEmojiTokenHelpers() {
    assert.strictEqual(normalizeEmojiText('  [星星眼]  '), '[星星眼]')
    assert.strictEqual(isEmojiToken('[星星眼]'), true)
    assert.strictEqual(isEmojiToken('不是表情[星星眼]'), false)
    assert.deepStrictEqual(splitEmojiTokens('可爱捏[星星眼]嘿嘿'), ['可爱捏', '[星星眼]', '嘿嘿'])
}

function run() {
    testCreateEmojiRecordFromNode()
    testCollectEmojiNodesFindsNestedEmojiNodes()
    testEmojiTokenHelpers()
    console.log('PASS bili-emoji-registry')
}

run()
