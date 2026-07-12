'use strict'

const express = require('express')
const sysConfig = require('../../../../config')
const { assertWebuiManageableGroup } = require('../shared/group-guard')
const {
    assertExpectedGeneration,
    assertCurrentGeneration,
    configErrorResponse,
    configErrorStatus,
    emptyMutationResult
} = require('../shared/config-mutation')

const router = express.Router()
const VIDEO_KEYS = ['videoDownloadEnabled', 'videoDownloadResolution', 'videoDownloadMaxDuration']

function publicGroupVideoConfig(groupConfig = {}) {
    return {
        videoDownloadEnabled: groupConfig.videoDownloadEnabled ?? null,
        videoDownloadResolution: groupConfig.videoDownloadResolution ?? null,
        videoDownloadMaxDuration: groupConfig.videoDownloadMaxDuration ?? null
    }
}

function buildOperation(groupId, groupConfig) {
    if (Object.keys(groupConfig).length === 0) return { op: 'remove', path: ['groupConfigs', groupId] }
    return { op: 'set', path: ['groupConfigs', groupId], value: groupConfig }
}

router.get('/groups/:groupId/video-download-config', async (req, res) => {
    try {
        const guarded = assertWebuiManageableGroup(req, res, sysConfig, { paramName: 'groupId' })
        if (!guarded) return
        const groupConfig = sysConfig.getSnapshot().groupConfigs?.[String(guarded.groupId)] || {}
        res.json(publicGroupVideoConfig(groupConfig))
    } catch (error) {
        res.status(500).json({ error: error?.code || 'GROUP_VIDEO_CONFIG_READ_FAILED' })
    }
})

router.put('/groups/:groupId/video-download-config', async (req, res) => {
    try {
        const expectedGeneration = assertExpectedGeneration(req.body?.expectedGeneration)
        const guarded = assertWebuiManageableGroup(req, res, sysConfig, { paramName: 'groupId' })
        if (!guarded) return
        const groupId = String(guarded.groupId)
        const { videoDownloadEnabled, videoDownloadResolution, videoDownloadMaxDuration } = req.body
        const validResolutions = ['360p', '480p', '720p', '1080p', '1080p+']

        if (videoDownloadEnabled !== null && videoDownloadEnabled !== undefined && typeof videoDownloadEnabled !== 'boolean') {
            return res.status(400).json({ error: 'videoDownloadEnabled must be boolean or null' })
        }
        if (videoDownloadResolution !== null && videoDownloadResolution !== undefined && !validResolutions.includes(videoDownloadResolution)) {
            return res.status(400).json({
                error: `videoDownloadResolution must be one of: ${validResolutions.join(', ')} or null`
            })
        }
        let normalizedDuration = videoDownloadMaxDuration
        if (videoDownloadMaxDuration !== null && videoDownloadMaxDuration !== undefined) {
            normalizedDuration = Number(videoDownloadMaxDuration)
            if (!Number.isSafeInteger(normalizedDuration) || normalizedDuration < 0) {
                return res.status(400).json({ error: 'videoDownloadMaxDuration must be a non-negative integer or null' })
            }
        }

        const current = sysConfig.getSnapshot().groupConfigs?.[groupId] || {}
        const next = { ...current }
        const values = { videoDownloadEnabled, videoDownloadResolution, videoDownloadMaxDuration: normalizedDuration }
        for (const key of VIDEO_KEYS) {
            if (values[key] === null) delete next[key]
            else if (values[key] !== undefined) next[key] = values[key]
        }
        assertCurrentGeneration(sysConfig, expectedGeneration)
        const unchanged = JSON.stringify(current) === JSON.stringify(next)
        const result = unchanged
            ? emptyMutationResult(sysConfig)
            : await sysConfig.patch([buildOperation(groupId, next)], { actor: 'dashboard', expectedGeneration })
        res.json({ ...result, success: true, config: publicGroupVideoConfig(next) })
    } catch (error) {
        const payload = configErrorResponse(sysConfig, error)
        res.status(configErrorStatus(error)).json(payload)
    }
})

router.delete('/groups/:groupId/video-download-config', async (req, res) => {
    try {
        const expectedGeneration = assertExpectedGeneration(req.body?.expectedGeneration)
        const guarded = assertWebuiManageableGroup(req, res, sysConfig, { paramName: 'groupId' })
        if (!guarded) return
        const groupId = String(guarded.groupId)
        const current = sysConfig.getSnapshot().groupConfigs?.[groupId] || {}
        const next = { ...current }
        for (const key of VIDEO_KEYS) delete next[key]
        assertCurrentGeneration(sysConfig, expectedGeneration)
        const unchanged = JSON.stringify(current) === JSON.stringify(next)
        const result = unchanged
            ? emptyMutationResult(sysConfig)
            : await sysConfig.patch([buildOperation(groupId, next)], { actor: 'dashboard', expectedGeneration })
        res.json({ ...result, success: true, config: publicGroupVideoConfig(next) })
    } catch (error) {
        const payload = configErrorResponse(sysConfig, error)
        res.status(configErrorStatus(error)).json(payload)
    }
})

module.exports = router
