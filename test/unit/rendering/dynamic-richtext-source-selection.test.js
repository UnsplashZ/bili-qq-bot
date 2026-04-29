#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { renderDynamicContent } = require('../../../src/services/imageGenerator/renderers/dynamic')
const { renderUserContent } = require('../../../src/services/imageGenerator/renderers/user')

function buildDynamicPayload({
    descText = '',
    descNodes = [],
    summaryText = '',
    summaryNodes = [],
    topic = null,
    orig = null
} = {}) {
    return {
        data: {
            item: {
                id_str: '1176618467023912983',
                modules: {
                    module_author: {
                        name: 'tester',
                        face: 'https://i0.hdslb.com/bfs/face/member/noface.jpg',
                        pub_time: '2026-03-07 00:00:00'
                    },
                    module_dynamic: {
                        topic,
                        desc: {
                            text: descText,
                            rich_text_nodes: descNodes
                        },
                        major: {
                            type: 'MAJOR_TYPE_OPUS',
                            opus: {
                                title: 'opus title',
                                summary: {
                                    text: summaryText,
                                    rich_text_nodes: summaryNodes
                                },
                                pics: [
                                    { url: 'https://i0.hdslb.com/bfs/new_dyn/fec17e8c86e815bdc1ad8ce2b5bdbf9e1955897084.png' }
                                ]
                            }
                        }
                    },
                    module_stat: {
                        forward: { count: 1 },
                        like: { count: 2 },
                        comment: { count: 3 }
                    }
                },
                orig
            },
            pub_ts: 1700000000
        }
    }
}

function testPreferSummaryWhenDescHasEmptyAddressLabels() {
    const html = renderDynamicContent(
        buildDynamicPayload({
            descText: '直播间地址：\n下载游戏：',
            descNodes: [],
            summaryText: '直播间地址：https://live.bilibili.com/27354807\n下载游戏：https://www.biligame.com/detail/?id=108820',
            summaryNodes: [
                { type: 'RICH_TEXT_NODE_TYPE_TEXT', text: '直播间地址：' },
                { type: 'RICH_TEXT_NODE_TYPE_WEB', text: '网页链接', jump_url: 'https://live.bilibili.com/27354807' },
                { type: 'RICH_TEXT_NODE_TYPE_TEXT', text: '\n下载游戏：' },
                { type: 'RICH_TEXT_NODE_TYPE_WEB', text: '网页链接', jump_url: 'https://www.biligame.com/detail/?id=108820' }
            ]
        })
    )

    assert.ok(html.includes('直播间地址：'), '期望命中链接补全后的 summary 文本')
    assert.ok(html.includes('网页链接'), '应渲染 summary 中的 WEB 节点')
}

function testKeepDescWhenDescHasRichLinkNodes() {
    const html = renderDynamicContent(
        buildDynamicPayload({
            descText: 'DESC_PRIORITY',
            descNodes: [
                { type: 'RICH_TEXT_NODE_TYPE_TEXT', text: 'DESC_PRIORITY ' },
                { type: 'RICH_TEXT_NODE_TYPE_URL', text: 'https://example.com', jump_url: 'https://example.com' }
            ],
            summaryText: 'SUMMARY_SHOULD_NOT_USE',
            summaryNodes: [
                { type: 'RICH_TEXT_NODE_TYPE_TEXT', text: 'SUMMARY_SHOULD_NOT_USE' },
                { type: 'RICH_TEXT_NODE_TYPE_WEB', text: '网页链接', jump_url: 'https://not-used.example' }
            ]
        })
    )

    assert.ok(html.includes('DESC_PRIORITY'), 'desc 有有效链接节点时应保持 desc 优先')
    assert.ok(!html.includes('SUMMARY_SHOULD_NOT_USE'), 'desc 有效时不应切到 summary')
}

