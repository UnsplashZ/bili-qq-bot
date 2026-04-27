#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')

const replyEffectStore = require(path.join(__dirname, '../../src/agent/feedback/replyEffectStore'))
const { trackSentReply, observeReplyEffect } = require(path.join(__dirname, '../../src/agent/feedback/replyEffectTracker'))

async function run() {
    replyEffectStore.resetForTest()
    const pending = trackSentReply({
        agentConfig: { participation: { replyEffectTrackingEnabled: true } },
        groupId: '1000',
        userId: '42',
        messageId: 'm1',
        topicId: 'topic1',
        policyDecision: {
            accepted: true,
            wouldSend: true,
            finalAction: 'react',
            replyDraft: '这个说法有点意思。'
        },
        replyerResult: { expressionHints: [{ id: 'expr_1' }] },
        timestamp: 1000
    })
    assert.ok(pending)

    const effect = await observeReplyEffect({
        agentConfig: { participation: { replyEffectTrackingEnabled: true } },
        agentMessage: {
            id: 'm2',
            groupId: '1000',
            userId: '42',
            selfId: '999',
            normalizedText: '不是这个意思，你没懂',
            rawText: '不是这个意思，你没懂'
        },
        memoryObservation: { topicSnapshot: { topicId: 'topic1' } }
    })
    assert.strictEqual(effect.status, 'ok')
    assert.strictEqual(effect.effect.label, 'negative')
    assert.strictEqual(effect.effect.signals.correction, true)

    const effects = replyEffectStore.listEffects({ groupId: '1000' })
    assert.strictEqual(effects.length, 1)
    assert.strictEqual(effects[0].observedMessageId, 'm2')

    console.log('✓ Agent 回复效果观察正常')
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
