function clampScore(value) {
    return Math.min(1, Math.max(0, Number(value) || 0))
}

function scoreMessage({ agentMessage, memoryObservation, actor }) {
    const reasons = []
    const penalties = []
    let score = 0

    if (agentMessage.mentionsSelf) {
        score += 0.45
        reasons.push('mentioned_bot')
    }

    if (agentMessage.aliasMatched) {
        score += 0.25
        reasons.push('alias_matched')
    }

    if (agentMessage.hasReply) {
        score += 0.12
        reasons.push('reply_segment')
    }

    const text = agentMessage.normalizedText || ''
    if (/订阅|配置|设置|开启|关闭|管理|权限|拉黑|黑名单/.test(text)) {
        score += 0.18
        reasons.push('bot_management_topic')
    }

    if (/\?|？|吗|么|怎么|如何|为什么/.test(text)) {
        score += 0.08
        reasons.push('question_like')
    }

    if (actor?.canManageGroupConfig || actor?.canManageSubscriptions) {
        score += 0.04
        reasons.push('privileged_actor')
    }

    if (memoryObservation?.chatPace?.crowded) {
        score -= 0.18
        penalties.push('crowded_chat')
    }

    if (text.length <= 2) {
        score -= 0.1
        penalties.push('too_short')
    }

    return {
        score: clampScore(score),
        reasons,
        penalties,
        components: {
            mentionsSelf: agentMessage.mentionsSelf,
            aliasMatched: agentMessage.aliasMatched,
            hasReply: agentMessage.hasReply,
            chatPace: memoryObservation?.chatPace || null
        }
    }
}

module.exports = {
    scoreMessage,
    clampScore
}
