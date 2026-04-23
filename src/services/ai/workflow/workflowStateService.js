'use strict'

function normalizeValue(value) {
    return String(value || '').trim()
}

function cloneValue(value) {
    return value == null ? null : JSON.parse(JSON.stringify(value))
}

class WorkflowStateService {
    constructor({ now = () => Date.now() } = {}) {
        this.now = typeof now === 'function' ? now : () => Date.now()
        this.records = new Map()
    }

    normalizeScope({ groupId, actorUserId, kind } = {}) {
        return {
            groupId: normalizeValue(groupId),
            actorUserId: normalizeValue(actorUserId),
            kind: normalizeValue(kind)
        }
    }

    _getGroupRecords(groupId) {
        return this.records.get(groupId) || null
    }

    _getActorRecords(groupId, actorUserId) {
        const groupRecords = this._getGroupRecords(groupId)
        return groupRecords?.get(actorUserId) || null
    }

    _ensureActorRecords(groupId, actorUserId) {
        let groupRecords = this.records.get(groupId)

        if (!groupRecords) {
            groupRecords = new Map()
            this.records.set(groupId, groupRecords)
        }

        let actorRecords = groupRecords.get(actorUserId)

        if (!actorRecords) {
            actorRecords = new Map()
            groupRecords.set(actorUserId, actorRecords)
        }

        return actorRecords
    }

    _deleteScopedRecord(groupId, actorUserId, kind) {
        const groupRecords = this.records.get(groupId)

        if (!groupRecords) {
            return false
        }

        const actorRecords = groupRecords.get(actorUserId)

        if (!actorRecords) {
            return false
        }

        const deleted = actorRecords.delete(kind)

        if (actorRecords.size === 0) {
            groupRecords.delete(actorUserId)
        }
        if (groupRecords.size === 0) {
            this.records.delete(groupId)
        }

        return deleted
    }

    isExpired(record) {
        const expiresAt = Number(record?.expiresAt)
        return Number.isFinite(expiresAt) && expiresAt <= this.now()
    }

    setRecord({ groupId, actorUserId, kind, record } = {}) {
        const scope = this.normalizeScope({ groupId, actorUserId, kind })

        if (!scope.groupId) {
            throw new Error('Workflow groupId is required')
        }
        if (!scope.actorUserId) {
            throw new Error('Workflow actorUserId is required')
        }
        if (!scope.kind) {
            throw new Error('Workflow kind is required')
        }
        if (!record || typeof record !== 'object') {
            throw new Error('Workflow record is required')
        }

        this._ensureActorRecords(scope.groupId, scope.actorUserId).set(scope.kind, cloneValue(record))
        return this.getRecord(scope)
    }

    getRecord({ groupId, actorUserId, kind, includeExpired = false } = {}) {
        const scope = this.normalizeScope({ groupId, actorUserId, kind })

        if (!scope.groupId || !scope.actorUserId || !scope.kind) {
            return null
        }

        const record = this._getActorRecords(scope.groupId, scope.actorUserId)?.get(scope.kind) || null

        if (!record) {
            return null
        }

        if (this.isExpired(record) && !includeExpired) {
            this._deleteScopedRecord(scope.groupId, scope.actorUserId, scope.kind)
            return null
        }

        return cloneValue(record)
    }

    getPendingRecord(options = {}) {
        const record = this.getRecord(options)

        if (!record) {
            return null
        }

        return record.state === 'pending' ? record : null
    }

    updateRecord({ groupId, actorUserId, kind, includeExpired = false, updater } = {}) {
        if (typeof updater !== 'function') {
            throw new Error('Workflow updater is required')
        }

        const currentRecord = this.getRecord({
            groupId,
            actorUserId,
            kind,
            includeExpired
        })

        if (!currentRecord) {
            return null
        }

        const nextRecord = updater(cloneValue(currentRecord))

        if (nextRecord == null) {
            this.deleteRecord({ groupId, actorUserId, kind })
            return null
        }

        return this.setRecord({
            groupId,
            actorUserId,
            kind,
            record: nextRecord
        })
    }

    deleteRecord({ groupId, actorUserId, kind } = {}) {
        const scope = this.normalizeScope({ groupId, actorUserId, kind })

        if (!scope.groupId || !scope.actorUserId || !scope.kind) {
            return false
        }

        return this._deleteScopedRecord(scope.groupId, scope.actorUserId, scope.kind)
    }
}

module.exports = {
    WorkflowStateService,
    normalizeValue,
    cloneValue
}
