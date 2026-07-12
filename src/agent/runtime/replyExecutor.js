const logger = require('../../utils/logger')
const notificationService = require('../../services/notificationService')
const { recordReply } = require('./replyGuard')
const shortTermStore = require('../memory/shortTermStore')
const { isQqTransportReady, resolveOutboundTransport } = require('../../providers/qq/readiness')

function buildTextMessage(text) {
    const safeText = String(text || '').trim()
    if (!safeText) return []
    return [{ type: 'text', data: { text: safeText } }]
}

function normalizeMessageChain(chain, fallbackText) {
    if (Array.isArray(chain) && chain.length > 0) {
        return chain.filter((item) => item && typeof item === 'object')
    }
    return buildTextMessage(fallbackText)
}

async function sendMessage({ ws, groupId, userId, messageChain }) {
    if (typeof groupId === 'string' && groupId.startsWith('private_')) {
        const realUserId = groupId.replace('private_', '')
        if (!realUserId) return false
        await notificationService.sendPrivateMessage(ws, realUserId, messageChain, 'AgentReplyExecutor', false)
        return true
    }

    if (groupId) {
        await notificationService.sendGroupMessage(ws, groupId, messageChain, 'AgentReplyExecutor', false)
        return true
    }

    if (userId) {
        await notificationService.sendPrivateMessage(ws, userId, messageChain, 'AgentReplyExecutor', false)
        return true
    }

    return false
}

async function executeReply({ ws, groupId, userId, selfId = '', sourceMessageId = '', llmDecision, policyDecision, traceContext = {} }) {
    const scope = traceContext.scope || ''
    if (!policyDecision?.accepted || !policyDecision?.wouldSend) {
        return { executed: false, reason: policyDecision?.reason || 'policy_not_accepted' }
    }

    const replyDraft = policyDecision?.replyDraft || llmDecision?.decision?.replyDraft || ''
    const messageChain = normalizeMessageChain(
        policyDecision?.messageChain || llmDecision?.decision?.messageChain,
        replyDraft
    )
    if (messageChain.length === 0) {
        return { executed: false, reason: 'empty_reply_draft' }
    }

    const activeTransport = resolveOutboundTransport(ws)
    if (!isQqTransportReady(activeTransport)) {
        logger.logEvent('warn', 'AGENT', scope, 'reply-skipped', {
            groupId,
            userId,
            reason: 'transport_not_ready'
        })
        return { executed: false, reason: 'transport_not_ready' }
    }

    try {
        const sent = await sendMessage({ ws: activeTransport, groupId, userId, messageChain })
        if (!sent) {
            logger.logEvent('warn', 'AGENT', scope, 'reply-skipped', {
                groupId,
                userId,
                reason: 'missing_target'
            })
            return { executed: false, reason: 'missing_target' }
        }

        logger.logEvent('info', 'AGENT', scope, 'reply-sent', {
            groupId,
            userId,
            action: policyDecision.finalAction,
            confidence: llmDecision.decision.confidence.toFixed(2)
        })
        recordReply({ groupId, replyDraft })
        shortTermStore.recordAssistantReply({
            groupId,
            selfId,
            replyText: replyDraft,
            sourceMessageId,
            timestamp: Date.now()
        })
        return { executed: true, reason: 'sent', action: policyDecision.finalAction }
    } catch (error) {
        logger.logEvent('warn', 'AGENT', scope, 'reply-failed', {
            groupId,
            userId,
            error: logger.getErrorMessage(error)
        })
        return { executed: false, reason: 'send_failed', error: logger.getErrorMessage(error) }
    }
}

module.exports = {
    executeReply,
    buildTextMessage,
    normalizeMessageChain
}
