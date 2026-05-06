const windows = new Map()

function nowMs() {
    return Date.now()
}

function normalizeBudgetConfig(agentConfig) {
    const budget = agentConfig.budget || {}
    return {
        enabled: budget.enabled !== false,
        windowMs: Math.max(1000, Number(budget.windowMs) || 60 * 1000),
        maxLlmCallsPerGroupPerMinute: Math.max(1, Number(budget.maxLlmCallsPerGroupPerMinute) || 60),
        maxLlmCallsPerUserPerMinute: Math.max(1, Number(budget.maxLlmCallsPerUserPerMinute) || 20)
    }
}

function bucketKey(scope, id) {
    return `${scope}:${id || 'unknown'}`
}

function getBucket(key, timestamp, windowMs) {
    const existing = windows.get(key)
    if (existing && timestamp - existing.startedAt < windowMs) return existing
    const next = { startedAt: timestamp, count: 0 }
    windows.set(key, next)
    return next
}

function checkBudget({ agentConfig, groupId, userId, timestamp = nowMs() }) {
    const budget = normalizeBudgetConfig(agentConfig)
    if (!budget.enabled) {
        return { allowed: true, reason: 'budget_disabled', budget }
    }

    const groupBucket = getBucket(bucketKey('group', groupId), timestamp, budget.windowMs)
    const userBucket = getBucket(bucketKey('user', `${groupId}:${userId}`), timestamp, budget.windowMs)

    if (groupBucket.count >= budget.maxLlmCallsPerGroupPerMinute) {
        return { allowed: false, reason: 'group_budget_exceeded', budget, groupCount: groupBucket.count, userCount: userBucket.count }
    }

    if (userBucket.count >= budget.maxLlmCallsPerUserPerMinute) {
        return { allowed: false, reason: 'user_budget_exceeded', budget, groupCount: groupBucket.count, userCount: userBucket.count }
    }

    groupBucket.count += 1
    userBucket.count += 1

    return { allowed: true, reason: 'budget_allowed', budget, groupCount: groupBucket.count, userCount: userBucket.count }
}

function resetBudget() {
    windows.clear()
}

module.exports = {
    checkBudget,
    resetBudget,
    normalizeBudgetConfig
}
