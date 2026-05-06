const logger = require('../../utils/logger')
const runtimeMetricsService = require('../../services/runtimeMetricsService')
const { runWithAgentSession } = require('../session/agentSessionContext')
const sessionStore = require('../session/sessionStore')
const longTermStore = require('../memory/longTermStore')
const { normalizeAgentConfig, isEnabledForGroup, getEffectiveAgentConfigForGroup } = require('../config/agentConfig')
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
const { evaluateInputGuardrails } = require('./inputGuardrails')
const { evaluateDecisionGuardrails } = require('./decisionGuardrails')
const { applyOutputGuardrails } = require('./outputGuardrails')
const { processToolPlan, tryConsumeToolConfirmation } = require('../tools/toolPlanProcessor')
const { scoreSocialInterject } = require('../social/socialInterjectScorer')
const { checkSocialBudget, recordSocialSend } = require('../social/socialBudget')
const { isSocialAction } = require('../social/interjectPolicy')
const { runAndRecordTimingGate } = require('../timing/timingGate')
const { scheduleTimingReentry } = require('../timing/timingStateStore')
const { runReplyer } = require('../replyer/replyerService')
const { selectExpressionHints } = require('../expression/expressionSelector')
const { maybeLearnExpressions } = require('../expression/expressionLearner')
const { maybeRefreshPersonProfile, compactProfile } = require('../memory/personProfileBuilder')
const { observeReplyEffect, trackSentReply } = require('../feedback/replyEffectTracker')

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
            result?.timingDecision?.timingAction ||
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
            ? {
                ...toolReplyDecision.decision,
                messageChain: toolOutcome.decisionOverride?.messageChain || toolReplyDecision.decision.messageChain || null
            }
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
            decision: runData.decision,
            messageTraits: runData.messageTraits,
            memoryWrite: runData.memoryWrite,
            topicSummaryWrite: runData.topicSummaryWrite,
            timingDecision: runData.timingDecision,
            budgetDecision: runData.budgetDecision,
            inputGuardrail: runData.inputGuardrail,
            llmDecision: runData.llmDecision,
            rawLlmDecision: runData.rawLlmDecision,
            toolPlanResult: runData.toolPlanResult,
            decisionGuardrail: runData.decisionGuardrail,
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

function makeTimingLlmDecision(timingDecision) {
    const action = timingDecision?.timingAction === 'wait' ? 'wait' : 'listen'
    return {
        status: 'skipped',
        reason: `timing_gate_${action}`,
        decision: {
            action,
            confidence: 1,
            reason: timingDecision?.reason || `timing_gate_${action}`,
            topic: 'timing_gate',
            replyStyle: 'none',
            replyDraft: '',
            participation: {
                action,
                targetMessageId: '',
                topic: 'timing_gate',
                relation: 'ambient',
                participationLevel: 0,
                reason: timingDecision?.reason || '',
                styleHints: [],
                toolPlan: null
            },
            targetMessageId: '',
            styleHints: [],
            memoryHints: [],
            toolIntent: null
        }
    }
}

