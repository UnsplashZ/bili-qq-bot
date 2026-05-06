#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { generateCSS } = require('../../../src/services/imageGenerator/core/theme')

function buildCss() {
    return generateCSS({
        colorText: '#111111',
        colorSubtext: '#666666',
        colorBorder: '#dddddd',
        colorShadow: 'rgba(0,0,0,0.1)',
        colorCardBg: '#ffffff',
        colorSoftBg: '#f5f5f5',
        colorBgStart: '#ffffff',
        colorBgMid: '#f8f8f8',
        colorBgEnd: '#f2f2f2',
        colorAccent: '#00a1d6',
        colorSecondary: '#fb7299',
        gradientMix: '50%',
        themeClass: 'light'
    }, { width: 1200, height: 1200 })
}

function extractRule(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = css.match(new RegExp(`(^|\\n)\\s*${escaped}\\s*\\{([\\s\\S]*?)\\}`, 'm'))
    assert.ok(match, `missing CSS rule for ${selector}`)
    return match[2]
}

function testMetaAndStatsShareSameSubtextColor() {
    const css = buildCss()
    const metaRule = extractRule(css, '.opus-link-card-meta')
    const statsRule = extractRule(css, '.opus-link-card-stats')
    const statRule = extractRule(css, '.opus-link-card-stat')

    assert.ok(metaRule.includes('color: var(--color-subtext);'), 'meta 行应与统计行共用 subtext 色值')
    assert.ok(statsRule.includes('color: var(--color-subtext);'), '统计行应使用 subtext 色值')
    assert.ok(statRule.includes('color: inherit;'), '单个统计文本应继承容器色值')
}

function testOpusLinkCardHeightEnvelope() {
    const css = buildCss()
    const cardRule = extractRule(css, '.opus-link-card')
    const coverRule = extractRule(css, '.opus-link-card-cover')
    const bodyRule = extractRule(css, '.opus-link-card-body')
    const coverImgRule = extractRule(css, '.opus-link-card-cover-img')

    assert.ok(cardRule.includes('height: 140px;'), '引用链接卡默认高度应为 140px')
    assert.ok(cardRule.includes('min-height: 120px;'), '引用链接卡最小高度应为 120px')
    assert.ok(cardRule.includes('max-height: 160px;'), '引用链接卡最大高度应为 160px')
    assert.ok(cardRule.includes('gap: 14px;'), '引用链接卡图片与文本之间应保留稳定间距')
    assert.ok(cardRule.includes('background: var(--color-soft-bg);'), '引用链接卡应由根容器提供统一底色')
    assert.ok(cardRule.includes('border: 1px solid var(--color-border);'), '引用链接卡外边框应回到中性色边框')
    assert.ok(coverRule.includes('flex: 0 0 auto;'), '引用链接卡封面容器宽度应由图片内容决定')
    assert.ok(coverRule.includes('align-self: stretch;'), '引用链接卡封面容器应贴合卡片高度')
    assert.ok(coverRule.includes('background: transparent;'), '引用链接卡图片圆角外侧不应再铺异色底')
    assert.ok(!coverRule.includes('width:'), '引用链接卡封面容器不应再写死固定宽度')
    assert.ok(!coverRule.includes('min-width:'), '引用链接卡封面容器不应保留固定最小宽度')
    assert.ok(!coverRule.includes('max-width:'), '引用链接卡封面容器不应保留固定最大宽度')
    assert.ok(bodyRule.includes('background: transparent;'), '引用链接卡文本区背景应交给根容器统一提供')
    assert.ok(bodyRule.includes('padding: 12px 14px 12px 0;'), '引用链接卡文本区应由自身内边距控制与图片的间距')
    assert.ok(coverImgRule.includes('display: block;'), '引用链接卡图片应作为独立块级元素贴左显示')
    assert.ok(coverImgRule.includes('width: auto;'), '引用链接卡图片宽度应按原始比例自适应')
    assert.ok(coverImgRule.includes('height: 100%;'), '引用链接卡图片高度应填满卡片容器')
    assert.ok(coverImgRule.includes('aspect-ratio: auto;'), '引用链接卡图片应显式使用原图比例')
    assert.ok(coverImgRule.includes('border-radius: 12px;'), '引用链接卡图片应补显式圆角')
    assert.ok(coverImgRule.includes('background: transparent;'), '引用链接卡图片圆角外露部分应透出卡片底色')
    assert.ok(!coverImgRule.includes('object-fit:'), '引用链接卡图片不应依赖 object-fit 进行裁切')
    assert.ok(!coverImgRule.includes('min-width:'), '引用链接卡图片不应保留额外最小宽度限制')
    assert.ok(!coverImgRule.includes('max-width:'), '引用链接卡图片不应额外限制最大宽度')
}

function testOpusLinkCardTextScale() {
    const css = buildCss()
    const titleRule = extractRule(css, '.opus-link-card-title')
    const metaRule = extractRule(css, '.opus-link-card-meta')
    const statRule = extractRule(css, '.opus-link-card-stat')
    const descRule = extractRule(css, '.opus-link-card-desc')

    assert.ok(titleRule.includes('font-size: 19px;'), '引用链接卡标题字号应提升到 19px')
    assert.ok(metaRule.includes('font-size: 14px;'), '引用链接卡 meta 字号应提升到 14px')
    assert.ok(statRule.includes('font-size: 14px;'), '引用链接卡统计字号应提升到 14px')
    assert.ok(descRule.includes('font-size: 14px;'), '引用链接卡描述字号应提升到 14px')
}

function run() {
    testMetaAndStatsShareSameSubtextColor()
    testOpusLinkCardHeightEnvelope()
    testOpusLinkCardTextScale()
    console.log('PASS opus-link-card-style')
}

run()
