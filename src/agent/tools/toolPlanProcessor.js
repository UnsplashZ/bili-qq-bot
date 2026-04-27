const logger = require('../../utils/logger')
const { normalizeToolIntent, executeToolPlan } = require('./registry')
const { evaluateToolGuardrails } = require('./toolGuardrails')
const confirmationStore = require('./confirmationStore')
const { recordToolAudit } = require('./auditLog')

function makeReplyDecision(replyDraft, reason = 'tool_plan_processed', messageChain = null) {
    return {
        action: 'short_reply',
        confidence: 1,
        reason,
        topic: 'tool_management',
        replyStyle: 'serious',
        replyDraft: String(replyDraft || '').trim(),
        memoryHints: [],
        toolIntent: null,
        messageChain: Array.isArray(messageChain) && messageChain.length > 0 ? messageChain : null
    }
}

function toolsEnabled(agentConfig) {
    return Boolean(agentConfig?.tools?.enabled)
}

function toolRuntimeReady(agentConfig) {
    if (agentConfig?.decisionMode !== 'llm_live') return { ready: false, reason: 'decision_mode_not_live' }
    return { ready: true, reason: 'ready' }
}

function requiresConfirmation(plan, agentConfig) {
    const risks = Array.isArray(agentConfig?.tools?.requireConfirmationFor)
        ? agentConfig.tools.requireConfirmationFor
        : ['medium', 'high']
    return risks.includes(plan.risk)
}

function formatDenied(reason) {
    const messages = {
        missing_tool_intent: '我识别到这是管理操作，但没有拿到可执行的工具计划。',
        global_tool_requires_root: '这个操作需要全局管理员权限。',
        global_config_permission_denied: '这个全局配置操作需要 Root 权限。',
        group_config_permission_denied: '这个群配置操作需要群主、群管理员或已配置的群管理员权限。',
        subscription_permission_denied: '订阅管理需要群主、群管理员或已配置的群管理员权限。',
        qq_manager_permission_denied: 'QQ 群管理操作需要群主或群管理员权限。',
        qq_account_requires_root: 'QQ 账号级操作需要 Root 权限。',
        cross_group_permission_denied: '你只能管理当前群；跨群操作需要 Root 权限。',
        invalid_target_user_id: '这个操作需要明确的目标 QQ 号，请回复目标消息或提供 QQ 号。',
        missing_message_id: '这个操作需要明确的目标消息，请回复要处理的消息后再试。',
        missing_approval_target: '这个审批操作需要申请短码，或回复对应的申请通知。'
    }
    return messages[reason] || `这个工具计划没有执行：${reason}`
}

function formatToolError(errorMessage) {
    const normalized = String(errorMessage || '')
    if (normalized.includes('screenshot_access_blocked')) {
        return '网页截图被站点安全验证拦截，不能发送有效截图；可以改为读取网页正文并总结。'
    }
    if (normalized.includes('screenshot_page_blank')) {
        return '网页截图结果为空白，不能发送无效截图；可以换链接或改为读取网页正文。'
    }
    return `工具执行失败：${normalized}`
}

async function executePlanWithAudit({ plan, sessionContext, actor, traceScope }) {
    await recordToolAudit({
        event: 'tool_execute_start',
        traceScope,
        groupId: sessionContext.groupId,
        userId: sessionContext.userId,
        actor,
        plan
    })
    try {
        const result = await executeToolPlan(plan, {
            ws: sessionContext.ws,
            selfId: sessionContext.selfId,
            groupId: sessionContext.groupId,
            userId: sessionContext.userId,
            actor,
            agentMessage: sessionContext.agentMessage,
            replyTarget: sessionContext.replyTarget,
            traceScope
        })
        await recordToolAudit({
            event: 'tool_execute_done',
            traceScope,
            groupId: sessionContext.groupId,
            userId: sessionContext.userId,
            plan,
            result
        })
        return {
            status: 'executed',
            plan,
            result,
            decisionOverride: makeReplyDecision(result.message || '操作已完成。', 'tool_executed', result.messageChain)
        }
    } catch (error) {
        const errorMessage = logger.getErrorMessage(error)
        await recordToolAudit({
            event: 'tool_execute_failed',
            traceScope,
            groupId: sessionContext.groupId,
            userId: sessionContext.userId,
            plan,
            error: errorMessage
        })
        return {
            status: 'failed',
            plan,
            error: errorMessage,
            decisionOverride: makeReplyDecision(formatToolError(errorMessage), 'tool_execute_failed')
        }
    }
}

