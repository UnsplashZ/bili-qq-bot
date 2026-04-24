const logger = require('../../utils/logger')
const { normalizeAgentConfig, isEnabledForGroup } = require('../config/agentConfig')
const { normalizeMessage } = require('./messageNormalizer')
const { resolveActor } = require('../session/actorResolver')
const { runWithAgentSession } = require('../session/agentSessionContext')
const shortTermStore = require('../memory/shortTermStore')
const { scoreMessage } = require('../cognition/relevanceScorer')
const { decideReply } = require('../cognition/replyDecision')
const { recordTrajectory } = require('../runtime/trajectoryRecorder')

async function observe(context) {
    const agentConfig = normalizeAgentConfig()
    const groupId = context.groupId ? String(context.groupId) : ''

    if (!isEnabledForGroup(groupId, agentConfig)) {
        return { skipped: true, reason: 'agent_disabled' }
    }

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
        const result = {
            skipped: false,
            message: agentMessage,
            session: sessionContext,
            topic: memoryObservation.topicSnapshot,
            score: scoreResult,
            decision
        }

        logger.logEvent('info', 'AGENT', sessionContext.traceScope, 'observe-decision', {
            groupId,
            userId: agentMessage.userId,
            topicId: sessionContext.topicId,
            action: decision.action,
            score: decision.score.toFixed(2),
            wouldReply: decision.wouldReply,
            reasons: decision.reasons.join(','),
            penalties: decision.penalties.join(',')
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
                decision,
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
