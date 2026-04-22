'use strict'

function normalizeGroupId(groupId) {
    return String(groupId || '').trim()
}

function isPrivatePseudoGroupId(groupId) {
    return typeof groupId === 'string' && groupId.startsWith('private_')
}

function isRealGroupScope(groupId) {
    return /^\d+$/.test(normalizeGroupId(groupId))
}

function normalizeValue(value) {
    return String(value || '').trim()
}

function resolveScopedGroupId(groupId, input = {}, operation = 'read') {
    const scopedGroupId = normalizeGroupId(groupId)
    const requestedGroupId = normalizeGroupId(input.groupId)

    if (!scopedGroupId) {
        throw new Error('Bot-control requires a scoped groupId')
    }
    if (requestedGroupId && requestedGroupId !== scopedGroupId) {
        throw new Error(`Bot-control ${operation} is limited to the current group scope`)
    }

    return scopedGroupId
}

function resolveManagedGroupId(groupId, input = {}, operation = 'read') {
    const scopedGroupId = resolveScopedGroupId(groupId, input, operation)

    if (!isRealGroupScope(scopedGroupId)) {
        throw new Error(`Bot-control ${operation} requires a real group scope`)
    }

    return scopedGroupId
}

function normalizeSubscriptionWriteOperation(input = {}) {
    const operation = normalizeValue(input.operation || input.type)

    if (operation === 'add_user') {
        return 'add_user'
    }
    if (operation === 'remove_user') {
        return 'remove_user'
    }

    throw new Error(`Unsupported subscription write operation: ${operation || '<empty>'}`)
}

function normalizeSubscriptionReadOperation(input = {}) {
    const operation = normalizeValue(input.operation || input.type)

    if (operation === 'search_user') {
        return 'search_user'
    }
    if (normalizeValue(input.query || input.keyword || input.name)) {
        return 'search_user'
    }

    return 'list'
}

function normalizeSearchQuery(input = {}) {
    const query = normalizeValue(input.query || input.keyword || input.name)

    if (!query) {
        throw new Error('Subscription read search_user requires a non-empty query')
    }

    return query
}

function normalizeSearchLimit(input = {}) {
    const numericLimit = Number.parseInt(input.limit ?? input.pageSize ?? input.page_size, 10)

    if (!Number.isFinite(numericLimit)) {
        return 5
    }

    return Math.max(1, Math.min(10, numericLimit))
}

function normalizeExactUid(input = {}) {
    const uid = normalizeValue(input.uid)

    if (!uid) {
        throw new Error('Subscription write requires an exact uid')
    }

    return uid
}

function buildSubscriptionWriteSnapshot({ groupId, input = {} } = {}) {
    const scopedGroupId = resolveManagedGroupId(groupId, input, 'write')
    const targetGroupId = normalizeValue(input.targetGroupId)

    if (targetGroupId && targetGroupId !== scopedGroupId) {
        throw new Error('Bot-control write is limited to the current group scope')
    }

    return {
        action: 'subscription.write',
        groupId: scopedGroupId,
        input: {
            operation: normalizeSubscriptionWriteOperation(input),
            uid: normalizeExactUid(input)
        }
    }
}

function buildSubscriptionReadSnapshot({ groupId, input = {} } = {}) {
    const scopedGroupId = resolveManagedGroupId(groupId, input, 'read')
    const operation = normalizeSubscriptionReadOperation(input)

    if (operation === 'search_user') {
        return {
            action: 'subscription.read',
            groupId: scopedGroupId,
            input: {
                operation: 'search_user',
                query: normalizeSearchQuery(input),
                limit: normalizeSearchLimit(input)
            }
        }
    }

    return {
        action: 'subscription.read',
        groupId: scopedGroupId,
        input: {
            operation: 'list'
        }
    }
}

function normalizeUserSubscription(sub) {
    return {
        type: 'user',
        uid: String(sub?.uid || '').trim(),
        name: String(sub?.name || '').trim(),
        roomId: sub?.roomId == null ? null : String(sub.roomId).trim(),
        groupIds: Array.isArray(sub?.groupIds) ? sub.groupIds.map(id => String(id).trim()).filter(Boolean) : []
    }
}

function normalizeBangumiSubscription(sub) {
    return {
        type: 'bangumi',
        seasonId: String(sub?.seasonId || '').trim(),
        title: String(sub?.title || '').trim(),
        groupIds: Array.isArray(sub?.groupIds) ? sub.groupIds.map(id => String(id).trim()).filter(Boolean) : []
    }
}

function normalizeUserSearchCandidate(candidate) {
    const rawRoomId = candidate?.room_id ?? candidate?.roomId
    const normalizedRoomId = rawRoomId == null || String(rawRoomId).trim() === '' || String(rawRoomId).trim() === '0'
        ? null
        : String(rawRoomId).trim()

    return {
        uid: String(candidate?.uid || candidate?.mid || '').trim(),
        name: String(candidate?.name || candidate?.uname || '').trim(),
        sign: String(candidate?.sign || candidate?.usign || '').trim(),
        avatarUrl: String(candidate?.avatar || candidate?.avatarUrl || candidate?.upic || '').trim(),
        roomId: normalizedRoomId,
        fans: Number.isFinite(Number(candidate?.fans)) ? Number(candidate.fans) : 0,
        videoCount: Number.isFinite(Number(candidate?.videos ?? candidate?.videoCount))
            ? Number(candidate?.videos ?? candidate?.videoCount)
            : 0,
        level: Number.isFinite(Number(candidate?.level)) ? Number(candidate.level) : 0,
        officialVerifyType: Number.isFinite(Number(candidate?.official_verify_type ?? candidate?.officialVerifyType))
            ? Number(candidate?.official_verify_type ?? candidate?.officialVerifyType)
            : -1,
        officialVerifyDesc: String(candidate?.official_verify_desc || candidate?.officialVerifyDesc || '').trim(),
        isLive: Boolean(candidate?.is_live ?? candidate?.isLive),
        isUpUser: Boolean(candidate?.is_upuser ?? candidate?.isUpUser)
    }
}

