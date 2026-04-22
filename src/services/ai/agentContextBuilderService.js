'use strict'

async function buildAgentContext({ agentInput, agentDecision, runtime }) {
    const contextKey = agentInput.contextKey || agentInput.groupId || agentInput.userId
    const fullContext = runtime.getContext(contextKey)
    const currentTurn = fullContext[fullContext.length - 1] || null

    const selectedContext = agentInput.pipelineInput?.selectedContext || runtime.selectContext({
        context: fullContext.slice(0, -1),
        currentTurn,
        messageMeta: agentInput.messageMeta
    })

    const augmentResult = await runtime.collectAugments({
        contextKey,
        groupId: agentInput.groupId,
        userId: agentInput.userId,
        currentSpeakerId: currentTurn?.speakerId || agentInput.userId,
        currentText: currentTurn?.content || agentInput.rawMessage,
        context: fullContext.slice(-runtime.contextLimit),
        intentType: runtime.detectIdentityIntent(currentTurn?.content || agentInput.rawMessage || ''),
        ragMode: runtime.ragMode,
        profileEnabled: runtime.profileEnabled,
        structuredSelectedContext: selectedContext
    })

    return {
        contextKey,
        currentTurn,
        fullContext,
        selectedContext,
        relevantMemories: augmentResult.memories || [],
        profileText: augmentResult.profileText || '',
        augmentResult,
        botFacts: runtime.buildBotFacts(agentInput.groupId, {
            currentMentionsBot: agentInput.messageMeta?.currentMentionsBot === true,
            isReplyToBot: agentInput.messageMeta?.isReplyToBot === true
        }),
        permissionFacts: agentDecision.permissionFacts,
        executionConstraints: {
            source: agentInput.source,
            riskLevel: agentDecision.riskLevel,
            confirmationState: agentDecision.confirmationState
        }
    }
}

module.exports = {
    buildAgentContext
}
