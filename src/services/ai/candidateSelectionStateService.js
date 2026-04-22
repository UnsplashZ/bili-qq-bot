'use strict'

const SNAPSHOT_TTL_MS = 10 * 60 * 1000

function normalizeGroupId(groupId) {
    return String(groupId || '').trim()
}

function normalizeActorUserId(actorUserId) {
    return String(actorUserId || '').trim()
}

function normalizeMessageId(messageId) {
    return String(messageId || '').trim()
}

function cloneValue(value) {
    return value == null ? null : JSON.parse(JSON.stringify(value))
}

class CandidateSelectionStateService {
    constructor({ now = () => Date.now(), ttlMs = SNAPSHOT_TTL_MS } = {}) {
        this.candidateSnapshots = new Map()
        this.now = typeof now === 'function' ? now : () => Date.now()
        this.ttlMs = Number.isFinite(Number(ttlMs)) && Number(ttlMs) > 0
            ? Number(ttlMs)
            : SNAPSHOT_TTL_MS
    }

    ensureGroupSnapshots(groupId) {
        if (!this.candidateSnapshots.has(groupId)) {
            this.candidateSnapshots.set(groupId, new Map())
        }

        return this.candidateSnapshots.get(groupId)
    }

    isExpired(snapshot) {
        const expiresAt = Number(snapshot?.expiresAt)
        return Number.isFinite(expiresAt) && expiresAt <= this.now()
    }

    deleteScopedSnapshot(groupId, actorUserId) {
        const groupSnapshots = this.candidateSnapshots.get(groupId)

        if (!groupSnapshots) {
            return false
        }

        const deleted = groupSnapshots.delete(actorUserId)

        if (groupSnapshots.size === 0) {
            this.candidateSnapshots.delete(groupId)
        }

        return deleted
    }

    saveSnapshot({ groupId, actorUserId, botMessageId, query, candidates, createdAt, expiresAt } = {}) {
        const scopedGroupId = normalizeGroupId(groupId)
        const scopedActorUserId = normalizeActorUserId(actorUserId)

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
                .filter(candidate => String(candidate?.uid || '').trim())
            : []

        const safeCreatedAt = Number.isFinite(Number(createdAt)) ? Number(createdAt) : this.now()
        const safeExpiresAt = Number.isFinite(Number(expiresAt)) ? Number(expiresAt) : safeCreatedAt + this.ttlMs
        const snapshot = {
            groupId: scopedGroupId,
            actorUserId: scopedActorUserId,
            botMessageId: normalizeMessageId(botMessageId) || null,
            query: String(query || '').trim(),
            candidates: normalizedCandidates,
            createdAt: safeCreatedAt,
            expiresAt: safeExpiresAt
        }

        this.ensureGroupSnapshots(scopedGroupId).set(scopedActorUserId, snapshot)
        return cloneValue(snapshot)
    }

    getSnapshot({ groupId, actorUserId, includeExpired = false } = {}) {
        const scopedGroupId = normalizeGroupId(groupId)
        const scopedActorUserId = normalizeActorUserId(actorUserId)

        if (!scopedGroupId || !scopedActorUserId) {
            return null
        }

        const snapshot = this.candidateSnapshots.get(scopedGroupId)?.get(scopedActorUserId) || null

        if (!snapshot) {
            return null
        }

        if (this.isExpired(snapshot)) {
            if (!includeExpired) {
                this.deleteScopedSnapshot(scopedGroupId, scopedActorUserId)
                return null
            }
        }

        return cloneValue(snapshot)
    }

    setSnapshotBotMessageId({ groupId, actorUserId, botMessageId } = {}) {
        const scopedGroupId = normalizeGroupId(groupId)
        const scopedActorUserId = normalizeActorUserId(actorUserId)
        const normalizedBotMessageId = normalizeMessageId(botMessageId)

        if (!scopedGroupId || !scopedActorUserId || !normalizedBotMessageId) {
            return null
        }

        const snapshot = this.candidateSnapshots.get(scopedGroupId)?.get(scopedActorUserId) || null

        if (!snapshot) {
            return null
        }

        if (this.isExpired(snapshot)) {
            this.deleteScopedSnapshot(scopedGroupId, scopedActorUserId)
            return null
        }

        const updatedSnapshot = {
            ...snapshot,
            botMessageId: normalizedBotMessageId
        }

        this.ensureGroupSnapshots(scopedGroupId).set(scopedActorUserId, updatedSnapshot)
        return cloneValue(updatedSnapshot)
    }

    clearSnapshot({ groupId, actorUserId } = {}) {
        const scopedGroupId = normalizeGroupId(groupId)
        const scopedActorUserId = normalizeActorUserId(actorUserId)

        if (!scopedGroupId || !scopedActorUserId) {
            return false
        }

        return this.deleteScopedSnapshot(scopedGroupId, scopedActorUserId)
    }
}

const candidateSelectionStateService = new CandidateSelectionStateService()

module.exports = {
    SNAPSHOT_TTL_MS,
    CandidateSelectionStateService,
    candidateSelectionStateService
}
