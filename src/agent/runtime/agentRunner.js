const logger = require('../../utils/logger')
const { runWithAgentSession } = require('../session/agentSessionContext')
const sessionStore = require('../session/sessionStore')
const longTermStore = require('../memory/longTermStore')
const { maybeStoreTopicSummary } = require('../memory/topicSummaryRecorder')
const { extractMemoryHints, mergeMemoryHints } = require('../memory/memoryHintExtractor')
const { scoreMessage } = require('../cognition/relevanceScorer')
const { decideReply } = require('../cognition/replyDecision')
const { decideWithLlm, finalizeToolResultReply } = require('../cognition/agentDecisionService')
const { validateDecisionPolicy } = require('../cognition/decisionPolicyValidator')
const { checkBudget } = require('./budgetGuard')
const { recordTrajectory } = require('./trajectoryRecorder')
const { executeReply } = require('./replyExecutor')
const { checkReplyGuard } = require('./replyGuard')
const { evaluateDecisionGuardrails } = require('./decisionGuardrails')
const { applyOutputGuardrails } = require('./outputGuardrails')
const { processToolPlan, tryConsumeToolConfirmation } = require('../tools/toolPlanProcessor')

const DETERMINISTIC_MEMORY_SOURCES = new Set([
    'explicit_memory_request',
    'uid_relation_pattern',
    'qq_relation_pattern',
    'user_preference_pattern'
])

function recordSessionOutcome(runState, result) {
    const conversationSession = runState.sessionContext?.conversationSession
    if (!conversationSession?.sessionId) return

    const toolOutcome = result?.toolPlanResult || result?.toolConfirmation || null
    sessionStore.recordAgentOutcome({
        sessionId: conversationSession.sessionId,
        action: result?.policyDecision?.finalAction ||
            toolOutcome?.decisionOverride?.action ||
            result?.llmDecision?.decision?.action ||
            result?.decision?.action ||
            '',
        executed: Boolean(result?.execution?.executed),
        toolName: toolOutcome?.plan?.name || toolOutcome?.tool?.name || '',
        timestamp: runState.agentMessage?.timestamp || Date.now()
    })
}

function filterMemoryHintsForWrite({ llmDecision, extractedMemoryHints }) {
    const llmHints = llmDecision?.status === 'ok'
        ? (llmDecision.decision?.memoryHints || [])
        : []
    const extractedHints = Array.isArray(extractedMemoryHints)
        ? extractedMemoryHints.filter((hint) => (
            llmDecision?.status === 'ok' || DETERMINISTIC_MEMORY_SOURCES.has(hint?.source)
        ))
        : []
    return { llmHints, extractedHints }
}

async function sendSystemReply({ runState, decision }) {
    const { context, groupId, agentConfig, agentMessage } = runState
    const llmDecision = {
        status: 'ok',
        decision
    }
    const policyDecision = {
        accepted: true,
        finalAction: decision.action,
        reason: decision.reason,
        wouldSend: true,
        replyDraft: decision.replyDraft
    }
    const outputDecision = applyOutputGuardrails({
        agentConfig,
        policyDecision,
        llmDecision
    })
    return executeReply({
        ws: context.ws,
        groupId,
        userId: agentMessage.userId,
        selfId: context.messageData?.self_id,
        sourceMessageId: context.messageData?.message_id,
        llmDecision,
        policyDecision: outputDecision.policyDecision,
        traceContext: context.traceContext
    })
}

async function finalizeToolOutcome({ runState, toolOutcome }) {
    if (!toolOutcome?.decisionOverride) return toolOutcome
    const toolReplyDecision = await finalizeToolResultReply({
        agentConfig: runState.agentConfig,
        agentMessage: runState.agentMessage,
        sessionContext: runState.sessionContext,
        toolOutcome
    })
    return {
        ...toolOutcome,
        toolReplyDecision,
        decisionOverride: toolReplyDecision?.status === 'ok'
            ? toolReplyDecision.decision
            : toolOutcome.decisionOverride
    }
}

