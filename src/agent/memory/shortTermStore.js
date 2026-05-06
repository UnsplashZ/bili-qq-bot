const { resolveTopic, serializeTopic } = require('./topicContextEngine')

class ShortTermStore {
    constructor() {
        this.groups = new Map()
    }

    reset() {
        this.groups.clear()
    }

    getGroupState(groupId) {
        const key = String(groupId || 'unknown')
        if (!this.groups.has(key)) {
            this.groups.set(key, {
                groupId: key,
                recentMessages: [],
                activeTopics: new Map(),
                botState: {
                    lastReplyAt: 0,
                    lastMentionAt: 0,
                    cooldownUntil: 0,
                    pendingActions: []
                },
                chatPace: {
                    messagesPerMinute: 0,
                    activeUsers: 0,
                    crowded: false
                }
            })
        }
        return this.groups.get(key)
    }

    observe(agentMessage, options = {}) {
        const groupState = this.getGroupState(agentMessage.groupId)
        const maxRecent = options.maxRecentMessagesPerGroup || 100
        const crowdedMessagesPerMinute = options.crowdedMessagesPerMinute || 8
        const topic = resolveTopic(groupState, agentMessage, options)

        groupState.recentMessages.push(agentMessage)
        groupState.recentMessages = groupState.recentMessages.slice(-maxRecent)

        const now = agentMessage.timestamp || Date.now()
        const recentWindowStart = now - 60 * 1000
        const recentWindowMessages = groupState.recentMessages.filter((message) => message.timestamp >= recentWindowStart)
        const activeUsers = new Set(recentWindowMessages.map((message) => message.userId).filter(Boolean))
        groupState.chatPace = {
            messagesPerMinute: recentWindowMessages.length,
            activeUsers: activeUsers.size,
            crowded: recentWindowMessages.length >= crowdedMessagesPerMinute
        }

        if (agentMessage.mentionsSelf) {
            groupState.botState.lastMentionAt = now
        }

        return {
            groupState,
            topic,
            topicSnapshot: serializeTopic(topic),
            chatPace: { ...groupState.chatPace }
        }
    }

    recordAssistantReply({ groupId, selfId = '', replyText = '', sourceMessageId = '', timestamp = Date.now() } = {}, options = {}) {
        const text = String(replyText || '').trim()
        const targetGroupId = String(groupId || '')
        if (!targetGroupId || !text) return null

        const groupState = this.getGroupState(targetGroupId)
        const maxRecent = options.maxRecentMessagesPerGroup || 100
        const message = {
            id: sourceMessageId ? `assistant:${sourceMessageId}` : `assistant:${timestamp}`,
            role: 'assistant',
            groupId: targetGroupId,
            userId: String(selfId || 'bot'),
            selfId: String(selfId || ''),
            messageType: 'group',
            rawText: text,
            segments: [{ type: 'text', data: { text } }],
            normalizedText: text,
            mentionsSelf: false,
            replyToSelf: false,
            hasReply: false,
            replyMessageId: '',
            replyTarget: null,
            aliasMatched: false,
            timestamp,
            sender: {
                nickname: 'Bot',
                card: '',
                role: 'assistant'
            }
        }
        groupState.recentMessages.push(message)
        groupState.recentMessages = groupState.recentMessages.slice(-maxRecent)
        return message
    }

    getSnapshot(groupId) {
        const groupState = this.getGroupState(groupId)
        return {
            groupId: groupState.groupId,
            recentMessages: groupState.recentMessages.slice(),
            activeTopics: [...groupState.activeTopics.values()].map(serializeTopic),
            botState: { ...groupState.botState },
            chatPace: { ...groupState.chatPace }
        }
    }
}

module.exports = new ShortTermStore()
module.exports.ShortTermStore = ShortTermStore
