#!/usr/bin/env node
'use strict'

const assert = require('assert')
const {
    normalizeContentNodes,
    resolveDynamicContent
} = require('../../../src/services/imageGenerator/renderers/components/contentNodes')

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
                    text: '直播间地址：https://live.bilibili.com/27354807\n下载游戏：https://www.biligame.com/detail/?id=108820',
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
                        },
                        {
                            type: 'RICH_TEXT_NODE_TYPE_TEXT',
                            text: '\n下载游戏：',
                            orig_text: '\n下载游戏：'
                        },
                        {
                            type: 'RICH_TEXT_NODE_TYPE_WEB',
                            text: '网页链接',
                            jump_url: 'https://www.biligame.com/detail/?id=108820'
                        }
                    ]
                }
            }
        }
    }, false)

    assert.strictEqual(resolved.source, 'opus_summary_preferred')
    assert.strictEqual(resolved.mergeMode, 'summary_link_recovery')
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

function testResolveDynamicContentBorrowsLeadingSummaryTopicsWithoutReplacingDesc() {
    const resolved = resolveDynamicContent({
        desc: {
            text: '「献给破晓的失控」4.1版本速览\n\n开拓者好呀！帕姆带来了4.1版本中的新内容速览帕~快来看看都有什么帕！',
            rich_text_nodes: []
        },
        major: {
            type: 'MAJOR_TYPE_OPUS',
            opus: {
                summary: {
                    text: '#崩坏星穹铁道# #献给破晓的失控# 「献给破晓的失控」4.1版本速览\n\n开拓者好呀！帕姆带来了4.1版本中的新内容速览帕~快来看看都有什么帕！',
                    rich_text_nodes: [
                        { type: 'RICH_TEXT_NODE_TYPE_TOPIC', text: '#崩坏星穹铁道#', orig_text: '#崩坏星穹铁道#' },
                        { type: 'RICH_TEXT_NODE_TYPE_TEXT', text: ' ', orig_text: ' ' },
                        { type: 'RICH_TEXT_NODE_TYPE_TOPIC', text: '#献给破晓的失控#', orig_text: '#献给破晓的失控#' },
                        {
                            type: 'RICH_TEXT_NODE_TYPE_TEXT',
                            text: ' 「献给破晓的失控」4.1版本速览\n\n开拓者好呀！帕姆带来了4.1版本中的新内容速览帕~快来看看都有什么帕！',
                            orig_text: ' 「献给破晓的失控」4.1版本速览\n\n开拓者好呀！帕姆带来了4.1版本中的新内容速览帕~快来看看都有什么帕！'
                        }
                    ]
                }
            }
        }
    }, false)

    assert.strictEqual(resolved.source, 'desc')
    assert.strictEqual(resolved.mergeMode, 'summary_topic_prefix')
    assert.deepStrictEqual(resolved.mergeModes, ['summary_topic_prefix'])
    assert.strictEqual(resolved.text.startsWith('「献给破晓的失控」4.1版本速览'), true)
    assert.strictEqual(resolved.richTextNodes[0].type, 'RICH_TEXT_NODE_TYPE_TOPIC')
    assert.strictEqual(resolved.richTextNodes[2].type, 'RICH_TEXT_NODE_TYPE_TOPIC')
}

