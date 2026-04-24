const config = require('../../config')

function normalizeRole(role) {
    const value = String(role || 'unknown').toLowerCase()
    if (['owner', 'admin', 'member'].includes(value)) return value
    return 'unknown'
}

function resolveActor({ groupId, userId, messageData }) {
    const isRoot = config.isRootAdmin(userId)
    const isConfiguredGroupAdmin = groupId ? config.isGroupAdmin(groupId, userId) : false
    const qqRole = normalizeRole(messageData?.sender?.role)
    const isQqManager = qqRole === 'admin' || qqRole === 'owner'

    return {
        userId: userId ? String(userId) : '',
        groupId: groupId ? String(groupId) : '',
        isRoot,
        isConfiguredGroupAdmin,
        qqRole,
        canManageGroupConfig: Boolean(isRoot || isConfiguredGroupAdmin || isQqManager),
        canManageSubscriptions: Boolean(isRoot || isConfiguredGroupAdmin || isQqManager),
        canManageGlobalConfig: Boolean(isRoot)
    }
}

module.exports = {
    resolveActor,
    normalizeRole
}
