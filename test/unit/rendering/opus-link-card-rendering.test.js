#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { renderDynamicContent } = require('../../../src/services/imageGenerator/renderers/dynamic')
const { renderUserContent } = require('../../../src/services/imageGenerator/renderers/user')

function buildDynamicPayload(moduleDynamic) {
    return {
        data: {
            item: {
                id_str: '1179264368735420423',
                type: 'DYNAMIC_TYPE_DRAW',
                modules: {
                    module_author: {
                        name: 'tester',
                        face: 'https://i0.hdslb.com/bfs/face/member/noface.jpg',
                        pub_time: '2026-03-16 12:00:00'
                    },
                    module_dynamic: moduleDynamic,
                    module_stat: {
                        forward: { count: 7 },
                        comment: { count: 8 },
                        like: { count: 9 }
                    }
                }
            },
            pub_ts: 1700000000
        }
    }
}

function buildOpusLinkCard() {
    return {
        card_type: 'LINK_CARD_TYPE_UGC',
        title: '笑了就会被小南梁坐脸',
        jump_url: '//www.bilibili.com/video/BV11dcUzAEc2/',
        cover_url: 'https://example.com/video-cover.jpg',
        cover_width: 1280,
        cover_height: 720,
        badge_text: '视频',
        subtitle: '国外难绷搞笑视频集锦',
        desc: '高能片段精选',
        duration_text: '07:01',
        stats: [
            { label: '播放', value: '1.8万' },
            { label: '弹幕', value: '88' }
        ]
    }
}

function testDynamicOpusLinkCardRendersBetweenMediaAndVote() {
    const html = renderDynamicContent(buildDynamicPayload({
        desc: {
            text: '正文',
            rich_text_nodes: []
        },
        major: {
            type: 'MAJOR_TYPE_OPUS',
            opus: {
                pics: [
                    { url: 'https://example.com/pic-a.jpg' },
                    { url: 'https://example.com/pic-b.jpg' }
                ]
            }
        },
        additional: {
            type: 'ADDITIONAL_TYPE_UGC',
            opus_link_cards: [buildOpusLinkCard()],
            vote: {
                desc: '你更喜欢哪一位？',
                join_num: 8,
                choice_cnt: 1,
                items: [
                    { desc: '悠妮里奈', cnt: 6 },
                    { desc: '若樱', cnt: 2 }
                ]
            },
            common: {
                head_text: '相关游戏',
                title: '原神',
                desc1: '角色扮演/二次元/冒险',
                desc2: '跨越尘世的探索之旅',
                cover: 'https://example.com/game.jpg'
            }
        }
    }))

    const mediaIndex = html.indexOf('images-grid cols-2')
    const opusLinkIndex = html.indexOf('opus-link-card')
    const voteIndex = html.indexOf('vote-card')
    const commonIndex = html.indexOf('embedded-resource-card--compact')

    assert.ok(opusLinkIndex > mediaIndex, '独立资源卡应位于主媒体之后')
    assert.ok(voteIndex > opusLinkIndex, '现有投票卡应位于独立资源卡之后')
    assert.ok(commonIndex > voteIndex, '现有 common 小卡应位于投票卡之后')
    assert.ok(html.includes('笑了就会被小南梁坐脸'))
    assert.ok(html.includes('国外难绷搞笑视频集锦'))
    assert.ok(html.includes('时长 07:01'))
    assert.ok(html.includes('播放 1.8万'))
    assert.ok(html.includes('弹幕 88'))
    assert.ok(!html.includes('>视频<'))
}

