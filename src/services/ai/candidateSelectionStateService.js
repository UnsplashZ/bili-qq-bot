'use strict'

const { WORKFLOW_KINDS } = require('./workflow/workflowTypes')
const { WorkflowStateService, normalizeValue, cloneValue } = require('./workflow/workflowStateService')

const SNAPSHOT_TTL_MS = 10 * 60 * 1000

function normalizeMessageId(messageId) {
    return normalizeValue(messageId)
}

class CandidateSelectionStateService {
    constructor({ now = () => Date.now(), ttlMs = SNAPSHOT_TTL_MS, workflowStateService } = {}) {
        this.now = typeof now === 'function' ? now : () => Date.now()
        this.ttlMs = Number.isFinite(Number(ttlMs)) && Number(ttlMs) > 0
            ? Number(ttlMs)
            : SNAPSHOT_TTL_MS
        this.workflowStateService = workflowStateService || new WorkflowStateService({ now: this.now })
    }

    isExpired(snapshot) {
        return this.workflowStateService.isExpired(snapshot)
    }

    saveSnapshot({ groupId, actorUserId, botMessageId, query, candidates, createdAt, expiresAt } = {}) {
        const scopedGroupId = normalizeValue(groupId)
        const scopedActorUserId = normalizeValue(actorUserId)

        if (!scopedGroupId) {
            throw new Error('Candidate-selection snapshot groupId is required')
        }
        if (!scopedActorUserId) {
            throw new Error('Candidate-selection snapshot actorUserId is required')
        }

        const normalizedCandidates = Array.isArray(candidates)
            ? candidates
                .filter(candidate => candidate && typeof candidate === 'object')
                .map(candidate => cloneValue(candidate))
                .filter(candidate => normalizeValue(candidate?.uid))
            : []

        const safeCreatedAt = Number.isFinite(Number(createdAt)) ? Number(createdAt) : this.now()
        const safeExpiresAt = Number.isFinite(Number(expiresAt)) ? Number(expiresAt) : safeCreatedAt + this.ttlMs
        const snapshot = {
            groupId: scopedGroupId,
            actorUserId: scopedActorUserId,
            botMessageId: normalizeMessageId(botMessageId) || null,
            query: normalizeValue(query),
            candidates: normalizedCandidates,
            createdAt: safeCreatedAt,
            expiresAt: safeExpiresAt
        }

        return this.workflowStateService.setRecord({
            groupId: scopedGroupId,
            actorUserId: scopedActorUserId,
            kind: WORKFLOW_KINDS.SELECTION,
            record: snapshot
        })
    }

    getSnapshot({ groupId, actorUserId, includeExpired = false } = {}) {
        return this.workflowStateService.getRecord({
            groupId,
            actorUserId,
            kind: WORKFLOW_KINDS.SELECTION,
            includeExpired
        })
    }

    setSnapshotBotMessageId({ groupId, actorUserId, botMessageId } = {}) {
        const scopedGroupId = normalizeValue(groupId)
        const scopedActorUserId = normalizeValue(actorUserId)
        const normalizedBotMessageId = normalizeMessageId(botMessageId)

        if (!scopedGroupId || !scopedActorUserId || !normalizedBotMessageId) {
            return null
        }

        return this.workflowStateService.updateRecord({
            groupId: scopedGroupId,
            actorUserId: scopedActorUserId,
            kind: WORKFLOW_KINDS.SELECTION,
            updater(snapshot) {
                return {
                    ...snapshot,
                    botMessageId: normalizedBotMessageId
                }
            }
        })
    }

    clearSnapshot({ groupId, actorUserId } = {}) {
        return this.workflowStateService.deleteRecord({
            groupId,
            actorUserId,
            kind: WORKFLOW_KINDS.SELECTION
        })
    }
}

const candidateSelectionStateService = new CandidateSelectionStateService()

module.exports = {
    SNAPSHOT_TTL_MS,
    CandidateSelectionStateService,
    candidateSelectionStateService
}
