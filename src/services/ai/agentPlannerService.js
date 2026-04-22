'use strict'

const { TASK_MODES } = require('./agentTypes')

function requiresConfirmationForStructuredAction(action, input = {}) {
    const normalizedAction = String(action || '').trim()

    if (!normalizedAction.endsWith('.write')) {
        return false
    }

    return !input.confirmationId
}

function planAgentRun({ agentDecision }) {
    const { taskMode, structuredAction } = agentDecision

    if (structuredAction?.kind === 'supported' && structuredAction.snapshot) {
        return {
            planType: 'structured_bot_control',
            requiresTools: false,
            requiresConfirmation: requiresConfirmationForStructuredAction(
                structuredAction.snapshot.action,
                structuredAction.snapshot.input
            ),
            candidateActions: [{
                executor: 'bot_control',
                action: structuredAction.snapshot.action,
                input: structuredAction.snapshot.input
            }],
            finalAnswerStyle: 'status_report'
        }
    }

    if (structuredAction?.kind === 'invalid') {
        return {
            planType: 'invalid_structured_bot_control',
            requiresTools: false,
            requiresConfirmation: false,
            candidateActions: [],
            finalAnswerStyle: 'status_report'
        }
    }

    if (taskMode === TASK_MODES.CHAT) {
        return {
            planType: 'chat',
            requiresTools: false,
            requiresConfirmation: false,
            candidateActions: [],
            finalAnswerStyle: 'brief_chat'
        }
    }

    if (taskMode === TASK_MODES.ANSWER) {
        return {
            planType: 'tool_assisted_answer',
            requiresTools: true,
            requiresConfirmation: false,
            candidateActions: [],
            finalAnswerStyle: 'brief_chat'
        }
    }

    if (taskMode === TASK_MODES.QUERY) {
        return {
            planType: 'query_only',
            requiresTools: true,
            requiresConfirmation: false,
            candidateActions: [],
            finalAnswerStyle: 'status_report'
        }
    }

    if (taskMode === TASK_MODES.CONFIRM) {
        return {
            planType: 'confirm_then_action',
            requiresTools: true,
            requiresConfirmation: true,
            candidateActions: [],
            finalAnswerStyle: 'status_report'
        }
    }

    return {
        planType: 'single_action',
        requiresTools: true,
        requiresConfirmation: false,
        candidateActions: [],
        finalAnswerStyle: 'status_report'
    }
}

module.exports = {
    requiresConfirmationForStructuredAction,
    planAgentRun
}
