#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { renderDynamicContent } = require('../../src/services/imageGenerator/renderers/dynamic')

function buildForwardPayload(moduleDynamic) {
    return {
        data: {
            item: {
                id_str: '782595959854989317',
                type: 'DYNAMIC_TYPE_FORWARD',
                modules: {
                    module_author: {
                        name: '转发者',
                        face: 'https://i0.hdslb.com/bfs/face/member/noface.jpg',
                        pub_time: '2026-03-16 12:00:00'
                    },
                    module_dynamic: {
                        desc: {
                            text: '转发一下',
                            rich_text_nodes: []
                        }
                    },
                    module_stat: {
                        forward: { count: 1 },
                        comment: { count: 2 },
                        like: { count: 3 }
                    }
                },
                orig: {
                    type: 'DYNAMIC_TYPE_MEDIALIST',
                    modules: {
                        module_author: {
                            name: '原作者',
                            face: 'https://i0.hdslb.com/bfs/face/member/noface.jpg',
                            pub_time: '2026-03-15 12:00:00'
                        },
                        module_dynamic: moduleDynamic
                    }
                }
            },
            pub_ts: 1700000000
        }
    }
}

function buildDynamicPayload(moduleDynamic) {
    return {
        data: {
            item: {
                id_str: '1175785954156216336',
                type: 'DYNAMIC_TYPE_DRAW',
                modules: {
                    module_author: {
                        name: '原神',
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

function testForwardMedialistRendersEmbeddedCard() {
    const html = renderDynamicContent(buildForwardPayload({
        major: {
            type: 'MAJOR_TYPE_MEDIALIST',
            medialist: {
                title: '音游比赛',
                sub_title: '9个内容',
                cover: 'https://example.com/cover.jpg',
                jump_url: '//www.bilibili.com/medialist/detail/ml2260130607',
                badge: {
                    text: '收藏',
                    bg_color: '#FB7299'
                }
            }
        }
    }))

    assert.ok(html.includes('embedded-resource-card'), '应渲染嵌入资源卡')
    assert.ok(html.includes('音游比赛'))
    assert.ok(html.includes('9个内容'))
    assert.ok(html.includes('收藏'))
    assert.ok(!html.includes('<div class="orig-content">\n                \n                \n                \n                \n            </div>'))
}

function testForwardUnknownResourceFallsBackToGenericCard() {
    const html = renderDynamicContent(buildForwardPayload({
        major: {
            type: 'MAJOR_TYPE_CUSTOM',
            mystery: {
                title: '未知资源标题',
                sub_title: '可降级展示',
                cover: 'https://example.com/custom.jpg',
                desc: '未知资源描述'
            }
        }
    }))

    assert.ok(html.includes('embedded-resource-card'), '未知资源应降级为最小嵌入卡')
    assert.ok(html.includes('未知资源标题'))
    assert.ok(html.includes('可降级展示'))
}

function testForwardOrigCommonCardIsRemoved() {
    const html = renderDynamicContent(buildForwardPayload({
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
            type: 'ADDITIONAL_TYPE_COMMON',
            common: {
                head_text: '相关游戏',
                title: '原神',
                desc1: '角色扮演/二次元/冒险',
                desc2: '跨越尘世的探索之旅',
                cover: 'https://example.com/game.jpg'
            }
        }
    }))

    assert.ok(!html.includes('embedded-resource-card--compact'), '子动态 orig-card 中不应再渲染 common 小卡')
    assert.ok(!html.includes('相关游戏'))
}

function testMainDynamicCommonCardRendersAfterMediaAsCompactStrip() {
    const html = renderDynamicContent(buildDynamicPayload({
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
            type: 'ADDITIONAL_TYPE_COMMON',
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
    const commonIndex = html.indexOf('embedded-resource-card--compact')
    const actionIndex = html.indexOf('action-bar')
    const compactMarkup = html.slice(commonIndex, actionIndex)
    const coverIndex = compactMarkup.indexOf('embedded-resource-cover')
    const bodyIndex = compactMarkup.indexOf('embedded-resource-body')
    const coverSection = coverIndex >= 0 && bodyIndex > coverIndex
        ? compactMarkup.slice(coverIndex, bodyIndex)
        : ''
    const inlineBadgeIndex = compactMarkup.indexOf('embedded-resource-badge embedded-resource-badge--inline')
    const titleIndex = compactMarkup.indexOf('embedded-resource-title')
    const subtitleIndex = compactMarkup.indexOf('embedded-resource-subtitle')

    assert.ok(commonIndex > mediaIndex, '主动态 common 小卡应位于图文媒体之后')
    assert.ok(commonIndex < actionIndex, '主动态 common 小卡应位于数据栏之前')
    assert.ok(html.includes('相关游戏'))
    assert.ok(html.includes('原神'))
    assert.ok(inlineBadgeIndex >= 0, 'compact common 小卡应在文字区渲染 inline chip')
    assert.ok(!coverSection.includes('embedded-resource-badge'), 'compact common 小卡不应再在封面上叠加 badge')
    assert.ok(titleIndex >= 0 && subtitleIndex > titleIndex, 'compact common 小卡标题应先于副标题渲染')
}

function testMainDynamicVoteCardRendersBelowMediaAndAboveCommon() {
    const html = renderDynamicContent(buildDynamicPayload({
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
            type: 'ADDITIONAL_TYPE_COMMON',
            common: {
                head_text: '相关游戏',
                title: '原神',
                desc1: '角色扮演/二次元/冒险',
                desc2: '跨越尘世的探索之旅',
                cover: 'https://example.com/game.jpg'
            },
            vote: {
                desc: '你更喜欢哪一位？',
                join_num: 8,
                choice_cnt: 1,
                items: [
                    { desc: '悠妮里奈', cnt: 6 },
                    { desc: '若樱', cnt: 2 }
                ]
            }
        }
    }))

    const mediaIndex = html.indexOf('images-grid cols-2')
    const voteIndex = html.indexOf('vote-card')
    const commonIndex = html.indexOf('embedded-resource-card--compact')
    const actionIndex = html.indexOf('action-bar')

    assert.ok(voteIndex > mediaIndex, '主动态投票卡应位于图文媒体之后')
    assert.ok(commonIndex > voteIndex, '主动态 common 小卡应位于投票卡之后')
    assert.ok(commonIndex < actionIndex, '主动态 common 小卡应位于数据栏之前')
}

function testForwardArchiveRegressionStillRendersInlineVideo() {
    const html = renderDynamicContent(buildForwardPayload({
        major: {
            archive: {
                cover: 'https://example.com/video.jpg',
                title: '视频标题',
                duration_text: '12:34',
                stat: {
                    play: 1234,
                    danmaku: 56
                }
            }
        }
    }))

    assert.ok(html.includes('video-card-inline'), '转发视频卡应保持原有 inline 视频卡渲染')
    assert.ok(html.includes('视频标题'))
}

function run() {
    testForwardMedialistRendersEmbeddedCard()
    testForwardUnknownResourceFallsBackToGenericCard()
    testForwardOrigCommonCardIsRemoved()
    testMainDynamicCommonCardRendersAfterMediaAsCompactStrip()
    testMainDynamicVoteCardRendersBelowMediaAndAboveCommon()
    testForwardArchiveRegressionStillRendersInlineVideo()
    console.log('PASS dynamic-forward-resource-rendering')
}

run()
