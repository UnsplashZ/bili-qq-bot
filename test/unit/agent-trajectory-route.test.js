#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')

const trajectoryRouter = require(path.join(__dirname, '../../src/dashboard/routes/api/modules/agent-trajectory'))

function run() {
    const { summarizeTrajectory, matchesFilters, summarizeItems, getTrajectoryAction } = trajectoryRouter._private

    const toolPlanItem = summarizeTrajectory({
        type: 'tool_plan_result',
        groupId: '1000',
        userId: '42',
        toolPlanResult: {
            status: 'confirmation_required',
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
            }
        }
    })
    assert.strictEqual(matchesFilters(confirmationItem, { action: 'tool_plan' }), true)

    const replyItem = summarizeTrajectory({
        type: 'observe_decision',
        groupId: '1000',
        userId: '42',
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
            reason: 'accepted'
        }
    })
    assert.strictEqual(matchesFilters(replyItem, { action: 'tool_plan' }), false)
    assert.strictEqual(matchesFilters(replyItem, { action: 'short_reply' }), true)

    const summary = summarizeItems([toolPlanItem, confirmationItem, replyItem])
    assert.strictEqual(summary.actionCounts.tool_plan, 2)
    assert.strictEqual(summary.actionCounts.short_reply, 1)
    assert.strictEqual(summary.toolCount, 2)

    console.log('✓ Agent trajectory tool_plan 过滤正常')
}

try {
    run()
} catch (error) {
    console.error(error)
    process.exit(1)
}