function testBorrowLeadingSummaryTopicsInDynamicCard() {
    const html = renderDynamicContent(
        buildDynamicPayload({
            descText: '「献给破晓的失控」4.1版本速览',
            descNodes: [],
            summaryText: '#崩坏星穹铁道# #献给破晓的失控# 「献给破晓的失控」4.1版本速览',
            summaryNodes: [
                { type: 'RICH_TEXT_NODE_TYPE_TOPIC', text: '#崩坏星穹铁道#', orig_text: '#崩坏星穹铁道#' },
                { type: 'RICH_TEXT_NODE_TYPE_TEXT', text: ' ', orig_text: ' ' },
                { type: 'RICH_TEXT_NODE_TYPE_TOPIC', text: '#献给破晓的失控#', orig_text: '#献给破晓的失控#' },
                { type: 'RICH_TEXT_NODE_TYPE_TEXT', text: ' 「献给破晓的失控」4.1版本速览', orig_text: ' 「献给破晓的失控」4.1版本速览' }
            ]
        })
    )

    assert.ok(html.includes('#崩坏星穹铁道#'), '动态卡片应恢复 summary 前置话题')
    assert.ok(html.includes('#献给破晓的失控#'), '动态卡片应恢复多个 summary 话题')
    assert.ok(html.includes('「献给破晓的失控」4.1版本速览'), '正文主体仍应保留 desc 文本')
}

function testBorrowLeadingTopicsAndTrailingEmojiInDynamicCard() {
    const html = renderDynamicContent(
        buildDynamicPayload({
            descText: '正文',
            descNodes: [],
            summaryText: '#话题# 正文 [汤圆]',
            summaryNodes: [
                {
                    type: 'RICH_TEXT_NODE_TYPE_TOPIC',
                    text: '#话题#',
                    orig_text: '#话题#',
                    jump_url: 'https://www.bilibili.com/v/topic/detail/?topic_id=1'
                },
                { type: 'RICH_TEXT_NODE_TYPE_TEXT', text: ' ', orig_text: ' ' },
                { type: 'RICH_TEXT_NODE_TYPE_TEXT', text: '正文 ', orig_text: '正文 ' },
                {
                    type: 'RICH_TEXT_NODE_TYPE_EMOJI',
                    text: '[汤圆]',
                    orig_text: '[汤圆]',
                    emoji: { icon_url: 'https://example.com/tangyuan.png' }
                }
            ]
        })
    )

    assert.ok(html.includes('#话题#'), '动态卡片应恢复前置话题')
    assert.ok(html.includes('<img class="emoji"'), '动态卡片应恢复尾部 emoji')
}

function testBorrowLeadingSummaryTopicsInOrigCard() {
    const html = renderDynamicContent(
        buildDynamicPayload({
            descText: '转发说明',
            descNodes: [],
            orig: {
                id_str: '1180220937382920247',
                pub_ts: 1700000000,
                modules: {
                    module_author: {
                        name: '原作者',
                        face: 'https://i0.hdslb.com/bfs/face/member/noface.jpg',
                        official_verify: { type: -1 }
                    },
                    module_dynamic: {
                        desc: {
                            text: '「献给破晓的失控」4.1版本速览',
                            rich_text_nodes: []
                        },
                        major: {
                            type: 'MAJOR_TYPE_OPUS',
                            opus: {
                                summary: {
                                    text: '#崩坏星穹铁道# #献给破晓的失控# 「献给破晓的失控」4.1版本速览',
                                    rich_text_nodes: [
                                        { type: 'RICH_TEXT_NODE_TYPE_TOPIC', text: '#崩坏星穹铁道#', orig_text: '#崩坏星穹铁道#' },
                                        { type: 'RICH_TEXT_NODE_TYPE_TEXT', text: ' ', orig_text: ' ' },
                                        { type: 'RICH_TEXT_NODE_TYPE_TOPIC', text: '#献给破晓的失控#', orig_text: '#献给破晓的失控#' },
                                        { type: 'RICH_TEXT_NODE_TYPE_TEXT', text: ' 「献给破晓的失控」4.1版本速览', orig_text: ' 「献给破晓的失控」4.1版本速览' }
                                    ]
                                }
                            }
                        }
                    }
                }
            }
        })
    )

    assert.ok(html.includes('orig-card'), '应渲染转发原动态卡片')
    assert.ok(html.includes('#崩坏星穹铁道#'), '原动态卡片也应恢复话题')
}

function testBorrowLeadingTopicsAndTrailingEmojiInOrigCard() {
    const html = renderDynamicContent(
        buildDynamicPayload({
            descText: '转发说明',
            descNodes: [],
            orig: {
                id_str: '1180220937382920247',
                pub_ts: 1700000000,
                modules: {
                    module_author: {
                        name: '原作者',
                        face: 'https://i0.hdslb.com/bfs/face/member/noface.jpg',
                        official_verify: { type: -1 }
                    },
                    module_dynamic: {
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
                                        {
                                            type: 'RICH_TEXT_NODE_TYPE_TOPIC',
                                            text: '#话题#',
                                            orig_text: '#话题#',
                                            jump_url: 'https://www.bilibili.com/v/topic/detail/?topic_id=1'
                                        },
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
                    }
                }
            }
        })
    )

    assert.ok(html.includes('orig-card'), '应渲染转发原动态卡片')
    assert.ok(html.includes('#话题#'), '原动态卡片应恢复前置话题')
    assert.ok(html.includes('<img class="emoji"'), '原动态卡片应恢复尾部 emoji')
}

