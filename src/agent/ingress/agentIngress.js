const logger = require('../../utils/logger')
const notificationService = require('../../services/notificationService')
const { normalizeAgentConfig, isEnabledForGroup, getEffectiveAgentConfigForGroup } = require('../config/agentConfig')
const { normalizeMessage, textifyCqAt, textifySegment } = require('./messageNormalizer')
const { resolveActor } = require('../session/actorResolver')
const shortTermStore = require('../memory/shortTermStore')
const { AgentRunState } = require('../runtime/runState')
const { runAgent, filterMemoryHintsForWrite } = require('../runtime/agentRunner')

function senderIsSelf(messagePayload, selfId) {
    const normalizedSelfId = String(selfId || '')
    if (!normalizedSelfId) return false
    const senderUserId = messagePayload?.sender?.user_id ?? messagePayload?.sender?.userId ?? messagePayload?.user_id
    return senderUserId !== undefined && senderUserId !== null && String(senderUserId) === normalizedSelfId
}

function extractPayloadText(messagePayload, selfId = '') {
    if (!messagePayload || typeof messagePayload !== 'object') return ''
    const segments = Array.isArray(messagePayload.message) ? messagePayload.message : []
    const segmentText = segments.map((segment) => textifySegment(segment, selfId)).join(' ').replace(/\s+/g, ' ').trim()
    if (segmentText) return segmentText
    return textifyCqAt(messagePayload.raw_message || messagePayload.message_text || '', selfId).replace(/\s+/g, ' ').trim()
}

function buildReplyTarget(messagePayload, selfId, fallbackMessageId = '') {
    if (!messagePayload || typeof messagePayload !== 'object') return null
    const senderUserId = messagePayload?.sender?.user_id ?? messagePayload?.sender?.userId ?? messagePayload?.user_id
    const messageId = messagePayload?.message_id ?? messagePayload?.id ?? fallbackMessageId
    return {
        messageId: messageId !== undefined && messageId !== null ? String(messageId) : '',
        userId: senderUserId !== undefined && senderUserId !== null ? String(senderUserId) : '',
        isBot: senderIsSelf(messagePayload, selfId),
        text: extractPayloadText(messagePayload, selfId)
    }
}

async function resolveReplyContext({ ws, agentMessage, messageData, traceScope }) {
    if (!agentMessage.hasReply) return { replyToSelf: false, replyTarget: null }
    const embeddedTarget = buildReplyTarget(messageData?.reply, agentMessage.selfId, agentMessage.replyMessageId)
    if (embeddedTarget?.text) {
        return {
            replyToSelf: embeddedTarget.isBot,
            replyTarget: embeddedTarget
        }
    }
    if (!agentMessage.replyMessageId || !ws || ws.readyState !== 1) {
        return {
            replyToSelf: Boolean(embeddedTarget?.isBot),
            replyTarget: embeddedTarget
        }
    }

    try {
        const response = await notificationService.callAction(
            ws,
            'get_msg',
            { message_id: agentMessage.replyMessageId },
            'AgentReplyResolver',
            3000
        )
        const replyTarget = buildReplyTarget(response?.data, agentMessage.selfId, agentMessage.replyMessageId)
        return {
            replyToSelf: Boolean(replyTarget?.isBot || embeddedTarget?.isBot),
            replyTarget: replyTarget || embeddedTarget
        }
    } catch (error) {
        logger.logEvent('debug', 'AGENT', traceScope || '', 'reply-target-resolve-failed', {
            messageId: agentMessage.id,
            replyMessageId: agentMessage.replyMessageId,
            error: logger.getErrorMessage(error)
        })
        return { replyToSelf: false, replyTarget: null }
    }
}

async function resolveReplyToSelf(args) {
    const replyContext = await resolveReplyContext(args)
    return Boolean(replyContext.replyToSelf)
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
    const replyContext = await resolveReplyContext({
        ws: context.ws,
        agentMessage,
        messageData: context.messageData,
        traceScope: context.traceContext?.scope || ''
    })
    agentMessage.replyToSelf = replyContext.replyToSelf
    agentMessage.replyTarget = replyContext.replyTarget
    const actor = resolveActor({ groupId, userId: context.userId, messageData: context.messageData })
    const memoryObservation = shortTermStore.observe(agentMessage, agentConfig.shortTerm)
    const sessionContext = {
        platform: 'qq',
        chatType: agentMessage.messageType,
        ws: context.ws,
        groupId,
        userId: agentMessage.userId,
        selfId: agentMessage.selfId,
        messageId: agentMessage.id,
        replyTarget: agentMessage.replyTarget,
        topicId: memoryObservation.topic.topicId,
        traceScope: context.traceContext?.scope || '',
        isSharedMultiUserSession: agentMessage.messageType === 'group',
        actor,
        agentMessage
    }

    return runAgent(new AgentRunState({
        context,
        groupId,
        agentConfig,
        agentMessage,
        actor,
        memoryObservation,
        sessionContext
    }))
}

module.exports = {
    observe,
    resolveReplyContext,
    resolveReplyToSelf,
    filterMemoryHintsForWrite
}
