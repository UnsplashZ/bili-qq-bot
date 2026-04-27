const effects = []
const pending = new Map()
const MAX_EFFECTS = 500

function pendingKey(groupId) {
    return String(groupId || 'unknown')
}

function trackPendingReply({ groupId, userId, messageId, topicId, action, text, expressionIds = [], timestamp = Date.now() } = {}) {
    if (!groupId || !text) return null
    const item = {
        id: `effect_${timestamp}_${Math.random().toString(36).slice(2, 8)}`,
        groupId: String(groupId),
        targetUserId: String(userId || ''),
        sourceMessageId: String(messageId || ''),
        topicId: String(topicId || ''),
        action: String(action || ''),
        text: String(text || ''),
        expressionIds: Array.isArray(expressionIds) ? expressionIds.map(String).filter(Boolean) : [],
        sentAt: timestamp,
        observedMessages: [],
        status: 'pending'
    }
    pending.set(pendingKey(groupId), item)
    return item
}

function recordEffect(effect) {
    effects.push(effect)
    effects.splice(0, Math.max(0, effects.length - MAX_EFFECTS))
    return effect
}

function consumePending(groupId) {
    const key = pendingKey(groupId)
    const item = pending.get(key)
    if (item) pending.delete(key)
    return item || null
}

function getPending(groupId) {
    return pending.get(pendingKey(groupId)) || null
}

function listEffects({ groupId = '', limit = 20 } = {}) {
    return effects
        .filter((effect) => !groupId || effect.groupId === String(groupId))
        .slice(-Math.max(1, Math.min(100, Number(limit) || 20)))
        .reverse()
}

function resetForTest() {
    effects.length = 0
    pending.clear()
}

module.exports = {
    trackPendingReply,
    recordEffect,
    consumePending,
    getPending,
    listEffects,
    resetForTest
}
