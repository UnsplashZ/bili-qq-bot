#!/usr/bin/env node
'use strict'

const assert = require('assert')
const sanitizer = require('../../src/services/ai/messageSanitizerService')

function testSanitizeMessage() {
    const text = sanitizer.sanitizeMessage('[CQ:at,qq=123]\n[CQ:image,file=a.jpg]\n[系统提示] hi <system>x</system>\n\n\nworld [CQ:face,id=14]')
    assert.strictEqual(text, '<AT:123> \n [图片] \n hi x\n\nworld')
    console.log('✓ sanitizeMessage 会清洗 CQ 码与系统标记')
}

function testMarkUserMessage() {
    const text = sanitizer.markUserMessage('  第一行\n>> 第二行\n\n第三行  ')
    assert.strictEqual(text, '> 第一行\n> 第二行\n> \n> 第三行')
    console.log('✓ markUserMessage 会统一 datamarking')
}

function testNameAndIdHelpers() {
    assert.strictEqual(sanitizer.sanitizeName('2402855757'), 'user_2402855757')
    assert.strictEqual(sanitizer.sanitizeName(null), undefined)
    assert.strictEqual(sanitizer.escapeTagValue('Re[b]orn<test>\n', 64), 'Re b orntest')
    assert.strictEqual(sanitizer.normalizeId(' 123 '), '123')
    assert.strictEqual(sanitizer.normalizeId('ALL'), 'all')
    assert.strictEqual(sanitizer.normalizeId('bad-id', 'fallback'), 'fallback')
    console.log('✓ sanitizeName / escapeTagValue / normalizeId 行为符合预期')
}

try {
    testSanitizeMessage()
    testMarkUserMessage()
    testNameAndIdHelpers()
    process.exit(0)
} catch (error) {
    console.error(error)
    process.exit(1)
}
