function validateDecisionPolicy({ agentConfig, llmDecision, messageTraits, replyGuardDecision }) {
    const decision = llmDecision?.decision || null
    const directlyAddressed = Boolean(messageTraits.mentionedBot || messageTraits.replyToBot || messageTraits.aliasMatched)

    if (agentConfig.observeOnly) {
        return {
            accepted: false,
            finalAction: 'observe_only',
            reason: 'observe_only_enabled',
            llmAction: decision?.action || '',
            wouldSend: false
        }
    }

    if (!agentConfig.sendEnabled) {
        return {
            accepted: false,
            finalAction: 'observe_only',
            reason: 'send_disabled',
            llmAction: decision?.action || '',
            wouldSend: false
        }
    }

    if (agentConfig.decisionMode !== 'llm_live') {
        return {
            accepted: false,
            finalAction: 'observe_only',
            reason: 'decision_mode_not_live',
            llmAction: decision?.action || '',
            wouldSend: false
        }
    }

    if (!llmDecision || !decision) {
        return {
            accepted: false,
            finalAction: 'observe_only',
            reason: llmDecision?.reason || llmDecision?.status || 'llm_decision_unavailable',
            wouldSend: false
        }
    }

    if (llmDecision.status !== 'ok') {
        const fallbackSendable = directlyAddressed &&
            ['short_reply', 'full_reply', 'ask_clarify'].includes(decision.action) &&
            Boolean(decision.replyDraft)

        if (!fallbackSendable) {
            return {
                accepted: false,
                finalAction: 'observe_only',
                reason: llmDecision.reason || llmDecision.status || 'llm_decision_unavailable',
                llmAction: decision.action,
                wouldSend: false
            }
        }

        if (replyGuardDecision && replyGuardDecision.allowed === false) {
            return {
                accepted: false,
                finalAction: 'observe_only',
                reason: replyGuardDecision.reason,
                llmAction: decision.action,
                wouldSend: false,
                replyGuardDecision
            }
        }

        return {
            accepted: true,
            finalAction: decision.action,
            reason: `llm_fallback:${llmDecision.reason || llmDecision.status}`,
            llmAction: decision.action,
            replyDraft: decision.replyDraft,
            wouldSend: true,
            replyGuardDecision
        }
    }

    if (decision.action === 'observe_only' || decision.action === 'defer') {
        return {
            accepted: false,
            finalAction: decision.action,
            reason: `llm_action_${decision.action}`,
            llmAction: decision.action,
            wouldSend: false
        }
    }

    if (decision.action === 'react_only' || decision.action === 'tool_plan') {
        if (replyGuardDecision && replyGuardDecision.allowed === false) {
            return {
                accepted: false,
                finalAction: 'observe_only',
                reason: replyGuardDecision.reason,
                llmAction: decision.action,
                wouldSend: false,
                replyGuardDecision
            }
        }
        if (directlyAddressed && decision.replyDraft) {
            return {
                accepted: true,
                finalAction: 'short_reply',
                reason: `${decision.action}_reply_downgraded`,
                llmAction: decision.action,
                replyDraft: decision.replyDraft,
                wouldSend: true,
                replyGuardDecision
            }
        }
        return {
            accepted: false,
            finalAction: decision.action,
            reason: 'action_not_enabled_in_phase2',
            llmAction: decision.action,
            wouldSend: false
        }
    }

    if (!['short_reply', 'full_reply', 'ask_clarify'].includes(decision.action)) {
        return {
            accepted: false,
            finalAction: decision.action,
            reason: 'action_not_sendable_yet',
            llmAction: decision.action,
            wouldSend: false
        }
    }

    const minConfidence = directlyAddressed ? 0 : Number(agentConfig.replyPolicy?.minReplyScore ?? 0.65)
    if (decision.confidence < minConfidence) {
        return {
            accepted: false,
            finalAction: 'observe_only',
            reason: 'confidence_below_send_threshold',
            llmAction: decision.action,
            wouldSend: false
        }
    }

    if (!decision.replyDraft) {
        return {
            accepted: false,
            finalAction: 'observe_only',
            reason: 'empty_reply_draft',
            llmAction: decision.action,
            wouldSend: false
        }
    }

    if (replyGuardDecision && replyGuardDecision.allowed === false) {
        return {
            accepted: false,
            finalAction: 'observe_only',
            reason: replyGuardDecision.reason,
            llmAction: decision.action,
            wouldSend: false,
            replyGuardDecision
        }
    }

    return {
        accepted: true,
        finalAction: decision.action,
        reason: 'accepted',
        llmAction: decision.action,
        wouldSend: true,
        replyGuardDecision
    }
}

module.exports = {
    validateDecisionPolicy
}
