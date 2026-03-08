#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { renderUserContent } = require('../../src/services/imageGenerator/renderers/user')

function buildUserPayload() {
    return {
        data: {
            uid: 15156331,
            name: 'Zzz做个好梦',
            level: 6,
            face: 'https://i0.hdslb.com/bfs/face/member/noface.jpg',
            sign: '忘了我吧',
            relation: {
                follower: 573,
                following: 49
            },
            likes: 6830,
            archive_view: 157000,
            dynamic: {
                modules: {
                    module_author: {
                        official_verify: { type: -1 }
                    },
                    module_dynamic: {
                        desc: {
                            text: '可爱捏[星星眼]',
                            rich_text_nodes: [
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
                                        icon_url: 'https://i0.hdslb.com/bfs/emote/63c9d1a31c0da745b61cdb35e0ecb28635675db2.png'
                                    }
                                }
                            ]
                        },
                        major: null
                    }
                }
            }
        }
    }
}

function testUserCardRendersLatestDynamicEmojiNode() {
    const html = renderUserContent(buildUserPayload(), true)

    assert.ok(html.includes('最近动态'), '应渲染最近动态区块')
    assert.ok(html.includes('<img class="emoji"'), 'emoji 节点应渲染为图片')
    assert.ok(!html.includes('>可爱捏[星星眼]</div>'), '不应直接输出未解析的表情文本')
}

function run() {
    testUserCardRendersLatestDynamicEmojiNode()
    console.log('PASS user-card-emoji-rendering')
}

run()
