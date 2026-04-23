'use strict'

const { recognizeBotControlShortcut } = require('./botControl/naturalLanguageShortcutParser')
const { recognizePendingBotControlFollowup } = require('./pendingBotControlFollowupRecognitionService')
const { recognizeCandidateSelectionFollowup } = require('./candidateSelectionFollowupRecognitionService')

function injectBotControlAction(agentInput, candidate) {
    if (candidate == null || agentInput?.pipelineInput?.botControlAction != null) {
        return agentInput
    }

    return {
        ...agentInput,
        pipelineInput: {
            ...(agentInput?.pipelineInput || {}),
            botControlAction: candidate
        }
    }
}

function resolveExplicitBotControlActionCandidate(agentInput = {}) {
    return agentInput?.pipelineInput?.botControlAction ?? null
}

function resolvePendingFollowupBotControlAction({ agentInput = {}, runtime } = {}) {
    if (!runtime?.botControl || typeof runtime.botControl.getPendingConfirmation !== 'function') {
        return null
    }

    const pendingConfirmation = runtime.botControl.getPendingConfirmation({
        actorUserId: agentInput.userId
    })
    const followup = recognizePendingBotControlFollowup({
        rawMessage: agentInput.rawMessage,
        pendingConfirmation,
        messageMeta: agentInput.messageMeta
    })

    if (!followup?.candidate) {
        return null
    }

    return {
        candidate: followup.candidate,
        pendingConfirmation,
        followup
    }
}

function resolveCandidateSelectionBotControlAction({ agentInput = {}, runtime } = {}) {
    if (!runtime?.botControl || typeof runtime.botControl.getCandidateSelectionSnapshot !== 'function') {
        return null
    }

    const actorUserId = String(agentInput.userId || '').trim()
    const snapshot = runtime.botControl.getCandidateSelectionSnapshot({
        actorUserId,
        includeExpired: true
    })
    const followup = recognizeCandidateSelectionFollowup({
        rawMessage: agentInput.rawMessage,
        snapshot,
        actorUserId,
        messageMeta: agentInput.messageMeta
    })

    if (!followup?.candidate) {
        return null
    }

    if (followup.kind === 'candidate_selection_expired'
        && typeof runtime.botControl.clearCandidateSelectionSnapshot === 'function') {
        runtime.botControl.clearCandidateSelectionSnapshot({ actorUserId })
    }

    return {
        candidate: followup.candidate,
        snapshot,
        followup
    }
}

function resolveBotControlActionInput({ agentInput = {}, runtime } = {}) {
    const explicitCandidate = resolveExplicitBotControlActionCandidate(agentInput)

    if (explicitCandidate != null) {
        return {
            effectiveAgentInput: agentInput,
            candidate: explicitCandidate,
            source: 'explicit',
            pendingConfirmation: null,
            followup: null
        }
    }

    const pendingFollowup = resolvePendingFollowupBotControlAction({ agentInput, runtime })

    if (pendingFollowup?.candidate) {
        return {
            effectiveAgentInput: injectBotControlAction(agentInput, pendingFollowup.candidate),
            candidate: pendingFollowup.candidate,
            source: 'pending_followup',
            pendingConfirmation: pendingFollowup.pendingConfirmation,
            followup: pendingFollowup.followup
        }
    }

    const candidateSelectionFollowup = resolveCandidateSelectionBotControlAction({ agentInput, runtime })

    if (candidateSelectionFollowup?.candidate) {
        return {
            effectiveAgentInput: injectBotControlAction(agentInput, candidateSelectionFollowup.candidate),
            candidate: candidateSelectionFollowup.candidate,
            source: 'candidate_selection_followup',
            pendingConfirmation: null,
            followup: candidateSelectionFollowup.followup
        }
    }

    const naturalLanguageCandidate = recognizeBotControlShortcut(agentInput.rawMessage, {
        messageMeta: agentInput.messageMeta
    })

    if (naturalLanguageCandidate != null) {
        return {
            effectiveAgentInput: injectBotControlAction(agentInput, naturalLanguageCandidate),
            candidate: naturalLanguageCandidate,
            source: 'natural_language',
            pendingConfirmation: null,
            followup: null
        }
    }

    return {
        effectiveAgentInput: agentInput,
        candidate: null,
        source: 'absent',
        pendingConfirmation: null,
        followup: null
    }
}

module.exports = {
    injectBotControlAction,
    resolveExplicitBotControlActionCandidate,
    resolvePendingFollowupBotControlAction,
    resolveCandidateSelectionBotControlAction,
    resolveBotControlActionInput
}
