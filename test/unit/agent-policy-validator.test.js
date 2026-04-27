#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')

const { validateDecisionPolicy } = require(path.join(__dirname, '../../src/agent/cognition/decisionPolicyValidator'))
const { evaluateInputGuardrails } = require(path.join(__dirname, '../../src/agent/runtime/inputGuardrails'))
const { evaluateDecisionGuardrails } = require(path.join(__dirname, '../../src/agent/runtime/decisionGuardrails'))
const { applyOutputGuardrails } = require(path.join(__dirname, '../../src/agent/runtime/outputGuardrails'))
const { normalizeAgentConfig } = require(path.join(__dirname, '../../src/agent/config/agentConfig'))

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

function makeFallbackDecision({ action = 'ask_clarify', replyDraft = '我刚才没能正确解析这条请求。你可以再明确说一次吗？' } = {}) {
    return {
        status: 'error',
        reason: 'agent_llm_empty_message_content',
        decision: {
            action,
            confidence: 0.2,
            reason: 'LLM decision failed; fallback to clarify: agent_llm_empty_message_content',
            topic: 'llm_fallback',
            replyStyle: 'clarify',
            replyDraft,
            memoryHints: [],
            toolIntent: null
        }
    }
}

function makeAgentConfig(overrides = {}) {
    return {
        observeOnly: false,
        sendEnabled: true,
        decisionMode: 'llm_live',
        replyPolicy: {
            minReplyScore: 0.65,
            cooldownMs: 5000
        },
        social: {
            enabled: true,
            mode: 'debug',
            maxCasualReplyChars: 80
        },
        ...overrides
    }
}

function validate({ confidence, traits, action = 'short_reply', replyDraft = '收到。' }) {
    const llmDecision = makeDecision({ confidence, replyDraft })
    llmDecision.decision.action = action
    return validateDecisionPolicy({
        agentConfig: makeAgentConfig(),
        llmDecision,
        messageTraits: traits,
        replyGuardDecision: { allowed: true }
    })
}

