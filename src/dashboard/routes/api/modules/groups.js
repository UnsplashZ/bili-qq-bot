const express = require('express')
const logger = require('../../../../utils/logger')
const sysConfig = require('../../../../config')
const { normalizeGroupId } = require('../shared/normalize')

const router = express.Router()

// GET /api/groups - List all groups (including disabled and left ones)
router.get('/groups', async (req, res) => {
    try {
        const bot = global.bot
        const groupConfigs = sysConfig.groupConfigs || {}
        const enabledGroups = new Set(sysConfig.enabledGroups || [])

        const allGroupIds = new Set()

        if (bot && bot.groupList) {
            bot.groupList.forEach((info, groupId) => {
                allGroupIds.add(groupId)
            })
        }

        Object.keys(groupConfigs).forEach(groupId => {
            allGroupIds.add(groupId)
        })

        if (sysConfig.enabledGroups) {
            sysConfig.enabledGroups.forEach(groupId => {
                allGroupIds.add(groupId)
            })
        }

        const groupsData = Array.from(allGroupIds).map(groupId => {
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
                isInGroup =
                    bot.groupList.has(groupId) || bot.groupList.has(groupIdNum)
            } else {
                isInGroup = groupConfig.isInGroup !== false
            }

            return {
                id: groupIdStr,
                name: groupInfo?.group_name || `群组 ${groupIdStr}`,
                isEnabled: enabledGroups.has(groupIdStr),
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
        const groupId = normalizeGroupId(req.params.id)
        const groupIdStr = String(groupId)
        const groupIdNum = Number(groupIdStr)

        if (
            !global.bot ||
            !global.bot.groupList ||
            (!global.bot.groupList.has(groupIdStr) &&
                !global.bot.groupList.has(groupIdNum))
        ) {
            return res.status(404).json({ error: 'Group not found' })
        }

        if (!sysConfig.enabledGroups) {
            sysConfig.enabledGroups = []
        }

        const index = sysConfig.enabledGroups.indexOf(groupIdStr)
        let isEnabled

        if (index === -1) {
            sysConfig.enabledGroups.push(groupIdStr)
            isEnabled = true
        } else {
            sysConfig.enabledGroups.splice(index, 1)
            isEnabled = false
        }

        sysConfig.save()
        res.json({ message: `Group ${groupId} toggled`, isEnabled })
    } catch (error) {
        res.status(500).json({ error: 'Failed to toggle group status' })
    }
})

// POST /api/groups/:id/config - Update specific group config
router.post('/groups/:id/config', async (req, res) => {
    try {
        const groupId = normalizeGroupId(req.params.id)
        const groupIdStr = String(groupId)
        const groupIdNum = Number(groupIdStr)
        const updates = req.body

        if (
            !global.bot ||
            !global.bot.groupList ||
            (!global.bot.groupList.has(groupIdStr) &&
                !global.bot.groupList.has(groupIdNum))
        ) {
            return res.status(404).json({ error: 'Group not found' })
        }

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
        const groupId = normalizeGroupId(req.params.id)
        const groupIdStr = String(groupId)
        const groupIdNum = Number(groupIdStr)
        const groupConfig = sysConfig.groupConfigs?.[groupIdStr]

        const bot = global.bot
        let isInBotGroup = true
        if (bot && bot.groupList) {
            isInBotGroup =
                bot.groupList.has(groupIdStr) || bot.groupList.has(groupIdNum)
        } else if (groupConfig) {
            isInBotGroup = groupConfig.isInGroup !== false
        }

        if (isInBotGroup) {
            return res.status(400).json({
                error: 'Can only delete configs for groups that bot has left'
            })
        }

        let modified = false

        if (groupConfig) {
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

