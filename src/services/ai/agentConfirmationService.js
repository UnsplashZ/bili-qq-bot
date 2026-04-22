'use strict'

const { CONFIRMATION_STATES } = require('./agentTypes')

function normalizeValue(value) {
    return String(value || '').trim()
}

function cloneSnapshot(snapshot) {
    return snapshot == null ? null : JSON.parse(JSON.stringify(snapshot))
}

class AgentConfirmationService {
    constructor({ now = () => Date.now(), random = () => Math.random() } = {}) {
        this.now = now
        this.random = random
        this.pendingConfirmations = new Map()
    }

    _getGroupConfirmations(groupId) {
        const scopedGroupId = normalizeValue(groupId)

        if (!scopedGroupId) {
            return null
        }

        return this.pendingConfirmations.get(scopedGroupId) || null
    }

    _getOrCreateGroupConfirmations(groupId) {
        const scopedGroupId = normalizeValue(groupId)

        if (!scopedGroupId) {
            return null
        }

        let groupConfirmations = this.pendingConfirmations.get(scopedGroupId)

        if (!groupConfirmations) {
            groupConfirmations = new Map()
            this.pendingConfirmations.set(scopedGroupId, groupConfirmations)
        }

        return groupConfirmations
    }

    _deleteGroupConfirmation(groupId, actorUserId) {
        const scopedGroupId = normalizeValue(groupId)
        const scopedActorUserId = normalizeValue(actorUserId)
        const groupConfirmations = this._getGroupConfirmations(scopedGroupId)

        if (!groupConfirmations) {
            return
        }

        groupConfirmations.delete(scopedActorUserId)
        if (groupConfirmations.size === 0) {
            this.pendingConfirmations.delete(scopedGroupId)
        }
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

        const groupConfirmations = this._getOrCreateGroupConfirmations(scopedGroupId)
        const existingRecord = groupConfirmations.get(scopedActorUserId)

        if (existingRecord) {
            return {
                ok: false,
                status: 'pending_confirmation_exists',
                code: 'pending_confirmation_exists',
                message: '请先处理当前待确认操作。',
                confirmation: cloneSnapshot(existingRecord)
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
            snapshot: cloneSnapshot(snapshot)
        }

        groupConfirmations.set(scopedActorUserId, record)
        return cloneSnapshot(record)
    }

    getPendingConfirmation({ groupId, actorUserId, confirmationId } = {}) {
        const scopedGroupId = normalizeValue(groupId)
        const scopedActorUserId = normalizeValue(actorUserId)
        const groupConfirmations = this._getGroupConfirmations(scopedGroupId)
        const record = groupConfirmations?.get(scopedActorUserId) || null

        if (!record) {
            return null
        }
        if (confirmationId && record.confirmationId !== normalizeValue(confirmationId)) {
            return null
        }

        return cloneSnapshot(record)
    }

    confirm({ groupId, actorUserId, confirmationId } = {}) {
        const scopedGroupId = normalizeValue(groupId)
        const scopedActorUserId = normalizeValue(actorUserId)
        const normalizedConfirmationId = normalizeValue(confirmationId)
        const groupConfirmations = this._getGroupConfirmations(scopedGroupId)
        const record = groupConfirmations?.get(scopedActorUserId) || null

        if (!record || record.confirmationId !== normalizedConfirmationId) {
            throw new Error('Pending confirmation not found for current group actor')
        }

        this._deleteGroupConfirmation(scopedGroupId, scopedActorUserId)
        return {
            ...cloneSnapshot(record),
            state: CONFIRMATION_STATES.CONFIRMED,
            confirmedAt: this.now()
        }
    }

    reject({ groupId, actorUserId, confirmationId } = {}) {
        const scopedGroupId = normalizeValue(groupId)
        const scopedActorUserId = normalizeValue(actorUserId)
        const normalizedConfirmationId = normalizeValue(confirmationId)
        const groupConfirmations = this._getGroupConfirmations(scopedGroupId)
        const record = groupConfirmations?.get(scopedActorUserId) || null

        if (!record || record.confirmationId !== normalizedConfirmationId) {
            throw new Error('Pending confirmation not found for current group actor')
        }

        this._deleteGroupConfirmation(scopedGroupId, scopedActorUserId)
        return {
            ...cloneSnapshot(record),
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
