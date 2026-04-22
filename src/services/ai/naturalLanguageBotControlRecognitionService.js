'use strict'

function normalizeMessage(rawMessage) {
    return String(rawMessage || '').replace(/\[CQ:[^\]]+\]/g, ' ').trim()
}

function buildContextResetAction() {
    return {
        action: 'context.write',
        input: {
            operation: 'reset'
        }
    }
}

function buildSubscriptionAction(operation, uid) {
    return {
        action: 'subscription.write',
        input: {
            operation,
            uid
        }
    }
}

function buildSubscriptionSearchAction(query) {
    return {
        action: 'subscription.read',
        input: {
            operation: 'search_user',
            query
        }
    }
}

function buildConfigReadAction() {
    return {
        action: 'config.read',
        input: {
            operation: 'get'
        }
    }
}

function buildConfigWriteAction(updates) {
    return {
        action: 'config.write',
        input: updates
    }
}

function buildApprovalReadAction() {
    return {
        action: 'approval.read',
        input: {
            operation: 'list'
        }
    }
}

function buildApprovalWriteAction(operation, target = {}) {
    return {
        action: 'approval.write',
        input: {
            operation,
            ...target
        }
    }
}

function normalizeCompactMessage(rawMessage) {
    return String(rawMessage || '').replace(/\[CQ:[^\]]+\]/g, ' ').trim().replace(/\s+/g, ' ').toLowerCase()
}

function normalizePlainText(rawMessage) {
    return String(rawMessage || '').replace(/\[CQ:[^\]]+\]/g, ' ').trim()
}

function isInitialBotControlTriggerAllowed(messageMeta = {}) {
    const source = String(messageMeta?.source || '').trim()

    if (source === 'private') {
        return true
    }

    return messageMeta?.isAtBot === true || messageMeta?.isReplyToBot === true
}

function recognizeApprovalDecisionPhrase(rawMessage) {
    const normalizedMessage = normalizePlainText(rawMessage).toLowerCase()

    if (!normalizedMessage) {
        return ''
    }

    if (normalizedMessage === '是' || normalizedMessage === '同意' || normalizedMessage === 'yes' || normalizedMessage === 'y' || normalizedMessage === 'approve') {
        return 'approve'
    }

    if (normalizedMessage === '否' || normalizedMessage === '拒绝' || normalizedMessage === 'no' || normalizedMessage === 'n' || normalizedMessage === 'reject') {
        return 'reject'
    }

    return ''
}

function recognizeNaturalLanguageBotControlAction(rawMessage, options = {}) {
    const normalizedMessage = normalizeMessage(rawMessage)
    const compactMessage = normalizeCompactMessage(rawMessage)
    const messageMeta = options?.messageMeta || {}
    const replyToMessageId = String(messageMeta?.replyToMessageId || '').trim()

    if (!normalizedMessage) {
        return null
    }

    if (!isInitialBotControlTriggerAllowed(messageMeta)) {
        return null
    }

    if (
        /^reset current group context$/i.test(normalizedMessage)
        || normalizedMessage === '清空上下文'
        || normalizedMessage === '重置上下文'
        || normalizedMessage === '重置当前群上下文'
    ) {
        return buildContextResetAction()
    }

    if (
        compactMessage === '查看当前群ai配置'
        || compactMessage === '查看ai配置'
        || compactMessage === '当前群ai配置'
        || compactMessage === 'ai配置'
        || compactMessage === '查看当前群ai状态'
        || compactMessage === '查看ai状态'
        || compactMessage === '当前群ai状态'
        || compactMessage === 'ai状态'
        || compactMessage === 'show current group ai config'
        || compactMessage === 'show ai config'
        || compactMessage === 'current group ai config'
        || compactMessage === 'show current group ai status'
        || compactMessage === 'show ai status'
        || compactMessage === 'current group ai status'
    ) {
        return buildConfigReadAction()
    }

    if (
        compactMessage === '查看待审批'
        || compactMessage === '待审批列表'
        || compactMessage === '查看审批列表'
        || compactMessage === '查看审批'
        || compactMessage === 'list approvals'
        || compactMessage === 'show approvals'
        || compactMessage === 'show pending approvals'
    ) {
        return buildApprovalReadAction()
    }

    if (replyToMessageId) {
        const replyDecision = recognizeApprovalDecisionPhrase(rawMessage)

        if (replyDecision) {
            return buildApprovalWriteAction(replyDecision, {
                replyMessageId: replyToMessageId
            })
        }
    }

    const exactApprovalMatch = normalizedMessage.match(/^(同意|拒绝|approve|reject)\s+(REQ-[A-Z0-9]+(?:-\d+)?)$/i)

    if (exactApprovalMatch) {
        return buildApprovalWriteAction(
            /^(同意|approve)$/i.test(exactApprovalMatch[1]) ? 'approve' : 'reject',
            { shortId: String(exactApprovalMatch[2]).toUpperCase() }
        )
    }

    if (
        compactMessage === '开启ai'
        || compactMessage === '打开ai'
        || compactMessage === '启用ai'
        || compactMessage === '关闭ai'
        || compactMessage === '禁用ai'
        || compactMessage === '关闭 rag'
        || compactMessage === '禁用 rag'
        || compactMessage === '开启 rag'
        || compactMessage === '打开 rag'
        || compactMessage === '启用 rag'
        || compactMessage === '启用rag'
        || compactMessage === '开启rag'
        || compactMessage === '打开rag'
        || compactMessage === '关闭rag'
        || compactMessage === '禁用rag'
        || compactMessage === 'enable ai'
        || compactMessage === 'disable ai'
        || compactMessage === 'enable rag'
        || compactMessage === 'disable rag'
    ) {
        if (compactMessage.includes('rag')) {
            return buildConfigWriteAction({
                aiRagEnabled: compactMessage.startsWith('关') || compactMessage.startsWith('禁') || compactMessage === 'disable rag'
                    ? false
                    : true
            })
        }

        return buildConfigWriteAction({
            aiEnabled: compactMessage.startsWith('关') || compactMessage.startsWith('禁') || compactMessage === 'disable ai'
                ? false
                : true
        })
    }

    const subscribeMatch = normalizedMessage.match(/^订阅\s*uid\s+(\d+)$/i)
        || normalizedMessage.match(/^subscribe(?:\s+exact)?\s+uid\s+(\d+)$/i)

    if (subscribeMatch) {
        return buildSubscriptionAction('add_user', subscribeMatch[1])
    }

    const unsubscribeMatch = normalizedMessage.match(/^取消订阅\s*uid\s+(\d+)$/i)
        || normalizedMessage.match(/^unsubscribe(?:\s+exact)?\s+uid\s+(\d+)$/i)

    if (unsubscribeMatch) {
        return buildSubscriptionAction('remove_user', unsubscribeMatch[1])
    }

    const fuzzySubscribeMatch = normalizedMessage.match(/^订阅\s*(.+)$/)

    if (fuzzySubscribeMatch) {
        const query = String(fuzzySubscribeMatch[1] || '').trim()

        if (query) {
            return buildSubscriptionSearchAction(query)
        }
    }

    return null
}

module.exports = {
    recognizeNaturalLanguageBotControlAction
}
