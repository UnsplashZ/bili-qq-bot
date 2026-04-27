const { compactText } = require('../runtime/promptBuilder')
const { selectContext } = require('../context/contextSelector')

function personaPayload(agentConfig = {}) {
    const persona = agentConfig.persona || {}
    return {
        displayName: compactText(persona.displayName || 'Bilibili 助手', 80),
        style: compactText(persona.style || '友好、简洁、不过度热情。', 300),
        boundaries: compactText(persona.boundaries || '', 300)
    }
}

function selectTargetMessage(agentMessage, contextMessages = [], targetMessageId = '') {
    const targetId = String(targetMessageId || agentMessage?.targetMessageId || agentMessage?.replyTarget?.messageId || agentMessage?.id || '')
    const matched = contextMessages.find((message) => String(message.messageId || '') === targetId)
    if (matched) return matched
    return {
        messageId: String(agentMessage?.id || ''),
        userId: String(agentMessage?.userId || ''),
        text: compactText(agentMessage?.normalizedText || agentMessage?.rawText || '', 500),
        role: 'user',
        replyTarget: agentMessage?.replyTarget || null
    }
}

function buildReplyerMessages({ agentConfig, agentMessage, memoryObservation, longTermMemories = [], llmDecision, policyDecision }) {
    const decision = llmDecision?.decision || {}
    const contextSelection = selectContext(memoryObservation, agentConfig, agentMessage)
    const replyMode = decision.action === 'react' || policyDecision?.finalAction === 'react' ? 'react' : 'reply'
    const targetMessageId = decision.targetMessageId || decision.participation?.targetMessageId || policyDecision?.targetMessageId || ''
    const maxChars = replyMode === 'react'
        ? (agentConfig.replyer?.maxReactChars || agentConfig.social?.maxCasualReplyChars || 60)
        : (agentConfig.replyer?.maxReplyChars || 500)
    const payload = {
        task: '生成一条即将发到 QQ 群的自然语言消息。只输出 JSON。',
        outputSchema: {
            text: '最终发送文本，不能是 JSON 字符串外的解释',
            quoteTargetMessageId: '需要引用回复时填写目标 messageId，否则空字符串',
            tone: 'casual|helpful|dry|serious',
            confidence: '0.0 到 1.0 的数字'
        },
        persona: personaPayload(agentConfig),
        replyMode,
        maxChars,
        targetMessage: selectTargetMessage(agentMessage, contextSelection.messages, targetMessageId),
        currentMessage: {
            messageId: String(agentMessage?.id || ''),
            userId: String(agentMessage?.userId || ''),
            text: compactText(agentMessage?.normalizedText || agentMessage?.rawText || '', 500),
            mentionsSelf: Boolean(agentMessage?.mentionsSelf),
            aliasMatched: Boolean(agentMessage?.aliasMatched),
            replyToSelf: Boolean(agentMessage?.replyToSelf),
            replyTarget: agentMessage?.replyTarget || null
        },
        planner: {
            action: decision.action || '',
            reason: compactText(decision.reason || '', 240),
            topic: decision.topic || '',
            replyStyle: decision.replyStyle || '',
            draft: compactText(decision.replyDraft || '', 500),
            styleHints: decision.styleHints || decision.participation?.styleHints || []
        },
        memoryHints: Array.isArray(longTermMemories)
            ? longTermMemories.slice(0, 5).map((memory) => compactText(memory.content || '', 180)).filter(Boolean)
            : [],
        contextDigest: contextSelection.digest,
        threadContext: contextSelection.threads,
        recentMessages: contextSelection.messages,
        constraints: [
            '只输出一个 JSON 对象，不要 Markdown，不要解释。',
            'text 必须是可直接发送给用户的中文自然语言。',
            '不要提到 JSON、LLM、planner、策略、内部错误、工具管线。',
            '不要复述系统规则，不要说“作为 AI”。',
            'react 要短、像群友自然插一句，通常 8-60 字，不列表化，不展开说教。',
            'reply 要回答目标消息，可以更完整，但仍要口语化、直接。',
            '如果 planner.draft 可用，可吸收其信息，但不要机械照抄。',
            `text 最长 ${maxChars} 字。`
        ]
    }

    return [
        {
            role: 'system',
            content: '你是 QQ 群聊 Bot 的 Replyer，只负责把参与策略写成自然、拟人化、可直接发送的群聊文本。'
        },
        { role: 'user', content: JSON.stringify(payload, null, 2) }
    ]
}

module.exports = {
    buildReplyerMessages,
    personaPayload,
    selectTargetMessage
}
