const express = require('express')
const logger = require('../../../../utils/logger')
const sysConfig = require('../../../../config')
const {
    assertWebuiManageableGroup,
    getKnownManageableNumericGroupIds,
    getNumericGroupIdsInBotGroupList,
    isInBotGroupList
} = require('../shared/group-guard')

const router = express.Router()

// GET /api/groups - List all groups (including disabled and left ones)
router.get('/groups', async (req, res) => {
    try {
        const bot = global.bot
        const groupConfigs = sysConfig.groupConfigs || {}
        const enabledGroups = Array.isArray(sysConfig.enabledGroups)
            ? sysConfig.enabledGroups.map(id => String(id))
            : []
        const enabledSet = new Set(enabledGroups)
        const whitelistMode = enabledGroups.length > 0
        const allGroupIds = getKnownManageableNumericGroupIds(sysConfig, bot)

        const groupsData = Array.from(allGroupIds)
            .sort((a, b) => Number(a) - Number(b))
            .map(groupId => {
            const groupIdStr = String(groupId)
            const groupIdNum = Number(groupIdStr)
            const groupInfo =
                bot?.groupList?.get(groupId) || bot?.groupList?.get(groupIdNum)
            const groupConfig = groupConfigs[groupIdStr] || {}
            const normalizedRules = sysConfig.normalizeSubscriptionAtAllRules(
                groupConfig.subscriptionAtAllRules
            )
            const configWithDefaults = {
                ...groupConfig,
                subscriptionAtAllRules: normalizedRules
            }

            let isInGroup = true
            if (bot && bot.groupList) {
                isInGroup = isInBotGroupList(bot, groupIdStr)
            } else {
                isInGroup = groupConfig.isInGroup !== false
            }

            return {
                id: groupIdStr,
                name: groupInfo?.group_name || `群组 ${groupIdStr}`,
                isEnabled: whitelistMode ? enabledSet.has(groupIdStr) : true,
                isInGroup,
                config: configWithDefaults
            }
        })

        res.json(groupsData)
    } catch (error) {
        logger.error('Error fetching groups:', error)
        res.status(500).json({ error: 'Failed to fetch groups' })
    }
})

// POST /api/groups/:id/toggle - Toggle group enabled status
router.post('/groups/:id/toggle', async (req, res) => {
    try {
        const guarded = assertWebuiManageableGroup(req, res, sysConfig, {
            paramName: 'id',
            requireInGroup: true
        })
        if (!guarded) return
        const groupId = guarded.groupId
        const groupIdStr = String(groupId)

        if (!sysConfig.enabledGroups) {
            sysConfig.enabledGroups = []
        }

        let enabledGroups = Array.isArray(sysConfig.enabledGroups)
            ? sysConfig.enabledGroups.map(id => String(id))
            : []
        const enabledSet = new Set(enabledGroups)
        const currentlyEnabled = enabledGroups.length === 0 || enabledSet.has(groupIdStr)
        let isEnabled

        if (currentlyEnabled) {
            if (enabledGroups.length === 0) {
                // 运行时语义中空白名单表示“全部启用”，禁用单群时先显式展开当前在群列表
                enabledGroups = Array.from(getNumericGroupIdsInBotGroupList(global.bot))
                if (enabledGroups.length === 0) {
                    // Bot 离线时回退到已知群集合，避免“返回禁用成功但空白名单仍表示全部启用”
                    enabledGroups = Array.from(
                        getKnownManageableNumericGroupIds(sysConfig, global.bot)
                    )
                }
            }
            enabledGroups = enabledGroups.filter(id => id !== groupIdStr)
            isEnabled = false
        } else {
            if (!enabledSet.has(groupIdStr)) {
                enabledGroups.push(groupIdStr)
            }
            isEnabled = true
        }

        sysConfig.enabledGroups = Array.from(new Set(enabledGroups))
        sysConfig.save()
        res.json({ message: `Group ${groupId} toggled`, isEnabled })
    } catch (error) {
        res.status(500).json({ error: 'Failed to toggle group status' })
    }
})

