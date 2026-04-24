#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')

const { extractMemoryHints, mergeMemoryHints } = require(path.join(__dirname, '../../src/agent/memory/memoryHintExtractor'))

function makeMessage(text) {
    return {
        rawText: text,
        normalizedText: text
    }
}

function run() {
    let hints = extractMemoryHints({ agentMessage: makeMessage('[CQ:at,qq=123] uid 2402855757是楠哥') })
    assert.strictEqual(hints.length, 1)
    assert.strictEqual(hints[0].scope, 'group')
    assert.strictEqual(hints[0].type, 'relation')
    assert.strictEqual(hints[0].content, 'uid 2402855757 是 楠哥')

    hints = extractMemoryHints({ agentMessage: makeMessage('楠哥是蔚蓝档案高手') })
    assert.strictEqual(hints.length, 1)
    assert.strictEqual(hints[0].type, 'fact')
    assert.strictEqual(hints[0].content, '楠哥是蔚蓝档案高手')

    hints = extractMemoryHints({ agentMessage: makeMessage('我喜欢少前2') })
    assert.strictEqual(hints.length, 1)
    assert.strictEqual(hints[0].scope, 'user')
    assert.strictEqual(hints[0].type, 'preference')
    assert.strictEqual(hints[0].content, '用户喜欢少前2')

    hints = extractMemoryHints({ agentMessage: makeMessage('楠哥可能是蔚蓝档案高手') })
    assert.strictEqual(hints.length, 0)

    const merged = mergeMemoryHints(
        [{ scope: 'group', type: 'fact', content: '楠哥是蔚蓝档案高手', confidence: 0.6 }],
        [{ scope: 'group', type: 'fact', content: '楠哥是蔚蓝档案高手', confidence: 0.68 }]
    )
    assert.strictEqual(merged.length, 1)

    console.log('✓ Agent 记忆提取规则正常')
}

try {
    run()
} catch (error) {
    console.error(error)
    process.exit(1)
}
