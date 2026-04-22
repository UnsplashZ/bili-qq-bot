'use strict'

const CONFIRM_PHRASES = Object.freeze(['confirm', '确认', '是', '执行', '继续'])
const REJECT_PHRASES = Object.freeze(['cancel', '取消', '不用了', '拒绝'])

const CONFIRM_PHRASE_SET = new Set(CONFIRM_PHRASES)
const REJECT_PHRASE_SET = new Set(REJECT_PHRASES)

function normalizeMessage(rawMessage) {
    return String(rawMessage || '').replace(/\[CQ:[^\]]+\]/g, ' ').trim().toLowerCase()
}

function isPendingFollowupTriggerAllowed(messageMeta = {}) {
    const source = String(messageMeta?.source || '').trim()

    if (source === 'private') {
        return true
    }

    return messageMeta?.isReplyToBot === true
}

function buildPendingConfirmationAction(pendingConfirmation) {
    const snapshotInput = pendingConfirmation?.snapshot?.input

    if (!snapshotInput || typeof snapshotInput !== 'object' || Array.isArray(snapshotInput)) {
        return null
    }

    return {
        action: pendingConfirmation.action,
        input: {
            ...snapshotInput,
            confirmationId: pendingConfirmation.confirmationId
        }
    }
}

function buildPendingRejectionAction(pendingConfirmation) {
    return {
        action: 'confirmation.reject',
        input: {
            confirmationId: pendingConfirmation.confirmationId
        }
    }
}

function recognizePendingBotControlFollowup({ rawMessage, pendingConfirmation, messageMeta } = {}) {
    const confirmationId = String(pendingConfirmation?.confirmationId || '').trim()
    const action = String(pendingConfirmation?.action || '').trim()
    const normalizedMessage = normalizeMessage(rawMessage)

    if (!confirmationId || !action || !normalizedMessage || !isPendingFollowupTriggerAllowed(messageMeta)) {
        return null
    }

    if (CONFIRM_PHRASE_SET.has(normalizedMessage)) {
        const candidate = buildPendingConfirmationAction(pendingConfirmation)

        return candidate == null
            ? null
            : {
                kind: 'confirm',
                candidate
            }
    }

    if (REJECT_PHRASE_SET.has(normalizedMessage)) {
        return {
            kind: 'reject',
            candidate: buildPendingRejectionAction(pendingConfirmation)
        }
    }

    return null
}

module.exports = {
    CONFIRM_PHRASES,
    REJECT_PHRASES,
    recognizePendingBotControlFollowup
}