// POST /api/groups/:id/config - Update specific group config
router.post('/groups/:id/config', async (req, res) => {
    try {
        const guarded = assertWebuiManageableGroup(req, res, sysConfig, {
            paramName: 'id',
            requireInGroup: true
        })
        if (!guarded) return
        const groupId = guarded.groupId
        const groupIdStr = String(groupId)
        const updates = req.body

        if (!updates || typeof updates !== 'object') {
            return res.status(400).json({ error: 'Invalid configuration data' })
        }

        if (updates.hasOwnProperty('aiProbability') && updates.aiProbability !== null) {
            const prob = parseFloat(updates.aiProbability)
            if (isNaN(prob) || prob < 0 || prob > 1) {
                return res
                    .status(400)
                    .json({ error: 'aiProbability must be between 0 and 1' })
            }
            updates.aiProbability = prob
        }

        if (updates.hasOwnProperty('aiContextLimit') && updates.aiContextLimit !== null) {
            const limit = parseInt(updates.aiContextLimit, 10)
            if (isNaN(limit) || limit < 1 || limit > 100) {
                return res
                    .status(400)
                    .json({ error: 'aiContextLimit must be between 1 and 100' })
            }
            updates.aiContextLimit = limit
        }

        if (updates.hasOwnProperty('aiTemperature') && updates.aiTemperature !== null) {
            const temp = parseFloat(updates.aiTemperature)
            if (isNaN(temp) || temp < 0 || temp > 2) {
                return res
                    .status(400)
                    .json({ error: 'aiTemperature must be between 0 and 2' })
            }
            updates.aiTemperature = temp
        }

        const aiToggleKeys = ['aiEnabled', 'aiRagEnabled', 'aiProfileEnabled']
        for (const key of aiToggleKeys) {
            if (
                updates.hasOwnProperty(key) &&
                updates[key] !== null &&
                typeof updates[key] !== 'boolean'
            ) {
                return res
                    .status(400)
                    .json({ error: `${key} must be a boolean or null` })
            }
        }

        if (
            updates.hasOwnProperty('subscriptionAtAll') &&
            typeof updates.subscriptionAtAll !== 'boolean'
        ) {
            return res
                .status(400)
                .json({ error: 'subscriptionAtAll must be a boolean' })
        }

        if (updates.hasOwnProperty('subscriptionAtAllRules')) {
            if (updates.subscriptionAtAllRules === null) {
                // null = reset to default behavior (remove group override)
            } else if (
                !updates.subscriptionAtAllRules ||
                typeof updates.subscriptionAtAllRules !== 'object'
            ) {
                return res
                    .status(400)
                    .json({ error: 'subscriptionAtAllRules must be an object or null' })
            } else {
                updates.subscriptionAtAllRules = sysConfig.normalizeSubscriptionAtAllRules(
                    updates.subscriptionAtAllRules
                )
            }
        }

        if (updates.hasOwnProperty('showId') && typeof updates.showId !== 'boolean') {
            return res.status(400).json({ error: 'showId must be a boolean' })
        }

        if (updates.hasOwnProperty('linkCacheTimeout')) {
            const timeout = parseInt(updates.linkCacheTimeout, 10)
            if (isNaN(timeout) || timeout < 0) {
                return res.status(400).json({
                    error: 'linkCacheTimeout must be a non-negative integer'
                })
            }
            updates.linkCacheTimeout = timeout
        }

        if (updates.hasOwnProperty('nightMode')) {
            const nightMode = updates.nightMode

            if (!nightMode || typeof nightMode !== 'object') {
                return res.status(400).json({ error: 'nightMode must be an object' })
            }

            if (!['on', 'off', 'timed'].includes(nightMode.mode)) {
                return res.status(400).json({
                    error: 'nightMode.mode must be "on", "off", or "timed"'
                })
            }

            if (nightMode.mode === 'timed') {
                const timeRegex = /^\d{1,2}:\d{2}$/

                if (
                    !timeRegex.test(nightMode.startTime) ||
                    !timeRegex.test(nightMode.endTime)
                ) {
                    return res.status(400).json({ error: 'Time format must be HH:mm' })
                }

                const [startH, startM] = nightMode.startTime.split(':').map(Number)
                const [endH, endM] = nightMode.endTime.split(':').map(Number)

                if (
                    startH < 0 ||
                    startH > 23 ||
                    startM < 0 ||
                    startM > 59 ||
                    endH < 0 ||
                    endH > 23 ||
                    endM < 0 ||
                    endM > 59
                ) {
                    return res.status(400).json({
                        error: 'Time values out of range (00:00-23:59)'
                    })
                }
            }
        }

        if (!sysConfig.groupConfigs) {
            sysConfig.groupConfigs = {}
        }

        const cleanedUpdates = { ...updates }
        if (updates.hasOwnProperty('aiProbability') && updates.aiProbability === null) {
            delete cleanedUpdates.aiProbability
            if (sysConfig.groupConfigs[groupIdStr]) {
                delete sysConfig.groupConfigs[groupIdStr].aiProbability
            }
        }
        if (updates.hasOwnProperty('aiContextLimit') && updates.aiContextLimit === null) {
            delete cleanedUpdates.aiContextLimit
            if (sysConfig.groupConfigs[groupIdStr]) {
                delete sysConfig.groupConfigs[groupIdStr].aiContextLimit
            }
        }
        if (updates.hasOwnProperty('aiTemperature') && updates.aiTemperature === null) {
            delete cleanedUpdates.aiTemperature
            if (sysConfig.groupConfigs[groupIdStr]) {
                delete sysConfig.groupConfigs[groupIdStr].aiTemperature
            }
        }
        if (updates.hasOwnProperty('aiEnabled') && updates.aiEnabled === null) {
            delete cleanedUpdates.aiEnabled
            if (sysConfig.groupConfigs[groupIdStr]) {
                delete sysConfig.groupConfigs[groupIdStr].aiEnabled
            }
        }
        if (updates.hasOwnProperty('aiRagEnabled') && updates.aiRagEnabled === null) {
            delete cleanedUpdates.aiRagEnabled
            if (sysConfig.groupConfigs[groupIdStr]) {
                delete sysConfig.groupConfigs[groupIdStr].aiRagEnabled
            }
        }
        if (
            updates.hasOwnProperty('aiProfileEnabled') &&
            updates.aiProfileEnabled === null
        ) {
            delete cleanedUpdates.aiProfileEnabled
            if (sysConfig.groupConfigs[groupIdStr]) {
                delete sysConfig.groupConfigs[groupIdStr].aiProfileEnabled
            }
        }
        if (
            updates.hasOwnProperty('subscriptionAtAllRules') &&
            updates.subscriptionAtAllRules === null
        ) {
            delete cleanedUpdates.subscriptionAtAllRules
            if (sysConfig.groupConfigs[groupIdStr]) {
                delete sysConfig.groupConfigs[groupIdStr].subscriptionAtAllRules
            }
        }

        sysConfig.groupConfigs[groupIdStr] = {
            ...(sysConfig.groupConfigs[groupIdStr] || {}),
            ...cleanedUpdates
        }

        sysConfig.save()

        const normalizedRules = sysConfig.normalizeSubscriptionAtAllRules(
            sysConfig.groupConfigs[groupIdStr].subscriptionAtAllRules
        )
        sysConfig.groupConfigs[groupIdStr].subscriptionAtAllRules = normalizedRules

        res.json({
            message: `Group ${groupId} configuration updated`,
            config: sysConfig.groupConfigs[groupIdStr]
        })
    } catch (error) {
        res.status(500).json({ error: 'Failed to update group configuration' })
    }
})