function testUserCardCanRenderOpusLinkCard() {
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
                            text: '正文',
                            rich_text_nodes: []
                        },
                        major: {
                            type: 'MAJOR_TYPE_OPUS',
                            opus: {
                                pics: [
                                    { url: 'https://example.com/pic-a.jpg' }
                                ]
                            }
                        },
                        additional: {
                            opus_link_cards: [buildOpusLinkCard()]
                        }
                    }
                }
            }
        }
    }, true)

    const mediaIndex = html.indexOf('user-dynamic-images')
    const opusLinkIndex = html.indexOf('opus-link-card')

    assert.ok(opusLinkIndex > mediaIndex, '用户卡最近动态中的独立资源卡应位于媒体之后')
    assert.ok(html.includes('笑了就会被小南梁坐脸'))
    assert.ok(html.includes('时长 07:01'))
}

function testUserCardCanRenderVoteAndCommonWithoutOpusLinkCard() {
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
                            text: '正文',
                            rich_text_nodes: []
                        },
                        major: {
                            type: 'MAJOR_TYPE_OPUS',
                            opus: {
                                pics: [
                                    { url: 'https://example.com/pic-a.jpg' }
                                ]
                            }
                        },
                        additional: {
                            vote: {
                                desc: '你更喜欢哪一位？',
                                join_num: 8,
                                choice_cnt: 1,
                                items: [
                                    { desc: '悠妮里奈', cnt: 6 },
                                    { desc: '若樱', cnt: 2 }
                                ]
                            },
                            common: {
                                head_text: '相关游戏',
                                title: '原神',
                                desc1: '角色扮演/二次元/冒险',
                                desc2: '跨越尘世的探索之旅',
                                cover: 'https://example.com/game.jpg'
                            }
                        }
                    }
                }
            }
        }
    }, true)

    const mediaIndex = html.indexOf('user-dynamic-images')
    const voteIndex = html.indexOf('vote-card')
    const commonIndex = html.indexOf('embedded-resource-card--compact')

    assert.ok(voteIndex > mediaIndex, '用户卡投票卡应位于媒体之后')
    assert.ok(commonIndex > voteIndex, '用户卡 common 小卡应位于投票卡之后')
    assert.ok(!html.includes('opus-link-card'), '去重后的 common 不应再以 opus-link-card 渲染')
    assert.ok(html.includes('相关游戏'))
}

function testUserCardEmbeddedResourceRendersBeforeVoteAndCommon() {
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
                            text: '正文',
                            rich_text_nodes: []
                        },
                        major: {
                            type: 'MAJOR_TYPE_MEDIALIST',
                            medialist: {
                                title: '结构收藏夹',
                                sub_title: '9个内容',
                                cover: 'https://example.com/list-cover.jpg',
                                jump_url: '//www.bilibili.com/medialist/detail/ml123456'
                            }
                        },
                        additional: {
                            vote: {
                                desc: '你更喜欢哪一位？',
                                join_num: 8,
                                choice_cnt: 1,
                                items: [
                                    { desc: '悠妮里奈', cnt: 6 },
                                    { desc: '若樱', cnt: 2 }
                                ]
                            },
                            common: {
                                head_text: '相关游戏',
                                title: '原神',
                                desc1: '角色扮演/二次元/冒险',
                                desc2: '跨越尘世的探索之旅',
                                cover: 'https://example.com/game.jpg'
                            }
                        }
                    }
                }
            }
        }
    }, true)

    const resourceIndex = html.indexOf('<div class="embedded-resource-card"')
    const voteIndex = html.indexOf('vote-card')
    const commonIndex = html.indexOf('embedded-resource-card--compact')

    assert.ok(resourceIndex >= 0, '用户卡最近动态应渲染引用资源卡')
    assert.ok(resourceIndex < voteIndex, '用户卡引用资源卡应位于投票卡之前')
    assert.ok(voteIndex < commonIndex, '用户卡投票卡应位于 common 小卡之前')
    assert.ok(html.includes('结构收藏夹'))
}

function run() {
    testDynamicOpusLinkCardRendersBetweenMediaAndVote()
    testUserCardCanRenderOpusLinkCard()
    testUserCardCanRenderVoteAndCommonWithoutOpusLinkCard()
    testUserCardEmbeddedResourceRendersBeforeVoteAndCommon()
    console.log('PASS opus-link-card-rendering')
}

run()
