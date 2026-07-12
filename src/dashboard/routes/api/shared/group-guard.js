const {
    normalizeGroupId,
    isPrivateVirtualGroupId,
    isNumericGroupId,
    isOfficialOpaqueGroupId
} = require('./normalize')

function isOfficialProviderMode(sysConfig, bot = global.bot) {
    return String(sysConfig?.qqProvider || '').toLowerCase() === 'official' ||
        String(bot?.provider?.id || '').toLowerCase() === 'official'
}

function getGroupIdsInBotGroupList(bot, options = {}) {
    const ids = new Set()
    if (!bot || !bot.groupList) return ids

    const allowOpaque = options.allowOpaque === true
    bot.groupList.forEach((_info, groupId) => {
        const id = String(groupId)
        if (isNumericGroupId(id) || (allowOpaque && isOfficialOpaqueGroupId(id))) {
            ids.add(id)
        }
    })

    return ids
}

function getNumericGroupIdsInBotGroupList(bot) {
    return getGroupIdsInBotGroupList(bot, { allowOpaque: false })
}

function isInBotGroupList(bot, groupId, options = {}) {
    if (!bot || !bot.groupList) return false
    const id = String(groupId || '')
    if (!isNumericGroupId(id) && !(options.allowOpaque === true && isOfficialOpaqueGroupId(id))) return false

    const numericId = Number(id)
    return bot.groupList.has(id) || (isNumericGroupId(id) && bot.groupList.has(numericId))
}

function getKnownManageableGroupIds(sysConfig, bot, options = {}) {
    const allowOpaque = options.allowOpaque === true || isOfficialProviderMode(sysConfig, bot)
    const ids = getGroupIdsInBotGroupList(bot, { allowOpaque })

    const groupConfigs = sysConfig.groupConfigs || {}
    Object.keys(groupConfigs).forEach(groupId => {
        if (isNumericGroupId(groupId) || (allowOpaque && isOfficialOpaqueGroupId(groupId))) {
            ids.add(groupId)
        }
    })

    const providerScope = allowOpaque ? 'official' : 'napcat'
    const enabledGroups = typeof sysConfig.getEnabledGroupsForProvider === 'function'
        ? sysConfig.getEnabledGroupsForProvider(providerScope)
        : (Array.isArray(sysConfig.enabledGroups) ? sysConfig.enabledGroups : [])
    enabledGroups.forEach(groupId => {
        const id = String(groupId)
        if (isNumericGroupId(id) || (allowOpaque && isOfficialOpaqueGroupId(id))) {
            ids.add(id)
        }
    })

    return ids
}

function getKnownManageableNumericGroupIds(sysConfig, bot) {
    const ids = new Set()
    for (const groupId of getKnownManageableGroupIds(sysConfig, bot, { allowOpaque: false })) {
        if (isNumericGroupId(groupId)) ids.add(groupId)
    }
    return ids
}

function assertWebuiManageableGroup(req, res, sysConfig, options = {}) {
    const paramName = options.paramName || 'id'
    const requireInGroup = options.requireInGroup === true

    const rawGroupId = req.params ? req.params[paramName] : null
    const groupId = normalizeGroupId(rawGroupId)

    if (!groupId) {
        res.status(400).json({ error: 'Invalid groupId' })
        return null
    }

    if (isPrivateVirtualGroupId(groupId)) {
        res.status(400).json({ error: 'WebUI 不支持私聊会话管理' })
        return null
    }

    const allowOpaque = isOfficialProviderMode(sysConfig, global.bot)
    if (!isNumericGroupId(groupId) && !(allowOpaque && isOfficialOpaqueGroupId(groupId))) {
        res.status(400).json({ error: 'Invalid groupId' })
        return null
    }

    const bot = global.bot
    const inBotGroupList = isInBotGroupList(bot, groupId, { allowOpaque })
    const knownGroupIds = getKnownManageableGroupIds(sysConfig, bot, { allowOpaque })

    if (!knownGroupIds.has(groupId)) {
        res.status(404).json({ error: 'Group not found' })
        return null
    }

    const groupConfig = (sysConfig.groupConfigs || {})[groupId]
    const isInGroup = bot && bot.groupList
        ? inBotGroupList
        : (groupConfig ? groupConfig.isInGroup !== false : false)

    if (requireInGroup && !isInGroup) {
        res.status(404).json({ error: 'Group not found' })
        return null
    }

    return {
        groupId,
        groupIdNum: isNumericGroupId(groupId) ? Number(groupId) : null,
        groupConfig: groupConfig || {},
        isInGroup,
        inBotGroupList
    }
}

module.exports = {
    assertWebuiManageableGroup,
    getKnownManageableGroupIds,
    getGroupIdsInBotGroupList,
    getKnownManageableNumericGroupIds,
    getNumericGroupIdsInBotGroupList,
    isInBotGroupList,
    isOfficialProviderMode
}
