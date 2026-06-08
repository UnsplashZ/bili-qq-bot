const config = require('../../../../config')

function normalizeGroupId(groupId) {
    if (groupId === null || groupId === undefined) return ''
    return String(groupId).trim()
}

function isGroupInService(groupId) {
    const gid = normalizeGroupId(groupId)
    if (!gid) return false
    const groupConfig = config.groupConfigs && config.groupConfigs[gid]
    return !groupConfig || groupConfig.isInGroup !== false
}

function canReceiveSubscriptionNotification(groupId) {
    return getSubscriptionNotificationReachability(groupId).ok
}

function getSubscriptionNotificationReachability(groupId) {
    const gid = normalizeGroupId(groupId)
    if (!gid) {
        return { ok: false, groupId: '', reason: 'invalid_group' }
    }
    if (!isGroupInService(gid)) {
        return { ok: false, groupId: gid, reason: 'not_in_group' }
    }
    if (!config.isGroupEnabled(gid)) {
        return { ok: false, groupId: gid, reason: 'group_disabled' }
    }
    return { ok: true, groupId: gid, reason: 'ok' }
}

function canReceiveSubscriptionVideoDownload(groupId) {
    const gid = normalizeGroupId(groupId)
    if (!gid) return false
    const isVideoDownloadEnabled = typeof config.isVideoDownloadEnabledForGroup === 'function'
        ? config.isVideoDownloadEnabledForGroup(gid)
        : false
    return canReceiveSubscriptionNotification(gid) && isVideoDownloadEnabled
}

module.exports = {
    normalizeGroupId,
    isGroupInService,
    getSubscriptionNotificationReachability,
    canReceiveSubscriptionNotification,
    canReceiveSubscriptionVideoDownload
}
