const { extractKeywords } = require('./topicContextEngine')

function buildQueryTerms(text) {
    const whitespaceWords = String(text || '').toLowerCase().split(/\s+/).filter((word) => word.length >= 2)
    return Array.from(new Set([...whitespaceWords, ...extractKeywords(text)]))
}

function hasQueryMatch(memory, queryTerms) {
    if (!Array.isArray(queryTerms) || queryTerms.length === 0) return false
    const content = String(memory?.content || '').toLowerCase()
    return queryTerms.some((word) => content.includes(word))
}

function isMemoryVisible(memory, { groupId, userId, topicId, queryTerms }) {
    if (!memory) return false
    if (memory.scope === 'global') return true
    if (memory.scope === 'group') return memory.groupId === groupId
    if (memory.scope === 'user') return memory.groupId === groupId && memory.userId === userId
    if (memory.scope === 'topic') {
        if (memory.groupId !== groupId) return false
        if (topicId && memory.topicId === topicId) return true
        return hasQueryMatch(memory, queryTerms)
    }
    return false
}

function scoreMemory(memory, { groupId, userId, topicId, queryTerms }) {
    let score = 0
    if (memory.scope === 'global') score += 0.2
    if (memory.scope === 'group' && memory.groupId === groupId) score += 0.7
    if (memory.scope === 'user' && memory.groupId === groupId && memory.userId === userId) score += 0.8
    if (memory.scope === 'topic' && memory.groupId === groupId) {
        score += topicId && memory.topicId === topicId ? 0.75 : 0.15
    }

    const content = String(memory.content || '').toLowerCase()
    const matches = queryTerms.filter((word) => content.includes(word)).length
    score += Math.min(0.35, matches * 0.1)
    score += Math.min(0.2, Number(memory.confidence) || 0)
    score += Math.min(0.1, Number(memory.importance) || 0)
    return score
}

function selectRelevantMemories({ memories, groupId, userId, topicId = '', text = '', limit = 5, timestamp = Date.now(), isExpired }) {
    const queryTerms = buildQueryTerms(text)
    const maxItems = Math.max(0, Number(limit) || 0)
    if (!Array.isArray(memories) || maxItems === 0) return []

    return memories
        .filter((memory) => !(typeof isExpired === 'function' && isExpired(memory, timestamp)))
        .filter((memory) => isMemoryVisible(memory, { groupId, userId, topicId, queryTerms }))
        .map((memory) => ({ memory, score: scoreMemory(memory, { groupId, userId, topicId, queryTerms }) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxItems)
        .map((item) => item.memory)
}

module.exports = {
    buildQueryTerms,
    isMemoryVisible,
    scoreMemory,
    selectRelevantMemories
}
