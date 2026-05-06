#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')

const { normalizeDecision } = require(path.join(__dirname, '../../../src/agent/cognition/decisionSchema'))

function run() {
    const legacyReply = normalizeDecision({
        action: 'short_reply',
        confidence: 0.8,
        reason: 'legacy',
        topic: 'test',
        replyStyle: 'friendly_brief',
        replyDraft: '收到',
        memoryHints: [],
        toolIntent: null
    })
    assert.strictEqual(legacyReply.action, 'reply')
    assert.strictEqual(legacyReply.participation.action, 'reply')
    assert.strictEqual(legacyReply.replyDraft, '收到')

    const legacyTool = normalizeDecision({
        action: 'tool_plan',
        confidence: 0.9,
        reason: 'legacy tool',
        topic: 'tool',
        replyStyle: 'none',
        replyDraft: '不应保留',
        memoryHints: [],
        toolIntent: { name: 'browser.read_url', arguments: { url: 'https://example.com' } }
    })
    assert.strictEqual(legacyTool.action, 'act')
    assert.strictEqual(legacyTool.replyDraft, '')
    assert.strictEqual(legacyTool.toolIntent.name, 'browser.read_url')

    const newReact = normalizeDecision({
        action: 'react',
        confidence: 0.7,
        reason: '可以轻插一句',
        topic: 'chat',
        replyStyle: 'casual',
        replyDraft: '这个角度挺有意思。',
        participation: {
            action: 'react',
            targetMessageId: 'm1',
            relation: 'ambient',
            participationLevel: 0.7,
            styleHints: ['短句']
        },
        memoryHints: [],
        toolIntent: null
    })
    assert.strictEqual(newReact.action, 'react')
    assert.strictEqual(newReact.targetMessageId, 'm1')
    assert.deepStrictEqual(newReact.styleHints, ['短句'])

    const listen = normalizeDecision({ action: 'listen', confidence: 0.2, reason: '无关', replyDraft: '不应发送' })
    assert.strictEqual(listen.action, 'listen')
    assert.strictEqual(listen.replyDraft, '')

    console.log('✓ Agent decision schema 新动作归一化正常')
}

try {
    run()
    process.exit(0)
} catch (error) {
    console.error(error)
    process.exit(1)
}
