function getRootAdminQQ() {
    const raw = process.env.ADMIN_QQ
    if (raw === undefined || raw === null) return ''
    return String(raw).trim()
}

function isRootAdmin(userId) {
    const rootAdminQQ = getRootAdminQQ()
    if (!rootAdminQQ || userId === undefined || userId === null) return false
    return String(userId) === rootAdminQQ
}

function isGroupAdmin(groupId, userId, groupConfigs) {
    if (isRootAdmin(userId)) return true
    if (!groupId) return false

    const groupConfig = groupConfigs[groupId]
    if (groupConfig && groupConfig.admins && Array.isArray(groupConfig.admins)) {
        return groupConfig.admins.includes(userId.toString())
    }
    return false
}

function addGroupAdmin(groupId, userId, groupConfigs, saveFn) {
    if (!groupId || !userId) return false
    if (!groupConfigs[groupId]) groupConfigs[groupId] = {}
    if (!groupConfigs[groupId].admins) groupConfigs[groupId].admins = []

    const strId = userId.toString()
    if (!groupConfigs[groupId].admins.includes(strId)) {
        groupConfigs[groupId].admins.push(strId)
        saveFn()
        return true
    }
    return false
}

function removeGroupAdmin(groupId, userId, groupConfigs, saveFn) {
    if (!groupId || !userId) return false
    if (!groupConfigs[groupId] || !groupConfigs[groupId].admins) return false

    const strId = userId.toString()
    const index = groupConfigs[groupId].admins.indexOf(strId)
    if (index > -1) {
        groupConfigs[groupId].admins.splice(index, 1)
        saveFn()
        return true
    }
    return false
}

module.exports = {
    getRootAdminQQ,
    isRootAdmin,
    isGroupAdmin,
    addGroupAdmin,
    removeGroupAdmin
}
