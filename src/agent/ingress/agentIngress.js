const logger = require('../../utils/logger')
const notificationService = require('../../services/notificationService')
const { normalizeAgentConfig, isEnabledForGroup, getEffectiveAgentConfigForGroup } = require('../config/agentConfig')
const { normalizeMessage } = require('./messageNormalizer')
const { resolveActor } = require('../session/actorResolver')
const { runWithAgentSession } = require('../session/agentSessionContext')
const shortTermStore = require('../memory/shortTermStore')
const longTermStore = require('../memory/longTermStore')
const { maybeStoreTopicSummary } = require('../memory/topicSummaryRecorder')
const { extractMemoryHints, mergeMemoryHints } = require('../memory/memoryHintExtractor')
const { scoreMessage } = require('../cognition/relevanceScorer')
const { decideReply } = require('../cognition/replyDecision')
const { decideWithLlm } = require('../cognition/agentDecisionService')
const { validateDecisionPolicy } = require('../cognition/decisionPolicyValidator')
const { checkBudget } = require('../runtime/budgetGuard')
const { recordTrajectory } = require('../runtime/trajectoryRecorder')
const { executeReply } = require('../runtime/replyExecutor')
const { checkReplyGuard } = require('../runtime/replyGuard')
const { processToolPlan, tryConsumeToolConfirmation } = require('../tools/toolPlanProcessor')

async function sendSystemReply({ context, groupId, userId, decision, traceContext }) {
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
    return executeReply({
        ws: context.ws,
        groupId,
        userId,
        llmDecision,
        policyDecision,
        traceContext
    })
}

function senderIsSelf(messagePayload, selfId) {
    const normalizedSelfId = String(selfId || '')
    if (!normalizedSelfId) return false
    const senderUserId = messagePayload?.sender?.user_id ?? messagePayload?.sender?.userId ?? messagePayload?.user_id
    return senderUserId !== undefined && senderUserId !== null && String(senderUserId) === normalizedSelfId
}

async function resolveReplyToSelf({ ws, agentMessage, messageData, traceScope }) {
    if (!agentMessage.hasReply) return false
    if (senderIsSelf(messageData?.reply, agentMessage.selfId)) return true
    if (!agentMessage.replyMessageId || !ws || ws.readyState !== 1) return false

    try {
        const response = await notificationService.callAction(
            ws,
            'get_msg',
            { message_id: agentMessage.replyMessageId },
            'AgentReplyResolver',
            3000
        )
        return senderIsSelf(response?.data, agentMessage.selfId)
    } catch (error) {
        logger.logEvent('debug', 'AGENT', traceScope || '', 'reply-target-resolve-failed', {
            messageId: agentMessage.id,
            replyMessageId: agentMessage.replyMessageId,
            error: logger.getErrorMessage(error)
        })
        return false
    }
}

