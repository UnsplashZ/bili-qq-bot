const {
    normalizeGroupId,
    isPrivateVirtualGroupId,
    isNumericGroupId
} = require('./normalize')

function getNumericGroupIdsInBotGroupList(bot) {
    const ids = new Set()
    if (!bot || !bot.groupList) return ids

    bot.groupList.forEach((_info, groupId) => {
        const id = String(groupId)
        if (isNumericGroupId(id)) {
            ids.add(id)
        }
    })

    return ids
}

function isInBotGroupList(bot, groupId) {
    if (!bot || !bot.groupList || !isNumericGroupId(groupId)) return false

    const numericId = Number(groupId)
    return bot.groupList.has(groupId) || bot.groupList.has(numericId)
}

function getKnownManageableNumericGroupIds(sysConfig, bot) {
    const ids = getNumericGroupIdsInBotGroupList(bot)

    const groupConfigs = sysConfig.groupConfigs || {}
    Object.keys(groupConfigs).forEach(groupId => {
        if (isNumericGroupId(groupId)) {
            ids.add(groupId)
        }
    })

    const enabledGroups = Array.isArray(sysConfig.enabledGroups)
        ? sysConfig.enabledGroups
        : []
    enabledGroups.forEach(groupId => {
        const id = String(groupId)
        if (isNumericGroupId(id)) {
            ids.add(id)
        }
    })

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

    if (!isNumericGroupId(groupId)) {
        res.status(400).json({ error: 'Invalid groupId' })
        return null
    }

    const bot = global.bot
    const inBotGroupList = isInBotGroupList(bot, groupId)
    const knownGroupIds = getKnownManageableNumericGroupIds(sysConfig, bot)

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
        groupIdNum: Number(groupId),
        groupConfig: groupConfig || {},
        isInGroup,
        inBotGroupList
    }
}

module.exports = {
    assertWebuiManageableGroup,
    getKnownManageableNumericGroupIds,
    getNumericGroupIdsInBotGroupList,
    isInBotGroupList
}

