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

function testMetaAndStatsShareSameSubtextColor() {
    const css = buildCss()
    const metaRule = extractRule(css, '.opus-link-card-meta')
    const statsRule = extractRule(css, '.opus-link-card-stats')
    const statRule = extractRule(css, '.opus-link-card-stat')

    assert.ok(metaRule.includes('color: var(--color-subtext);'), 'meta 行应与统计行共用 subtext 色值')
    assert.ok(statsRule.includes('color: var(--color-subtext);'), '统计行应使用 subtext 色值')
    assert.ok(statRule.includes('color: inherit;'), '单个统计文本应继承容器色值')
}

function run() {
    testMetaAndStatsShareSameSubtextColor()
    console.log('PASS opus-link-card-style')
}

run()