async function handleToolConfirmation(runState, scoreResult, consumedToolConfirmation) {
    const { agentConfig, agentMessage, groupId, sessionContext } = runState
    const finalToolConfirmation = await finalizeToolOutcome({
        runState,
        toolOutcome: consumedToolConfirmation
    })
    const execution = await sendSystemReply({
        runState,
        decision: finalToolConfirmation.decisionOverride
    })
    const result = runState.baseResult({
        score: scoreResult,
        toolConfirmation: finalToolConfirmation,
        execution
    })
    if (agentConfig.logTrajectory) {
        await recordTrajectory({
            type: 'tool_confirmation',
            traceScope: sessionContext.traceScope,
            groupId,
            userId: agentMessage.userId,
            messageId: agentMessage.id,
            topicId: sessionContext.topicId,
            replyTarget: agentMessage.replyTarget,
            toolConfirmation: finalToolConfirmation,
            execution
        })
    }
    return result
}

async function handleToolPlanResult(runState, runData) {
    const { agentConfig, agentMessage, groupId, sessionContext } = runState
    const execution = await sendSystemReply({
        runState,
        decision: runData.toolPlanResult.decisionOverride
    })
    const result = runState.baseResult({
        ...runData,
        execution
    })
    if (agentConfig.logTrajectory) {
        await recordTrajectory({
            type: 'tool_plan_result',
            traceScope: sessionContext.traceScope,
            groupId,
            userId: agentMessage.userId,
            messageId: agentMessage.id,
            topicId: sessionContext.topicId,
            replyTarget: agentMessage.replyTarget,
            toolPlanResult: runData.toolPlanResult,
            execution,
            actor: runState.actorSummary()
        })
    }
    return result
}

function logDecisions(runState, { decision, scoreResult, effectiveLlmDecision, policyDecision }) {
    const { agentMessage, groupId, sessionContext } = runState
    logger.logEvent('info', 'AGENT', sessionContext.traceScope, 'observe-decision', {
        groupId,
        userId: agentMessage.userId,
        topicId: sessionContext.topicId,
        action: decision.action,
        score: decision.score.toFixed(2),
        wouldReply: decision.wouldReply,
        reasons: decision.reasons.join(','),
        penalties: decision.penalties.join(','),
        traits: scoreResult.reasons.concat(scoreResult.penalties).join(',')
    })

    if (effectiveLlmDecision.status === 'ok') {
        logger.logEvent('info', 'AGENT', sessionContext.traceScope, 'llm-decision', {
            groupId,
            userId: agentMessage.userId,
            topicId: sessionContext.topicId,
            action: effectiveLlmDecision.decision.action,
            confidence: effectiveLlmDecision.decision.confidence.toFixed(2),
            wouldSend: policyDecision.wouldSend,
            reason: effectiveLlmDecision.decision.reason
        })
    }

    logger.logEvent('info', 'AGENT', sessionContext.traceScope, 'policy-decision', {
        groupId,
        userId: agentMessage.userId,
        finalAction: policyDecision.finalAction,
        accepted: policyDecision.accepted,
        wouldSend: policyDecision.wouldSend,
        reason: policyDecision.reason
    })
}

