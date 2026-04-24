const crypto = require('crypto')

const CJK_WORD_RE = /[\u4e00-\u9fa5]{2,}|[a-zA-Z0-9_]{3,}/g

function extractKeywords(text) {
    const matches = String(text || '').toLowerCase().match(CJK_WORD_RE) || []
    return Array.from(new Set(matches)).slice(0, 8)
}

function topicIdFromKeywords(groupId, keywords) {
    const base = keywords.length > 0 ? keywords.slice(0, 3).join('|') : 'general'
    const hash = crypto.createHash('sha1').update(`${groupId}:${base}`).digest('hex').slice(0, 10)
    return `topic_${hash}`
}

function resolveTopic(groupState, agentMessage, options = {}) {
    const now = agentMessage.timestamp || Date.now()
    const topicIdleMs = options.topicIdleMs || 30 * 60 * 1000
    const keywords = extractKeywords(agentMessage.normalizedText || agentMessage.rawText)
    const activeTopics = groupState.activeTopics || new Map()

    let bestTopic = null
    let bestOverlap = 0
    for (const topic of activeTopics.values()) {
        if (now - topic.lastActiveAt > topicIdleMs) continue
        const overlap = keywords.filter((keyword) => topic.keywords.includes(keyword)).length
        if (overlap > bestOverlap) {
            bestOverlap = overlap
            bestTopic = topic
        }
    }

    const topic = bestTopic || {
        topicId: topicIdFromKeywords(agentMessage.groupId, keywords),
        keywords,
        participants: new Set(),
        recentMessageIds: [],
        summary: keywords.length > 0 ? keywords.join(' / ') : 'general',
        createdAt: now,
        lastActiveAt: now,
        messageCount: 0
    }

    if (!activeTopics.has(topic.topicId)) {
        activeTopics.set(topic.topicId, topic)
    }

    keywords.forEach((keyword) => {
        if (!topic.keywords.includes(keyword)) topic.keywords.push(keyword)
    })
    topic.keywords = topic.keywords.slice(0, 12)
    topic.participants.add(agentMessage.userId)
    topic.recentMessageIds.push(agentMessage.id)
    topic.recentMessageIds = topic.recentMessageIds.slice(-20)
    topic.lastActiveAt = now
    topic.messageCount += 1

    return topic
}

function serializeTopic(topic) {
    if (!topic) return null
    return {
        topicId: topic.topicId,
        keywords: [...topic.keywords],
        participants: [...topic.participants],
        recentMessageIds: [...topic.recentMessageIds],
        summary: topic.summary,
        createdAt: topic.createdAt,
        lastActiveAt: topic.lastActiveAt,
        messageCount: topic.messageCount
    }
}

module.exports = {
    extractKeywords,
    resolveTopic,
    serializeTopic
}