function testResolveDynamicContentBorrowsTrailingEmojiSuffix() {
    const resolved = resolveDynamicContent({
        desc: {
            text: '祝大家@帕姆元宵节快乐！\n月圆人圆，好运连连',
            rich_text_nodes: [
                {
                    type: 'RICH_TEXT_NODE_TYPE_TEXT',
                    text: '祝大家',
                    orig_text: '祝大家'
                },
                {
                    type: 'RICH_TEXT_NODE_TYPE_AT',
                    text: '@帕姆',
                    orig_text: '@帕姆'
                },
                {
                    type: 'RICH_TEXT_NODE_TYPE_TEXT',
                    text: '元宵节快乐！\n月圆人圆，好运连连',
                    orig_text: '元宵节快乐！\n月圆人圆，好运连连'
                }
            ]
        },
        major: {
            type: 'MAJOR_TYPE_OPUS',
            opus: {
                summary: {
                    text: '祝大家@帕姆元宵节快乐！\n月圆人圆，好运连连 [汤圆][汤圆]',
                    rich_text_nodes: [
                        {
                            type: 'RICH_TEXT_NODE_TYPE_TEXT',
                            text: '祝大家',
                            orig_text: '祝大家'
                        },
                        {
                            type: 'RICH_TEXT_NODE_TYPE_AT',
                            text: '@帕姆',
                            orig_text: '@帕姆'
                        },
                        {
                            type: 'RICH_TEXT_NODE_TYPE_TEXT',
                            text: '元宵节快乐！\n月圆人圆，好运连连 ',
                            orig_text: '元宵节快乐！\n月圆人圆，好运连连 '
                        },
                        { type: 'RICH_TEXT_NODE_TYPE_EMOJI', text: '[汤圆]', orig_text: '[汤圆]' },
                        { type: 'RICH_TEXT_NODE_TYPE_EMOJI', text: '[汤圆]', orig_text: '[汤圆]' }
                    ]
                }
            }
        }
    }, false)

    assert.strictEqual(resolved.source, 'desc')
    assert.strictEqual(resolved.mergeMode, 'summary_suffix_borrow')
    assert.deepStrictEqual(resolved.mergeModes, ['summary_suffix_borrow'])
    assert.strictEqual(resolved.text, '祝大家@帕姆元宵节快乐！\n月圆人圆，好运连连')
    assert.strictEqual(resolved.richTextNodes[3].type, 'RICH_TEXT_NODE_TYPE_EMOJI')
    assert.strictEqual(resolved.richTextNodes[4].type, 'RICH_TEXT_NODE_TYPE_EMOJI')
}

function testResolveDynamicContentCanCombineLeadingTopicsAndTrailingEmoji() {
    const resolved = resolveDynamicContent({
        desc: {
            text: '正文',
            rich_text_nodes: []
        },
        major: {
            type: 'MAJOR_TYPE_OPUS',
            opus: {
                summary: {
                    text: '#话题# 正文 [汤圆]',
                    rich_text_nodes: [
                        { type: 'RICH_TEXT_NODE_TYPE_TOPIC', text: '#话题#', orig_text: '#话题#' },
                        { type: 'RICH_TEXT_NODE_TYPE_TEXT', text: ' ', orig_text: ' ' },
                        { type: 'RICH_TEXT_NODE_TYPE_TEXT', text: '正文 ', orig_text: '正文 ' },
                        {
                            type: 'RICH_TEXT_NODE_TYPE_EMOJI',
                            text: '[汤圆]',
                            orig_text: '[汤圆]',
                            emoji: { icon_url: 'https://example.com/tangyuan.png' }
                        }
                    ]
                }
            }
        }
    }, false)

    const semanticTypes = resolved.richTextNodes
        .filter(node => node.type !== 'RICH_TEXT_NODE_TYPE_TEXT')
        .map(node => node.type)

    assert.strictEqual(resolved.text, '正文')
    assert.deepStrictEqual(resolved.mergeModes, ['summary_topic_prefix', 'summary_suffix_borrow'])
    assert.deepStrictEqual(semanticTypes, [
        'RICH_TEXT_NODE_TYPE_TOPIC',
        'RICH_TEXT_NODE_TYPE_EMOJI'
    ])
}

