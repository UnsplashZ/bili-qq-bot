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
    const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`))
    assert.ok(match, `missing CSS rule for ${selector}`)
    return match[1]
}

function extractPx(rule, property) {
    const match = rule.match(new RegExp(`${property}:\\s*(\\d+)px;`))
    assert.ok(match, `missing ${property} px value`)
    return Number(match[1])
}

function testDynamicFramedAvatarKeepsFrameOutsideFace() {
    const css = buildCss()
    const wrapperRule = extractRule(css, '.avatar-wrapper--dynamic.avatar-wrapper--with-frame')
    const avatarRule = extractRule(css, '.avatar-wrapper--dynamic.avatar-wrapper--with-frame .avatar')
    const frameRule = extractRule(css, '.avatar-wrapper--dynamic.avatar-wrapper--with-frame .avatar-frame')

    const wrapperWidth = extractPx(wrapperRule, 'width')
    const avatarWidth = extractPx(avatarRule, 'width')
    const frameWidth = extractPx(frameRule, 'width')

    assert.ok(avatarWidth > 72, '带框动态头像本体应略大，避免头像与框内圈留空')
    assert.ok(frameWidth >= 160, '带透明边界的头像框素材盒子应足够大')
    assert.ok(wrapperWidth >= 134, '头像容器应为放大的头像框预留空间')
    assert.ok(frameWidth > wrapperWidth, '头像框可适度溢出容器以包住头像外缘')
}

function run() {
    testDynamicFramedAvatarKeepsFrameOutsideFace()
    console.log('PASS avatar-frame-style')
}

run()
