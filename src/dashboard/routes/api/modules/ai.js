const express = require('express')
const logger = require('../../../../utils/logger')
const sysConfig = require('../../../../config')
const {
    AI_ALLOWED_FIELDS,
    AiConfigValidationError,
    normalizeAiConfigUpdates
} = require('../../../../services/ai/validation')
const { dashLog } = require('../shared/logging')

const router = express.Router()

// POST /api/ai - Update AI settings
router.post('/ai', async (req, res) => {
    try {
        const updates = normalizeAiConfigUpdates(req.body, {
            contextLimitRange: { min: 1, max: 100 }
        })

        Object.assign(sysConfig, updates)

        const snapshot = {}
        for (const field of AI_ALLOWED_FIELDS) {
            snapshot[field] = sysConfig[field]
        }

        dashLog(req, 'info', 'ai-settings-updated', {
            keys: Object.keys(updates).join(',')
        })
        res.json({ message: 'AI settings updated', config: snapshot })
    } catch (error) {
        if (error instanceof AiConfigValidationError) {
            return res.status(400).json({
                error: error.message,
                field: error.field
            })
        }
        dashLog(req, 'error', 'ai-settings-update-failed', {
            error: logger.getErrorMessage(error)
        })
        res
            .status(500)
            .json({ error: 'Failed to update AI settings', details: error.message })
    }
})

// POST /api/ai/reset - Reset AI settings to defaults (.env)
router.post('/ai/reset', async (req, res) => {
    try {
        const aiKeys = [
            'aiApiUrl',
            'aiApiKey',
            'aiModel',
            'aiSystemPrompt',
            'aiProbability',
            'aiTemperature',
            'aiChatApiUrl',
            'aiChatApiKey',
            'aiChatModel',
            'aiChatProxy',
            'aiChatSystemPrompt',
            'aiEmbeddingApiUrl',
            'aiEmbeddingApiKey',
            'aiEmbeddingModel',
            'aiEmbeddingProxy',
            'aiContextLimit',
            'aiHistoryMaxSize',
            'aiVectorMaxSize',
            'aiVectorSimilarityThreshold',
            'aiVectorSearchLimit',
            'aiShortMessageThreshold',
            'aiMemorySafetyLimit',
            'aiVectorMemoryLimit',
            'aiTrimRatio',
            'aiVectorBatchLoadSize',
            'aiEnableVectorCache',
            'aiEnableSmartTrim',
            'aiStructuredContextEnabled',
            'aiIdentityRagMode',
            'aiAdminClaimRequiresTool',
            'aiReplyGateEnabled',
            'aiContextSelectorEnabled',
            'aiResponseModeEnabled',
            'aiPromptAssemblerEnabled',
            'aiReplyScoreThreshold',
            'aiBusyReplyScoreThreshold',
            'aiBusyWindowSeconds',
            'aiBusyMessageCount',
            'aiReplyCooldownMs',
            'aiMaxRepliesPerWindow',
            'aiBotName',
            'aiBotAliases'
        ]

        sysConfig.deleteKeys(aiKeys)

        dashLog(req, 'info', 'ai-settings-reset', {
            keyCount: aiKeys.length
        })
        res.json({ message: 'AI settings reset to defaults', config: sysConfig })
    } catch (error) {
        dashLog(req, 'error', 'ai-settings-reset-failed', {
            error: logger.getErrorMessage(error)
        })
        res.status(500).json({ error: 'Failed to reset AI settings' })
    }
})

module.exports = router
