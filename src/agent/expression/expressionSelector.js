const expressionStore = require('./expressionStore')

async function selectExpressionHints({ agentConfig, groupId, agentMessage, policyDecision } = {}) {
    if (agentConfig?.participation?.expressionLearningEnabled !== true) return []
    if (!policyDecision?.accepted || !policyDecision?.wouldSend) return []
    const replyMode = policyDecision.finalAction === 'react' ? 'react' : 'reply'
    if (replyMode === 'reply' && /tool|management|管理|配置|订阅|禁言|撤回|截图|网页/i.test(String(policyDecision.reason || ''))) {
        return []
    }
    return expressionStore.selectExpressions({
        groupId,
        text: agentMessage?.normalizedText || agentMessage?.rawText || '',
        replyMode,
        limit: replyMode === 'react' ? 3 : 2
    })
}

module.exports = {
    selectExpressionHints
}
