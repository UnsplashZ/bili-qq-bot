function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim()
}

function includesAny(text, patterns) {
    return patterns.some((pattern) => pattern.test(text))
}

function scoreReplyEffect({ pendingReply, agentMessage, memoryObservation } = {}) {
    if (!pendingReply || !agentMessage) return null
    const text = normalizeText(agentMessage.normalizedText || agentMessage.rawText || '')
    if (!text) return null
    const targetUserResponded = String(agentMessage.userId || '') === String(pendingReply.targetUserId || '')
    const positiveFeedback = includesAny(text, [/谢谢|感谢|懂了|可以|有用|ok|好的|明白|牛/i])
    const correction = includesAny(text, [/不是|不对|你没懂|我说的是|不是这个意思|错了|理解错/i])
    const explicitNegative = includesAny(text, [/烦|闭嘴|别说|尬|无语|吵|滚/i])
    const sameTopic = Boolean(memoryObservation?.topicSnapshot?.topicId && memoryObservation.topicSnapshot.topicId === pendingReply.topicId)
    const continuedConversation = sameTopic || targetUserResponded || Boolean(agentMessage.replyTarget?.isBot)
    const topicDerailment = !sameTopic && !targetUserResponded && !positiveFeedback && text.length > 8

    let score = 0
    if (continuedConversation) score += 0.25
    if (targetUserResponded) score += 0.25
    if (positiveFeedback) score += 0.35
    if (correction) score -= 0.45
    if (explicitNegative) score -= 0.6
    if (topicDerailment && pendingReply.action === 'react') score -= 0.2

    let label = score >= 0.35 ? 'positive' : score <= -0.25 ? 'negative' : 'neutral'
    if (correction || explicitNegative) label = 'negative'
    else if (positiveFeedback) label = 'positive'
    return {
        status: 'ok',
        label,
        score: Math.max(-1, Math.min(1, score)),
        signals: {
            continuedConversation,
            targetUserResponded,
            positiveFeedback,
            correction,
            explicitNegative,
            topicDerailment,
            silenceAfterReply: false
        },
        observedMessageId: agentMessage.id || '',
        observedTextPreview: text.slice(0, 120)
    }
}

module.exports = {
    scoreReplyEffect
}
