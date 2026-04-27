const states = new Map()

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

function resetTimingState() {
    states.clear()
}

module.exports = {
    getTimingState,
    recordTimingDecision,
    resetTimingState
}
