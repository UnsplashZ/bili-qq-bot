'use strict'

function buildPendingBotControlReply(localAction) {
    const summary = String(localAction?.confirmation?.summary || '').trim()

    if (summary) {
        return `这个操作需要确认。确认后将执行：${summary}。`
    }

    return '这个操作需要确认，确认后我再执行。'
}

function buildExecutedBotControlReply(localAction) {
    const action = String(localAction?.action || '').trim()
    const data = localAction?.result?.data && typeof localAction.result.data === 'object'
        ? localAction.result.data
        : {}
    const genericMessage = String(data.message || '').trim()

    if (genericMessage) {
        return genericMessage
    }

    const operation = data.operation
    const uid = data.uid

    if (action === 'config.read') {
        const effective = data.effective && typeof data.effective === 'object'
            ? data.effective
            : {}
        const lines = Object.entries(effective).map(([field, value]) => `${field}: ${value}`)
        return lines.length > 0
            ? `当前群 AI 配置如下：\n${lines.join('\n')}`
            : '当前群没有可读的 AI 配置项。'
    }

    if (action === 'approval.read') {
        const items = Array.isArray(data.items) ? data.items : []

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

    if (action === 'config.write') {
        const updates = data.updates && typeof data.updates === 'object'
            ? data.updates
            : {}
        const summary = Object.entries(updates).map(([field, value]) => `${field}=${value}`).join('，')
        return summary
            ? `已更新当前群 AI 配置：${summary}。`
            : '已更新当前群 AI 配置。'
    }

    if (action === 'context.write' && operation === 'reset') {
        return '已重置当前群聊上下文。'
    }

    if (action === 'subscription.write' && operation === 'add_user' && uid) {
        if (data.status === 'already_subscribed') {
            return `UID ${uid} 已经在当前群订阅中，无需重复添加。`
        }

        return `已在当前群订阅中添加 UID ${uid}。`
    }

    if (action === 'subscription.write' && operation === 'remove_user' && uid) {
        if (data.status === 'not_subscribed') {
            return `UID ${uid} 当前不在本群订阅中，无需移除。`
        }

        return `已从当前群订阅中移除 UID ${uid}。`
    }

    if (action === 'subscription.read' && operation === 'search_user') {
        const query = String(data.query || '').trim()
        const candidates = Array.isArray(data.candidates) ? data.candidates : []
        const total = Number.isFinite(Number(data.counts?.total))
            ? Number(data.counts.total)
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

    if (action === 'approval.write') {
        const decision = data.operation === 'approve' ? '同意' : '拒绝'
        const status = data.status
        const shortId = data.shortId || data.target?.shortId || '未知编号'
        const pendingCount = Number.isFinite(Number(data.pendingCount))
            ? Number(data.pendingCount)
            : 0
        const wording = String(data.wording || '').trim()

        if (status === 'executed') {
            return wording
                ? `已${decision}审批请求 ${shortId}。剩余待处理：${pendingCount}。接口回执：${wording}`
                : `已${decision}审批请求 ${shortId}。剩余待处理：${pendingCount}。`
        }

        return shortId && shortId !== '未知编号'
            ? `审批操作未执行：${shortId}`
            : '审批操作未执行。'
    }

    return '已执行当前群管理操作。'
}

function buildRejectedBotControlReply() {
    return '已取消当前待确认操作。'
}

function renderLocalActionFinalReply(localAction) {
    if (!localAction || typeof localAction !== 'object') {
        return null
    }

    if (localAction.status === 'rejected') {
        return buildRejectedBotControlReply()
    }

    if (localAction.status === 'pending_confirmation') {
        return buildPendingBotControlReply(localAction)
    }

    return buildExecutedBotControlReply(localAction)
}

function finalizeAgentRunResult({ runResult, replyResult = null }) {
    if (!runResult || typeof runResult !== 'object') {
        throw new Error('runResult is required')
    }

    if (replyResult) {
        const steps = Array.isArray(replyResult.steps) ? replyResult.steps : []
        const toolCalls = Array.isArray(replyResult.toolCalls) ? replyResult.toolCalls : []
        const errors = Array.isArray(replyResult.errors) ? replyResult.errors : []

        runResult.steps.push(...steps)
        runResult.toolCalls.push(...toolCalls)
        runResult.errors.push(...errors)
        runResult.hasToolResult = replyResult.hasToolResult === true
        runResult.finalReply = replyResult.finalReply ?? null
    } else {
        const localAction = runResult.localActions[runResult.localActions.length - 1] || null
        runResult.finalReply = renderLocalActionFinalReply(localAction)
        runResult.hasToolResult = false

        if (localAction?.result && typeof localAction.result.mutation === 'boolean') {
            runResult.hasMutation = localAction.result.mutation
        }
    }

    runResult.stepCount = runResult.steps.length
    return runResult
}

module.exports = {
    renderLocalActionFinalReply,
    finalizeAgentRunResult
}
