function compactText(value, limit = 500) {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    return text.length > limit ? `${text.slice(0, limit - 3)}...` : text
}

function buildSystemPrompt() {
    return [
        '你是一个 QQ 群聊里的 Bilibili 助手 Agent。',
        '你不是每条消息都要回复；沉默是常见且正确的选择。',
        '你需要根据上下文、与你的关联程度、群聊节奏和自己的职责，判断是否参与。',
        '如果用户明确 @ 你、回复你、叫你的名字，通常应该认真判断是否回应。',
        '如果只是普通闲聊，除非与你的职责或人格强相关，否则 observe_only。',
        '如果涉及订阅、配置、群管理，只能输出 tool_plan 意图，不能声称已经执行。',
        '输出必须是严格 JSON，不要 Markdown，不要额外解释。'
    ].join('\n')
}

function buildDecisionInstruction() {
    return JSON.stringify({
        action: 'observe_only|react_only|short_reply|full_reply|ask_clarify|tool_plan|defer',
        confidence: '0.0 到 1.0 的数字',
        reason: '简短说明为什么这样决定',
        topic: '当前话题标签',
        replyStyle: 'none|friendly_brief|explain|clarify|serious',
        replyDraft: '如果需要回复，给出草稿；否则为空字符串',
        memoryHints: [],
        toolIntent: null
    }, null, 2)
}

function summarizeRecentMessages(memoryObservation) {
    const messages = memoryObservation?.groupState?.recentMessages || []
    return messages.slice(-8).map((message) => ({
        userId: message.userId,
        messageId: message.id,
        text: compactText(message.normalizedText || message.rawText, 160),
        mentionsSelf: message.mentionsSelf,
        aliasMatched: message.aliasMatched
    }))
}

function buildDecisionMessages({ agentMessage, memoryObservation, scoreResult, ruleDecision, sessionContext, budgetDecision }) {
    const userPayload = {
        task: '判断是否应该参与这条 QQ 群聊消息。只输出 JSON。',
        outputSchema: JSON.parse(buildDecisionInstruction()),
        currentMessage: {
            groupId: agentMessage.groupId,
            userId: agentMessage.userId,
            messageId: agentMessage.id,
            text: compactText(agentMessage.normalizedText || agentMessage.rawText, 500),
            mentionsSelf: agentMessage.mentionsSelf,
            hasReply: agentMessage.hasReply,
            aliasMatched: agentMessage.aliasMatched,
            senderRole: agentMessage.sender.role
        },
        actor: sessionContext.actor,
        topic: memoryObservation?.topicSnapshot || null,
        chatPace: memoryObservation?.chatPace || null,
        messageTraits: scoreResult.traits || scoreResult.components || {},
        legacyRuleObservation: {
            score: scoreResult.score,
            reasons: scoreResult.reasons,
            penalties: scoreResult.penalties,
            ruleAction: ruleDecision.action,
            ruleWouldReply: ruleDecision.wouldReply,
            threshold: ruleDecision.threshold
        },
        budgetDecision: budgetDecision || null,
        recentMessages: summarizeRecentMessages(memoryObservation),
        constraints: [
            '默认不要插话。',
            '明确 @ 你或要求你做自我介绍时，通常应给 short_reply 草稿。',
            '不要执行任何配置或订阅修改，只能提出 tool_plan。',
            'observe_only/defer 时 replyDraft 必须为空字符串。',
            'tooShort、lowInformation、crowdedChat 只是上下文特征，不是硬拒绝；你需要自己判断是否沉默。'
        ]
    }

    return [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: JSON.stringify(userPayload, null, 2) }
    ]
}

module.exports = {
    buildDecisionMessages,
    buildSystemPrompt,
    compactText
}
