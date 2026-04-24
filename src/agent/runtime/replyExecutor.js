const logger = require('../../utils/logger')
const notificationService = require('../../services/notificationService')

function buildTextMessage(text) {
    const safeText = String(text || '').trim()
    if (!safeText) return []
    return [{ type: 'text', data: { text: safeText } }]
}

function sendMessage({ ws, groupId, userId, messageChain }) {
    if (typeof groupId === 'string' && groupId.startsWith('private_')) {
        const realUserId = groupId.replace('private_', '')
        if (!realUserId) return false
        notificationService.sendPrivateMessage(ws, realUserId, messageChain, 'AgentReplyExecutor', false)
        return true
    }

    if (groupId) {
        notificationService.sendGroupMessage(ws, groupId, messageChain, 'AgentReplyExecutor', false)
        return true
    }

    if (userId) {
        notificationService.sendPrivateMessage(ws, userId, messageChain, 'AgentReplyExecutor', false)
        return true
    }

    return false
}

async function executeReply({ ws, groupId, userId, llmDecision, policyDecision, traceContext = {} }) {
    const scope = traceContext.scope || ''
    if (!policyDecision?.accepted || !policyDecision?.wouldSend) {
        return { executed: false, reason: policyDecision?.reason || 'policy_not_accepted' }
    }

    const replyDraft = llmDecision?.decision?.replyDraft || ''
    const messageChain = buildTextMessage(replyDraft)
    if (messageChain.length === 0) {
        return { executed: false, reason: 'empty_reply_draft' }
    }

    if (!ws || ws.readyState !== 1) {
        logger.logEvent('warn', 'AGENT', scope, 'reply-skipped', {
            groupId,
            userId,
            reason: 'ws_not_open'
        })
        return { executed: false, reason: 'ws_not_open' }
    }

    try {
        const sent = sendMessage({ ws, groupId, userId, messageChain })
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
    buildTextMessage
}
