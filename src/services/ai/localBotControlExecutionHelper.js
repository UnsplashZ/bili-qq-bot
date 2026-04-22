'use strict'

const { CONFIRMATION_STATES } = require('./agentTypes')

function buildPendingBotControlReply(result) {
    const summary = String(result?.confirmation?.summary || '').trim()

    if (summary) {
        return `这个操作需要确认。确认后将执行：${summary}。`
    }

    return '这个操作需要确认，确认后我再执行。'
}

function buildExecutedBotControlReply(result) {
    const genericMessage = String(result?.data?.message || '').trim()

    if (genericMessage) {
        return genericMessage
    }

    const operation = result?.data?.operation
    const uid = result?.data?.uid

    if (result?.action === 'config.read') {
        const effective = result?.data?.effective && typeof result.data.effective === 'object'
            ? result.data.effective
            : {}
        const lines = Object.entries(effective).map(([field, value]) => `${field}: ${value}`)
        return lines.length > 0
            ? `当前群 AI 配置如下：\n${lines.join('\n')}`
            : '当前群没有可读的 AI 配置项。'
    }

    if (result?.action === 'approval.read') {
        const items = Array.isArray(result?.data?.items) ? result.data.items : []

        if (items.length === 0) {
            return '当前没有待处理审批。'
        }

        const lines = items.map((item, index) => {
            const segments = [
                `${index + 1}. ${item.requestTypeLabel || '待审批请求'}`,
                `编号 ${item.shortId || item.key}`,
                `申请人 ${item.userId || '未知'}`
            ]

            if (item.groupId) {
                segments.push(`群 ${item.groupId}`)
            }
            if (item.comment) {
                segments.push(`附言 ${item.comment}`)
            }

            return segments.join('，')
        })

        return `当前共有 ${items.length} 条待处理审批：\n${lines.join('\n')}\n如需处理，请精确回复审批通知消息，或发送“同意/拒绝 REQ-*”。`
    }

    if (result?.action === 'config.write') {
        const updates = result?.data?.updates && typeof result.data.updates === 'object'
            ? result.data.updates
            : {}
        const summary = Object.entries(updates).map(([field, value]) => `${field}=${value}`).join('，')
        return summary
            ? `已更新当前群 AI 配置：${summary}。`
            : '已更新当前群 AI 配置。'
    }

    if (result?.action === 'context.write' && operation === 'reset') {
        return '已重置当前群聊上下文。'
    }

    if (result?.action === 'subscription.write' && operation === 'add_user' && uid) {
        if (result?.data?.status === 'already_subscribed') {
            return `UID ${uid} 已经在当前群订阅中，无需重复添加。`
        }

        return `已在当前群订阅中添加 UID ${uid}。`
    }

    if (result?.action === 'subscription.write' && operation === 'remove_user' && uid) {
        if (result?.data?.status === 'not_subscribed') {
            return `UID ${uid} 当前不在本群订阅中，无需移除。`
        }

        return `已从当前群订阅中移除 UID ${uid}。`
    }

    if (result?.action === 'subscription.read' && operation === 'search_user') {
        const query = String(result?.data?.query || '').trim()
        const candidates = Array.isArray(result?.data?.candidates) ? result.data.candidates : []
        const total = Number.isFinite(Number(result?.data?.counts?.total))
            ? Number(result.data.counts.total)
            : candidates.length

        if (candidates.length === 0) {
            return `没有找到与“${query}”相关的B站用户候选，请尝试更具体的名字，或直接发送“订阅 UID <uid>”。`
        }

        const summary = total > candidates.length
            ? `共找到 ${total} 个候选，先列出前 ${candidates.length} 个：`
            : `找到 ${candidates.length} 个候选：`
        const lines = candidates.map(candidate => {
            const roomText = candidate?.roomId ? `，直播间 ${candidate.roomId}` : ''
            const fansText = Number.isFinite(Number(candidate?.fans)) && Number(candidate.fans) > 0
                ? `，粉丝 ${Number(candidate.fans)}`
                : ''

            return `${candidate.rank}. ${candidate.name}（UID ${candidate.uid}${roomText}${fansText}）`
        })

        return `${summary}\n${lines.join('\n')}\n如需订阅，可直接回复序号（如 1 / 第1个 / 选2），或发送“订阅 UID <uid>”。`
    }

    if (result?.action === 'approval.write') {
        const decision = result?.data?.operation === 'approve' ? '同意' : '拒绝'
        const status = result?.data?.status
        const shortId = result?.data?.shortId || result?.data?.target?.shortId || '未知编号'
        const pendingCount = Number.isFinite(Number(result?.data?.pendingCount))
            ? Number(result.data.pendingCount)
            : 0
        const message = String(result?.data?.message || '').trim()
        const wording = String(result?.data?.wording || '').trim()

        if (status === 'executed') {
            return wording
                ? `已${decision}审批请求 ${shortId}。剩余待处理：${pendingCount}。接口回执：${wording}`
                : `已${decision}审批请求 ${shortId}。剩余待处理：${pendingCount}。`
        }

        return message || `审批操作未执行：${shortId}`
    }

    return '已执行当前群管理操作。'
}

function buildRejectedBotControlReply() {
    return '已取消当前待确认操作。'
}

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

function buildBotControlFinalReply({ outcome, actionResult }) {
    if (outcome === 'rejected') {
        return buildRejectedBotControlReply()
    }

    if (outcome === 'pending_confirmation') {
        return buildPendingBotControlReply(actionResult)
    }

    return buildExecutedBotControlReply(actionResult)
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
        finalReply: buildBotControlFinalReply({ outcome: localActionRecord.status, actionResult }),
        hasMutation: localActionRecord.result.mutation
    }
}

module.exports = {
    executeLocalBotControlAction,
    normalizeLocalBotControlActionRecord
}