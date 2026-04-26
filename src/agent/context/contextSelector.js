const { summarizeMessage } = require('./contextCompactor')

function messageTimestamp(message, fallbackIndex) {
    const timestamp = Number(message?.timestamp || 0)
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : fallbackIndex
}

function addSelectedMessage(selected, message, relevance, score, index) {
    if (!message) return
    const key = String(message.id || `${message.userId || 'unknown'}:${index}`)
    const current = selected.get(key)
    if (current) {
        current.relevance.add(relevance)
        current.score += score
        return
    }
    selected.set(key, {
        message,
        index,
        score,
        relevance: new Set([relevance])
    })
}

function selectRecentMessages(memoryObservation, agentConfig = {}, agentMessage = {}) {
    const messages = Array.isArray(memoryObservation?.groupState?.recentMessages)
        ? memoryObservation.groupState.recentMessages
        : []
    const shortTerm = agentConfig.shortTerm || {}
    const promptRecentMessages = shortTerm.promptRecentMessages || 16
    const promptTopicMessages = shortTerm.promptTopicMessages || 20
    const promptAssistantMessages = shortTerm.promptAssistantMessages || 6
    const promptMaxMessages = shortTerm.promptMaxMessages || 32
    const promptMaxCharsPerMessage = shortTerm.promptMaxCharsPerMessage || 220
    const selected = new Map()
    const topicMessageIds = new Set(memoryObservation?.topicSnapshot?.recentMessageIds || [])
    const replyMessageId = String(agentMessage.replyMessageId || agentMessage.replyTarget?.messageId || '')
    const currentUserId = String(agentMessage.userId || '')
    const indexedMessages = messages.map((message, index) => ({ message, index }))

    indexedMessages.slice(-promptRecentMessages).forEach(({ message, index }) => {
        addSelectedMessage(selected, message, 'recent', 10 + index / 1000, index)
    })

    if (topicMessageIds.size > 0 && promptTopicMessages > 0) {
        indexedMessages
            .filter(({ message }) => topicMessageIds.has(message.id))
            .slice(-promptTopicMessages)
            .forEach(({ message, index }) => addSelectedMessage(selected, message, 'topic', 60, index))
    }

    if (replyMessageId) {
        indexedMessages
            .filter(({ message }) => (
                String(message.id || '') === replyMessageId ||
                String(message.replyMessageId || '') === replyMessageId ||
                String(message.replyTarget?.messageId || '') === replyMessageId
            ))
            .forEach(({ message, index }) => addSelectedMessage(selected, message, 'reply_chain', 100, index))
    }

    indexedMessages
        .filter(({ message }) => (
            String(message.userId || '') === currentUserId ||
            message.mentionsSelf ||
            message.aliasMatched ||
            message.replyTarget?.isBot
        ))
        .slice(-promptRecentMessages)
        .forEach(({ message, index }) => addSelectedMessage(selected, message, 'addressed_or_same_user', 35, index))

    if (promptAssistantMessages > 0) {
        indexedMessages
            .filter(({ message }) => (message.role || (message.userId === message.selfId ? 'assistant' : 'user')) === 'assistant')
            .slice(-promptAssistantMessages)
            .forEach(({ message, index }) => addSelectedMessage(selected, message, 'assistant_recent', 50, index))
    }

    const limited = [...selected.values()]
    if (limited.length > promptMaxMessages) {
        limited.sort((left, right) => {
            if (right.score !== left.score) return right.score - left.score
            return messageTimestamp(right.message, right.index) - messageTimestamp(left.message, left.index)
        })
        limited.length = promptMaxMessages
    }

    return limited
        .sort((left, right) => messageTimestamp(left.message, left.index) - messageTimestamp(right.message, right.index))
        .map(({ message, relevance }) => summarizeMessage(message, [...relevance], promptMaxCharsPerMessage))
}

module.exports = {
    selectRecentMessages,
    messageTimestamp
}
