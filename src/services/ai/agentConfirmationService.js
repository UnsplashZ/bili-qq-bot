'use strict'

const { CONFIRMATION_STATES } = require('./agentTypes')
const { WORKFLOW_KINDS } = require('./workflow/workflowTypes')
const { WorkflowStateService, normalizeValue, cloneValue } = require('./workflow/workflowStateService')

function normalizeMessageId(messageId) {
    return String(messageId || '').trim()
}

class AgentConfirmationService {
    constructor({
        now = () => Date.now(),
        random = () => Math.random(),
        workflowStateService
    } = {}) {
        this.now = typeof now === 'function' ? now : () => Date.now()
        this.random = typeof random === 'function' ? random : () => Math.random()
        this.workflowStateService = workflowStateService || new WorkflowStateService({ now: this.now })
    }

    createPendingConfirmation({ groupId, actorUserId, action, snapshot, summary = '' } = {}) {
        const scopedGroupId = normalizeValue(groupId)
        const scopedActorUserId = normalizeValue(actorUserId)
        const normalizedAction = normalizeValue(action)

        if (!scopedGroupId) {
            throw new Error('Confirmation groupId is required')
        }
        if (!scopedActorUserId) {
            throw new Error('Confirmation actorUserId is required')
        }
        if (!normalizedAction) {
            throw new Error('Confirmation action is required')
        }
        if (!snapshot || typeof snapshot !== 'object') {
            throw new Error('Confirmation snapshot is required')
        }

        const existingRecord = this.workflowStateService.getPendingRecord({
            groupId: scopedGroupId,
            actorUserId: scopedActorUserId,
            kind: WORKFLOW_KINDS.CONFIRMATION
        })

        if (existingRecord) {
            return {
                ok: false,
                status: 'pending_confirmation_exists',
                code: 'pending_confirmation_exists',
                message: '请先处理当前待确认操作。',
                confirmation: cloneValue(existingRecord)
            }
        }

        const confirmationId = `${this.now()}_${Math.floor(this.random() * 1e9)}`
        const record = {
            confirmationId,
            groupId: scopedGroupId,
            actorUserId: scopedActorUserId,
            action: normalizedAction,
            summary: normalizeValue(summary),
            state: CONFIRMATION_STATES.PENDING,
            createdAt: this.now(),
            snapshot: cloneValue(snapshot)
        }

        return this.workflowStateService.setRecord({
            groupId: scopedGroupId,
            actorUserId: scopedActorUserId,
            kind: WORKFLOW_KINDS.CONFIRMATION,
            record
        })
    }

    getPendingConfirmation({ groupId, actorUserId, confirmationId } = {}) {
        const record = this.workflowStateService.getPendingRecord({
            groupId,
            actorUserId,
            kind: WORKFLOW_KINDS.CONFIRMATION
        })

        if (!record) {
            return null
        }
        if (confirmationId && record.confirmationId !== normalizeValue(confirmationId)) {
            return null
        }

        return record
    }

    setPendingConfirmationBotMessageId({ groupId, actorUserId, confirmationId, botMessageId } = {}) {
        const scopedGroupId = normalizeValue(groupId)
        const scopedActorUserId = normalizeValue(actorUserId)
        const normalizedConfirmationId = normalizeValue(confirmationId)
        const normalizedBotMessageId = normalizeMessageId(botMessageId)

        if (!scopedGroupId || !scopedActorUserId || !normalizedConfirmationId || !normalizedBotMessageId) {
            return null
        }

        return this.workflowStateService.updateRecord({
            groupId: scopedGroupId,
            actorUserId: scopedActorUserId,
            kind: WORKFLOW_KINDS.CONFIRMATION,
            updater: (record) => {
                if (record?.state !== CONFIRMATION_STATES.PENDING) {
                    return record
                }
                if (record.confirmationId !== normalizedConfirmationId) {
                    return record
                }

                return {
                    ...record,
                    botMessageId: normalizedBotMessageId
                }
            }
        })
    }

    confirm({ groupId, actorUserId, confirmationId } = {}) {
        const scopedGroupId = normalizeValue(groupId)
        const scopedActorUserId = normalizeValue(actorUserId)
        const normalizedConfirmationId = normalizeValue(confirmationId)
        const record = this.getPendingConfirmation({
            groupId: scopedGroupId,
            actorUserId: scopedActorUserId,
            confirmationId: normalizedConfirmationId
        })

        if (!record) {
            throw new Error('Pending confirmation not found for current group actor')
        }

        this.workflowStateService.deleteRecord({
            groupId: scopedGroupId,
            actorUserId: scopedActorUserId,
            kind: WORKFLOW_KINDS.CONFIRMATION
        })

        return {
            ...cloneValue(record),
            state: CONFIRMATION_STATES.CONFIRMED,
            confirmedAt: this.now()
        }
    }

    reject({ groupId, actorUserId, confirmationId } = {}) {
        const scopedGroupId = normalizeValue(groupId)
        const scopedActorUserId = normalizeValue(actorUserId)
        const normalizedConfirmationId = normalizeValue(confirmationId)
        const record = this.getPendingConfirmation({
            groupId: scopedGroupId,
            actorUserId: scopedActorUserId,
            confirmationId: normalizedConfirmationId
        })

        if (!record) {
            throw new Error('Pending confirmation not found for current group actor')
        }

        this.workflowStateService.deleteRecord({
            groupId: scopedGroupId,
            actorUserId: scopedActorUserId,
            kind: WORKFLOW_KINDS.CONFIRMATION
        })

        return {
            ...cloneValue(record),
            state: CONFIRMATION_STATES.REJECTED,
            rejectedAt: this.now()
        }
    }
}

const agentConfirmationService = new AgentConfirmationService()

module.exports = {
    AgentConfirmationService,
    agentConfirmationService
}