function run() {
    const inputAllowed = evaluateInputGuardrails({
        agentMessage: { userId: '42', normalizedText: '小助手 ping' },
        budgetDecision: { allowed: true, reason: 'budget_allowed', groupCount: 1, userCount: 1 }
    })
    assert.strictEqual(inputAllowed.allowed, true)
    assert.ok(inputAllowed.checks.some((check) => check.name === 'llm_budget' && check.passed))

    const inputBlocked = evaluateInputGuardrails({
        agentMessage: { userId: '42', normalizedText: '小助手 ping' },
        budgetDecision: { allowed: false, reason: 'group_budget_exceeded', groupCount: 60, userCount: 2 }
    })
    assert.strictEqual(inputBlocked.allowed, false)
    assert.strictEqual(inputBlocked.reason, 'group_budget_exceeded')

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

    const socialAccepted = validate({
        confidence: 0.9,
        action: 'casual_interject',
        replyDraft: '这个角度我觉得挺准。',
        traits: { mentionedBot: false, replyToBot: false, aliasMatched: false }
    })
    assert.strictEqual(socialAccepted.accepted, true)
    assert.strictEqual(socialAccepted.finalAction, 'casual_interject')

    const socialWithToolIntent = makeDecision({
        confidence: 0.9,
        replyDraft: '这个角度我觉得挺准。'
    })
    socialWithToolIntent.decision.action = 'casual_interject'
    socialWithToolIntent.decision.toolIntent = { name: 'browser.search_web', arguments: { query: 'test' } }
    const socialToolRejected = validateDecisionPolicy({
        agentConfig: makeAgentConfig(),
        llmDecision: socialWithToolIntent,
        messageTraits: { mentionedBot: false, replyToBot: false, aliasMatched: false },
        replyGuardDecision: { allowed: true }
    })
    assert.strictEqual(socialToolRejected.accepted, false)
    assert.strictEqual(socialToolRejected.reason, 'social_action_with_tool_intent')

    const directSocialDowngraded = validate({
        confidence: 0.9,
        action: 'casual_interject',
        replyDraft: '这个角度我觉得挺准。',
        traits: { mentionedBot: true, replyToBot: false, aliasMatched: false }
    })
    assert.strictEqual(directSocialDowngraded.accepted, true)
    assert.strictEqual(directSocialDowngraded.finalAction, 'short_reply')
    assert.strictEqual(directSocialDowngraded.reason, 'social_action_direct_reply_downgraded')

    const directLlmErrorFallback = validateDecisionPolicy({
        agentConfig: makeAgentConfig(),
        llmDecision: makeFallbackDecision(),
        messageTraits: { mentionedBot: true, replyToBot: false, aliasMatched: false },
        replyGuardDecision: { allowed: true }
    })
    assert.strictEqual(directLlmErrorFallback.accepted, true)
    assert.strictEqual(directLlmErrorFallback.finalAction, 'ask_clarify')
    assert.strictEqual(directLlmErrorFallback.reason, 'llm_fallback:agent_llm_empty_message_content')

    const naturalLlmErrorFallback = validateDecisionPolicy({
        agentConfig: makeAgentConfig(),
        llmDecision: makeFallbackDecision(),
        messageTraits: { mentionedBot: false, replyToBot: false, aliasMatched: false },
        replyGuardDecision: { allowed: true }
    })
    assert.strictEqual(naturalLlmErrorFallback.accepted, false)
    assert.strictEqual(naturalLlmErrorFallback.reason, 'agent_llm_empty_message_content')

    const disabledLlmErrorFallback = validateDecisionPolicy({
        agentConfig: makeAgentConfig({ sendEnabled: false }),
        llmDecision: makeFallbackDecision(),
        messageTraits: { mentionedBot: true, replyToBot: false, aliasMatched: false },
        replyGuardDecision: { allowed: true }
    })
    assert.strictEqual(disabledLlmErrorFallback.accepted, false)
    assert.strictEqual(disabledLlmErrorFallback.reason, 'send_disabled')

    const decisionGuardrail = evaluateDecisionGuardrails(makeDecision({ confidence: 0.8 }))
    assert.strictEqual(decisionGuardrail.allowed, true)
    assert.ok(decisionGuardrail.checks.some((check) => check.name === 'action_allowed' && check.passed))

    const fallbackDecisionGuardrail = evaluateDecisionGuardrails(makeFallbackDecision())
    assert.strictEqual(fallbackDecisionGuardrail.allowed, true)
    assert.ok(fallbackDecisionGuardrail.checks.some((check) => check.name === 'decision_available' && check.passed))

    const missingToolIntentGuardrail = evaluateDecisionGuardrails({
        status: 'ok',
        decision: {
            action: 'tool_plan',
            confidence: 0.8,
            replyDraft: '',
            toolIntent: null
        }
    })
    assert.strictEqual(missingToolIntentGuardrail.allowed, false)
    assert.strictEqual(missingToolIntentGuardrail.reason, 'missing_tool_intent')

    const longReply = '这是一段比较长的回复内容'.repeat(10)
    const outputAllowed = applyOutputGuardrails({
        agentConfig: { replyPolicy: { maxReplyChars: 80 } },
        llmDecision: makeDecision({ confidence: 0.8, replyDraft: longReply }),
        policyDecision: {
            accepted: true,
            wouldSend: true,
            finalAction: 'short_reply',
            reason: 'accepted',
            replyDraft: longReply
        }
    })
    assert.strictEqual(outputAllowed.policyDecision.accepted, true)
    assert.strictEqual(outputAllowed.policyDecision.replyDraft.length, 80)

    const socialTrimmed = applyOutputGuardrails({
        agentConfig: { social: { maxCasualReplyChars: 30 } },
        llmDecision: makeDecision({ confidence: 0.8, replyDraft: longReply }),
        policyDecision: {
            accepted: true,
            wouldSend: true,
            finalAction: 'casual_interject',
            reason: 'social_accepted',
            replyDraft: longReply
        }
    })
    assert.strictEqual(socialTrimmed.policyDecision.replyDraft.length, 30)

    const outputBlocked = applyOutputGuardrails({
        agentConfig: {},
        llmDecision: makeDecision({ confidence: 0.8, replyDraft: 'sk-1234567890abcdefg' }),
        policyDecision: {
            accepted: true,
            wouldSend: true,
            finalAction: 'short_reply',
            reason: 'accepted',
            replyDraft: 'sk-1234567890abcdefg'
        }
    })
    assert.strictEqual(outputBlocked.policyDecision.accepted, false)
    assert.strictEqual(outputBlocked.policyDecision.reason, 'possible_secret_leakage')

    const normalizedConfig = normalizeAgentConfig({
        tools: {
            enabled: true,
            requireConfirmationFor: ['low']
        }
    })
    assert.deepStrictEqual(normalizedConfig.tools.requireConfirmationFor.sort(), ['high', 'low'])

    console.log('✓ Agent 回复策略阈值正常')
}

try {
    run()
} catch (error) {
    console.error(error)
    process.exit(1)
}
