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
    const gid = normalizeGroupId(groupId)
    if (!gid) return false
    return isGroupInService(gid) && config.isGroupEnabled(gid)
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
    canReceiveSubscriptionNotification,
    canReceiveSubscriptionVideoDownload
}
