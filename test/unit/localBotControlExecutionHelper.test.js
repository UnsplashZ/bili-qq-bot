#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { normalizeLocalBotControlActionRecord } = require('../../src/services/ai/localBotControlExecutionHelper')

function testFailedWriteActionUsesFailedStatusAndKeepsFailureData() {
    const localAction = normalizeLocalBotControlActionRecord({
        candidateAction: {
            action: 'approval.write',
            groupId: 'private_10000',
            input: {
                operation: 'reject',
                replyMessageId: '2001',
                shortId: ''
            }
        },
        actionResult: {
            ok: false,
            action: 'approval.write',
            namespace: 'approval',
            operation: 'write',
            scope: 'root_private',
            groupId: 'private_10000',
            mutation: false,
            data: {
                operation: 'reject',
                status: 'invalid_reply',
                message: '引用的审批消息不存在、已过期或已处理。'
            }
        },
        pendingConfirmation: null
    })

    assert.strictEqual(localAction.status, 'failed')
    assert.deepStrictEqual(localAction.result, {
        ok: false,
        mutation: false,
        data: {
            operation: 'reject',
            status: 'invalid_reply',
            message: '引用的审批消息不存在、已过期或已处理。'
        }
    })
    assert.strictEqual(localAction.confirmation, null)
}

function testPendingAndRejectedSemanticsStayUnchanged() {
    const pendingAction = normalizeLocalBotControlActionRecord({
        candidateAction: {
            action: 'context.write',
            groupId: '1000',
            input: { operation: 'reset' }
        },
        actionResult: {
            ok: true,
            confirmationRequired: true,
            namespace: 'context',
            operation: 'write',
            scope: 'current_group',
            groupId: '1000',
            confirmation: {
                confirmationId: 'confirm-1',
                state: 'pending',
                summary: 'reset current group conversation context'
            }
        },
        pendingConfirmation: null
    })

    const rejectedAction = normalizeLocalBotControlActionRecord({
        candidateAction: {
            action: 'confirmation.reject',
            groupId: '1000',
            input: { confirmationId: 'confirm-1' }
        },
        actionResult: {
            ok: true,
            confirmationId: 'confirm-1',
            state: 'rejected',
            summary: 'reset current group conversation context'
        },
        pendingConfirmation: null
    })

    assert.strictEqual(pendingAction.status, 'pending_confirmation')
    assert.strictEqual(pendingAction.result.data, null)
    assert.strictEqual(rejectedAction.status, 'rejected')
    assert.strictEqual(rejectedAction.result.data, null)
}

function run() {
    testFailedWriteActionUsesFailedStatusAndKeepsFailureData()
    testPendingAndRejectedSemanticsStayUnchanged()
    console.log('✓ localBotControlExecutionHelper records failed local actions without mislabeling them as executed')
}

run()
