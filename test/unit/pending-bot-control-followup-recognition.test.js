#!/usr/bin/env node
'use strict'

const assert = require('assert')
const {
    CONFIRM_PHRASES,
    REJECT_PHRASES,
    recognizePendingBotControlFollowup
} = require('../../src/services/ai/pendingBotControlFollowupRecognitionService')

const pendingConfirmation = {
    confirmationId: 'confirm-42',
    action: 'subscription.write',
    snapshot: {
        action: 'subscription.write',
        groupId: '1000',
        input: {
            operation: 'add_user',
            uid: '42'
        }
    }
}

const replyBotMeta = Object.freeze({
    source: 'group',
    isReplyToBot: true
})

function testConfirmPhrasesResolveToSavedSnapshot() {
    for (const phrase of CONFIRM_PHRASES) {
        assert.deepStrictEqual(recognizePendingBotControlFollowup({
            rawMessage: phrase,
            pendingConfirmation,
            messageMeta: replyBotMeta
        }), {
            kind: 'confirm',
            candidate: {
                action: 'subscription.write',
                input: {
                    operation: 'add_user',
                    uid: '42',
                    confirmationId: 'confirm-42'
                }
            }
        })
    }
}

function testRejectPhrasesResolveToScopedRejectAction() {
    for (const phrase of REJECT_PHRASES) {
        assert.deepStrictEqual(recognizePendingBotControlFollowup({
            rawMessage: phrase,
            pendingConfirmation,
            messageMeta: replyBotMeta
        }), {
            kind: 'reject',
            candidate: {
                action: 'confirmation.reject',
                input: {
                    confirmationId: 'confirm-42'
                }
            }
        })
    }
}

function testNoPendingConfirmationKeepsOrdinaryTextUntouched() {
    assert.strictEqual(recognizePendingBotControlFollowup({
        rawMessage: '确认',
        pendingConfirmation: null,
        messageMeta: replyBotMeta
    }), null)

    assert.strictEqual(recognizePendingBotControlFollowup({
        rawMessage: '今天聊什么',
        pendingConfirmation,
        messageMeta: replyBotMeta
    }), null)
}

function testGroupFollowupRequiresReplyToBot() {
    assert.strictEqual(recognizePendingBotControlFollowup({
        rawMessage: '确认',
        pendingConfirmation,
        messageMeta: {
            source: 'group',
            isReplyToBot: false
        }
    }), null)
}

function run() {
    testConfirmPhrasesResolveToSavedSnapshot()
    testRejectPhrasesResolveToScopedRejectAction()
    testNoPendingConfirmationKeepsOrdinaryTextUntouched()
    testGroupFollowupRequiresReplyToBot()
    console.log('✓ pendingBotControlFollowupRecognitionService 仅在 reply bot 且存在待确认操作时识别确认/取消短语')
}

try {
    run()
    process.exit(0)
} catch (error) {
    console.error(error)
    process.exit(1)
}