async function handleTimingStop(runState, scoreResult, decision, timingDecision, replyEffectObservation = null) {
    const { agentConfig, agentMessage, groupId, memoryObservation, sessionContext } = runState
    const extractedMemoryHints = extractMemoryHints({ agentMessage })
    const llmDecision = makeTimingLlmDecision(timingDecision)
    const writableMemoryHints = filterMemoryHintsForWrite({
        llmDecision,
        extractedMemoryHints
    })
    const memoryHints = mergeMemoryHints(writableMemoryHints.llmHints, writableMemoryHints.extractedHints)
    const memoryWrite = await longTermStore.storeMemoryHints({
        hints: memoryHints,
        sessionContext,
        agentMessage,
        decision: llmDecision.decision
    })
    const topicSummaryWrite = await maybeStoreTopicSummary({
        agentConfig,
        memoryObservation,
        sessionContext,
        agentMessage
    })
    const policyDecision = {
        accepted: false,
        finalAction: timingDecision.timingAction,
        reason: timingDecision.reason,
        llmAction: llmDecision.decision.action,
        wouldSend: false
    }
    const execution = { executed: false, reason: `timing_gate_${timingDecision.timingAction}` }
    let timingReentrySchedule = null
    if (timingDecision.timingAction === 'wait') {
        timingReentrySchedule = scheduleTimingReentry({
            groupId,
            waitMs: timingDecision.waitMs,
            run: async () => {
                try {
                    const latestAgentConfig = normalizeAgentConfig()
                    if (!isEnabledForGroup(groupId, latestAgentConfig)) {
                        logger.logEvent('info', 'AGENT', sessionContext.traceScope, 'timing-reentry-skipped', {
                            groupId,
                            userId: agentMessage.userId,
                            messageId: agentMessage.id,
                            reason: 'agent_disabled'
                        })
                        return
                    }
                    const reentryState = runState.createTimingReentry({
                        agentConfig: getEffectiveAgentConfigForGroup(groupId, latestAgentConfig)
                    })
                    await runAgent(reentryState)
                } catch (error) {
                    logger.logEvent('warn', 'AGENT', sessionContext.traceScope, 'timing-reentry-failed', {
                        groupId,
                        userId: agentMessage.userId,
                        messageId: agentMessage.id,
                        error: logger.getErrorMessage(error)
                    })
                }
            }
        })
        if (timingReentrySchedule?.scheduled) {
            logger.logEvent('info', 'AGENT', sessionContext.traceScope, 'timing-reentry-scheduled', {
                groupId,
                userId: agentMessage.userId,
                messageId: agentMessage.id,
                waitMs: timingReentrySchedule.waitMs
            })
        }
    }
    logDecisions(runState, {
        decision,
        scoreResult,
        effectiveLlmDecision: llmDecision,
        policyDecision
    })
    const result = runState.baseResult({
        score: scoreResult,
        decision,
        messageTraits: scoreResult.traits,
        extractedMemoryHints,
        memoryWrite,
        topicSummaryWrite,
        timingDecision,
        timingReentrySchedule,
        replyEffectObservation,
        llmDecision,
        rawLlmDecision: llmDecision,
        policyDecision,
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
            timingDecision,
            timingReentrySchedule,
            replyEffectObservation,
            messageTraits: scoreResult.traits,
            extractedMemoryHints,
            memoryWrite,
            topicSummaryWrite,
            llmDecision,
            rawLlmDecision: llmDecision,
            policyDecision,
            execution,
            score: scoreResult,
            actor: runState.actorSummary()
        })
    }
    return result
}

