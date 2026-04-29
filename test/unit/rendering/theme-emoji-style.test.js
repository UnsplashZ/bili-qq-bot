#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { generateCSS } = require('../../../src/services/imageGenerator/core/theme')

function testEmojiUsesRelativeInlineMetrics() {
    const css = generateCSS({
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

    assert.ok(css.includes('width: 1.15em;'), 'emoji 宽度应跟随当前文字字号')
    assert.ok(css.includes('height: 1.15em;'), 'emoji 高度应跟随当前文字字号')
    assert.ok(css.includes('vertical-align: -0.18em;'), 'emoji 应使用更稳定的基线偏移')
    assert.ok(css.includes('margin: 0 0.08em;'), 'emoji 左右间距应跟随字号缩放')
}

function testRichTextIconsUseTighterRelativeBaselineMetrics() {
    const css = generateCSS({
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

    assert.ok(css.includes('width: 1em;'), '富文本图标宽度应跟随当前字号')
    assert.ok(css.includes('height: 1em;'), '富文本图标高度应跟随当前字号')
    assert.ok(css.includes('margin-right: 0.12em;'), '富文本图标右间距应跟随字号缩放')
    assert.ok(css.includes('vertical-align: -0.12em;'), '富文本图标应统一使用更贴近正文的基线偏移')
}

function run() {
    testEmojiUsesRelativeInlineMetrics()
    testRichTextIconsUseTighterRelativeBaselineMetrics()
    console.log('PASS theme-emoji-style')
}

run()