async function runObserveDecision(runState, scoreResult) {
    const { agentConfig, agentMessage, groupId, memoryObservation, sessionContext } = runState
    const decision = decideReply({ scoreResult, agentConfig })
    const budgetDecision = checkBudget({
        agentConfig,
        groupId,
        userId: agentMessage.userId,
        timestamp: agentMessage.timestamp
    })
    const longTermMemories = await longTermStore.retrieveRelevantMemories({
        groupId,
        userId: agentMessage.userId,
        text: agentMessage.normalizedText || agentMessage.rawText,
        limit: agentConfig.longTerm?.retrieveLimit || 5
    })
    const llmDecision = await decideWithLlm({
        agentConfig,
        agentMessage,
        memoryObservation,
        longTermMemories,
        scoreResult,
        ruleDecision: decision,
        sessionContext,
        budgetDecision
    })
    const extractedMemoryHints = extractMemoryHints({ agentMessage })
    const rawToolPlanResult = await processToolPlan({
        decision: llmDecision.decision,
        agentConfig,
        sessionContext
    })
    const toolPlanResult = await finalizeToolOutcome({
        runState,
        toolOutcome: rawToolPlanResult
    })
    const effectiveLlmDecision = toolPlanResult?.decisionOverride
        ? {
            ...llmDecision,
            decision: {
                ...llmDecision.decision,
                ...toolPlanResult.decisionOverride
            }
        }
        : llmDecision
    const decisionGuardrail = evaluateDecisionGuardrails(effectiveLlmDecision)
    const writableMemoryHints = filterMemoryHintsForWrite({
        llmDecision: effectiveLlmDecision,
        extractedMemoryHints
    })
    const memoryHints = mergeMemoryHints(writableMemoryHints.llmHints, writableMemoryHints.extractedHints)
    const memoryWrite = await longTermStore.storeMemoryHints({
        hints: memoryHints,
        sessionContext,
        agentMessage,
        decision: effectiveLlmDecision.decision
    })
    const topicSummaryWrite = await maybeStoreTopicSummary({
        agentConfig,
        memoryObservation,
        sessionContext,
        agentMessage
    })
    const runData = {
        score: scoreResult,
        decision,
        messageTraits: scoreResult.traits,
        longTermMemories,
        extractedMemoryHints,
        memoryWrite,
        topicSummaryWrite,
        budgetDecision,
        llmDecision: effectiveLlmDecision,
        rawLlmDecision: llmDecision,
        toolPlanResult,
        decisionGuardrail
    }

    if (toolPlanResult?.decisionOverride) {
        return handleToolPlanResult(runState, runData)
    }

    let policyDecision = validateDecisionPolicy({
        agentConfig,
        llmDecision: effectiveLlmDecision,
        messageTraits: scoreResult.traits || {},
        replyGuardDecision: checkReplyGuard({
            agentConfig,
            groupId,
            replyDraft: effectiveLlmDecision.decision?.replyDraft || '',
            timestamp: agentMessage.timestamp,
            bypassCooldown: Boolean(
                scoreResult.traits?.mentionedBot ||
                scoreResult.traits?.replyToBot ||
                scoreResult.traits?.aliasMatched
            )
        })
    })
    const outputDecision = applyOutputGuardrails({
        agentConfig,
        policyDecision,
        llmDecision: effectiveLlmDecision
    })
    policyDecision = outputDecision.policyDecision
    logDecisions(runState, {
        decision,
        scoreResult,
        effectiveLlmDecision,
        policyDecision
    })

    const execution = await executeReply({
        ws: runState.context.ws,
        groupId,
        userId: agentMessage.userId,
        selfId: agentMessage.selfId,
        sourceMessageId: agentMessage.id,
        llmDecision: effectiveLlmDecision,
        policyDecision,
        traceContext: runState.context.traceContext
    })
    const result = runState.baseResult({
        ...runData,
        policyDecision,
        outputGuardrail: outputDecision.outputGuardrail,
        execution
    })

    if (agentConfig.logTrajectory) {
        await recordTrajectory({
            type: 'observe_decision',
            traceScope: sessionContext.traceScope,
            groupId,
            userId: agentMessage.userId,
            messageId: agentMessage.id,
            topicId: sessionContext.topicId,
            rawTextPreview: agentMessage.rawText,
            replyTarget: agentMessage.replyTarget,
            decision,
            messageTraits: scoreResult.traits,
            longTermMemories,
            extractedMemoryHints,
            memoryWrite,
            topicSummaryWrite,
            budgetDecision,
            llmDecision: effectiveLlmDecision,
            rawLlmDecision: llmDecision,
            toolPlanResult,
            policyDecision,
            decisionGuardrail,
            outputGuardrail: outputDecision.outputGuardrail,
            execution,
            score: scoreResult,
            actor: runState.actorSummary()
        })
    }

    return result
}

async function runAgent(runState) {
    return runWithAgentSession(runState.sessionContext, async () => {
        const scoreResult = scoreMessage({
            agentMessage: runState.agentMessage,
            memoryObservation: runState.memoryObservation,
            actor: runState.actor
        })
        const consumedToolConfirmation = await tryConsumeToolConfirmation({
            agentMessage: runState.agentMessage,
            agentConfig: runState.agentConfig,
            sessionContext: runState.sessionContext
        })
        if (consumedToolConfirmation) {
            const result = await handleToolConfirmation(runState, scoreResult, consumedToolConfirmation)
            recordSessionOutcome(runState, result)
            return result
        }
        const result = await runObserveDecision(runState, scoreResult)
        recordSessionOutcome(runState, result)
        return result
    })
}

module.exports = {
    runAgent,
    filterMemoryHintsForWrite
}
