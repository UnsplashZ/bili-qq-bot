function validateDecisionPolicy({ agentConfig, llmDecision, messageTraits }) {
    if (!llmDecision || llmDecision.status !== 'ok' || !llmDecision.decision) {
        return {
            accepted: false,
            finalAction: 'observe_only',
            reason: llmDecision?.reason || llmDecision?.status || 'llm_decision_unavailable',
            wouldSend: false
        }
    }

    const decision = llmDecision.decision
    if (agentConfig.observeOnly) {
        return {
            accepted: false,
            finalAction: 'observe_only',
            reason: 'observe_only_enabled',
            llmAction: decision.action,
            wouldSend: false
        }
    }

    if (!agentConfig.sendEnabled) {
        return {
            accepted: false,
            finalAction: 'observe_only',
            reason: 'send_disabled',
            llmAction: decision.action,
            wouldSend: false
        }
    }

    if (agentConfig.decisionMode !== 'llm_live') {
        return {
            accepted: false,
            finalAction: 'observe_only',
            reason: 'decision_mode_not_live',
            llmAction: decision.action,
            wouldSend: false
        }
    }

    if (!['short_reply', 'ask_clarify'].includes(decision.action)) {
        return {
            accepted: false,
            finalAction: decision.action,
            reason: 'action_not_sendable_yet',
            llmAction: decision.action,
            wouldSend: false
        }
    }

    if (decision.confidence < 0.85) {
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

    if (!(messageTraits.mentionedBot || messageTraits.replyToBot || messageTraits.aliasMatched)) {
        return {
            accepted: false,
            finalAction: 'observe_only',
            reason: 'not_directly_addressed',
            llmAction: decision.action,
            wouldSend: false
        }
    }

    return {
        accepted: true,
        finalAction: decision.action,
        reason: 'accepted',
        llmAction: decision.action,
        wouldSend: true
    }
}

module.exports = {
    validateDecisionPolicy
}
