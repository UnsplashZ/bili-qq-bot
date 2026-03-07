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
        aiStructuredContextEnabled: true
    })

    assert.strictEqual(normalized.aiProbability, 0.35)
    assert.strictEqual(normalized.aiContextLimit, 50)
    assert.strictEqual(normalized.aiTemperature, 1.2)
    assert.strictEqual(normalized.aiIdentityRagMode, 'strict')
    assert.strictEqual(normalized.aiStructuredContextEnabled, true)

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

    console.log('✓ AI 配置统一校验模块工作正常')
}

run()
