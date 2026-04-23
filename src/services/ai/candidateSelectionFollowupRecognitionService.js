'use strict'

function normalizeMessage(rawMessage) {
    return String(rawMessage || '').replace(/\[CQ:[^\]]+\]/g, ' ').trim()
}

function normalizeActorUserId(actorUserId) {
    return String(actorUserId || '').trim()
}

function normalizeMessageId(messageId) {
    return String(messageId || '').trim()
}

function extractSelectionNumber(rawMessage) {
    const normalizedMessage = normalizeMessage(rawMessage)

    if (!normalizedMessage) {
        return null
    }

    const plainNumberMatch = normalizedMessage.match(/^(\d+)$/)

    if (plainNumberMatch) {
        return plainNumberMatch[1]
    }

    const chineseNumberMatch = normalizedMessage.match(/^第\s*(\d+)\s*个$/)
        || normalizedMessage.match(/^选\s*(\d+)$/)
        || normalizedMessage.match(/^选择\s*(\d+)$/)

    return chineseNumberMatch ? chineseNumberMatch[1] : null
}

function buildCandidateSelectionAction(candidate) {
    return {
        action: 'subscription.write',
        input: {
            operation: 'add_user',
            uid: candidate.uid
        }
    }
}

function buildInvalidCandidateSelectionAction(error) {
    return {
        action: 'candidate_selection.invalid',
        input: {
            error: String(error || '').trim() || '候选选择无效，请重新选择。'
        }
    }
}

function buildExpiredCandidateSelectionAction() {
    return buildInvalidCandidateSelectionAction('候选已过期，请重新搜索。')
}

function buildInvalidSelectionError(snapshot) {
    const candidates = Array.isArray(snapshot?.candidates) ? snapshot.candidates : []

    if (candidates.length === 0) {
        return '当前没有可选候选，请重新搜索后再选择。'
    }

    return `当前候选列表中没有这个序号或 UID，请回复 1-${candidates.length} 之间的序号，或候选 UID。`
}

function findCandidateByExactUid(snapshot, token) {
    const normalizedToken = String(token || '').trim()
    const candidates = Array.isArray(snapshot?.candidates) ? snapshot.candidates : []

    if (!normalizedToken) {
        return null
    }

    return candidates.find(candidate => String(candidate?.uid || '').trim() === normalizedToken) || null
}

function findCandidateByRank(snapshot, rankToken) {
    const rank = Number.parseInt(rankToken, 10)
    const candidates = Array.isArray(snapshot?.candidates) ? snapshot.candidates : []

    if (!Number.isInteger(rank) || rank <= 0) {
        return null
    }

    return candidates.find(candidate => Number(candidate?.rank) === rank)
        || candidates[rank - 1]
        || null
}

function matchesSnapshotScope({ snapshot, actorUserId, messageMeta } = {}) {
    const scopedActorUserId = normalizeActorUserId(actorUserId)
    const snapshotActorUserId = normalizeActorUserId(snapshot?.actorUserId)
    const replyToMessageId = normalizeMessageId(messageMeta?.replyToMessageId)
    const botMessageId = normalizeMessageId(snapshot?.botMessageId)

    if (!snapshot || !scopedActorUserId || !snapshotActorUserId) {
        return false
    }

    if (scopedActorUserId !== snapshotActorUserId) {
        return false
    }

    if (!replyToMessageId || !botMessageId || replyToMessageId !== botMessageId) {
        return false
    }

    return true
}

function isExpiredSnapshot(snapshot) {
    const expiresAt = Number(snapshot?.expiresAt)
    return Number.isFinite(expiresAt) && expiresAt <= Date.now()
}

function recognizeCandidateSelectionFollowup({ rawMessage, snapshot, actorUserId, messageMeta } = {}) {
    if (!matchesSnapshotScope({ snapshot, actorUserId, messageMeta })) {
        return null
    }

    if (isExpiredSnapshot(snapshot)) {
        return {
            kind: 'candidate_selection_expired',
            matchedBy: 'expired',
            candidate: buildExpiredCandidateSelectionAction(),
            snapshot
        }
    }

    const normalizedMessage = normalizeMessage(rawMessage)
    const candidates = Array.isArray(snapshot?.candidates) ? snapshot.candidates : []

    if (!normalizedMessage || candidates.length === 0) {
        return null
    }

    const exactUidCandidate = findCandidateByExactUid(snapshot, normalizedMessage)

    if (exactUidCandidate) {
        return {
            kind: 'candidate_selection',
            matchedBy: 'uid',
            candidate: buildCandidateSelectionAction(exactUidCandidate),
            snapshot
        }
    }

    const selectionNumber = extractSelectionNumber(normalizedMessage)

    if (!selectionNumber) {
        return null
    }

    const selectedCandidate = findCandidateByRank(snapshot, selectionNumber)

    if (!selectedCandidate) {
        return {
            kind: 'candidate_selection_invalid',
            matchedBy: 'index_or_uid',
            candidate: buildInvalidCandidateSelectionAction(buildInvalidSelectionError(snapshot)),
            snapshot
        }
    }

    return {
        kind: 'candidate_selection',
        matchedBy: 'index',
        candidate: buildCandidateSelectionAction(selectedCandidate),
        snapshot
    }
}

module.exports = {
    extractSelectionNumber,
    recognizeCandidateSelectionFollowup
}
