#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { renderDynamicContent } = require('../../../src/services/imageGenerator/renderers/dynamic')
const { renderUserContent } = require('../../../src/services/imageGenerator/renderers/user')

function buildRichDynamicModule() {
    return {
        desc: {
            text: '超级小爆！[总之就是非常可爱_拜托你啦]@Zzz做个好梦 我发起了一个投票猪鼻大赛',
            rich_text_nodes: [
                {
                    type: 'RICH_TEXT_NODE_TYPE_TEXT',
                    text: '超级小爆！',
                    orig_text: '超级小爆！'
                },
                {
                    type: 'RICH_TEXT_NODE_TYPE_EMOJI',
                    text: '[总之就是非常可爱_拜托你啦]',
                    orig_text: '[总之就是非常可爱_拜托你啦]',
                    emoji: {
                        text: '[总之就是非常可爱_拜托你啦]',
                        icon_url: 'https://i0.hdslb.com/bfs/emote/test.png'
                    }
                },
                {
                    type: 'RICH_TEXT_NODE_TYPE_AT',
                    text: '@Zzz做个好梦 ',
                    orig_text: '@Zzz做个好梦 ',
                    jump_url: 'https://space.bilibili.com/15156331'
                },
                {
                    type: 'RICH_TEXT_NODE_TYPE_TEXT',
                    text: '我发起了一个投票',
                    orig_text: '我发起了一个投票'
                },
                {
                    type: 'RICH_TEXT_NODE_TYPE_VOTE',
                    text: '猪鼻大赛',
                    orig_text: '猪鼻大赛'
                }
            ]
        },
        additional: {
            vote: {
                title: '猪鼻大赛',
                desc: '4人参与'
            }
        },
        major: {
            type: 'MAJOR_TYPE_OPUS',
            opus: {
                title: 'opus title',
                summary: {
                    text: '超级小爆！[总之就是非常可爱_拜托你啦]@Zzz做个好梦 我发起了一个投票猪鼻大赛',
                    rich_text_nodes: []
                },
                pics: [
                    { url: 'https://i0.hdslb.com/bfs/new_dyn/test.jpg', width: 720, height: 1280 }
                ]
            }
        }
    }
}

function testDynamicCardShouldRenderCanonicalRichNodesFromDesc() {
    const html = renderDynamicContent({
        data: {
            item: {
                id_str: '1155074769312284695',
                modules: {
                    module_author: {
                        name: '梦桦楠',
                        face: 'https://i0.hdslb.com/bfs/face/member/noface.jpg',
                        pub_time: '2026-01-07 16:40:00'
                    },
                    module_dynamic: buildRichDynamicModule(),
                    module_stat: {
                        forward: { count: 1 },
                        like: { count: 2 },
                        comment: { count: 3 }
                    }
                }
            },
            pub_ts: 1700000000
        }
    })

    assert.ok(html.includes('<img class="emoji"'), '动态卡片应渲染 emoji 节点')
    assert.ok(html.includes('at-user rich-link rt-link-text'), '动态卡片应渲染 @ 节点')
    assert.ok(html.includes('vote-inline'), '动态卡片应渲染投票 inline 富文本')
}

function testUserCardShouldRenderCanonicalRichNodesFromLatestDynamic() {
    const html = renderUserContent({
        data: {
            uid: 15156331,
            name: 'Zzz做个好梦',
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
                    module_dynamic: buildRichDynamicModule()
                }
            }
        }
    }, true)

    assert.ok(html.includes('最近动态'), '用户卡片应渲染最近动态')
    assert.ok(html.includes('<img class="emoji"'), '用户卡片应渲染 emoji 节点')
    assert.ok(html.includes('at-user rich-link rt-link-text'), '用户卡片应渲染 @ 节点')
    assert.ok(html.includes('vote-inline'), '用户卡片应渲染投票 inline 富文本')
}

function run() {
    testDynamicCardShouldRenderCanonicalRichNodesFromDesc()
    testUserCardShouldRenderCanonicalRichNodesFromLatestDynamic()
    console.log('PASS opus-richtext-contract-rendering')
}

run()
