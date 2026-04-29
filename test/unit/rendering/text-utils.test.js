#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { normalizePlainText } = require('../../../src/services/imageGenerator/renderers/components/textUtils')

function testNormalizePlainTextRemovesHiddenCharsAndCollapsesWhitespace() {
    const normalized = normalizePlainText('  第一行\u200b\r\n\r\n\r\n第二行 \t\n\n ')
    assert.strictEqual(normalized, '第一行\n\n第二行')
}

function testNormalizePlainTextReturnsEmptyForFalsyInput() {
    assert.strictEqual(normalizePlainText(''), '')
    assert.strictEqual(normalizePlainText(null), '')
    assert.strictEqual(normalizePlainText(undefined), '')
}

function run() {
    testNormalizePlainTextRemovesHiddenCharsAndCollapsesWhitespace()
    testNormalizePlainTextReturnsEmptyForFalsyInput()
    console.log('PASS text-utils')
}

run()
