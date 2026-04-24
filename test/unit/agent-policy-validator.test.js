#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')

const { validateDecisionPolicy } = require(path.join(__dirname, '../../src/agent/cognition/decisionPolicyValidator'))

function makeDecision({ confidence, replyDraft = '收到。' }) {
    return {
        status: 'ok',
        decision: {
            action: 'short_reply',
            confidence,
            reason: 'test',
            topic: 'test',
            replyStyle: 'friendly_brief',
            replyDraft,
            memoryHints: [],
            toolIntent: null
        }
    }
}

function validate({ confidence, traits, action = 'short_reply', replyDraft = '收到。' }) {
    const llmDecision = makeDecision({ confidence, replyDraft })
    llmDecision.decision.action = action
    return validateDecisionPolicy({
        agentConfig: {
            observeOnly: false,
            sendEnabled: true,
            decisionMode: 'llm_live',
            replyPolicy: {
                minReplyScore: 0.65,
                cooldownMs: 5000
            }
        },
        llmDecision,
        messageTraits: traits,
        replyGuardDecision: { allowed: true }
    })
}

function run() {
    const mentionedLowConfidence = validate({
        confidence: 0.2,
        traits: { mentionedBot: true, replyToBot: false, aliasMatched: false }
    })
    assert.strictEqual(mentionedLowConfidence.accepted, true)
    assert.strictEqual(mentionedLowConfidence.reason, 'accepted')

    const naturalAccepted = validate({
        confidence: 0.65,
        traits: { mentionedBot: false, replyToBot: false, aliasMatched: false }
    })
    assert.strictEqual(naturalAccepted.accepted, true)
    assert.strictEqual(naturalAccepted.reason, 'accepted')

    const naturalRejected = validate({
        confidence: 0.64,
        traits: { mentionedBot: false, replyToBot: false, aliasMatched: false }
    })
    assert.strictEqual(naturalRejected.accepted, false)
    assert.strictEqual(naturalRejected.reason, 'confidence_below_send_threshold')

    const directReactDowngraded = validate({
        confidence: 0.95,
        action: 'react_only',
        replyDraft: '我不是楠哥，我是B站助手。',
        traits: { mentionedBot: true, replyToBot: false, aliasMatched: false }
    })
    assert.strictEqual(directReactDowngraded.accepted, true)
    assert.strictEqual(directReactDowngraded.finalAction, 'short_reply')
    assert.strictEqual(directReactDowngraded.reason, 'react_only_reply_downgraded')

    const directToolPlanDowngraded = validate({
        confidence: 0.95,
        action: 'tool_plan',
        replyDraft: '我可以帮你查看配置，但现在只先说明计划。',
        traits: { mentionedBot: true, replyToBot: false, aliasMatched: false }
    })
    assert.strictEqual(directToolPlanDowngraded.accepted, true)
    assert.strictEqual(directToolPlanDowngraded.finalAction, 'short_reply')
    assert.strictEqual(directToolPlanDowngraded.reason, 'tool_plan_reply_downgraded')

    console.log('✓ Agent 回复策略阈值正常')
}

try {
    run()
} catch (error) {
    console.error(error)
    process.exit(1)
}
