'use strict'

const TASK_MODES = Object.freeze({
    CHAT: 'chat',
    ANSWER: 'answer',
    QUERY: 'query',
    CONFIRM: 'confirm',
    ACT: 'act'
})

const RUN_STATES = Object.freeze({
    ADMITTED: 'admitted',
    CONTEXT_READY: 'context_ready',
    PLANNED: 'planned',
    WAITING_CONFIRMATION: 'waiting_confirmation',
    EXECUTING: 'executing',
    OBSERVING: 'observing',
    FINALIZED: 'finalized',
    BLOCKED: 'blocked',
    FAILED: 'failed',
    ABORTED: 'aborted'
})

const RISK_LEVELS = Object.freeze({
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high'
})

const CONFIRMATION_STATES = Object.freeze({
    NOT_REQUIRED: 'not_required',
    REQUIRED: 'required',
    PENDING: 'pending',
    CONFIRMED: 'confirmed',
    REJECTED: 'rejected',
    EXPIRED: 'expired'
})

function createEmptyRunResult(overrides = {}) {
    return {
        runId: '',
        state: RUN_STATES.ADMITTED,
        stepCount: 0,
        steps: [],
        toolCalls: [],
        localActions: [],
        errors: [],
        hasToolResult: false,
        hasMutation: false,
        finalReply: null,
        ...overrides
    }
}

module.exports = {
    TASK_MODES,
    RUN_STATES,
    RISK_LEVELS,
    CONFIRMATION_STATES,
    createEmptyRunResult
}
