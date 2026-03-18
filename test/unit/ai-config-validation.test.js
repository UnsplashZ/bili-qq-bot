#!/usr/bin/env node
'use strict'

const assert = require('assert')
const {
    normalizeAiConfigUpdates,
    AiConfigValidationError
} = require('../../src/services/ai/validation')

function run() {
    const normalized = normalizeAiConfigUpdates({
        aiProbability: '0.35',
        aiContextLimit: '50',
        aiTemperature: '1.2',
        aiIdentityRagMode: 'STRICT',
        aiStructuredContextEnabled: true,
        aiReplyGateEnabled: true,
        aiContextSelectorEnabled: true,
        aiResponseModeEnabled: true,
        aiPromptAssemblerEnabled: true,
        aiReplyScoreThreshold: '45',
        aiBusyReplyScoreThreshold: '80',
        aiBusyWindowSeconds: '10',
        aiBusyMessageCount: '12',
        aiReplyCooldownMs: '15000',
        aiMaxRepliesPerWindow: '3',
        aiChatBaseTimeoutSeconds: '30',
        aiChatToolTimeoutSeconds: '2',
        aiChatMaxTimeoutSeconds: '45',
        aiBotAliases: ['小助手', ' BiliBot ']
    })

    assert.strictEqual(normalized.aiProbability, 0.35)
    assert.strictEqual(normalized.aiContextLimit, 50)
    assert.strictEqual(normalized.aiTemperature, 1.2)
    assert.strictEqual(normalized.aiIdentityRagMode, 'strict')
    assert.strictEqual(normalized.aiStructuredContextEnabled, true)
    assert.strictEqual(normalized.aiReplyGateEnabled, true)
    assert.strictEqual(normalized.aiContextSelectorEnabled, true)
    assert.strictEqual(normalized.aiResponseModeEnabled, true)
    assert.strictEqual(normalized.aiPromptAssemblerEnabled, true)
    assert.strictEqual(normalized.aiReplyScoreThreshold, 45)
    assert.strictEqual(normalized.aiBusyReplyScoreThreshold, 80)
    assert.strictEqual(normalized.aiBusyWindowSeconds, 10)
    assert.strictEqual(normalized.aiBusyMessageCount, 12)
    assert.strictEqual(normalized.aiReplyCooldownMs, 15000)
    assert.strictEqual(normalized.aiMaxRepliesPerWindow, 3)
    assert.strictEqual(normalized.aiChatBaseTimeoutSeconds, 30)
    assert.strictEqual(normalized.aiChatToolTimeoutSeconds, 2)
    assert.strictEqual(normalized.aiChatMaxTimeoutSeconds, 45)
    assert.deepStrictEqual(normalized.aiBotAliases, ['小助手', 'BiliBot'])

    assert.throws(
        () => normalizeAiConfigUpdates({ aiContextLimit: 0 }),
        (err) => err instanceof AiConfigValidationError && err.field === 'aiContextLimit'
    )

    assert.throws(
        () => normalizeAiConfigUpdates({ aiUnknownField: 'x' }),
        (err) => err instanceof AiConfigValidationError && err.field === 'aiUnknownField'
    )

    assert.throws(
        () => normalizeAiConfigUpdates({ aiProbability: '0.35abc' }),
        (err) => err instanceof AiConfigValidationError && err.field === 'aiProbability'
    )

    assert.throws(
        () => normalizeAiConfigUpdates({ aiContextLimit: '10foo' }),
        (err) => err instanceof AiConfigValidationError && err.field === 'aiContextLimit'
    )

    assert.throws(
        () => normalizeAiConfigUpdates({ aiReplyGateEnabled: 'true' }),
        (err) => err instanceof AiConfigValidationError && err.field === 'aiReplyGateEnabled'
    )

    assert.throws(
        () => normalizeAiConfigUpdates({ aiBusyMessageCount: 0 }),
        (err) => err instanceof AiConfigValidationError && err.field === 'aiBusyMessageCount'
    )

    assert.throws(
        () => normalizeAiConfigUpdates({ aiChatBaseTimeoutSeconds: 0 }),
        (err) => err instanceof AiConfigValidationError && err.field === 'aiChatBaseTimeoutSeconds'
    )

    assert.throws(
        () => normalizeAiConfigUpdates({ aiChatToolTimeoutSeconds: -1 }),
        (err) => err instanceof AiConfigValidationError && err.field === 'aiChatToolTimeoutSeconds'
    )

    assert.throws(
        () => normalizeAiConfigUpdates({ aiChatMaxTimeoutSeconds: 3601 }),
        (err) => err instanceof AiConfigValidationError && err.field === 'aiChatMaxTimeoutSeconds'
    )

    assert.throws(
        () => normalizeAiConfigUpdates({
            aiChatBaseTimeoutSeconds: 60,
            aiChatMaxTimeoutSeconds: 30
        }),
        (err) => err instanceof AiConfigValidationError && err.field === 'aiChatMaxTimeoutSeconds'
    )

    assert.throws(
        () => normalizeAiConfigUpdates(
            { aiChatMaxTimeoutSeconds: 20 },
            { currentConfig: { aiChatBaseTimeoutSeconds: 30, aiChatMaxTimeoutSeconds: 45 } }
        ),
        (err) => err instanceof AiConfigValidationError && err.field === 'aiChatMaxTimeoutSeconds'
    )

    assert.throws(
        () => normalizeAiConfigUpdates({ aiBotAliases: 'not-array' }),
        (err) => err instanceof AiConfigValidationError && err.field === 'aiBotAliases'
    )

    console.log('✓ AI 配置统一校验模块工作正常')
}

run()
