const express = require('express')
const logger = require('../../../../utils/logger')
const sysConfig = require('../../../../config')

const router = express.Router()

// POST /api/ai - Update AI settings
router.post('/ai', async (req, res) => {
    try {
        const updates = req.body
        if (!updates || typeof updates !== 'object') {
            return res.status(400).json({ error: 'Invalid configuration data' })
        }

        if (updates.aiProbability !== undefined) {
            const prob = parseFloat(updates.aiProbability)
            if (isNaN(prob) || prob < 0 || prob > 1) {
                return res.status(400).json({
                    error: 'aiProbability must be between 0 and 1',
                    field: 'aiProbability',
                    expected: '0.0 - 1.0'
                })
            }
            updates.aiProbability = prob
        }

        if (updates.aiContextLimit !== undefined) {
            const limit = parseInt(updates.aiContextLimit, 10)
            if (isNaN(limit) || limit < 1 || limit > 100) {
                return res.status(400).json({
                    error: 'aiContextLimit must be between 1 and 100',
                    field: 'aiContextLimit',
                    expected: '1 - 100'
                })
            }
            updates.aiContextLimit = limit
        }

        if (updates.aiTemperature !== undefined) {
            const temp = parseFloat(updates.aiTemperature)
            if (isNaN(temp) || temp < 0 || temp > 2) {
                return res.status(400).json({
                    error: 'aiTemperature must be between 0 and 2',
                    field: 'aiTemperature',
                    expected: '0.0 - 2.0'
                })
            }
            updates.aiTemperature = temp
        }

        if (updates.aiVectorSimilarityThreshold !== undefined) {
            const threshold = parseFloat(updates.aiVectorSimilarityThreshold)
            if (isNaN(threshold) || threshold < 0 || threshold > 1) {
                return res.status(400).json({
                    error: 'aiVectorSimilarityThreshold must be between 0 and 1',
                    field: 'aiVectorSimilarityThreshold',
                    expected: '0.0 - 1.0'
                })
            }
            updates.aiVectorSimilarityThreshold = threshold
        }

        if (updates.aiVectorSearchLimit !== undefined) {
            const limit = parseInt(updates.aiVectorSearchLimit, 10)
            if (isNaN(limit) || limit < 1 || limit > 10) {
                return res.status(400).json({
                    error: 'aiVectorSearchLimit must be between 1 and 10',
                    field: 'aiVectorSearchLimit',
                    expected: '1 - 10'
                })
            }
            updates.aiVectorSearchLimit = limit
        }

        if (updates.aiMemorySafetyLimit !== undefined) {
            const limit = parseInt(updates.aiMemorySafetyLimit, 10)
            if (isNaN(limit) || limit < 1 || limit > 10000) {
                return res.status(400).json({
                    error: 'aiMemorySafetyLimit must be between 1 and 10000',
                    field: 'aiMemorySafetyLimit',
                    expected: '1 - 10000'
                })
            }
            updates.aiMemorySafetyLimit = limit
        }

        if (updates.aiHistoryMaxSize !== undefined) {
            const size = parseInt(updates.aiHistoryMaxSize, 10)
            if (isNaN(size) || size < 1024 * 1024 || size > 10000 * 1024 * 1024) {
                return res.status(400).json({
                    error: 'aiHistoryMaxSize must be between 1MB and 10000MB',
                    field: 'aiHistoryMaxSize',
                    expected: '1048576 - 10485760000 (1MB - 10000MB)'
                })
            }
            updates.aiHistoryMaxSize = size
        }

        if (
            updates.aiStructuredContextEnabled !== undefined &&
            typeof updates.aiStructuredContextEnabled !== 'boolean'
        ) {
            return res.status(400).json({
                error: 'aiStructuredContextEnabled must be a boolean',
                field: 'aiStructuredContextEnabled'
            })
        }

        if (
            updates.aiAdminClaimRequiresTool !== undefined &&
            typeof updates.aiAdminClaimRequiresTool !== 'boolean'
        ) {
            return res.status(400).json({
                error: 'aiAdminClaimRequiresTool must be a boolean',
                field: 'aiAdminClaimRequiresTool'
            })
        }

        if (updates.aiIdentityRagMode !== undefined) {
            const mode = String(updates.aiIdentityRagMode).trim().toLowerCase()
            if (!['strict', 'normal'].includes(mode)) {
                return res.status(400).json({
                    error: 'aiIdentityRagMode must be "strict" or "normal"',
                    field: 'aiIdentityRagMode'
                })
            }
            updates.aiIdentityRagMode = mode
        }

        Object.assign(sysConfig, updates)

        const aiFields = [
            'aiApiUrl',
            'aiApiKey',
            'aiModel',
            'aiSystemPrompt',
            'aiProbability',
            'aiContextLimit',
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

        const snapshot = {}
        for (const field of aiFields) {
            snapshot[field] = sysConfig[field]
        }

        res.json({ message: 'AI settings updated', config: snapshot })
    } catch (error) {
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

