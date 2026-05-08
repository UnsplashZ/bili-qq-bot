const replyEffectStore = require('./replyEffectStore')
const { scoreReplyEffect } = require('./replyEffectScorer')
const expressionStore = require('../expression/expressionStore')

async function observeReplyEffect({ agentConfig, agentMessage, memoryObservation } = {}) {
    if (agentConfig?.participation?.enabled === false) return { status: 'skipped', reason: 'participation_disabled' }
    if (agentConfig?.participation?.replyEffectTrackingEnabled !== true) return { status: 'skipped', reason: 'reply_effect_disabled' }
    const pending = replyEffectStore.consumePending(agentMessage?.groupId)
    if (!pending) return { status: 'skipped', reason: 'no_pending_reply' }
    if (String(agentMessage?.userId || '') === String(agentMessage?.selfId || '')) return { status: 'skipped', reason: 'self_message' }

    const effect = scoreReplyEffect({ pendingReply: pending, agentMessage, memoryObservation })
    if (!effect) return { status: 'skipped', reason: 'effect_unavailable' }
    const record = replyEffectStore.recordEffect({
        ...pending,
        ...effect,
        observedAt: new Date().toISOString()
    })
    let expressionAdjustment = { adjusted: 0 }
    if (pending.expressionIds.length > 0) {
        const delta = effect.label === 'positive' ? 0.03 : (effect.label === 'negative' ? -0.08 : 0)
        if (delta !== 0) {
            expressionAdjustment = await expressionStore.adjustExpressionConfidence({
                ids: pending.expressionIds,
                delta,
                reason: `reply_effect_${effect.label}`
            })
        }
    }
    return {
        status: 'ok',
        reason: '',
        effect: record,
        expressionAdjustment
    }
}

function trackSentReply({ agentConfig, groupId, userId, messageId, topicId, policyDecision, replyerResult, timestamp = Date.now() } = {}) {
    if (agentConfig?.participation?.enabled === false) return null
    if (agentConfig?.participation?.replyEffectTrackingEnabled !== true) return null
    if (!policyDecision?.accepted || !policyDecision?.wouldSend) return null
    return replyEffectStore.trackPendingReply({
        groupId,
        userId,
        messageId,
        topicId,
        action: policyDecision.finalAction,
        text: policyDecision.replyDraft || '',
        expressionIds: Array.isArray(replyerResult?.expressionHints)
            ? replyerResult.expressionHints.map((item) => item.id).filter(Boolean)
            : [],
        timestamp
    })
}

module.exports = {
    observeReplyEffect,
    trackSentReply
}