function hasGroupUserSubscription(subscriptions, groupId, uid) {
    const users = Array.isArray(subscriptions?.users) ? subscriptions.users : []

    return users.some(sub => {
        const subUid = normalizeValue(sub?.uid)
        if (subUid !== uid) {
            return false
        }

        const groupIds = Array.isArray(sub?.groupIds) ? sub.groupIds.map(id => normalizeValue(id)).filter(Boolean) : []
        return groupIds.includes(groupId)
    })
}

class SubscriptionController {
    constructor({ subscriptionService }) {
        this.subscriptionService = subscriptionService
    }

    async read({ action, groupId, input }) {
        const scopedGroupId = resolveManagedGroupId(groupId, input)
        const readOperation = normalizeSubscriptionReadOperation(input)

        if (readOperation === 'search_user') {
            const query = normalizeSearchQuery(input)
            const limit = normalizeSearchLimit(input)
            const searchResult = await this.subscriptionService.searchUsers(query, scopedGroupId, {
                page: 1,
                pageSize: limit
            })

            if (!searchResult || searchResult.status !== 'success') {
                throw new Error(searchResult?.message || 'B站用户搜索失败')
            }

            const rawData = searchResult.data && typeof searchResult.data === 'object'
                ? searchResult.data
                : {}
            const candidates = Array.isArray(rawData.candidates)
                ? rawData.candidates
                    .map(normalizeUserSearchCandidate)
                    .filter(candidate => candidate.uid && candidate.name)
                    .map((candidate, index) => ({ ...candidate, rank: index + 1 }))
                : []
            const total = Number.isFinite(Number(rawData.total)) ? Number(rawData.total) : candidates.length

            return {
                ok: true,
                action,
                namespace: 'subscription',
                scope: 'current_group',
                groupId: scopedGroupId,
                data: {
                    operation: 'search_user',
                    query,
                    page: 1,
                    limit,
                    candidates,
                    counts: {
                        returned: candidates.length,
                        total
                    }
                }
            }
        }

        const subscriptions = await this.subscriptionService.getSubscriptionsByGroup(scopedGroupId)
        const users = Array.isArray(subscriptions?.users)
            ? subscriptions.users.map(normalizeUserSubscription)
            : []
        const bangumis = Array.isArray(subscriptions?.bangumis)
            ? subscriptions.bangumis.map(normalizeBangumiSubscription)
            : []

        return {
            ok: true,
            action,
            namespace: 'subscription',
            scope: 'current_group',
            groupId: scopedGroupId,
            data: {
                users,
                bangumis,
                counts: {
                    users: users.length,
                    bangumis: bangumis.length,
                    total: users.length + bangumis.length
                }
            }
        }
    }

    async write({ action, groupId, input }) {
        const snapshot = buildSubscriptionWriteSnapshot({ groupId, input })
        const { operation, uid } = snapshot.input
        const subscriptions = await this.subscriptionService.getSubscriptionsByGroup(snapshot.groupId)
        const alreadySubscribed = hasGroupUserSubscription(subscriptions, snapshot.groupId, uid)

        if (operation === 'add_user' && alreadySubscribed) {
            return {
                ok: true,
                action,
                namespace: 'subscription',
                operation: 'write',
                scope: 'current_group',
                groupId: snapshot.groupId,
                mutation: false,
                data: {
                    operation,
                    subscriptionType: 'user',
                    uid,
                    status: 'already_subscribed'
                }
            }
        }

        if (operation === 'remove_user' && !alreadySubscribed) {
            return {
                ok: true,
                action,
                namespace: 'subscription',
                operation: 'write',
                scope: 'current_group',
                groupId: snapshot.groupId,
                mutation: false,
                data: {
                    operation,
                    subscriptionType: 'user',
                    uid,
                    status: 'not_subscribed'
                }
            }
        }

        if (operation === 'add_user') {
            await this.subscriptionService.addUserSubscription(uid, snapshot.groupId)
        } else if (operation === 'remove_user') {
            await this.subscriptionService.removeUserSubscription(uid, snapshot.groupId)
        }

        return {
            ok: true,
            action,
            namespace: 'subscription',
            operation: 'write',
            scope: 'current_group',
            groupId: snapshot.groupId,
            mutation: true,
            data: {
                operation,
                subscriptionType: 'user',
                uid,
                status: 'updated'
            }
        }
    }
}

module.exports = {
    SubscriptionController,
    buildSubscriptionReadSnapshot,
    buildSubscriptionWriteSnapshot,
    isPrivatePseudoGroupId,
    isRealGroupScope,
    resolveManagedGroupId,
    resolveScopedGroupId
}
