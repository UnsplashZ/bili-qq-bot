function compactText(value, limit = 500) {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    return text.length > limit ? `${text.slice(0, limit - 3)}...` : text
}

function summarizeMessage(message, relevance, maxCharsPerMessage) {
    return {
        role: message.role || (message.userId === message.selfId ? 'assistant' : 'user'),
        userId: message.userId,
        messageId: message.id,
        text: compactText(message.normalizedText || message.rawText, maxCharsPerMessage),
        mentionsSelf: message.mentionsSelf,
        aliasMatched: message.aliasMatched,
        replyToMessageId: message.replyMessageId || '',
        relevance,
        replyTarget: message.replyTarget
            ? {
                messageId: message.replyTarget.messageId || '',
                userId: message.replyTarget.userId || '',
                isBot: Boolean(message.replyTarget.isBot),
                text: compactText(message.replyTarget.text || '', Math.min(maxCharsPerMessage, 220))
            }
            : null
    }
}

function buildContextDigest(messages = [], limit = 700) {
    const selected = Array.isArray(messages) ? messages : []
    if (selected.length === 0) {
        return {
            summary: '',
            keyTurns: [],
            participants: [],
            assistantLastReply: '',
            topicMessageCount: 0
        }
    }

    const participants = Array.from(new Set(selected.map((message) => String(message.userId || '')).filter(Boolean))).slice(0, 12)
    const topicMessages = selected.filter((message) => Array.isArray(message.relevance) && message.relevance.includes('topic'))
    const assistantMessages = selected.filter((message) => message.role === 'assistant')
    const keyTurns = selected
        .filter((message) => {
            const relevance = Array.isArray(message.relevance) ? message.relevance : []
            return relevance.some((kind) => ['reply_chain', 'topic', 'assistant_recent', 'addressed_or_same_user'].includes(kind))
        })
        .slice(-8)
        .map((message) => ({
            role: message.role,
            userId: message.userId,
            messageId: message.messageId,
            relevance: message.relevance,
            text: compactText(message.text, 120)
        }))

    const source = keyTurns.length > 0 ? keyTurns : selected.slice(-6).map((message) => ({
        role: message.role,
        userId: message.userId,
        messageId: message.messageId,
        relevance: message.relevance,
        text: compactText(message.text, 120)
    }))
    const summary = compactText(source
        .map((message) => `${message.role}:${message.userId || '-'}:${message.text}`)
        .join(' | '), limit)

    return {
        summary,
        keyTurns: source,
        participants,
        assistantLastReply: compactText(assistantMessages.at(-1)?.text || '', 180),
        topicMessageCount: topicMessages.length
    }
}

function buildContextPolicy(agentConfig = {}, contextStats = null) {
    return {
        strategy: 'relevance_window_with_digest',
        note: 'recentMessages 是按相关性筛选后的群聊上下文，不是完整聊天记录；contextDigest 是对入选上下文的压缩摘要。',
        maxMessages: agentConfig.shortTerm?.promptMaxMessages || 32,
        relevanceKinds: ['reply_chain', 'topic', 'assistant_recent', 'addressed_or_same_user', 'recent'],
        budget: contextStats || null
    }
}

module.exports = {
    compactText,
    summarizeMessage,
    buildContextDigest,
    buildContextPolicy
}
