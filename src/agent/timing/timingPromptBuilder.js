const { compactText } = require('../runtime/promptBuilder')
const { selectContext } = require('../context/contextSelector')

function buildTimingGateMessages({ agentConfig, agentMessage, memoryObservation, scoreResult }) {
    const contextSelection = selectContext(memoryObservation, agentConfig, agentMessage)
    const payload = {
        task: '判断当前群聊节奏是否适合马上进入 Agent Planner。只输出 JSON。',
        outputSchema: {
            timingAction: 'continue|wait|listen',
            waitMs: 0,
            reason: '简短原因',
            signals: {
                directAddressed: false,
                rapidConversation: false,
                twoPersonChat: false,
                userLikelyStillTyping: false,
                topicOpenForBot: false
            }
        },
        currentMessage: {
            messageId: agentMessage?.id || '',
            userId: agentMessage?.userId || '',
            text: compactText(agentMessage?.normalizedText || agentMessage?.rawText || '', 300),
            mentionsSelf: Boolean(agentMessage?.mentionsSelf),
            replyToSelf: Boolean(agentMessage?.replyToSelf),
            aliasMatched: Boolean(agentMessage?.aliasMatched)
        },
        chatPace: memoryObservation?.chatPace || null,
        traits: scoreResult?.traits || {},
        recentMessages: contextSelection.messages.slice(-10)
    }
    return [
        { role: 'system', content: '你是 QQ 群聊 Agent 的 Timing Gate，只判断节奏，不生成回复。' },
        { role: 'user', content: JSON.stringify(payload, null, 2) }
    ]
}

module.exports = {
    buildTimingGateMessages
}
