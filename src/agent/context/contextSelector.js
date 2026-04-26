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

function countRelevance(messages) {
    const counts = {}
    for (const message of messages) {
        const relevanceList = Array.isArray(message.relevance) ? message.relevance : []
        for (const relevance of relevanceList) {
            counts[relevance] = (counts[relevance] || 0) + 1
        }
    }
    return counts
}

function estimateContextChars(messages) {
    return messages.reduce((total, message) => {
        const textLength = String(message.text || '').length
        const replyTextLength = String(message.replyTarget?.text || '').length
        return total + textLength + replyTextLength
    }, 0)
}

function relevancePriority(relevanceList) {
    const priorities = {
        reply_chain: 100,
        topic: 80,
        assistant_recent: 70,
        addressed_or_same_user: 60,
        recent: 10
    }
    return (Array.isArray(relevanceList) ? relevanceList : [])
        .reduce((highest, relevance) => Math.max(highest, priorities[relevance] || 0), 0)
}

function trimEntriesByCharBudget(entries, maxContextChars) {
    const budget = Math.trunc(Number(maxContextChars || 0))
    const result = {
        entries: [...entries],
        charBudgetExceeded: false,
        droppedByBudgetCount: 0
    }

    if (!Number.isFinite(budget) || budget <= 0) return result

    let estimatedChars = estimateContextChars(result.entries.map((entry) => entry.summary))
    if (estimatedChars <= budget) return result

    result.charBudgetExceeded = true

    while (estimatedChars > budget && result.entries.length > 1) {
        let dropIndex = 0
        for (let index = 1; index < result.entries.length; index += 1) {
            const candidate = result.entries[index]
            const current = result.entries[dropIndex]
            if (candidate.priority !== current.priority) {
                if (candidate.priority < current.priority) dropIndex = index
                continue
            }
            if (messageTimestamp(candidate.message, candidate.index) < messageTimestamp(current.message, current.index)) {
                dropIndex = index
            }
        }

        result.entries.splice(dropIndex, 1)
        result.droppedByBudgetCount += 1
        estimatedChars = estimateContextChars(result.entries.map((entry) => entry.summary))
    }

    return result
}

function buildSelectionStats({ sourceMessages, preBudgetSelectedMessages, selectedMessages, shortTerm, charBudgetExceeded, droppedByBudgetCount }) {
    const droppedBySelectionCount = Math.max(0, sourceMessages.length - preBudgetSelectedMessages.length)
    return {
        sourceMessageCount: sourceMessages.length,
        preBudgetSelectedMessageCount: preBudgetSelectedMessages.length,
        selectedMessageCount: selectedMessages.length,
        droppedMessageCount: Math.max(0, sourceMessages.length - selectedMessages.length),
        droppedBySelectionCount,
        droppedByBudgetCount,
        charBudgetExceeded,
        estimatedChars: estimateContextChars(selectedMessages),
        maxMessages: shortTerm.promptMaxMessages || 32,
        maxCharsPerMessage: shortTerm.promptMaxCharsPerMessage || 220,
        maxContextChars: shortTerm.promptMaxContextChars || 0,
        relevanceCounts: countRelevance(selectedMessages)
    }
}

function selectContext(memoryObservation, agentConfig = {}, agentMessage = {}) {
    const messages = Array.isArray(memoryObservation?.groupState?.recentMessages)
        ? memoryObservation.groupState.recentMessages
        : []
    const shortTerm = agentConfig.shortTerm || {}
    const promptRecentMessages = shortTerm.promptRecentMessages || 16
    const promptTopicMessages = shortTerm.promptTopicMessages || 20
    const promptAssistantMessages = shortTerm.promptAssistantMessages || 6
    const promptMaxMessages = shortTerm.promptMaxMessages || 32
    const promptMaxCharsPerMessage = shortTerm.promptMaxCharsPerMessage || 220
    const promptMaxContextChars = shortTerm.promptMaxContextChars || 6000
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

    const preBudgetEntries = limited
        .sort((left, right) => messageTimestamp(left.message, left.index) - messageTimestamp(right.message, right.index))
        .map(({ message, relevance, index }) => {
            const relevanceList = [...relevance]
            return {
                message,
                index,
                priority: relevancePriority(relevanceList),
                summary: summarizeMessage(message, relevanceList, promptMaxCharsPerMessage)
            }
        })
    const budgetResult = trimEntriesByCharBudget(preBudgetEntries, promptMaxContextChars)
    const selectedMessages = budgetResult.entries.map((entry) => entry.summary)

    return {
        messages: selectedMessages,
        stats: buildSelectionStats({
            sourceMessages: messages,
            preBudgetSelectedMessages: preBudgetEntries.map((entry) => entry.summary),
            selectedMessages,
            shortTerm: {
                ...shortTerm,
                promptMaxMessages,
                promptMaxCharsPerMessage,
                promptMaxContextChars
            },
            charBudgetExceeded: budgetResult.charBudgetExceeded,
            droppedByBudgetCount: budgetResult.droppedByBudgetCount
        })
    }
}

function selectRecentMessages(memoryObservation, agentConfig = {}, agentMessage = {}) {
    return selectContext(memoryObservation, agentConfig, agentMessage).messages
}

module.exports = {
    selectContext,
    selectRecentMessages,
    messageTimestamp
}
