function clamp(value) {
    return Math.min(1, Math.max(0, Number(value) || 0))
}

function hasTopicAffinity(text) {
    return /番|动画|漫画|b站|bilibili|视频|直播|截图|网页|游戏|模型|agent|bot|小助手|助手|机器人|拟人化|人格|功能|规则|回复|说话|插话|记忆|上下文|配置|开关|llm|prompt/i.test(String(text || ''))
}

function isRapidTwoPersonChat(memoryObservation = {}, agentMessage = {}) {
    const messages = Array.isArray(memoryObservation?.groupState?.recentMessages)
        ? memoryObservation.groupState.recentMessages
        : []
    const now = Number(agentMessage.timestamp || Date.now())
    const recent = messages.filter((message) => now - Number(message.timestamp || 0) <= 20 * 1000)
    const users = new Set(recent.map((message) => String(message.userId || '')).filter(Boolean))
    return recent.length >= 4 && users.size === 2 && !agentMessage.mentionsSelf && !agentMessage.replyToSelf && !agentMessage.aliasMatched
}

function scoreSocialInterject({ agentConfig = {}, agentMessage = {}, memoryObservation = {}, scoreResult = {} } = {}) {
    const text = agentMessage.normalizedText || agentMessage.rawText || ''
    const traits = scoreResult.traits || {}
    const rapidTwoPersonChat = isRapidTwoPersonChat(memoryObservation, agentMessage)
    const shouldAvoidRapidChat = agentConfig.social?.avoidDuringRapidTwoPersonChat !== false
    const topicAffinity = hasTopicAffinity(text) ? 0.9 : 0.2
    const conversationalOpening = traits.questionLike ? 0.4 : 0.65
    const botRelevance = (traits.mentionedBot || traits.replyToBot || traits.aliasMatched) ? 1 : topicAffinity
    const novelty = String(text).replace(/\s+/g, '').length >= 8 ? 0.55 : 0.1
    const crowdedPenalty = traits.crowdedChat ? 0.3 : 0
    const interruptionRisk = shouldAvoidRapidChat && rapidTwoPersonChat ? 0.9 : 0.15
    const recentBotSpeechPenalty = memoryObservation?.groupState?.recentMessages?.slice(-3).some((message) => message.role === 'assistant') ? 0.35 : 0

    const raw = topicAffinity * 0.3 +
        conversationalOpening * 0.2 +
        0.1 +
        botRelevance * 0.2 +
        novelty * 0.1 -
        interruptionRisk * 0.3 -
        crowdedPenalty * 0.2 -
        recentBotSpeechPenalty * 0.4

    const score = clamp(raw)
    return {
        score,
        topicAffinity,
        conversationalOpening,
        botRelevance,
        novelty,
        interruptionRisk,
        crowdedPenalty,
        recentBotSpeechPenalty,
        rapidTwoPersonChat,
        enabled: Boolean(agentConfig.social?.enabled)
    }
}

module.exports = {
    scoreSocialInterject,
    isRapidTwoPersonChat
}
