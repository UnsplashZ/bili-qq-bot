const express = require('express')
const logger = require('../../../../utils/logger')
const sysConfig = require('../../../../config')
const {
    AiConfigValidationError
} = require('../../../../services/ai/validation')
const {
    GROUP_AI_SWITCH_FIELDS,
    pickGroupAiConfigUpdates,
    readGroupAiConfigSnapshot,
    updateGroupAiConfig,
    resetGroupAiConfig
} = require('../../../../services/ai/groupConfigFacade')
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

        res.json(readGroupAiConfigSnapshot(sysConfig, groupId, {
            fields: GROUP_AI_SWITCH_FIELDS,
            includeGlobal: true
        }))
    } catch (error) {
        logger.logEvent('error', 'DASH', req.logScope || '', 'ai-config-fetch-failed', {
            groupId: req.params.groupId,
            error: logger.getErrorMessage(error)
        })
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
        const updates = pickGroupAiConfigUpdates(req.body, GROUP_AI_SWITCH_FIELDS)

        try {
            const result = updateGroupAiConfig(sysConfig, groupId, updates, {
                fields: GROUP_AI_SWITCH_FIELDS,
                includeGlobal: true,
                requireAtLeastOne: true,
                requireAtLeastOneMessage: 'At least one of aiEnabled, aiRagEnabled, or aiProfileEnabled must be provided'
            })

            logger.logEvent('info', 'DASH', req.logScope || '', 'ai-config-updated', {
                groupId
            })

            res.json({
                message: 'AI configuration updated successfully',
                ...result.snapshot
            })
        } catch (error) {
            if (error instanceof AiConfigValidationError) {
                if (error.field === 'aiEnabled') {
                    return res.status(400).json({ error: 'aiEnabled must be a boolean or null' })
                }
                if (error.field === 'aiRagEnabled') {
                    return res.status(400).json({ error: 'aiRagEnabled must be a boolean or null' })
                }
                if (error.field === 'aiProfileEnabled') {
                    return res.status(400).json({ error: 'aiProfileEnabled must be a boolean or null' })
                }
                return res.status(400).json({ error: error.message, field: error.field })
            }
            throw error
        }
    } catch (error) {
        logger.logEvent('error', 'DASH', req.logScope || '', 'ai-config-update-failed', {
            groupId: req.params.groupId,
            error: logger.getErrorMessage(error)
        })
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

        const snapshot = resetGroupAiConfig(sysConfig, groupId, {
            fields: GROUP_AI_SWITCH_FIELDS,
            includeGlobal: true
        })

        logger.logEvent('info', 'DASH', req.logScope || '', 'ai-config-reset', {
            groupId
        })

        res.json({
            message: 'AI configuration reset to global defaults',
            ...snapshot
        })
    } catch (error) {
        logger.logEvent('error', 'DASH', req.logScope || '', 'ai-config-reset-failed', {
            groupId: req.params.groupId,
            error: logger.getErrorMessage(error)
        })
        res.status(500).json({ error: 'Failed to reset AI configuration' })
    }
})

module.exports = router
