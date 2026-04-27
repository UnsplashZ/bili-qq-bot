function safeArray(value) {
    return Array.isArray(value) ? value : []
}

function makeSpan(type, status = 'ok', reason = '', detail = {}) {
    return {
        type,
        status,
        reason,
        ...detail
    }
}

function guardrailStatus(guardrail) {
    if (!guardrail) return 'skipped'
    return guardrail.allowed === false ? 'blocked' : 'ok'
}

function summarizeLlmDecision(llmDecision = {}) {
    const decision = llmDecision.decision || {}
    return {
        action: decision.action || '',
        participationAction: decision.participation?.action || decision.action || '',
        targetMessageId: decision.targetMessageId || decision.participation?.targetMessageId || '',
        model: llmDecision.model || '',
        totalTokens: llmDecision.usage?.total_tokens ?? null
    }
}

function buildNativeTrajectorySpans(event = {}) {
    const spans = []
    const toolSource = event.toolPlanResult || event.toolConfirmation || null
    const toolPlan = toolSource?.plan || null

    spans.push(makeSpan('message_received', 'ok', '', {
        messageId: String(event.messageId || ''),
        groupId: String(event.groupId || ''),
        userId: String(event.userId || '')
    }))

    const inputGuardrail = event.inputGuardrail || (
        event.budgetDecision
            ? {
                allowed: event.budgetDecision.allowed !== false,
                reason: event.budgetDecision.reason || '',
                checks: [{
                    name: 'llm_budget',
                    passed: event.budgetDecision.allowed !== false,
                    reason: event.budgetDecision.reason || ''
                }]
            }
            : null
    )
    if (inputGuardrail) {
        spans.push(makeSpan('input_guardrail', guardrailStatus(inputGuardrail), inputGuardrail.reason, {
            checks: safeArray(inputGuardrail.checks)
        }))
    }

    if (event.topicId || Object.keys(event.messageTraits || event.score?.traits || {}).length > 0) {
        spans.push(makeSpan('context_selected', 'ok', '', {
            topicId: String(event.topicId || ''),
            traitCount: Object.keys(event.messageTraits || event.score?.traits || {}).length
        }))
    }

    if (event.timingDecision) {
        spans.push(makeSpan('timing_gate', event.timingDecision.timingAction || 'continue', event.timingDecision.reason || '', {
            waitMs: event.timingDecision.waitMs || 0,
            signals: event.timingDecision.signals || {}
        }))
    }

    if (event.llmDecision?.status) {
        spans.push(makeSpan(
            'llm_decision',
            event.llmDecision.status === 'ok' ? 'ok' : 'skipped',
            event.llmDecision.reason || '',
            summarizeLlmDecision(event.llmDecision)
        ))
    }

    if (event.decisionGuardrail) {
        spans.push(makeSpan('decision_guardrail', guardrailStatus(event.decisionGuardrail), event.decisionGuardrail.reason, {
            checks: safeArray(event.decisionGuardrail.checks)
        }))
    }

    if (toolSource) {
        spans.push(makeSpan('tool_plan', toolSource.status || 'ok', toolSource.reason || toolSource.error || '', {
            toolName: toolPlan?.name || '',
            risk: toolPlan?.risk || '',
            permission: toolPlan?.permission || ''
        }))
    }

    if (toolSource?.guardrailDecision) {
        spans.push(makeSpan('tool_guardrail', guardrailStatus(toolSource.guardrailDecision), toolSource.guardrailDecision.reason, {
            toolName: toolPlan?.name || '',
            checks: safeArray(toolSource.guardrailDecision.checks)
        }))
    }

    if (toolSource?.confirmation) {
        spans.push(makeSpan('tool_confirmation', toolSource.status || 'pending', toolSource.reason || '', {
            shortId: toolSource.confirmation.shortId || '',
            expiresAt: toolSource.confirmation.expiresAt || null
        }))
    }

    if (toolSource && ['executed', 'failed'].includes(toolSource.status)) {
        spans.push(makeSpan('tool_execute', toolSource.status === 'executed' ? 'ok' : 'failed', toolSource.error || toolSource.reason || '', {
            toolName: toolPlan?.name || '',
            resultMessage: toolSource.result?.message || ''
        }))
    }

    if (toolSource?.toolReplyDecision) {
        spans.push(makeSpan('tool_result_reply', toolSource.toolReplyDecision.status || 'skipped', toolSource.toolReplyDecision.reason || '', {
            action: toolSource.toolReplyDecision.decision?.action || '',
            model: toolSource.toolReplyDecision.model || ''
        }))
    }

    if (event.replyerResult) {
        spans.push(makeSpan('replyer', event.replyerResult.status || 'skipped', event.replyerResult.reason || '', {
            tone: event.replyerResult.output?.tone || '',
            confidence: event.replyerResult.output?.confidence ?? null,
            model: event.replyerResult.model || ''
        }))
    }

    const outputGuardrail = event.outputGuardrail || event.policyDecision?.outputGuardrail || null
    if (outputGuardrail) {
        spans.push(makeSpan('output_guardrail', guardrailStatus(outputGuardrail), outputGuardrail.reason, {
            checks: safeArray(outputGuardrail.checks)
        }))
    }

    if (event.execution) {
        spans.push(makeSpan('reply_sent', event.execution.executed ? 'ok' : 'skipped', event.execution.reason || '', {
            action: event.execution.action || ''
        }))
    }

    return spans
}

module.exports = {
    safeArray,
    makeSpan,
    guardrailStatus,
    buildNativeTrajectorySpans
}