// DELETE /api/groups/:id - Delete config for a left group
router.delete('/groups/:id', async (req, res) => {
    try {
        const guarded = assertWebuiManageableGroup(req, res, sysConfig, {
            paramName: 'id'
        })
        if (!guarded) return
        const groupId = guarded.groupId
        const groupIdStr = String(groupId)

        if (guarded.isInGroup) {
            return res.status(400).json({
                error: 'Can only delete configs for groups that bot has left'
            })
        }

        let modified = false

        if (
            sysConfig.groupConfigs &&
            Object.prototype.hasOwnProperty.call(sysConfig.groupConfigs, groupIdStr)
        ) {
            delete sysConfig.groupConfigs[groupIdStr]
            modified = true
        }

        if (sysConfig.enabledGroups) {
            const index = sysConfig.enabledGroups.indexOf(groupIdStr)
            if (index !== -1) {
                sysConfig.enabledGroups.splice(index, 1)
                modified = true
            }
        }

        if (!modified) {
            return res.status(404).json({ error: 'Group config not found' })
        }

        const subscriptionManager = require('../../../../services/subscription/subscriptionManager')
        await subscriptionManager.removeGroupFromAllSubscriptions(groupId)

        sysConfig.save()

        logger.info(`[API] Deleted config for left group ${groupId}`)
        res.json({ success: true, message: `Config for group ${groupId} deleted` })
    } catch (error) {
        logger.error('Error deleting group config:', error)
        res.status(500).json({ error: 'Failed to delete group config' })
    }
})

module.exports = router