async function runObserveDecision(runState, scoreResult) {
    const { agentConfig, agentMessage, groupId, memoryObservation, sessionContext } = runState
    const decision = decideReply({ scoreResult, agentConfig })
    const replyEffectObservation = await observeReplyEffect({
        agentConfig,
        agentMessage,
        memoryObservation
    })
    const timingDecision = runState.timingReentry
        ? {
            status: 'ok',
            timingAction: 'continue',
            waitMs: 0,
            reason: 'timing_reentry',
            signals: {
                directAddressed: false,
                rapidConversation: false,
                twoPersonChat: false,
                userLikelyStillTyping: false,
                topicOpenForBot: true
            }
        }
        : runAndRecordTimingGate({
            agentConfig,
            agentMessage,
            memoryObservation,
            scoreResult
        })
    if (timingDecision.timingAction === 'listen' || timingDecision.timingAction === 'wait') {
        return handleTimingStop(runState, scoreResult, decision, timingDecision, replyEffectObservation)
    }

    const budgetDecision = checkBudget({
        agentConfig,
        groupId,
        userId: agentMessage.userId,
        timestamp: agentMessage.timestamp
    })
    const inputGuardrail = evaluateInputGuardrails({
        agentMessage,
        budgetDecision
    })
    const socialScore = scoreSocialInterject({
        agentConfig,
        agentMessage,
        memoryObservation,
        scoreResult
    })
    const longTermMemories = await longTermStore.retrieveRelevantMemories({
        groupId,
        userId: agentMessage.userId,
        topicId: sessionContext.topicId,
        text: agentMessage.normalizedText || agentMessage.rawText,
        limit: agentConfig.longTerm?.retrieveLimit || 5
    })
    const personProfileWrite = await maybeRefreshPersonProfile({
        agentConfig,
        groupId,
        userId: agentMessage.userId,
        longTermMemories,
        agentMessage
    })
    const personProfile = compactProfile(personProfileWrite.profile)
    const llmDecision = await decideWithLlm({
        agentConfig,
        agentMessage,
        memoryObservation,
        longTermMemories,
        scoreResult,
        ruleDecision: decision,
        sessionContext,
        budgetDecision,
        inputGuardrail,
        socialScore,
        replyEffectObservation
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
        personProfile,
        personProfileWrite,
        extractedMemoryHints,
        memoryWrite,
        topicSummaryWrite,
        timingDecision,
        timingReentry: runState.timingReentry,
        budgetDecision,
        inputGuardrail,
        llmDecision: effectiveLlmDecision,
        rawLlmDecision: llmDecision,
        toolPlanResult,
        decisionGuardrail,
        socialScore,
        replyEffectObservation
    }

    if (toolPlanResult?.decisionOverride) {
        return handleToolPlanResult(runState, runData)
    }

    const plannerReplyDraft = effectiveLlmDecision.decision?.replyDraft || ''
    const plannerNeedsReplyer = ['reply', 'react'].includes(effectiveLlmDecision.decision?.action)
    let replyGuardDecision = checkReplyGuard({
        agentConfig,
        groupId,
        replyDraft: plannerReplyDraft || (plannerNeedsReplyer ? '__replyer_pending__' : ''),
        timestamp: agentMessage.timestamp,
        bypassCooldown: Boolean(
            scoreResult.traits?.mentionedBot ||
            scoreResult.traits?.replyToBot ||
            scoreResult.traits?.aliasMatched
        )
    })
    if (isSocialAction(effectiveLlmDecision.decision?.action)) {
        const llmSocialScore = Number(effectiveLlmDecision.decision.social?.interjectScore)
        const trustedSocialScore = Number.isFinite(llmSocialScore)
            ? Math.min(socialScore.score, Math.max(0, Math.min(1, llmSocialScore)))
            : socialScore.score
        replyGuardDecision = checkSocialBudget({
            agentConfig,
            groupId,
            userId: agentMessage.userId,
            topicId: sessionContext.topicId,
            timestamp: agentMessage.timestamp,
            action: effectiveLlmDecision.decision.action,
            score: trustedSocialScore,
            socialScore
        })
    }

    let policyDecision = validateDecisionPolicy({
        agentConfig,
        llmDecision: effectiveLlmDecision,
        messageTraits: scoreResult.traits || {},
        replyGuardDecision
    })
    const expressionHints = await selectExpressionHints({
        agentConfig,
        groupId,
        agentMessage,
        policyDecision
    })
    const replyerResult = await runReplyer({
        agentConfig,
        agentMessage,
        memoryObservation,
        longTermMemories,
        personProfile,
        expressionHints,
        llmDecision: effectiveLlmDecision,
        policyDecision,
        sessionContext
    })
    policyDecision = replyerResult.policyDecision || policyDecision
    if (policyDecision.accepted && policyDecision.wouldSend) {
        const finalReplyGuard = checkReplyGuard({
            agentConfig,
            groupId,
            replyDraft: policyDecision.replyDraft || '',
            timestamp: agentMessage.timestamp,
            bypassCooldown: Boolean(
                scoreResult.traits?.mentionedBot ||
                scoreResult.traits?.replyToBot ||
                scoreResult.traits?.aliasMatched
            )
        })
        if (finalReplyGuard.allowed === false) {
            policyDecision = {
                ...policyDecision,
                accepted: false,
                wouldSend: false,
                finalAction: 'listen',
                reason: finalReplyGuard.reason,
                replyGuardDecision: finalReplyGuard
            }
        } else {
            policyDecision = {
                ...policyDecision,
                replyGuardDecision: finalReplyGuard
            }
        }
    }
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
    if (execution.executed && isSocialAction(policyDecision.finalAction)) {
        recordSocialSend({ groupId, topicId: sessionContext.topicId, timestamp: agentMessage.timestamp })
    }
    const replyEffectPending = execution.executed
        ? trackSentReply({
            agentConfig,
            groupId,
            userId: agentMessage.userId,
            messageId: agentMessage.id,
            topicId: sessionContext.topicId,
            policyDecision,
            replyerResult,
            timestamp: Date.now()
        })
        : null
    const expressionLearning = await maybeLearnExpressions({
        agentConfig,
        memoryObservation,
        sessionContext
    })
    const result = runState.baseResult({
        ...runData,
        policyDecision,
        expressionHints,
        replyerResult,
        outputGuardrail: outputDecision.outputGuardrail,
        replyEffectObservation,
        replyEffectPending,
        expressionLearning,
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
            personProfile,
            personProfileWrite,
            extractedMemoryHints,
            memoryWrite,
            topicSummaryWrite,
            timingDecision,
            timingReentry: runState.timingReentry,
            budgetDecision,
            inputGuardrail,
            llmDecision: effectiveLlmDecision,
            rawLlmDecision: llmDecision,
            toolPlanResult,
            policyDecision,
            expressionHints,
            replyerResult,
            replyEffectObservation,
            replyEffectPending,
            expressionLearning,
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
    return runtimeMetricsService.track('aiReply', () => runWithAgentSession(runState.sessionContext, async () => {
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
    }), { latest: runState.timingReentry ? 'timing_reentry' : 'observe' })
}

module.exports = {
    runAgent,
    filterMemoryHintsForWrite
}
