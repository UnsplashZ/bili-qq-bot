const express = require('express')
const logger = require('../../../../utils/logger')
const sysConfig = require('../../../../config')
const {
    AI_NULLABLE_OVERRIDE_FIELDS,
    AiConfigValidationError,
    normalizeAiConfigUpdates
} = require('../../../../services/ai/validation')
const { dashLog } = require('../shared/logging')

const router = express.Router()

// POST /api/ai - Update AI settings
router.post('/ai', async (req, res) => {
    try {
        if (!req.body || typeof req.body !== 'object') {
            throw new AiConfigValidationError('payload', 'Invalid configuration data')
        }

        const clearFields = []
        const rawUpdates = {}
        for (const [field, value] of Object.entries(req.body)) {
            if (value === null) {
                if (!AI_NULLABLE_OVERRIDE_FIELDS.has(field)) {
                    throw new AiConfigValidationError(field, `${field} does not support clearing override`)
                }
                clearFields.push(field)
                continue
            }
            rawUpdates[field] = value
        }

        const updates = normalizeAiConfigUpdates(rawUpdates, {
            contextLimitRange: { min: 1, max: 100 },
            currentConfig: sysConfig
        })

        sysConfig.applyOverridePatch({
            clear: clearFields,
            set: updates
        })
        const snapshot = sysConfig.getAiEditorSnapshot()

        dashLog(req, 'info', 'ai-settings-updated', {
            keys: [...clearFields, ...Object.keys(updates)].join(',')
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

// POST /api/ai/reset - Reset AI settings to env/default-backed effective values
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
            'aiChatBaseTimeoutSeconds',
            'aiChatToolTimeoutSeconds',
            'aiChatMaxTimeoutSeconds',
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
        res.json({ message: 'AI settings reset to defaults', config: sysConfig.getAiEditorSnapshot() })
    } catch (error) {
        dashLog(req, 'error', 'ai-settings-reset-failed', {
            error: logger.getErrorMessage(error)
        })
        res.status(500).json({ error: 'Failed to reset AI settings' })
    }
})

module.exports = router
