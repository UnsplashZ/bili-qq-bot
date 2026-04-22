#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { planAgentRun } = require('../../src/services/ai/agentPlannerService')
const { TASK_MODES } = require('../../src/services/ai/agentTypes')

function run() {
    const chatPlan = planAgentRun({ agentDecision: { taskMode: TASK_MODES.CHAT } })
    const answerPlan = planAgentRun({ agentDecision: { taskMode: TASK_MODES.ANSWER } })
    const confirmPlan = planAgentRun({ agentDecision: { taskMode: TASK_MODES.CONFIRM } })
    const structuredPlan = planAgentRun({
        agentDecision: {
            taskMode: TASK_MODES.ACT,
            structuredAction: {
                kind: 'supported',
                snapshot: {
                    action: 'context.write',
                    input: { operation: 'reset' }
                }
            }
        }
    })

    assert.strictEqual(chatPlan.planType, 'chat')
    assert.strictEqual(chatPlan.requiresTools, false)
    assert.strictEqual(answerPlan.planType, 'tool_assisted_answer')
    assert.strictEqual(answerPlan.requiresConfirmation, false)
    assert.strictEqual(confirmPlan.planType, 'confirm_then_action')
    assert.strictEqual(confirmPlan.requiresConfirmation, true)
    assert.deepStrictEqual(confirmPlan.candidateActions, [])
    assert.strictEqual(structuredPlan.planType, 'structured_bot_control')
    assert.strictEqual(structuredPlan.requiresTools, false)
    assert.strictEqual(structuredPlan.requiresConfirmation, true)
    assert.deepStrictEqual(structuredPlan.candidateActions, [{
        executor: 'bot_control',
        action: 'context.write',
        input: { operation: 'reset' }
    }])

    console.log('✓ agentPlannerService 会为显式结构化 bot-control 动作生成最小本地执行 plan，并保持普通 chat/answer 映射稳定')
}

try {
    run()
    process.exit(0)
} catch (error) {
    console.error(error)
    process.exit(1)
}
