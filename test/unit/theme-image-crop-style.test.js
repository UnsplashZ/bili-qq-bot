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
    const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`))
    assert.ok(match, `missing CSS rule for ${selector}`)
    return match[1]
}

function testGridImagesCropFromTop() {
    const css = buildCss()
    const rule = extractRule(css, '.images-grid .image-item img')

    assert.ok(rule.includes('object-fit: cover;'), '网格缩略图应保持 cover 裁切')
    assert.ok(rule.includes('object-position: top;'), '网格缩略图应从顶部开始裁切')
}

function testUserDynamicImagesCropFromTop() {
    const css = buildCss()
    const rule = extractRule(css, '.user-dynamic-image')

    assert.ok(rule.includes('object-fit: cover;'), '主页最近动态缩略图应保持 cover 裁切')
    assert.ok(rule.includes('object-position: top;'), '主页最近动态缩略图应从顶部开始裁切')
}

function testImageTypeBadgeGetsSlightlyLarger() {
    const css = buildCss()
    const rule = extractRule(css, '.image-type-badge')

    assert.ok(rule.includes('min-width: 50px;'), '图片类型角标最小宽度应再略微增大')
    assert.ok(rule.includes('height: 31px;'), '图片类型角标高度应再略微增大')
    assert.ok(rule.includes('padding: 0 13px;'), '图片类型角标横向留白应再略微增大')
    assert.ok(rule.includes('font-size: 21px;'), '图片类型角标字号应再略微增大')
}

function run() {
    testGridImagesCropFromTop()
    testUserDynamicImagesCropFromTop()
    testImageTypeBadgeGetsSlightlyLarger()
    console.log('PASS theme-image-crop-style')
}

run()
