#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')

const trajectoryRouter = require(path.join(__dirname, '../../src/dashboard/routes/api/modules/agent-trajectory'))
const { buildNativeTrajectorySpans } = require(path.join(__dirname, '../../src/agent/runtime/trajectorySpans'))

function run() {
    const { summarizeTrajectory, matchesFilters, summarizeItems, getTrajectoryAction } = trajectoryRouter._private

    const toolPlanItem = summarizeTrajectory({
        type: 'tool_plan_result',
        groupId: '1000',
        userId: '42',
        toolPlanResult: {
            status: 'confirmation_required',
            guardrailDecision: {
                allowed: true,
                reason: 'allowed',
                checks: [{ name: 'permission', passed: true, reason: 'group_config_allowed' }]
            },
            plan: {
                name: 'agent.set_send_enabled',
                risk: 'medium',
                permission: 'manage_group_config',
                summary: '关闭本群 Agent 发言'
            },
            confirmation: {
                id: 'confirm_1',
                shortId: 'abcd',
                requestMessageId: 'msg_1',
                expiresAt: Date.now() + 60000
            }
        }
    })

    assert.strictEqual(toolPlanItem.llmDecision.action, '')
    assert.strictEqual(toolPlanItem.tool.name, 'agent.set_send_enabled')
    assert.strictEqual(getTrajectoryAction(toolPlanItem), 'tool_plan')
    assert.strictEqual(matchesFilters(toolPlanItem, { action: 'tool_plan' }), true)
    assert.strictEqual(matchesFilters(toolPlanItem, { action: 'short_reply' }), false)
    assert.strictEqual(matchesFilters(toolPlanItem, { spanType: 'tool_guardrail' }), true)
    assert.strictEqual(matchesFilters(toolPlanItem, { spanType: 'output_guardrail' }), false)
    assert.ok(toolPlanItem.spans.some((span) => span.type === 'tool_plan'))
    assert.ok(toolPlanItem.spans.some((span) => span.type === 'tool_guardrail' && span.status === 'ok'))

    const confirmationItem = summarizeTrajectory({
        type: 'tool_confirmation',
        groupId: '1000',
        userId: '42',
        toolConfirmation: {
            status: 'executed',
            plan: {
                name: 'agent.set_send_enabled',
                risk: 'medium',
                permission: 'manage_group_config',
                summary: '关闭本群 Agent 发言'
            },
            result: {
                message: '已关闭群 1000 的 Agent 发言'
            },
            toolReplyDecision: {
                status: 'ok',
                model: 'test-model',
                usage: { total_tokens: 9 },
                decision: {
                    action: 'short_reply',
                    replyDraft: '已处理：本群 Agent 发言已关闭。'
                }
            }
        }
    })
    assert.strictEqual(matchesFilters(confirmationItem, { action: 'tool_plan' }), true)
    assert.strictEqual(confirmationItem.tool.replyDecision.status, 'ok')
    assert.strictEqual(confirmationItem.tool.replyDecision.action, 'short_reply')
    assert.strictEqual(confirmationItem.tool.replyDecision.replyDraftPreview, '已处理：本群 Agent 发言已关闭。')

    const replyItem = summarizeTrajectory({
        type: 'observe_decision',
        groupId: '1000',
        userId: '42',
        inputGuardrail: {
            allowed: true,
            reason: 'allowed',
            checks: [{ name: 'llm_budget', passed: true, reason: 'budget_allowed' }]
        },
        llmDecision: {
            status: 'ok',
            decision: {
                action: 'short_reply',
                confidence: 0.9
            }
        },
        policyDecision: {
            accepted: true,
            finalAction: 'short_reply',
            reason: 'accepted',
            outputGuardrail: {
                allowed: true,
                reason: 'allowed',
                checks: [{ name: 'secret_leakage', passed: true, reason: 'ok' }]
            }
        },
        execution: {
            executed: true,
            reason: 'sent',
            action: 'short_reply'
        }
    })
    assert.strictEqual(matchesFilters(replyItem, { action: 'tool_plan' }), false)
    assert.strictEqual(matchesFilters(replyItem, { action: 'short_reply' }), true)
    assert.strictEqual(matchesFilters(replyItem, { spanType: 'output_guardrail' }), true)
    assert.strictEqual(matchesFilters(replyItem, { spanType: 'input_guardrail' }), true)
    assert.strictEqual(replyItem.inputGuardrail.reason, 'allowed')
    assert.ok(replyItem.spans.some((span) => span.type === 'llm_decision'))
    assert.ok(replyItem.spans.some((span) => span.type === 'reply_sent'))

    const nativeSpanItem = summarizeTrajectory({
        type: 'observe_decision',
        groupId: '1000',
        userId: '42',
        spans: [
            { type: 'message_received', status: 'ok', reason: '' },
            { type: 'input_guardrail', status: 'blocked', reason: 'group_budget_exceeded' }
        ]
    })
    assert.strictEqual(nativeSpanItem.spans.length, 2)
    assert.strictEqual(matchesFilters(nativeSpanItem, { spanType: 'input_guardrail' }), true)

    const builtSpans = buildNativeTrajectorySpans({
        type: 'observe_decision',
        groupId: '1000',
        userId: '42',
        messageId: 'm1',
        inputGuardrail: {
            allowed: false,
            reason: 'group_budget_exceeded',
            checks: [{ name: 'llm_budget', passed: false, reason: 'group_budget_exceeded' }]
        },
        execution: { executed: false, reason: 'policy_not_accepted' }
    })
    assert.ok(builtSpans.some((span) => span.type === 'input_guardrail' && span.status === 'blocked'))
    assert.ok(builtSpans.some((span) => span.type === 'reply_sent' && span.status === 'skipped'))

    const summary = summarizeItems([toolPlanItem, confirmationItem, replyItem])
    assert.strictEqual(summary.actionCounts.tool_plan, 2)
    assert.strictEqual(summary.actionCounts.short_reply, 1)
    assert.strictEqual(summary.toolCount, 2)
    assert.strictEqual(summary.spanCounts.tool_plan, 2)
    assert.strictEqual(summary.spanCounts.reply_sent, 1)
    assert.strictEqual(summary.spanCounts.input_guardrail, 1)

    console.log('✓ Agent trajectory tool_plan 和 span 过滤正常')
}

try {
    run()
} catch (error) {
    console.error(error)
    process.exit(1)
}
