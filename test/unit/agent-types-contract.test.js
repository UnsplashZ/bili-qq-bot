#!/usr/bin/env node
'use strict'

const assert = require('assert')
const {
    TASK_MODES,
    RUN_STATES,
    RISK_LEVELS,
    CONFIRMATION_STATES,
    createEmptyRunResult
} = require('../../src/services/ai/agentTypes')

function run() {
    assert.strictEqual(TASK_MODES.CHAT, 'chat')
    assert.strictEqual(TASK_MODES.ACT, 'act')
    assert.strictEqual(RUN_STATES.PLANNED, 'planned')
    assert.strictEqual(RISK_LEVELS.MEDIUM, 'medium')
    assert.strictEqual(CONFIRMATION_STATES.REQUIRED, 'required')

    const result = createEmptyRunResult()
    assert.deepStrictEqual(result.steps, [])
    assert.deepStrictEqual(result.toolCalls, [])
    assert.deepStrictEqual(result.localActions, [])
    assert.deepStrictEqual(result.errors, [])
    assert.strictEqual(result.finalReply, null)
    assert.strictEqual(result.stepCount, 0)

    console.log('✓ agentTypes 提供稳定的 Phase 1 runtime 契约常量与默认 run result')
}

try {
    run()
    process.exit(0)
} catch (error) {
    console.error(error)
    process.exit(1)
}
