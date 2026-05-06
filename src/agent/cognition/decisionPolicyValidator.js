function validateDecisionPolicy({ agentConfig, llmDecision, messageTraits, replyGuardDecision }) {
    const decision = llmDecision?.decision || null
    const directlyAddressed = Boolean(messageTraits.mentionedBot || messageTraits.replyToBot || messageTraits.aliasMatched)

    if (agentConfig.observeOnly) {
        return {
            accepted: false,
            finalAction: 'listen',
            reason: 'observe_only_enabled',
            llmAction: decision?.action || '',
            wouldSend: false
        }
    }

    if (!agentConfig.sendEnabled) {
        return {
            accepted: false,
            finalAction: 'listen',
            reason: 'send_disabled',
            llmAction: decision?.action || '',
            wouldSend: false
        }
    }

    if (agentConfig.decisionMode !== 'llm_live') {
        return {
            accepted: false,
            finalAction: 'listen',
            reason: 'decision_mode_not_live',
            llmAction: decision?.action || '',
            wouldSend: false
        }
    }

    if (!llmDecision || !decision) {
        return {
            accepted: false,
            finalAction: 'listen',
            reason: llmDecision?.reason || llmDecision?.status || 'llm_decision_unavailable',
            wouldSend: false
        }
    }

    if (llmDecision.status !== 'ok') {
        const fallbackSendable = directlyAddressed && decision.action === 'reply' && Boolean(decision.replyDraft)
        if (!fallbackSendable) {
            return {
                accepted: false,
                finalAction: 'listen',
                reason: llmDecision.reason || llmDecision.status || 'llm_decision_unavailable',
                llmAction: decision.action,
                wouldSend: false
            }
        }
        if (replyGuardDecision && replyGuardDecision.allowed === false) {
            return {
                accepted: false,
                finalAction: 'listen',
                reason: replyGuardDecision.reason,
                llmAction: decision.action,
                wouldSend: false,
                replyGuardDecision
            }
        }
        return {
            accepted: true,
            finalAction: 'reply',
            reason: `llm_fallback:${llmDecision.reason || llmDecision.status}`,
            llmAction: decision.action,
            replyDraft: decision.replyDraft,
            wouldSend: true,
            replyGuardDecision
        }
    }

    if (decision.action === 'listen' || decision.action === 'wait') {
        if (directlyAddressed) {
            return {
                accepted: true,
                finalAction: 'reply',
                reason: `${decision.action}_direct_reply_forced`,
                llmAction: decision.action,
                replyDraft: decision.replyDraft,
                wouldSend: true,
                replyGuardDecision
            }
        }
        return {
            accepted: false,
            finalAction: decision.action,
            reason: `planner_action_${decision.action}`,
            llmAction: decision.action,
            wouldSend: false
        }
    }

    if (decision.action === 'act') {
        return {
            accepted: false,
            finalAction: 'act',
            reason: 'tool_action_processed_before_reply_policy',
            llmAction: decision.action,
            wouldSend: false
        }
    }

    if (decision.action === 'react') {
        if (decision.toolIntent) {
            return {
                accepted: false,
                finalAction: 'listen',
                reason: 'react_action_with_tool_intent',
                llmAction: decision.action,
                wouldSend: false
            }
        }
        if (directlyAddressed) {
            return {
                accepted: true,
                finalAction: 'reply',
                reason: 'react_direct_reply_upgraded',
                llmAction: decision.action,
                replyDraft: decision.replyDraft,
                wouldSend: true,
                replyGuardDecision
            }
        }
        if (!agentConfig.social?.enabled || agentConfig.social?.mode === 'quiet') {
            return {
                accepted: false,
                finalAction: 'listen',
                reason: 'social_disabled',
                llmAction: decision.action,
                wouldSend: false
            }
        }
        if (replyGuardDecision && replyGuardDecision.allowed === false) {
            return {
                accepted: false,
                finalAction: 'listen',
                reason: replyGuardDecision.reason,
                llmAction: decision.action,
                wouldSend: false,
                replyGuardDecision
            }
        }
        return {
            accepted: true,
            finalAction: 'react',
            reason: 'react_accepted',
            llmAction: decision.action,
            replyDraft: decision.replyDraft,
            wouldSend: true,
            replyGuardDecision
        }
    }

    if (decision.action !== 'reply') {
        return {
            accepted: false,
            finalAction: decision.action,
            reason: 'unknown_participation_action',
            llmAction: decision.action,
            wouldSend: false
        }
    }

    const minConfidence = directlyAddressed ? 0 : Number(agentConfig.replyPolicy?.minReplyScore ?? 0.65)
    if (decision.confidence < minConfidence) {
        return {
            accepted: false,
            finalAction: 'listen',
            reason: 'confidence_below_send_threshold',
            llmAction: decision.action,
            wouldSend: false
        }
    }

    if (replyGuardDecision && replyGuardDecision.allowed === false) {
        return {
            accepted: false,
            finalAction: 'listen',
            reason: replyGuardDecision.reason,
            llmAction: decision.action,
            wouldSend: false,
            replyGuardDecision
        }
    }

    return {
        accepted: true,
        finalAction: 'reply',
        reason: 'accepted',
        llmAction: decision.action,
        replyDraft: decision.replyDraft,
        wouldSend: true,
        replyGuardDecision
    }
}

module.exports = {
    validateDecisionPolicy
}
