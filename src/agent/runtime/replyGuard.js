const replyStates = new Map()

function nowMs() {
    return Date.now()
}

function getKey(groupId) {
    return String(groupId || 'unknown')
}

function normalizeText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function getState(groupId) {
    const key = getKey(groupId)
    let state = replyStates.get(key)
    if (!state) {
        state = { lastReplyAt: 0, lastReplyText: '' }
        replyStates.set(key, state)
    }
    return state
}

function checkReplyGuard({ agentConfig, groupId, replyDraft, timestamp = nowMs() }) {
    const cooldownMs = Math.max(0, Number(agentConfig?.replyPolicy?.cooldownMs) || 0)
    const state = getState(groupId)
    const normalizedDraft = normalizeText(replyDraft)

    if (!normalizedDraft) {
        return { allowed: false, reason: 'empty_reply_draft' }
    }

    if (cooldownMs > 0 && state.lastReplyAt > 0) {
        const elapsed = timestamp - state.lastReplyAt
        if (elapsed < cooldownMs) {
            return {
                allowed: false,
                reason: 'reply_cooldown_active',
                cooldownRemainingMs: cooldownMs - elapsed
            }
        }
    }

    const duplicateWindowMs = Math.max(cooldownMs, 120 * 1000)
    if (state.lastReplyText && state.lastReplyText === normalizedDraft && timestamp - state.lastReplyAt < duplicateWindowMs) {
        return { allowed: false, reason: 'duplicate_reply' }
    }

    return { allowed: true, reason: 'reply_allowed' }
}

function recordReply({ groupId, replyDraft, timestamp = nowMs() }) {
    const state = getState(groupId)
    state.lastReplyAt = timestamp
    state.lastReplyText = normalizeText(replyDraft)
}

function resetReplyGuard() {
    replyStates.clear()
}

module.exports = {
    checkReplyGuard,
    recordReply,
    resetReplyGuard
}
