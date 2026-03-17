#!/usr/bin/env node
'use strict'

const assert = require('assert')
const {
    resolveDynamicSupplementalCards,
    renderDynamicSupplementalCards
} = require('../../src/services/imageGenerator/renderers/components/dynamicSupplementalCards')

function buildModules(additional = {}) {
    return {
        module_dynamic: {
            major: {
                type: 'MAJOR_TYPE_OPUS',
                opus: {
                    pics: [{ url: 'https://example.com/pic-a.jpg' }]
                }
            },
            additional
        }
    }
}

function buildOpusCard() {
    return {
        card_type: 'LINK_CARD_TYPE_UGC',
        title: '独立视频卡',
        cover_url: 'https://example.com/cover.jpg',
        duration_text: '07:01',
        stats: [{ label: '播放', value: '1.8万' }]
    }
}

function testResolveSupplementalCardsKeepsExistingContracts() {
    const modules = buildModules({
        opus_link_cards: [buildOpusCard()],
        vote: {
            title: '投票标题',
            items: [{ desc: 'A', cnt: 1 }]
        },
        common: {
            head_text: '相关游戏',
            title: '原神',
            desc1: '角色扮演'
        }
    })

    const resolved = resolveDynamicSupplementalCards(modules)

    assert.strictEqual(resolved.opusLinkCards.length, 1)
    assert.strictEqual(resolved.vote.desc, '投票标题')
    assert.strictEqual(resolved.commonCard.title, '原神')
    assert.strictEqual(resolved.commonCard.variant, 'compact')
    assert.strictEqual(resolved.commonCard.placement, 'after_media')
}

function testResolveSupplementalCardsKeepsCommonNormalizationMetadata() {
    const resolved = resolveDynamicSupplementalCards(buildModules({
        common: {
            head_text: '相关游戏',
            title: '原神',
            desc1: '角色扮演',
            desc2: '跨越尘世的探索之旅',
            cover: '//example.com/game.jpg',
            jump_url: '//www.biligame.com/detail?id=103496',
            stat: {
                count: 12,
                follower: 34
            },
            badge: {
                bg_color: '#FB7299'
            }
        }
    }))

    assert.strictEqual(resolved.commonCard.cover, 'https://example.com/game.jpg')
    assert.strictEqual(resolved.commonCard.jumpUrl, 'https://www.biligame.com/detail?id=103496')
    assert.strictEqual(resolved.commonCard.badgeText, '相关游戏')
    assert.strictEqual(resolved.commonCard.badgeColor, '#FB7299')
    assert.deepStrictEqual(resolved.commonCard.stats, [
        { label: '内容', value: 12 },
        { label: '关注', value: 34 }
    ])
    assert.strictEqual(resolved.commonCard.variant, 'compact')
    assert.strictEqual(resolved.commonCard.placement, 'after_media')
}

function testRenderSupplementalCardsKeepsOpusVoteCommonOrder() {
    const html = renderDynamicSupplementalCards(buildModules({
        opus_link_cards: [buildOpusCard()],
        vote: {
            title: '投票标题',
            items: [{ desc: 'A', cnt: 1 }]
        },
        common: {
            head_text: '相关游戏',
            title: '原神',
            desc1: '角色扮演'
        }
    }))

    const opusIndex = html.indexOf('opus-link-card')
    const voteIndex = html.indexOf('vote-card')
    const commonIndex = html.indexOf('embedded-resource-card--compact')

    assert.ok(opusIndex >= 0, '应渲染 opus-link-card')
    assert.ok(voteIndex > opusIndex, '投票卡应位于 opus-link-card 之后')
    assert.ok(commonIndex > voteIndex, 'common 小卡应位于投票卡之后')
}

function testRenderSupplementalCardsSkipsMissingContracts() {
    const html = renderDynamicSupplementalCards(buildModules({
        common: {
            head_text: '相关游戏',
            title: '原神'
        }
    }))

    assert.ok(!html.includes('opus-link-card'), '没有 opus_link_cards 时不应渲染独立资源卡')
    assert.ok(!html.includes('vote-card'), '没有 vote 时不应渲染投票卡')
    assert.ok(html.includes('embedded-resource-card--compact'), '有 common 时应渲染 common 小卡')
}

function run() {
    testResolveSupplementalCardsKeepsExistingContracts()
    testResolveSupplementalCardsKeepsCommonNormalizationMetadata()
    testRenderSupplementalCardsKeepsOpusVoteCommonOrder()
    testRenderSupplementalCardsSkipsMissingContracts()
    console.log('PASS dynamic-supplemental-cards')
}

run()
