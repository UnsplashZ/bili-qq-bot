const socialStates = new Map()

function nowMs() {
    return Date.now()
}

function dateKey(timestamp = nowMs()) {
    return new Date(timestamp).toISOString().slice(0, 10)
}

function getState(groupId) {
    const key = String(groupId || 'unknown')
    let state = socialStates.get(key)
    if (!state) {
        state = {
            lastInterjectAt: 0,
            dailyKey: '',
            dailyCount: 0,
            topicCounts: new Map()
        }
        socialStates.set(key, state)
    }
    return state
}

function normalizeSocialConfig(agentConfig = {}) {
    const social = agentConfig.social || {}
    const numberOrDefault = (value, fallback) => {
        const parsed = Number(value)
        return Number.isFinite(parsed) ? parsed : fallback
    }
    const mode = ['quiet', 'normal', 'active', 'debug'].includes(social.mode) ? social.mode : 'quiet'
    const probabilityMultiplier = mode === 'active' ? 1.5 : 1
    return {
        enabled: Boolean(social.enabled),
        mode,
        cooldownMs: Math.max(0, Math.trunc(numberOrDefault(social.cooldownMs, 90000))),
        dailyInterjectLimit: Math.max(0, Math.trunc(numberOrDefault(social.dailyInterjectLimit, 30))),
        perTopicInterjectLimit: Math.max(0, Math.trunc(numberOrDefault(social.perTopicInterjectLimit, 2))),
        interjectProbability: Math.min(1, Math.max(0, numberOrDefault(social.interjectProbability, 0.18) * probabilityMultiplier)),
        ambientReactProbability: Math.min(1, Math.max(0, numberOrDefault(social.ambientReactProbability, 0.08) * probabilityMultiplier)),
        minInterjectScore: Math.min(1, Math.max(0, numberOrDefault(social.minInterjectScore, 0.72))),
        minAmbientScore: Math.min(1, Math.max(0, numberOrDefault(social.minAmbientScore, 0.62))),
        maxCasualReplyChars: Math.max(20, Math.min(500, Math.trunc(numberOrDefault(social.maxCasualReplyChars, 120)))),
        avoidDuringRapidTwoPersonChat: social.avoidDuringRapidTwoPersonChat !== false
    }
}

function deterministicRoll({ groupId, userId, topicId, timestamp, action }) {
    const seed = `${groupId}:${userId}:${topicId}:${Math.floor(Number(timestamp || 0) / 60000)}:${action}`
    let hash = 0
    for (let index = 0; index < seed.length; index += 1) {
        hash = ((hash << 5) - hash + seed.charCodeAt(index)) >>> 0
    }
    return (hash % 10000) / 10000
}

function checkSocialBudget({ agentConfig, groupId, userId, topicId = '', timestamp = nowMs(), action = 'react', score = 0, socialScore = null }) {
    const config = normalizeSocialConfig(agentConfig)
    if (!config.enabled || config.mode === 'quiet') return { allowed: false, reason: 'social_disabled', config }
    if (config.avoidDuringRapidTwoPersonChat && socialScore?.rapidTwoPersonChat) {
        return { allowed: false, reason: 'social_rapid_two_person_chat', config }
    }

    const minScore = false ? config.minAmbientScore : config.minInterjectScore
    if (Number(score || 0) < minScore) return { allowed: false, reason: 'social_score_below_threshold', config }

    const state = getState(groupId)
    const currentDateKey = dateKey(timestamp)
    if (state.dailyKey !== currentDateKey) {
        state.dailyKey = currentDateKey
        state.dailyCount = 0
        state.topicCounts.clear()
    }

    if (config.dailyInterjectLimit > 0 && state.dailyCount >= config.dailyInterjectLimit) {
        return { allowed: false, reason: 'social_daily_limit', config }
    }

    const normalizedTopicId = String(topicId || 'unknown')
    const topicCount = state.topicCounts.get(normalizedTopicId) || 0
    if (config.perTopicInterjectLimit > 0 && topicCount >= config.perTopicInterjectLimit) {
        return { allowed: false, reason: 'social_topic_limit', config }
    }

    if (config.cooldownMs > 0 && state.lastInterjectAt > 0 && timestamp - state.lastInterjectAt < config.cooldownMs) {
        return { allowed: false, reason: 'social_cooldown_active', cooldownRemainingMs: config.cooldownMs - (timestamp - state.lastInterjectAt), config }
    }

    if (config.mode !== 'debug') {
        const probability = false ? config.ambientReactProbability : config.interjectProbability
        if (probability <= 0) return { allowed: false, reason: 'social_probability_skip', roll: null, probability, config }
        const roll = deterministicRoll({ groupId, userId, topicId: normalizedTopicId, timestamp, action })
        if (roll >= probability) return { allowed: false, reason: 'social_probability_skip', roll, probability, config }
    }

    return { allowed: true, reason: 'social_allowed', config }
}

function recordSocialSend({ groupId, topicId = '', timestamp = nowMs() }) {
    const state = getState(groupId)
    const currentDateKey = dateKey(timestamp)
    if (state.dailyKey !== currentDateKey) {
        state.dailyKey = currentDateKey
        state.dailyCount = 0
        state.topicCounts.clear()
    }
    const normalizedTopicId = String(topicId || 'unknown')
    state.lastInterjectAt = timestamp
    state.dailyCount += 1
    state.topicCounts.set(normalizedTopicId, (state.topicCounts.get(normalizedTopicId) || 0) + 1)
}

function resetSocialBudget() {
    socialStates.clear()
}

module.exports = {
    normalizeSocialConfig,
    checkSocialBudget,
    recordSocialSend,
    resetSocialBudget,
    deterministicRoll
}