async function processToolPlan({ decision, agentConfig, sessionContext }) {
    if (decision?.action !== 'tool_plan') return null

    const traceScope = sessionContext?.traceScope || ''
    if (!toolsEnabled(agentConfig)) {
        return {
            status: 'disabled',
            decisionOverride: makeReplyDecision('受限工具功能还没开启，我只能说明计划，不能执行。', 'tools_disabled')
        }
    }
    const runtime = toolRuntimeReady(agentConfig)
    if (!runtime.ready) {
        return {
            status: 'disabled',
            reason: runtime.reason,
            decisionOverride: makeReplyDecision(`受限工具暂不可执行：${runtime.reason}`, 'tools_runtime_disabled')
        }
    }

    let plan
    try {
        plan = normalizeToolIntent(decision.toolIntent, sessionContext)
    } catch (error) {
        const reason = logger.getErrorMessage(error)
        await recordToolAudit({
            event: 'tool_plan_invalid',
            traceScope,
            groupId: sessionContext.groupId,
            userId: sessionContext.userId,
            reason,
            toolIntent: decision.toolIntent
        })
        return {
            status: 'invalid',
            reason,
            decisionOverride: makeReplyDecision(formatDenied(reason), 'tool_plan_invalid')
        }
    }

    const actor = sessionContext.actor
    const guardrailDecision = evaluateToolGuardrails({ plan, actor })
    if (!guardrailDecision.allowed) {
        await recordToolAudit({
            event: 'tool_guardrail_denied',
            traceScope,
            groupId: sessionContext.groupId,
            userId: sessionContext.userId,
            actor,
            plan,
            reason: guardrailDecision.reason,
            guardrailDecision
        })
        return {
            status: 'denied',
            plan,
            permission: guardrailDecision.permission,
            guardrailDecision,
            decisionOverride: makeReplyDecision(formatDenied(guardrailDecision.reason), 'tool_guardrail_denied')
        }
    }

    if (requiresConfirmation(plan, agentConfig)) {
        const confirmation = confirmationStore.createConfirmation({
            plan,
            sessionContext,
            ttlMs: agentConfig.tools.confirmationTtlMs
        })
        await recordToolAudit({
            event: 'tool_confirmation_requested',
            traceScope,
            groupId: sessionContext.groupId,
            userId: sessionContext.userId,
            actor,
            plan,
            guardrailDecision,
            confirmationId: confirmation.id
        })
        return {
            status: 'confirmation_required',
            plan,
            guardrailDecision,
            confirmation,
            decisionOverride: makeReplyDecision(`需要你确认后再执行：${plan.summary}\n请 @我回复「确认 ${confirmation.shortId}」执行，或回复「取消 ${confirmation.shortId}」。`, 'tool_confirmation_required')
        }
    }

    const execution = await executePlanWithAudit({ plan, sessionContext, actor, traceScope })
    return {
        ...execution,
        guardrailDecision
    }
}

async function tryConsumeToolConfirmation({ agentMessage, agentConfig, sessionContext }) {
    if (!toolsEnabled(agentConfig)) return null
    const consumed = confirmationStore.consumeConfirmation({
        sessionContext,
        agentMessage,
        text: agentMessage?.normalizedText || agentMessage?.rawText || ''
    })
    if (!consumed.consumed) {
        const text = agentMessage?.normalizedText || agentMessage?.rawText || ''
        if (
            consumed.pending &&
            confirmationStore.includesShortId(text, consumed.pending.shortId)
        ) {
            await recordToolAudit({
                event: 'tool_confirmation_unrecognized',
                traceScope: sessionContext?.traceScope || '',
                groupId: sessionContext.groupId,
                userId: sessionContext.userId,
                plan: consumed.pending.plan,
                confirmationId: consumed.pending.id,
                shortId: consumed.pending.shortId,
                reason: consumed.action
            })
            return {
                status: 'pending',
                plan: consumed.pending.plan,
                reason: consumed.action,
                decisionOverride: makeReplyDecision(
                    `确认码 ${consumed.pending.shortId} 还在等待处理。请回复「确认 ${consumed.pending.shortId}」执行，或回复「取消 ${consumed.pending.shortId}」。`,
                    'tool_confirmation_unrecognized'
                )
            }
        }
        return null
    }

    const traceScope = sessionContext?.traceScope || ''
    const actor = sessionContext.actor
    const runtime = toolRuntimeReady(agentConfig)
    if (!runtime.ready) {
        await recordToolAudit({
            event: 'tool_confirmation_runtime_denied',
            traceScope,
            groupId: sessionContext.groupId,
            userId: sessionContext.userId,
            actor,
            plan: consumed.pending.plan,
            reason: runtime.reason
        })
        return {
            status: 'disabled',
            plan: consumed.pending.plan,
            reason: runtime.reason,
            decisionOverride: makeReplyDecision(`受限工具暂不可执行：${runtime.reason}`, 'tools_runtime_disabled')
        }
    }
    if (consumed.action === 'cancel') {
        await recordToolAudit({
            event: 'tool_confirmation_cancelled',
            traceScope,
            groupId: sessionContext.groupId,
            userId: sessionContext.userId,
            actor,
            plan: consumed.pending.plan
        })
        return {
            status: 'cancelled',
            plan: consumed.pending.plan,
            decisionOverride: makeReplyDecision(`已取消：${consumed.pending.plan.summary}`, 'tool_confirmation_cancelled')
        }
    }

    const guardrailDecision = evaluateToolGuardrails({ plan: consumed.pending.plan, actor })
    if (!guardrailDecision.allowed) {
        await recordToolAudit({
            event: 'tool_confirmation_guardrail_denied',
            traceScope,
            groupId: sessionContext.groupId,
            userId: sessionContext.userId,
            actor,
            plan: consumed.pending.plan,
            reason: guardrailDecision.reason,
            guardrailDecision
        })
        return {
            status: 'denied',
            plan: consumed.pending.plan,
            permission: guardrailDecision.permission,
            guardrailDecision,
            decisionOverride: makeReplyDecision(formatDenied(guardrailDecision.reason), 'tool_guardrail_denied')
        }
    }

    const execution = await executePlanWithAudit({
        plan: consumed.pending.plan,
        sessionContext,
        actor,
        traceScope
    })
    return {
        ...execution,
        guardrailDecision
    }
}

module.exports = {
    processToolPlan,
    tryConsumeToolConfirmation,
    makeReplyDecision,
    formatToolError
}
