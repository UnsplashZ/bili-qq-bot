#!/usr/bin/env node
'use strict'

const assert = require('assert')
const {
    normalizeContentNodes,
    resolveDynamicContent
} = require('../../src/services/imageGenerator/renderers/components/contentNodes')

function testNormalizeContentNodesKeepsEmojiNodes() {
    const nodes = normalizeContentNodes([
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
                icon_url: 'https://i0.hdslb.com/bfs/emote/63c9d1a31c0da745b61cdb35e0ecb28635675db2.png'
            }
        }
    ], '')

    assert.strictEqual(nodes.length, 2)
    assert.strictEqual(nodes[1].type, 'RICH_TEXT_NODE_TYPE_EMOJI')
}

function testNormalizeContentNodesBuildsTextNodeFromFallbackText() {
    const nodes = normalizeContentNodes(null, '纯文本正文')

    assert.strictEqual(nodes.length, 1)
    assert.strictEqual(nodes[0].type, 'RICH_TEXT_NODE_TYPE_TEXT')
    assert.strictEqual(nodes[0].text, '纯文本正文')
}

function testResolveDynamicContentPrefersSummaryWhenDescLacksUsefulNodes() {
    const resolved = resolveDynamicContent({
        desc: {
            text: '直播间地址：\n下载游戏：',
            rich_text_nodes: []
        },
        major: {
            type: 'MAJOR_TYPE_OPUS',
            opus: {
                title: 'opus title',
                summary: {
                    text: '直播间地址：https://live.bilibili.com/27354807',
                    rich_text_nodes: [
                        {
                            type: 'RICH_TEXT_NODE_TYPE_TEXT',
                            text: '直播间地址：',
                            orig_text: '直播间地址：'
                        },
                        {
                            type: 'RICH_TEXT_NODE_TYPE_WEB',
                            text: '网页链接',
                            jump_url: 'https://live.bilibili.com/27354807'
                        }
                    ]
                }
            }
        }
    }, false)

    assert.strictEqual(resolved.source, 'opus_summary_preferred')
    assert.strictEqual(resolved.richTextNodes[1].type, 'RICH_TEXT_NODE_TYPE_WEB')
}

function testResolveDynamicContentPrependsTopicWhenTopicExistsOutsideBodyText() {
    const resolved = resolveDynamicContent({
        topic: {
            id: 1005190,
            name: '元宵节快乐',
            jump_url: 'https://m.bilibili.com/topic-detail?topic_id=1005190&topic_name=%E5%85%83%E5%AE%B5%E8%8A%82%E5%BF%AB%E4%B9%90'
        },
        desc: {
            text: '祝大家元宵节快乐！',
            rich_text_nodes: []
        },
        major: {
            type: 'MAJOR_TYPE_OPUS',
            opus: {
                summary: {
                    text: '祝大家元宵节快乐！[汤圆]',
                    rich_text_nodes: [
                        {
                            type: 'RICH_TEXT_NODE_TYPE_TEXT',
                            text: '祝大家元宵节快乐！',
                            orig_text: '祝大家元宵节快乐！'
                        },
                        {
                            type: 'RICH_TEXT_NODE_TYPE_EMOJI',
                            text: '[汤圆]',
                            orig_text: '[汤圆]',
                            emoji: {
                                icon_url: 'https://i0.hdslb.com/bfs/emote/93609633a9d194cf336687eb19c01dca95bde719.png'
                            }
                        }
                    ]
                }
            }
        }
    }, false)

    assert.strictEqual(resolved.richTextNodes[0].type, 'RICH_TEXT_NODE_TYPE_TOPIC')
    assert.strictEqual(resolved.richTextNodes[0].text, '元宵节快乐')
    assert.strictEqual(resolved.richTextNodes[0].orig_text, '元宵节快乐')
    assert.strictEqual(resolved.richTextNodes[1].type, 'RICH_TEXT_NODE_TYPE_TEXT')
}

function run() {
    testNormalizeContentNodesKeepsEmojiNodes()
    testNormalizeContentNodesBuildsTextNodeFromFallbackText()
    testResolveDynamicContentPrefersSummaryWhenDescLacksUsefulNodes()
    testResolveDynamicContentPrependsTopicWhenTopicExistsOutsideBodyText()
    console.log('PASS content-nodes-normalization')
}

run()
