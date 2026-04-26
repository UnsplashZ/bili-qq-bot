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

function buildContextPolicy(agentConfig = {}, contextStats = null) {
    return {
        strategy: 'relevance_window',
        note: 'recentMessages 是按相关性筛选后的群聊上下文，不是完整聊天记录。',
        maxMessages: agentConfig.shortTerm?.promptMaxMessages || 32,
        relevanceKinds: ['reply_chain', 'topic', 'assistant_recent', 'addressed_or_same_user', 'recent'],
        budget: contextStats || null
    }
}

module.exports = {
    compactText,
    summarizeMessage,
    buildContextPolicy
}