function testBorrowTrailingEmojiInUserCardLatestDynamic() {
    const html = renderUserContent({
        data: {
            uid: 1,
            name: 'tester',
            level: 6,
            face: 'https://i0.hdslb.com/bfs/face/member/noface.jpg',
            relation: { follower: 1, following: 2 },
            likes: 3,
            archive_view: 4,
            dynamic: {
                modules: {
                    module_author: {
                        official_verify: { type: -1 }
                    },
                    module_dynamic: {
                        desc: {
                            text: '祝大家元宵节快乐！\n月圆人圆，好运连连',
                            rich_text_nodes: []
                        },
                        major: {
                            type: 'MAJOR_TYPE_OPUS',
                            opus: {
                                summary: {
                                    text: '祝大家元宵节快乐！\n月圆人圆，好运连连 [汤圆][汤圆]',
                                    rich_text_nodes: [
                                        {
                                            type: 'RICH_TEXT_NODE_TYPE_TEXT',
                                            text: '祝大家元宵节快乐！\n月圆人圆，好运连连 ',
                                            orig_text: '祝大家元宵节快乐！\n月圆人圆，好运连连 '
                                        },
                                        {
                                            type: 'RICH_TEXT_NODE_TYPE_EMOJI',
                                            text: '[汤圆]',
                                            orig_text: '[汤圆]',
                                            emoji: { icon_url: 'https://i0.hdslb.com/bfs/emote/93609633a9d194cf336687eb19c01dca95bde719.png' }
                                        },
                                        {
                                            type: 'RICH_TEXT_NODE_TYPE_EMOJI',
                                            text: '[汤圆]',
                                            orig_text: '[汤圆]',
                                            emoji: { icon_url: 'https://i0.hdslb.com/bfs/emote/93609633a9d194cf336687eb19c01dca95bde719.png' }
                                        }
                                    ]
                                }
                            }
                        }
                    }
                }
            }
        }
    }, true)

    assert.ok(html.includes('最近动态'), '用户卡片应渲染最近动态')
    assert.ok(html.includes('<img class="emoji"'), '用户卡片应借用 summary 的 emoji 节点')
}

function testBackfillMissingAtNodesAndEmojiInUserCardLatestDynamic() {
    const html = renderUserContent({
        data: {
            uid: 1,
            name: 'tester',
            level: 6,
            face: 'https://i0.hdslb.com/bfs/face/member/noface.jpg',
            relation: { follower: 1, following: 2 },
            likes: 3,
            archive_view: 4,
            dynamic: {
                modules: {
                    module_author: {
                        official_verify: { type: -1 }
                    },
                    module_dynamic: {
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
                                    text: '@甲 和 @乙 [汤圆]',
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
                                        },
                                        {
                                            type: 'RICH_TEXT_NODE_TYPE_TEXT',
                                            text: ' ',
                                            orig_text: ' '
                                        },
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
                    }
                }
            }
        }
    }, true)

    const atClassMatches = html.match(/class="at-user rich-link rt-link-text"/g) || []
    assert.ok(html.includes('最近动态'), '用户卡片应渲染最近动态')
    assert.strictEqual(atClassMatches.length, 2, '用户卡片应回填缺失的 @ 节点')
    assert.ok(html.includes('<img class="emoji"'), '用户卡片应恢复尾部 emoji')
}

function run() {
    testPreferSummaryWhenDescHasEmptyAddressLabels()
    testKeepDescWhenDescHasRichLinkNodes()
    testBorrowLeadingSummaryTopicsInDynamicCard()
    testBorrowLeadingTopicsAndTrailingEmojiInDynamicCard()
    testBorrowLeadingSummaryTopicsInOrigCard()
    testBorrowLeadingTopicsAndTrailingEmojiInOrigCard()
    testBorrowTrailingEmojiInUserCardLatestDynamic()
    testBackfillMissingAtNodesAndEmojiInUserCardLatestDynamic()
    console.log('PASS dynamic-richtext-source-selection')
}

run()
