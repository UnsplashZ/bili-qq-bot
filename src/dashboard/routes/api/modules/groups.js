const express = require('express')
const logger = require('../../../../utils/logger')
const sysConfig = require('../../../../config')
const {
    assertWebuiManageableGroup,
    getKnownManageableGroupIds,
    getGroupIdsInBotGroupList,
    getKnownManageableNumericGroupIds,
    getNumericGroupIdsInBotGroupList,
    isInBotGroupList,
    isOfficialProviderMode
} = require('../shared/group-guard')
const { isNumericGroupId } = require('../shared/normalize')
const { dashLog } = require('../shared/logging')

const router = express.Router()

// GET /api/groups - List all groups (including disabled and left ones)
router.get('/groups', async (req, res) => {
    try {
        const bot = global.bot
        const groupConfigs = sysConfig.groupConfigs || {}
        const allowOpaque = isOfficialProviderMode(sysConfig, bot)
        const enabledGroups = (typeof sysConfig.getEnabledGroupsForProvider === 'function'
            ? sysConfig.getEnabledGroupsForProvider(allowOpaque ? 'official' : 'napcat')
            : (Array.isArray(sysConfig.enabledGroups) ? sysConfig.enabledGroups : [])
        ).map(id => String(id))
        const enabledSet = new Set(enabledGroups)
        const whitelistMode = enabledGroups.length > 0
        const allGroupIds = getKnownManageableGroupIds(sysConfig, bot, { allowOpaque })

        const groupsData = Array.from(allGroupIds)
            .sort((a, b) => {
                const aNumeric = isNumericGroupId(a)
                const bNumeric = isNumericGroupId(b)
                if (aNumeric && bNumeric) return Number(a) - Number(b)
                return String(a).localeCompare(String(b))
            })
            .map(groupId => {
            const groupIdStr = String(groupId)
            const groupIdNum = Number(groupIdStr)
            const groupInfo =
                bot?.groupList?.get(groupId) || (isNumericGroupId(groupIdStr) ? bot?.groupList?.get(groupIdNum) : null)
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
                isInGroup = isInBotGroupList(bot, groupIdStr, { allowOpaque })
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

        dashLog(req, 'info', 'groups-fetched', {
            count: groupsData.length
        })
        res.json(groupsData)
    } catch (error) {
        dashLog(req, 'error', 'groups-fetch-failed', {
            error: logger.getErrorMessage(error)
        })
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
        const allowOpaque = isOfficialProviderMode(sysConfig, global.bot)

        const providerScope = allowOpaque ? 'official' : 'napcat'
        let enabledGroups = (typeof sysConfig.getMutableEnabledGroupsForProvider === 'function'
            ? sysConfig.getMutableEnabledGroupsForProvider(providerScope)
            : (Array.isArray(sysConfig.enabledGroups) ? sysConfig.enabledGroups : [])
        ).map(id => String(id))
        const enabledSet = new Set(enabledGroups)
        const currentlyEnabled = enabledGroups.length === 0 || enabledSet.has(groupIdStr)
        let isEnabled

        if (currentlyEnabled) {
            if (enabledGroups.length === 0) {
                // 运行时语义中空白名单表示“全部启用”，禁用单群时先显式展开当前在群列表
                enabledGroups = allowOpaque
                    ? Array.from(getGroupIdsInBotGroupList(global.bot, { allowOpaque: true }))
                    : Array.from(getNumericGroupIdsInBotGroupList(global.bot))
                if (enabledGroups.length === 0) {
                    // Bot 离线时回退到已知群集合，避免“返回禁用成功但空白名单仍表示全部启用”
                    enabledGroups = allowOpaque
                        ? Array.from(getKnownManageableGroupIds(sysConfig, global.bot, { allowOpaque: true }))
                        : Array.from(getKnownManageableNumericGroupIds(sysConfig, global.bot))
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

        enabledGroups = Array.from(new Set(enabledGroups))
        if (allowOpaque && typeof sysConfig.getMutableEnabledGroupsForProvider === 'function') {
            const scopedGroups = sysConfig.getMutableEnabledGroupsForProvider('official')
            scopedGroups.splice(0, scopedGroups.length, ...enabledGroups)
        } else {
            sysConfig.enabledGroups = enabledGroups
        }
        sysConfig.save()
        dashLog(req, 'info', 'group-toggled', {
            groupId,
            isEnabled
        })
        res.json({ message: `Group ${groupId} toggled`, isEnabled })
    } catch (error) {
        dashLog(req, 'error', 'group-toggle-failed', {
            groupId: req.params.id,
            error: logger.getErrorMessage(error)
        })
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

        if (!sysConfig.groupConfigs) {
            sysConfig.groupConfigs = {}
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

        const cleanedUpdates = { ...updates }
        if (
            updates.hasOwnProperty('subscriptionAtAllRules') &&
            updates.subscriptionAtAllRules === null
        ) {
            delete cleanedUpdates.subscriptionAtAllRules
            if (sysConfig.groupConfigs[groupIdStr]) {
                delete sysConfig.groupConfigs[groupIdStr].subscriptionAtAllRules
            }
        }

        const groupConfig = sysConfig.groupConfigs[groupIdStr] || {}
        Object.assign(groupConfig, cleanedUpdates)
        sysConfig.groupConfigs[groupIdStr] = groupConfig

        sysConfig.save()

        const normalizedRules = sysConfig.normalizeSubscriptionAtAllRules(
            sysConfig.groupConfigs[groupIdStr].subscriptionAtAllRules
        )
        sysConfig.groupConfigs[groupIdStr].subscriptionAtAllRules = normalizedRules

        dashLog(req, 'info', 'group-config-updated', {
            groupId,
            keys: Object.keys(cleanedUpdates).join(',')
        })
        res.json({
            message: `Group ${groupId} configuration updated`,
            config: sysConfig.groupConfigs[groupIdStr]
        })
    } catch (error) {
        dashLog(req, 'error', 'group-config-update-failed', {
            groupId: req.params.id,
            error: logger.getErrorMessage(error)
        })
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

        const allowOpaque = isOfficialProviderMode(sysConfig, global.bot)
        const enabledGroups = allowOpaque && typeof sysConfig.getMutableEnabledGroupsForProvider === 'function'
            ? sysConfig.getMutableEnabledGroupsForProvider('official')
            : sysConfig.enabledGroups
        if (enabledGroups) {
            const index = enabledGroups.indexOf(groupIdStr)
            if (index !== -1) {
                enabledGroups.splice(index, 1)
                modified = true
            }
        }

        if (!modified) {
            return res.status(404).json({ error: 'Group config not found' })
        }

        const subscriptionManager = require('../../../../services/subscription/subscriptionManager')
        await subscriptionManager.removeGroupFromAllSubscriptions(groupId)

        sysConfig.save()

        dashLog(req, 'info', 'group-config-deleted', {
            groupId
        })
        res.json({ success: true, message: `Config for group ${groupId} deleted` })
    } catch (error) {
        dashLog(req, 'error', 'group-config-delete-failed', {
            groupId: req.params.id,
            error: logger.getErrorMessage(error)
        })
        res.status(500).json({ error: 'Failed to delete group config' })
    }
})

module.exports = router
