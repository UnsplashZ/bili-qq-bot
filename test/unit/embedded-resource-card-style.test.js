#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { generateCSS } = require('../../src/services/imageGenerator/core/theme')

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

function testCompactEmbeddedResourceCardHeightEnvelope() {
    const css = buildCss()
    const compactRule = extractRule(css, '.embedded-resource-card--compact')
    const coverRule = extractRule(css, '.embedded-resource-card--compact .embedded-resource-cover')
    const bodyRule = extractRule(css, '.embedded-resource-card--compact .embedded-resource-body')

    assert.ok(compactRule.includes('height: 140px;'), 'common 小卡默认高度应为 140px')
    assert.ok(compactRule.includes('min-height: 120px;'), 'common 小卡最小高度应为 120px')
    assert.ok(compactRule.includes('max-height: 160px;'), 'common 小卡最大高度应为 160px')
    assert.ok(compactRule.includes('gap: 14px;'), 'common 小卡图片与文本之间应保留稳定间距')
    assert.ok(compactRule.includes('background: var(--color-soft-bg);'), 'common 小卡应由根容器提供统一底色')
    assert.ok(coverRule.includes('flex: 0 0 auto;'), 'common 小卡封面容器宽度应由图片内容决定')
    assert.ok(coverRule.includes('width: auto;'), 'common 小卡封面容器应显式取消基础样式里的整行宽度')
    assert.ok(coverRule.includes('align-self: stretch;'), 'common 小卡封面容器应贴合卡片高度')
    assert.ok(coverRule.includes('min-height: 120px;'), 'common 小卡封面容器应与卡片使用同一最小高度')
    assert.ok(coverRule.includes('max-height: 160px;'), 'common 小卡封面容器应与卡片使用同一最大高度')
    assert.ok(coverRule.includes('background: transparent;'), 'common 小卡图片外层不应再铺异色底')
    assert.ok(!coverRule.includes('min-width:'), 'common 小卡封面容器不应保留固定最小宽度')
    assert.ok(!coverRule.includes('max-width:'), 'common 小卡封面容器不应保留固定最大宽度')
    assert.ok(bodyRule.includes('background: transparent;'), 'common 小卡文本区背景应交给根容器统一提供')
    assert.ok(bodyRule.includes('padding: 12px 16px 12px 0;'), 'common 小卡文本区应由自身内边距控制与图片的间距')
}

function testCompactEmbeddedResourceCardImagePreservesAspectRatio() {
    const css = buildCss()
    const coverImgRule = extractRule(css, '.embedded-resource-card--compact .embedded-resource-cover-img')

    assert.ok(coverImgRule.includes('display: block;'), 'common 小卡图片应作为独立块级元素贴左显示')
    assert.ok(coverImgRule.includes('width: auto;'), 'common 小卡图片应按原始比例计算宽度')
    assert.ok(coverImgRule.includes('height: 100%;'), 'common 小卡图片应拉伸到封面容器高度')
    assert.ok(coverImgRule.includes('aspect-ratio: auto;'), 'common 小卡图片应显式使用原图比例而不是继承 16:9')
    assert.ok(coverImgRule.includes('border-radius: 12px;'), 'common 小卡图片应补显式圆角')
    assert.ok(coverImgRule.includes('background: transparent;'), 'common 小卡图片圆角外露部分应透出卡片底色')
    assert.ok(!coverImgRule.includes('object-fit:'), 'common 小卡图片不应依赖 object-fit 进行裁切')
    assert.ok(!coverImgRule.includes('min-width:'), 'common 小卡图片不应保留额外最小宽度限制')
    assert.ok(!coverImgRule.includes('max-width:'), 'common 小卡图片不应额外限制最大宽度')
}

function testCompactEmbeddedResourceCardTextScale() {
    const css = buildCss()
    const badgeRule = extractRule(css, '.embedded-resource-card--compact .embedded-resource-badge--inline')
    const subtitleRule = extractRule(css, '.embedded-resource-card--compact .embedded-resource-subtitle')
    const titleRule = extractRule(css, '.embedded-resource-card--compact .embedded-resource-title')
    const statRule = extractRule(css, '.embedded-resource-card--compact .embedded-resource-stat')
    const descRule = extractRule(css, '.embedded-resource-card--compact .embedded-resource-desc')

    assert.ok(badgeRule.includes('font-size: 16px;'), 'common 小卡 badge 字号应调整到 16px')
    assert.ok(subtitleRule.includes('font-size: 16px;'), 'common 小卡副标题字号应调整到 16px')
    assert.ok(titleRule.includes('font-size: 24px;'), 'common 小卡标题字号应调整到 24px')
    assert.ok(statRule.includes('font-size: 16px;'), 'common 小卡统计字号应调整到 16px')
    assert.ok(descRule.includes('font-size: 16px;'), 'common 小卡描述字号应调整到 16px')
}

function run() {
    testCompactEmbeddedResourceCardHeightEnvelope()
    testCompactEmbeddedResourceCardImagePreservesAspectRatio()
    testCompactEmbeddedResourceCardTextScale()
    console.log('PASS embedded-resource-card-style')
}

run()
