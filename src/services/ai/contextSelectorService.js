'use strict'

function normalizeText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^\u4e00-\u9fa5a-z0-9]+/gi, ' ')
        .trim()
}

function extractTokens(value) {
    const text = normalizeText(value)
    const tokens = new Set()
    const asciiMatches = text.match(/[a-z0-9]{2,}/g) || []
    for (const token of asciiMatches) tokens.add(token)

    const cjk = text.replace(/[^\u4e00-\u9fa5]/g, '')
    for (let i = 0; i < cjk.length - 1; i++) {
        tokens.add(cjk.slice(i, i + 2))
    }
    return tokens
}

function overlapSize(left, right) {
    let count = 0
    for (const token of left) {
        if (right.has(token)) count++
    }
    return count
}

function summarizeContext(currentTurn, threadMessages) {
    const tokens = []
    for (const msg of threadMessages) {
        tokens.push(...extractTokens(msg?.content || ''))
    }
    if (tokens.length === 0) {
        tokens.push(...extractTokens(currentTurn?.content || ''))
    }
    const keywords = [...new Set(tokens)].filter(token => token.length >= 2).slice(0, 2)
    if (keywords.length === 0) {
        return '最近几条与当前问题相关的消息较少，当前用户仍在延续当前话题。'
    }
    return `最近几条主要围绕${keywords.join('、')}展开，当前用户在继续当前话题，其余插话与当前问题无关。`
}

function hasCurrentSpeakerThreadAround(context, index, currentSpeakerId) {
    if (!currentSpeakerId) return false
    const prev = context[index - 1]
    const next = context[index + 1]
    return String(prev?.speakerId || '') === currentSpeakerId && String(next?.speakerId || '') === currentSpeakerId
}

function followsCurrentSpeaker(context, index, currentSpeakerId) {
    if (!currentSpeakerId) return false
    const prev = context[index - 1]
    return String(prev?.speakerId || '') === currentSpeakerId
}

function selectContext({ context = [], currentTurn, messageMeta = {}, options = {} }) {
    const threadLimit = Number(options.threadLimit || 4)
    const summaryThreshold = Number(options.summaryThreshold || 8)
    const currentSpeakerId = String(currentTurn?.speakerId || '')
    const currentTokens = extractTokens(currentTurn?.content || '')
    const replyToMessageId = messageMeta.replyToMessageId ? String(messageMeta.replyToMessageId) : null

    const candidates = []
    for (let index = 0; index < context.length; index++) {
        const msg = context[index]
        if (!msg || msg === currentTurn) continue
        let score = 0
        if (String(msg.speakerId || '') === currentSpeakerId && currentSpeakerId) score += 40
        if (replyToMessageId && String(msg.messageId || '') === replyToMessageId) score += 60

        const msgTokens = extractTokens(msg.content || '')
        const overlap = overlapSize(currentTokens, msgTokens)
        if (overlap > 0) score += 20
        if (
            msg.role === 'assistant' &&
            (
                overlap > 0 ||
                (replyToMessageId && String(msg.messageId || '') === replyToMessageId) ||
                followsCurrentSpeaker(context, index, currentSpeakerId) ||
                hasCurrentSpeakerThreadAround(context, index, currentSpeakerId)
            )
        ) {
            score += 35
        }
        if (score > 0 && msg.timestamp && currentTurn?.timestamp && currentTurn.timestamp - msg.timestamp <= 5 * 60 * 1000) {
            score += 10
        }
        if (score === 0) score -= 25
        candidates.push({ msg, score })
    }

    const threadMessages = candidates
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score || (a.msg.timestamp || 0) - (b.msg.timestamp || 0))
        .slice(0, threadLimit)
        .map(item => item.msg)
        .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))

    const backgroundSummary = context.length >= summaryThreshold
        ? summarizeContext(currentTurn, threadMessages)
        : ''

    return {
        currentTurn,
        threadMessages,
        backgroundSummary,
        stats: {
            candidateCount: candidates.length,
            selectedCount: threadMessages.length
        }
    }
}

module.exports = {
    selectContext
}
