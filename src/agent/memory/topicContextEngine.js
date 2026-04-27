const crypto = require('crypto')

const CJK_WORD_RE = /[\u4e00-\u9fa5]{2,}|[a-zA-Z0-9_]{3,}/g
const URL_RE = /https?:\/\/[^\s]+/gi
const ENTITY_RE = /\b(?:BV[0-9A-Za-z]+|av\d+|uid\s*\d+|\d{5,})\b/gi

function extractKeywords(text) {
    const raw = String(text || '').toLowerCase()
    const matches = raw.match(CJK_WORD_RE) || []
    const urls = raw.match(URL_RE) || []
    const entities = raw.match(ENTITY_RE) || []
    return Array.from(new Set([...urls, ...entities, ...matches])).slice(0, 12)
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

    const replyMessageId = String(agentMessage.replyMessageId || agentMessage.replyTarget?.messageId || '')
    const replyTopic = replyMessageId
        ? [...activeTopics.values()].find((topic) => Array.isArray(topic.recentMessageIds) && topic.recentMessageIds.includes(replyMessageId))
        : null

    let bestTopic = replyTopic || null
    let bestScore = replyTopic ? 100 : 0
    for (const topic of activeTopics.values()) {
        if (now - topic.lastActiveAt > topicIdleMs) continue
        const overlap = keywords.filter((keyword) => topic.keywords.includes(keyword)).length
        const participantOverlap = topic.participants?.has(agentMessage.userId) ? 0.3 : 0
        const assistantOverlap = agentMessage.replyToSelf && topic.lastAssistantMessageId ? 0.8 : 0
        const ageRatio = Math.max(0, 1 - ((now - topic.lastActiveAt) / topicIdleMs))
        const score = overlap * 0.7 + participantOverlap + assistantOverlap + ageRatio * 0.2
        if (score > bestScore) {
            bestScore = score
            bestTopic = topic
        }
    }

    const topic = bestTopic || {
        topicId: topicIdFromKeywords(agentMessage.groupId, keywords),
        keywords,
        participants: new Set(),
        recentMessageIds: [],
        assistantMessageIds: [],
        lastAssistantMessageId: '',
        summary: keywords.length > 0 ? keywords.join(' / ') : 'general',
        createdAt: now,
        lastActiveAt: now,
        messageCount: 0,
        confidence: bestTopic ? Math.min(1, bestScore) : 0.5,
        status: 'active'
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
    const role = agentMessage.role || (agentMessage.selfId && String(agentMessage.userId) === String(agentMessage.selfId) ? 'assistant' : 'user')
    if (role === 'assistant') {
        topic.assistantMessageIds.push(agentMessage.id)
        topic.assistantMessageIds = topic.assistantMessageIds.slice(-10)
        topic.lastAssistantMessageId = agentMessage.id
    }
    topic.lastActiveAt = now
    topic.messageCount += 1
    topic.confidence = Math.min(1, Math.max(Number(topic.confidence || 0), bestScore || topic.confidence || 0.5))
    topic.status = 'active'

    return topic
}

function serializeTopic(topic) {
    if (!topic) return null
    return {
        topicId: topic.topicId,
        keywords: [...topic.keywords],
        participants: [...topic.participants],
        recentMessageIds: [...topic.recentMessageIds],
        assistantMessageIds: [...(topic.assistantMessageIds || [])],
        lastAssistantMessageId: topic.lastAssistantMessageId || '',
        summary: topic.summary,
        createdAt: topic.createdAt,
        lastActiveAt: topic.lastActiveAt,
        messageCount: topic.messageCount,
        confidence: topic.confidence || 0,
        status: topic.status || 'active'
    }
}

module.exports = {
    extractKeywords,
    resolveTopic,
    serializeTopic
}
