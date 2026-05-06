const states = new Map()
const timers = new Map()

function keyFor(groupId) {
    return String(groupId || 'unknown')
}

function getTimingState(groupId) {
    const key = keyFor(groupId)
    if (!states.has(key)) {
        states.set(key, {
            lastWaitAt: 0,
            lastAction: '',
            waitCount: 0
        })
    }
    return states.get(key)
}

function recordTimingDecision({ groupId, decision, timestamp = Date.now() }) {
    const state = getTimingState(groupId)
    state.lastAction = decision?.timingAction || ''
    if (decision?.timingAction === 'wait') {
        state.lastWaitAt = timestamp
        state.waitCount += 1
    }
    if (decision?.timingAction === 'continue' || decision?.timingAction === 'listen') {
        state.waitCount = 0
    }
    return { ...state }
}

function scheduleTimingReentry({ groupId, waitMs, run }) {
    const key = keyFor(groupId)
    const delay = Math.max(0, Math.trunc(Number(waitMs) || 0))
    const existing = timers.get(key)
    if (existing) {
        clearTimeout(existing)
    }
    if (typeof run !== 'function' || delay <= 0) {
        timers.delete(key)
        return { scheduled: false, reason: 'invalid_reentry' }
    }

    const timer = setTimeout(() => {
        timers.delete(key)
        Promise.resolve(run()).catch(() => {})
    }, delay)
    if (typeof timer.unref === 'function') timer.unref()
    timers.set(key, timer)
    return { scheduled: true, waitMs: delay }
}

function clearTimingReentry(groupId) {
    const key = keyFor(groupId)
    const timer = timers.get(key)
    if (timer) clearTimeout(timer)
    timers.delete(key)
}

function getScheduledTimingReentryCount() {
    return timers.size
}

function resetTimingState() {
    for (const timer of timers.values()) {
        clearTimeout(timer)
    }
    timers.clear()
    states.clear()
}

module.exports = {
    getTimingState,
    recordTimingDecision,
    scheduleTimingReentry,
    clearTimingReentry,
    getScheduledTimingReentryCount,
    resetTimingState
}
