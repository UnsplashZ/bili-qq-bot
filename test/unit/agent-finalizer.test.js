#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { renderLocalActionFinalReply, finalizeAgentRunResult } = require('../../src/services/ai/agent/finalizer')

function testRendersPendingWorkflowPromptFromLocalActionRecord() {
    const reply = renderLocalActionFinalReply({
        action: 'context.write',
        status: 'pending_confirmation',
        confirmation: {
            summary: 'reset current group conversation context'
        },
        result: {
            ok: true,
            mutation: false,
            data: null
        }
    })

    assert.strictEqual(reply, '这个操作需要确认。确认后将执行：reset current group conversation context。')
}

function testRendersExecutedLocalActionSummaryFromLocalActionRecord() {
    const reply = renderLocalActionFinalReply({
        action: 'subscription.write',
        status: 'executed',
        result: {
            ok: true,
            mutation: true,
            data: {
                operation: 'add_user',
                uid: '42'
            }
        }
    })

    assert.strictEqual(reply, '已在当前群订阅中添加 UID 42。')
}

function testRendersTruthfulApprovalWriteFailureFallbackWhenMessageIsEmpty() {
    const reply = renderLocalActionFinalReply({
        action: 'approval.write',
        status: 'failed',
        result: {
            ok: false,
            mutation: false,
            data: {
                operation: 'reject',
                status: 'invalid_short_id',
                shortId: 'REQ-ABCD12',
                pendingCount: 1,
                message: '',
                wording: ''
            }
        }
    })

    assert.strictEqual(reply, '审批操作未执行：REQ-ABCD12')
}

function testFinalizeUsesLocalActionRenderingWhenNoReplyPipelinePayloadExists() {
    const runResult = {
        steps: [{ type: 'local_action_done' }],
        toolCalls: [],
        localActions: [{
            action: 'confirmation.reject',
            status: 'rejected',
            result: {
                ok: true,
                mutation: false,
                data: null
            }
        }],
        errors: [],
        hasToolResult: true,
        hasMutation: false,
        finalReply: null
    }

    const finalized = finalizeAgentRunResult({ runResult })

    assert.strictEqual(finalized.finalReply, '已取消当前待确认操作。')
    assert.strictEqual(finalized.hasToolResult, false)
    assert.strictEqual(finalized.stepCount, 1)
}

function run() {
    testRendersPendingWorkflowPromptFromLocalActionRecord()
    testRendersExecutedLocalActionSummaryFromLocalActionRecord()
    testRendersTruthfulApprovalWriteFailureFallbackWhenMessageIsEmpty()
    testFinalizeUsesLocalActionRenderingWhenNoReplyPipelinePayloadExists()
    console.log('✓ agent finalizer centralizes user-visible local action rendering and final reply shaping')
}

run()
