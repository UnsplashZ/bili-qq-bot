'use strict'

function summarizeVisibleTools({ runtime, agentDecision }) {
    const toolContext = {
        ...(runtime?.toolContext || {}),
        allowMcpTools: agentDecision?.execution?.toolPolicy?.allowMcpTools !== false,
        allowLocalTools: agentDecision?.execution?.toolPolicy?.allowBotControl === true
    }
    const listVisibleTools = typeof runtime?.toolRegistry?.listToolsForContext === 'function'
        ? runtime.toolRegistry.listToolsForContext.bind(runtime.toolRegistry)
        : null
    const visibleTools = listVisibleTools ? listVisibleTools(toolContext) : []
    const allTools = typeof runtime?.toolRegistry?.getTools === 'function'
        ? runtime.toolRegistry.getTools()
        : []
    const toolNames = Array.isArray(visibleTools)
        ? visibleTools.map(tool => tool?.name).filter(Boolean)
        : []

    return {
        visibleCount: toolNames.length,
        totalCount: Array.isArray(allTools) ? allTools.length : toolNames.length,
        visibleToolNames: toolNames,
        visibleSources: Array.from(new Set((visibleTools || []).map(tool => tool?.source).filter(Boolean))),
        visibilityContext: toolContext
    }
}

function readPendingWorkflows({ agentInput, runtime }) {
    const actorUserId = String(agentInput?.userId || '').trim()
    const pendingConfirmation = actorUserId && typeof runtime?.botControl?.getPendingConfirmation === 'function'
        ? runtime.botControl.getPendingConfirmation({ actorUserId })
        : null
    const pendingSelection = actorUserId && typeof runtime?.botControl?.getCandidateSelectionSnapshot === 'function'
        ? runtime.botControl.getCandidateSelectionSnapshot({ actorUserId })
        : null

    return {
        pendingConfirmation,
        pendingSelection,
        hasPendingWorkflows: !!(pendingConfirmation || pendingSelection)
    }
}

function attachContextShape(context) {
    return {
        ...context,
        message: {
            text: context?.currentTurn?.content || context?.agentInput?.rawMessage || '',
            currentTurn: context?.currentTurn || null,
            source: context?.agentInput?.source || null,
            messageMeta: context?.agentInput?.messageMeta || {}
        },
        actor: {
            userId: context?.agentInput?.userId || null,
            groupId: context?.agentInput?.groupId || null,
            contextKey: context?.contextKey || null,
            source: context?.agentInput?.source || null
        },
        scope: {
            contextKey: context?.contextKey || null,
            groupId: context?.agentInput?.groupId || null,
            source: context?.agentInput?.source || null
        },
        permissions: {
            facts: context?.permissionFacts || null
        },
        history: {
            fullContext: context?.fullContext || [],
            selectedContext: context?.selectedContext || null,
            currentTurn: context?.currentTurn || null
        },
        workflows: context?.workflowState || {
            pendingConfirmation: null,
            pendingSelection: null,
            hasPendingWorkflows: false
        },
        tools: context?.toolVisibility || {
            visibleCount: 0,
            totalCount: 0,
            visibleToolNames: [],
            visibleSources: [],
            visibilityContext: {}
        },
        runtimeSignals: {
            gate: context?.runtimeSignals?.gate || null,
            responseMode: context?.runtimeSignals?.responseMode || null,
            executionConstraints: context?.executionConstraints || null
        }
    }
}

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

    const workflowState = readPendingWorkflows({ agentInput, runtime })
    const toolVisibility = summarizeVisibleTools({ runtime, agentDecision })
    const executionConstraints = {
        source: agentInput.source,
        riskLevel: agentDecision.riskLevel,
        confirmationState: agentDecision.confirmationState
    }

    return attachContextShape({
        agentInput,
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
        workflowState,
        toolVisibility,
        runtimeSignals: agentDecision.runtimeSignals || {
            gate: agentDecision.gateDecision || null,
            responseMode: agentDecision.responseMode || null,
            executionConstraints
        },
        executionConstraints
    })
}

module.exports = {
    attachContextShape,
    buildAgentContext,
    readPendingWorkflows,
    summarizeVisibleTools
}
