function getRootAdminQQ() {
    const raw = process.env.ADMIN_QQ
    if (raw === undefined || raw === null) return ''
    return String(raw).trim()
}

function getOfficialRootOpenids(config = null) {
    const fromConfig = Array.isArray(config?.qqOfficialRootOpenids)
        ? config.qqOfficialRootOpenids
        : []
    const fromEnv = String(process.env.QQ_OFFICIAL_ROOT_OPENIDS || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    return [...fromConfig, ...fromEnv]
}

function isOfficialRootAdmin(userId, config = null) {
    const normalized = String(userId || '').trim()
    if (!normalized) return false
    return getOfficialRootOpenids(config).some((item) => String(item).trim() === normalized)
}

function isRootAdmin(userId, config = null) {
    if (String(config?.qqProvider || '').toLowerCase() === 'official' && isOfficialRootAdmin(userId, config)) {
        return true
    }
    const rootAdminQQ = getRootAdminQQ()
    if (!rootAdminQQ || userId === undefined || userId === null) return false
    return String(userId) === rootAdminQQ
}

function isGroupAdmin(groupId, userId, groupConfigs, config = null) {
    if (isRootAdmin(userId, config)) return true
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
    getOfficialRootOpenids,
    isOfficialRootAdmin,
    isRootAdmin,
    isGroupAdmin,
    addGroupAdmin,
    removeGroupAdmin
}