async function observe(context) {
    const baseAgentConfig = normalizeAgentConfig()
    const groupId = context.groupId ? String(context.groupId) : ''

    if (!isEnabledForGroup(groupId, baseAgentConfig)) {
        return { skipped: true, reason: 'agent_disabled' }
    }
    const agentConfig = getEffectiveAgentConfigForGroup(groupId, baseAgentConfig)

    const agentMessage = normalizeMessage({
        rawMessage: context.rawMessage,
        messageSegments: context.messageData?.message,
        messageData: context.messageData,
        aliases: agentConfig.aliases
    })
    agentMessage.replyToSelf = await resolveReplyToSelf({
        ws: context.ws,
        agentMessage,
        messageData: context.messageData,
        traceScope: context.traceContext?.scope || ''
    })
    const actor = resolveActor({ groupId, userId: context.userId, messageData: context.messageData })
    const memoryObservation = shortTermStore.observe(agentMessage, agentConfig.shortTerm)
    const sessionContext = {
        platform: 'qq',
        chatType: agentMessage.messageType,
        groupId,
        userId: agentMessage.userId,
        messageId: agentMessage.id,
        topicId: memoryObservation.topic.topicId,
        traceScope: context.traceContext?.scope || '',
        isSharedMultiUserSession: agentMessage.messageType === 'group',
        actor
    }

    return runWithAgentSession(sessionContext, async () => {
        const scoreResult = scoreMessage({ agentMessage, memoryObservation, actor })
        const consumedToolConfirmation = await tryConsumeToolConfirmation({
            agentMessage,
            agentConfig,
            sessionContext
        })
        if (consumedToolConfirmation) {
            const execution = await sendSystemReply({
                context,
                groupId,
                userId: agentMessage.userId,
                decision: consumedToolConfirmation.decisionOverride,
                traceContext: context.traceContext
            })
            const result = {
                skipped: false,
                message: agentMessage,
                session: sessionContext,
                topic: memoryObservation.topicSnapshot,
                score: scoreResult,
                toolConfirmation: consumedToolConfirmation,
                execution
            }
            if (agentConfig.logTrajectory) {
                await recordTrajectory({
                    type: 'tool_confirmation',
                    traceScope: sessionContext.traceScope,
                    groupId,
                    userId: agentMessage.userId,
                    messageId: agentMessage.id,
                    topicId: sessionContext.topicId,
                    toolConfirmation: consumedToolConfirmation,
                    execution
                })
            }
            return result
        }

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
        const toolPlanResult = await processToolPlan({
            decision: llmDecision.decision,
            agentConfig,
            sessionContext
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
        const memoryHints = mergeMemoryHints(effectiveLlmDecision.decision?.memoryHints || [], extractedMemoryHints)
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
        if (toolPlanResult?.decisionOverride) {
            const execution = await sendSystemReply({
                context,
                groupId,
                userId: agentMessage.userId,
                decision: toolPlanResult.decisionOverride,
                traceContext: context.traceContext
            })
            const result = {
                skipped: false,
                message: agentMessage,
                session: sessionContext,
                topic: memoryObservation.topicSnapshot,
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
                execution
            }
            if (agentConfig.logTrajectory) {
                await recordTrajectory({
                    type: 'tool_plan_result',
                    traceScope: sessionContext.traceScope,
                    groupId,
                    userId: agentMessage.userId,
                    messageId: agentMessage.id,
                    topicId: sessionContext.topicId,
                    toolPlanResult,
                    execution,
                    actor: {
                        isRoot: actor.isRoot,
                        isConfiguredGroupAdmin: actor.isConfiguredGroupAdmin,
                        qqRole: actor.qqRole,
                        canManageGroupConfig: actor.canManageGroupConfig,
                        canManageSubscriptions: actor.canManageSubscriptions,
                        canManageGlobalConfig: actor.canManageGlobalConfig
                    }
                })
            }
            return result
        }
        const policyDecision = validateDecisionPolicy({
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

        const execution = await executeReply({
            ws: context.ws,
            groupId,
            userId: agentMessage.userId,
            llmDecision: effectiveLlmDecision,
            policyDecision,
            traceContext: context.traceContext
        })
        const result = {
            skipped: false,
            message: agentMessage,
            session: sessionContext,
            topic: memoryObservation.topicSnapshot,
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
            policyDecision,
            execution
        }

        if (agentConfig.logTrajectory) {
            await recordTrajectory({
                type: 'observe_decision',
                traceScope: sessionContext.traceScope,
                groupId,
                userId: agentMessage.userId,
                messageId: agentMessage.id,
                topicId: sessionContext.topicId,
                rawTextPreview: agentMessage.rawText,
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
                execution,
                score: scoreResult,
                actor: {
                    isRoot: actor.isRoot,
                    isConfiguredGroupAdmin: actor.isConfiguredGroupAdmin,
                    qqRole: actor.qqRole,
                    canManageGroupConfig: actor.canManageGroupConfig,
                    canManageSubscriptions: actor.canManageSubscriptions,
                    canManageGlobalConfig: actor.canManageGlobalConfig
                }
            })
        }

        return result
    })
}

module.exports = {
    observe,
    resolveReplyToSelf
}