function testResolveDynamicContentBackfillsMissingSemanticNodesFromEquivalentSummary() {
    const resolved = resolveDynamicContent({
        desc: {
            text: '@甲 和 @乙',
            rich_text_nodes: [
                {
                    type: 'RICH_TEXT_NODE_TYPE_AT',
                    text: '@甲',
                    orig_text: '@甲',
                    jump_url: 'https://space.bilibili.com/1'
                },
                {
                    type: 'RICH_TEXT_NODE_TYPE_TEXT',
                    text: ' 和 @乙',
                    orig_text: ' 和 @乙'
                }
            ]
        },
        major: {
            type: 'MAJOR_TYPE_OPUS',
            opus: {
                summary: {
                    text: '@甲 和 @乙',
                    rich_text_nodes: [
                        {
                            type: 'RICH_TEXT_NODE_TYPE_AT',
                            text: '@甲',
                            orig_text: '@甲',
                            jump_url: 'https://space.bilibili.com/1'
                        },
                        {
                            type: 'RICH_TEXT_NODE_TYPE_TEXT',
                            text: ' 和 ',
                            orig_text: ' 和 '
                        },
                        {
                            type: 'RICH_TEXT_NODE_TYPE_AT',
                            text: '@乙',
                            orig_text: '@乙',
                            jump_url: 'https://space.bilibili.com/2'
                        }
                    ]
                }
            }
        }
    }, false)

    const atNodes = resolved.richTextNodes.filter(node => node.type === 'RICH_TEXT_NODE_TYPE_AT')

    assert.strictEqual(resolved.source, 'desc_with_summary_nodes')
    assert.strictEqual(resolved.mergeMode, 'equivalent_borrow')
    assert.deepStrictEqual(resolved.mergeModes, ['equivalent_borrow'])
    assert.strictEqual(atNodes.length, 2)
    assert.deepStrictEqual(resolved.borrowedNodeTypes, ['RICH_TEXT_NODE_TYPE_AT'])
}

function testResolveDynamicContentKeepsLongerDescWhenSummaryLooksTruncated() {
    const descText = 'A'.repeat(2026)
    const summaryText = 'A'.repeat(503)
    const resolved = resolveDynamicContent({
        desc: {
            text: descText,
            rich_text_nodes: []
        },
        major: {
            type: 'MAJOR_TYPE_OPUS',
            opus: {
                summary: {
                    text: summaryText,
                    rich_text_nodes: [
                        {
                            type: 'RICH_TEXT_NODE_TYPE_TEXT',
                            text: summaryText,
                            orig_text: summaryText
                        }
                    ]
                }
            }
        }
    }, false)

    assert.strictEqual(resolved.source, 'desc')
    assert.strictEqual(resolved.mergeMode, 'none')
    assert.strictEqual(resolved.text.length, 2026)
}

function testResolveDynamicContentAvoidsDuplicatingTopicFromTopicField() {
    const resolved = resolveDynamicContent({
        topic: {
            id: 1,
            name: '原神'
        },
        desc: {
            text: '正文',
            rich_text_nodes: []
        },
        major: {
            type: 'MAJOR_TYPE_OPUS',
            opus: {
                summary: {
                    text: '#原神# 正文',
                    rich_text_nodes: [
                        { type: 'RICH_TEXT_NODE_TYPE_TOPIC', text: '#原神#', orig_text: '#原神#' },
                        { type: 'RICH_TEXT_NODE_TYPE_TEXT', text: ' 正文', orig_text: ' 正文' }
                    ]
                }
            }
        }
    }, false)

    const topicNodes = resolved.richTextNodes.filter(node => node.type === 'RICH_TEXT_NODE_TYPE_TOPIC')
    assert.strictEqual(topicNodes.length, 1)
}

function run() {
    testNormalizeContentNodesKeepsEmojiNodes()
    testNormalizeContentNodesBuildsTextNodeFromFallbackText()
    testResolveDynamicContentPrefersSummaryWhenDescLacksUsefulNodes()
    testResolveDynamicContentPrependsTopicWhenTopicExistsOutsideBodyText()
    testResolveDynamicContentBorrowsLeadingSummaryTopicsWithoutReplacingDesc()
    testResolveDynamicContentBorrowsTrailingEmojiSuffix()
    testResolveDynamicContentCanCombineLeadingTopicsAndTrailingEmoji()
    testResolveDynamicContentBackfillsMissingSemanticNodesFromEquivalentSummary()
    testResolveDynamicContentKeepsLongerDescWhenSummaryLooksTruncated()
    testResolveDynamicContentAvoidsDuplicatingTopicFromTopicField()
    console.log('PASS content-nodes-normalization')
}

run()
