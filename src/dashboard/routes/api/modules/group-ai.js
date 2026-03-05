const express = require('express')
const logger = require('../../../../utils/logger')
const sysConfig = require('../../../../config')
const { assertWebuiManageableGroup } = require('../shared/group-guard')

const router = express.Router()

// GET /api/groups/:groupId/ai-config - Get group-level AI configuration
router.get('/groups/:groupId/ai-config', async (req, res) => {
    try {
        const guarded = assertWebuiManageableGroup(req, res, sysConfig, {
            paramName: 'groupId'
        })
        if (!guarded) return
        const groupId = guarded.groupId

        sysConfig.ensureGroupConfig(groupId)

        const groupConfig = sysConfig.groupConfigs[groupId]

        res.json({
            aiEnabled:
                groupConfig.aiEnabled !== undefined ? groupConfig.aiEnabled : null,
            aiRagEnabled:
                groupConfig.aiRagEnabled !== undefined
                    ? groupConfig.aiRagEnabled
                    : null,
            aiProfileEnabled:
                groupConfig.aiProfileEnabled !== undefined
                    ? groupConfig.aiProfileEnabled
                    : null,
            global: {
                aiEnabled: sysConfig.aiEnabled,
                aiRagEnabled: sysConfig.aiRagEnabled,
                aiProfileEnabled: sysConfig.aiProfileEnabled
            }
        })
    } catch (error) {
        logger.error(`Error fetching AI config for group ${req.params.groupId}:`, error)
        res.status(500).json({ error: 'Failed to fetch AI configuration' })
    }
})

// PUT /api/groups/:groupId/ai-config - Update group-level AI configuration
router.put('/groups/:groupId/ai-config', async (req, res) => {
    try {
        const guarded = assertWebuiManageableGroup(req, res, sysConfig, {
            paramName: 'groupId'
        })
        if (!guarded) return
        const groupId = guarded.groupId
        const { aiEnabled, aiRagEnabled, aiProfileEnabled } = req.body

        if (
            aiEnabled === undefined &&
            aiRagEnabled === undefined &&
            aiProfileEnabled === undefined
        ) {
            return res.status(400).json({
                error: 'At least one of aiEnabled, aiRagEnabled, or aiProfileEnabled must be provided'
            })
        }

        sysConfig.ensureGroupConfig(groupId)

        const groupConfig = sysConfig.groupConfigs[groupId]

        if (aiEnabled !== undefined) {
            if (aiEnabled === null) {
                delete groupConfig.aiEnabled
            } else if (typeof aiEnabled === 'boolean') {
                groupConfig.aiEnabled = aiEnabled
            } else {
                return res.status(400).json({
                    error: 'aiEnabled must be a boolean or null'
                })
            }
        }

        if (aiRagEnabled !== undefined) {
            if (aiRagEnabled === null) {
                delete groupConfig.aiRagEnabled
            } else if (typeof aiRagEnabled === 'boolean') {
                groupConfig.aiRagEnabled = aiRagEnabled
            } else {
                return res.status(400).json({
                    error: 'aiRagEnabled must be a boolean or null'
                })
            }
        }

        if (aiProfileEnabled !== undefined) {
            if (aiProfileEnabled === null) {
                delete groupConfig.aiProfileEnabled
            } else if (typeof aiProfileEnabled === 'boolean') {
                groupConfig.aiProfileEnabled = aiProfileEnabled
            } else {
                return res.status(400).json({
                    error: 'aiProfileEnabled must be a boolean or null'
                })
            }
        }

        sysConfig.save()

        logger.info(`[API] Updated AI config for group ${groupId}`)

        res.json({
            message: 'AI configuration updated successfully',
            aiEnabled:
                groupConfig.aiEnabled !== undefined ? groupConfig.aiEnabled : null,
            aiRagEnabled:
                groupConfig.aiRagEnabled !== undefined
                    ? groupConfig.aiRagEnabled
                    : null,
            aiProfileEnabled:
                groupConfig.aiProfileEnabled !== undefined
                    ? groupConfig.aiProfileEnabled
                    : null,
            global: {
                aiEnabled: sysConfig.aiEnabled,
                aiRagEnabled: sysConfig.aiRagEnabled,
                aiProfileEnabled: sysConfig.aiProfileEnabled
            }
        })
    } catch (error) {
        logger.error(`Error updating AI config for group ${req.params.groupId}:`, error)
        res.status(500).json({ error: 'Failed to update AI configuration' })
    }
})

// DELETE /api/groups/:groupId/ai-config - Reset group-level AI configuration
router.delete('/groups/:groupId/ai-config', async (req, res) => {
    try {
        const guarded = assertWebuiManageableGroup(req, res, sysConfig, {
            paramName: 'groupId'
        })
        if (!guarded) return
        const groupId = guarded.groupId

        sysConfig.ensureGroupConfig(groupId)

        const groupConfig = sysConfig.groupConfigs[groupId]

        delete groupConfig.aiEnabled
        delete groupConfig.aiRagEnabled
        delete groupConfig.aiProfileEnabled

        sysConfig.save()

        logger.info(`[API] Reset AI config for group ${groupId} to global defaults`)

        res.json({
            message: 'AI configuration reset to global defaults',
            global: {
                aiEnabled: sysConfig.aiEnabled,
                aiRagEnabled: sysConfig.aiRagEnabled,
                aiProfileEnabled: sysConfig.aiProfileEnabled
            }
        })
    } catch (error) {
        logger.error(`Error resetting AI config for group ${req.params.groupId}:`, error)
        res.status(500).json({ error: 'Failed to reset AI configuration' })
    }
})

module.exports = router
