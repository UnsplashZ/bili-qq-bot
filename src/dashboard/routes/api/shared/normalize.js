function normalizeGroupId(groupId) {
    return groupId ? String(groupId) : null
}

function normalizeQQ(qq) {
    if (qq === null || qq === undefined) return ''
    return String(qq).trim()
}

function normalizeBlacklist(input) {
    if (!Array.isArray(input)) return []

    const normalized = []
    for (const item of input) {
        if (item === null || item === undefined) continue
        const qq = normalizeQQ(item)
        if (!qq) continue
        if (!normalized.includes(qq)) {
            normalized.push(qq)
        }
    }
    return normalized
}

function normalizeSyncGroupNames(input) {
    if (Array.isArray(input)) {
        return input.map(v => String(v).trim()).filter(Boolean)
    }
    if (typeof input === 'string') {
        return input.split(',').map(v => v.trim()).filter(Boolean)
    }
    return []
}

function extractFollowerUid(follower) {
    if (!follower || typeof follower !== 'object') return ''
    const raw = follower.uid ?? follower.mid ?? follower.id ?? ''
    const uid = String(raw).trim()
    return /^\d+$/.test(uid) ? uid : ''
}

function resolveFollowerName(follower, uid) {
    if (!follower || typeof follower !== 'object') return `User_${uid}`
    const name = String(follower.name || follower.uname || '').trim()
    return name || `User_${uid}`
}

function isValidProfileGroupId(groupId) {
    return typeof groupId === 'string' && /^\d+$/.test(groupId)
}

module.exports = {
    normalizeGroupId,
    normalizeQQ,
    normalizeBlacklist,
    normalizeSyncGroupNames,
    extractFollowerUid,
    resolveFollowerName,
    isValidProfileGroupId
}

