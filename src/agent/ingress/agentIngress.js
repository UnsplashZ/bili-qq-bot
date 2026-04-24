const logger = require('../../utils/logger')
const { normalizeAgentConfig, isEnabledForGroup, getEffectiveAgentConfigForGroup } = require('../config/agentConfig')
const { normalizeMessage } = require('./messageNormalizer')
const { resolveActor } = require('../session/actorResolver')
const { runWithAgentSession } = require('../session/agentSessionContext')
const shortTermStore = require('../memory/shortTermStore')
const longTermStore = require('../memory/longTermStore')
const { scoreMessage } = require('../cognition/relevanceScorer')
const { decideReply } = require('../cognition/replyDecision')
const { decideWithLlm } = require('../cognition/agentDecisionService')
const { validateDecisionPolicy } = require('../cognition/decisionPolicyValidator')
const { checkBudget } = require('../runtime/budgetGuard')
const { recordTrajectory } = require('../runtime/trajectoryRecorder')
const { executeReply } = require('../runtime/replyExecutor')
const { checkReplyGuard } = require('../runtime/replyGuard')

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
            text: agentMessage.normalizedText || agentMessage.rawText
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
        const memoryWrite = await longTermStore.storeMemoryHints({
            hints: llmDecision.decision?.memoryHints || [],
            sessionContext,
            agentMessage,
            decision: llmDecision.decision
        })
        const policyDecision = validateDecisionPolicy({
            agentConfig,
            llmDecision,
            messageTraits: scoreResult.traits || {},
            replyGuardDecision: checkReplyGuard({
                agentConfig,
                groupId,
                replyDraft: llmDecision.decision?.replyDraft || '',
                timestamp: agentMessage.timestamp
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

        if (llmDecision.status === 'ok') {
            logger.logEvent('info', 'AGENT', sessionContext.traceScope, 'llm-decision', {
                groupId,
                userId: agentMessage.userId,
                topicId: sessionContext.topicId,
                action: llmDecision.decision.action,
                confidence: llmDecision.decision.confidence.toFixed(2),
                wouldSend: policyDecision.wouldSend,
                reason: llmDecision.decision.reason
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
            llmDecision,
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
            memoryWrite,
            budgetDecision,
            llmDecision,
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
                memoryWrite,
                budgetDecision,
                llmDecision,
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
    observe
}
