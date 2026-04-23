'use strict'

const { CONFIRMATION_STATES } = require('./agentTypes')

function buildLocalActionAudit(candidateAction, actionResult) {
    return {
        namespace: actionResult?.namespace || String(candidateAction?.action || '').split('.')[0] || null,
        operation: actionResult?.operation || null,
        scope: actionResult?.scope || 'current_group',
        groupId: actionResult?.groupId || candidateAction?.groupId || null
    }
}

function buildLocalActionConfirmation({ candidateAction, actionResult, status, pendingConfirmation }) {
    if (status === 'pending_confirmation') {
        return {
            confirmationId: actionResult?.confirmation?.confirmationId || null,
            state: actionResult?.confirmation?.state || CONFIRMATION_STATES.PENDING,
            summary: actionResult?.confirmation?.summary || null,
            createdAt: actionResult?.confirmation?.createdAt || null,
            required: true
        }
    }

    if (status === 'rejected') {
        return {
            confirmationId: actionResult?.confirmationId || null,
            state: actionResult?.state || CONFIRMATION_STATES.REJECTED,
            summary: actionResult?.summary || null,
            createdAt: actionResult?.createdAt || null,
            rejectedAt: actionResult?.rejectedAt || null,
            required: false
        }
    }

    const confirmationId = String(candidateAction?.input?.confirmationId || '').trim()

    if (!confirmationId) {
        return null
    }

    return {
        confirmationId,
        state: CONFIRMATION_STATES.CONFIRMED,
        summary: pendingConfirmation?.summary || null,
        createdAt: pendingConfirmation?.createdAt || null,
        confirmedAt: pendingConfirmation ? actionResult?.confirmedAt || null : null,
        required: false
    }
}

function buildLocalActionResult({ candidateAction, actionResult, status }) {
    const isMutation = (() => {
        if (status !== 'executed') {
            return false
        }

        if (typeof actionResult?.mutation === 'boolean') {
            return actionResult.mutation
        }

        const action = String(candidateAction?.action || '').trim()

        if (action === 'confirmation.reject') {
            return false
        }

        return action.endsWith('.write') || actionResult?.operation === 'write'
    })()

    return {
        ok: actionResult?.ok !== false,
        mutation: isMutation,
        data: status === 'pending_confirmation' || status === 'rejected'
            ? null
            : actionResult?.data ?? null
    }
}

function normalizeLocalBotControlActionRecord({ candidateAction, actionResult, pendingConfirmation }) {
    const status = candidateAction?.action === 'confirmation.reject'
        ? 'rejected'
        : actionResult?.confirmationRequired
            ? 'pending_confirmation'
            : actionResult?.ok === false
                ? 'failed'
                : 'executed'

    return {
        type: 'bot_control',
        kind: 'bot_control',
        executor: 'local',
        action: candidateAction.action,
        status,
        input: candidateAction.input,
        result: buildLocalActionResult({ candidateAction, actionResult, status }),
        confirmation: buildLocalActionConfirmation({ candidateAction, actionResult, status, pendingConfirmation }),
        audit: buildLocalActionAudit(candidateAction, actionResult),
        errors: []
    }
}

async function executeLocalBotControlAction({ botControl, candidateAction, agentInput }) {
    const confirmationId = String(candidateAction?.input?.confirmationId || '').trim()
    const pendingConfirmation = confirmationId && typeof botControl.getPendingConfirmation === 'function'
        ? botControl.getPendingConfirmation(confirmationId, {
            actorUserId: agentInput?.userId,
            userId: agentInput?.userId
        })
        : null
    let actionResult = null

    if (candidateAction.action === 'confirmation.reject') {
        if (typeof botControl.reject !== 'function') {
            throw new Error('Bot-control rejection runtime is unavailable')
        }

        actionResult = await botControl.reject(candidateAction.input.confirmationId, {
            actorUserId: agentInput?.userId,
            userId: agentInput?.userId
        })
    } else if (String(candidateAction?.action || '').trim().endsWith('.read')) {
        if (typeof botControl.read !== 'function') {
            throw new Error('Bot-control read runtime is unavailable')
        }

        actionResult = await botControl.read(candidateAction.action, candidateAction.input, {
            ws: agentInput?.ws || null,
            actorUserId: agentInput?.userId,
            userId: agentInput?.userId
        })
    } else {
        if (typeof botControl.write !== 'function') {
            throw new Error('Bot-control runtime is unavailable')
        }

        actionResult = await botControl.write(candidateAction.action, candidateAction.input, {
            ws: agentInput?.ws || null,
            actorUserId: agentInput?.userId,
            userId: agentInput?.userId
        })
    }

    const localActionRecord = normalizeLocalBotControlActionRecord({
        candidateAction,
        actionResult,
        pendingConfirmation
    })

    return {
        actionResult,
        localActionRecord,
        outcome: localActionRecord.status,
        hasMutation: localActionRecord.result.mutation
    }
}

module.exports = {
    executeLocalBotControlAction,
    normalizeLocalBotControlActionRecord
}