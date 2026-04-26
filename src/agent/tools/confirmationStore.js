const pendingConfirmations = new Map()

function nowMs() {
    return Date.now()
}

function getKey({ groupId, userId }) {
    return `${String(groupId || '')}:${String(userId || '')}`
}

function normalizeText(value) {
    return String(value || '')
        .replace(/\[CQ:[^\]]+\]/g, '')
        .replace(/@bot/gi, '')
        .replace(/\s+/g, '')
        .trim()
        .toLowerCase()
}

function isDirectlyAddressed(agentMessage) {
    return Boolean(agentMessage?.mentionsSelf || agentMessage?.replyToSelf || agentMessage?.aliasMatched)
}

function makeShortId() {
    return Math.random().toString(36).slice(2, 6)
}

function parseDecisionText(text, shortId = '') {
    const normalized = normalizeText(text)
    const confirmWords = ['确认', '确认执行', '执行', '同意', '是', 'yes', 'confirm', 'y', 'ok']
    const cancelWords = ['取消', '算了', '不要', '否', 'no', 'n', 'stop']
    const normalizedShortId = normalizeText(shortId)

    if (normalizedShortId && normalized === normalizedShortId) {
        return { action: 'confirm', hasCode: true }
    }

    for (const word of confirmWords) {
        if (normalized === word) return { action: 'confirm', hasCode: false }
        if (normalizedShortId && normalized === `${word}${normalizedShortId}`) {
            return { action: 'confirm', hasCode: true }
        }
        if (word.length > 1 && normalizedShortId && normalized.includes(normalizedShortId) && normalized.includes(word)) {
            return { action: 'confirm', hasCode: true }
        }
    }

    for (const word of cancelWords) {
        if (normalized === word) return { action: 'cancel', hasCode: false }
        if (normalizedShortId && normalized === `${word}${normalizedShortId}`) {
            return { action: 'cancel', hasCode: true }
        }
        if (word.length > 1 && normalizedShortId && normalized.includes(normalizedShortId) && normalized.includes(word)) {
            return { action: 'cancel', hasCode: true }
        }
    }

    return { action: 'none', hasCode: false }
}

function includesShortId(text, shortId = '') {
    const normalizedShortId = normalizeText(shortId)
    if (!normalizedShortId) return false
    return normalizeText(text).includes(normalizedShortId)
}

function isConfirmText(text, shortId = '') {
    return parseDecisionText(text, shortId).action === 'confirm'
}

function isCancelText(text, shortId = '') {
    return parseDecisionText(text, shortId).action === 'cancel'
}

function createConfirmation({ plan, sessionContext, ttlMs }) {
    const expiresAt = nowMs() + Math.max(10 * 1000, Number(ttlMs) || 60 * 1000)
    const key = getKey(sessionContext)
    const confirmation = {
        id: `confirm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        plan,
        groupId: String(sessionContext?.groupId || ''),
        userId: String(sessionContext?.userId || ''),
        requestMessageId: String(sessionContext?.messageId || ''),
        shortId: makeShortId(),
        createdAt: new Date().toISOString(),
        expiresAt
    }
    pendingConfirmations.set(key, confirmation)
    return confirmation
}

function getPending(sessionContext) {
    const key = getKey(sessionContext)
    const pending = pendingConfirmations.get(key)
    if (!pending) return null
    if (pending.expiresAt <= nowMs()) {
        pendingConfirmations.delete(key)
        return null
    }
    return pending
}

function summarizeConfirmation(confirmation) {
    return {
        id: confirmation.id,
        groupId: confirmation.groupId,
        userId: confirmation.userId,
        requestMessageId: confirmation.requestMessageId,
        shortId: confirmation.shortId,
        createdAt: confirmation.createdAt,
        expiresAt: new Date(confirmation.expiresAt).toISOString(),
        plan: {
            id: confirmation.plan?.id || '',
            name: confirmation.plan?.name || '',
            risk: confirmation.plan?.risk || '',
            permission: confirmation.plan?.permission || '',
            summary: confirmation.plan?.summary || ''
        }
    }
}

function listPendingConfirmations(filters = {}) {
    const groupId = String(filters.groupId || '')
    const userId = String(filters.userId || '')
    const active = []

    for (const [key, confirmation] of pendingConfirmations.entries()) {
        if (confirmation.expiresAt <= nowMs()) {
            pendingConfirmations.delete(key)
            continue
        }
        if (groupId && confirmation.groupId !== groupId) continue
        if (userId && confirmation.userId !== userId) continue
        active.push(summarizeConfirmation(confirmation))
    }

    return active.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
}

function consumeConfirmation({ sessionContext, agentMessage, text }) {
    const pending = getPending(sessionContext)
    if (!pending) return { consumed: false, action: 'none' }

    const decision = parseDecisionText(text, pending.shortId)
    if (decision.action === 'none') {
        return { consumed: false, action: 'pending', pending }
    }

    if (!decision.hasCode && !isDirectlyAddressed(agentMessage)) {
        return { consumed: false, action: 'needs_addressing', pending }
    }

    if (decision.action === 'cancel') {
        pendingConfirmations.delete(getKey(sessionContext))
        return { consumed: true, action: 'cancel', pending }
    }

    if (decision.action === 'confirm') {
        pendingConfirmations.delete(getKey(sessionContext))
        return { consumed: true, action: 'confirm', pending }
    }

    return { consumed: false, action: 'pending', pending }
}

function resetConfirmations() {
    pendingConfirmations.clear()
}

module.exports = {
    createConfirmation,
    getPending,
    listPendingConfirmations,
    consumeConfirmation,
    resetConfirmations,
    isConfirmText,
    isCancelText,
    parseDecisionText,
    includesShortId
}
