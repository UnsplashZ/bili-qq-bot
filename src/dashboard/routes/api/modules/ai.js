const express = require('express')
const logger = require('../../../../utils/logger')
const sysConfig = require('../../../../config')
const {
    AI_ALLOWED_FIELDS,
    AiConfigValidationError,
    normalizeAiConfigUpdates
} = require('../../../../services/ai/validation')

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

        res.json({ message: 'AI settings updated', config: snapshot })
    } catch (error) {
        if (error instanceof AiConfigValidationError) {
            return res.status(400).json({
                error: error.message,
                field: error.field
            })
        }
        logger.error('Failed to update AI settings:', error)
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
            'aiAdminClaimRequiresTool'
        ]

        sysConfig.deleteKeys(aiKeys)

        res.json({ message: 'AI settings reset to defaults', config: sysConfig })
    } catch (error) {
        logger.error('Error resetting AI settings:', error)
        res.status(500).json({ error: 'Failed to reset AI settings' })
    }
})

module.exports = router
