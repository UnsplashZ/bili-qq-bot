const express = require('express')
const sysConfig = require('../../../../config')
const { assertWebuiManageableGroup } = require('../shared/group-guard')

const router = express.Router()

// GET /api/groups/:groupId/video-download-config - Get group-level video download config
router.get('/groups/:groupId/video-download-config', async (req, res) => {
    try {
        const guarded = assertWebuiManageableGroup(req, res, sysConfig, {
            paramName: 'groupId'
        })
        if (!guarded) return
        const groupId = guarded.groupId
        const groupConfig = sysConfig.groupConfigs[groupId] || {}
        res.json({
            videoDownloadEnabled: groupConfig.videoDownloadEnabled ?? null,
            videoDownloadResolution: groupConfig.videoDownloadResolution ?? null,
            videoDownloadMaxDuration: groupConfig.videoDownloadMaxDuration ?? null
        })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// PUT /api/groups/:groupId/video-download-config - Update group-level video download config
router.put('/groups/:groupId/video-download-config', async (req, res) => {
    try {
        const guarded = assertWebuiManageableGroup(req, res, sysConfig, {
            paramName: 'groupId'
        })
        if (!guarded) return
        const groupId = guarded.groupId
        sysConfig.ensureGroupConfig(groupId)
        const {
            videoDownloadEnabled,
            videoDownloadResolution,
            videoDownloadMaxDuration
        } = req.body

        const validResolutions = ['360p', '480p', '720p', '1080p', '1080p+']
        if (
            videoDownloadEnabled !== null &&
            videoDownloadEnabled !== undefined &&
            typeof videoDownloadEnabled !== 'boolean'
        ) {
            return res
                .status(400)
                .json({ error: 'videoDownloadEnabled must be boolean or null' })
        }
        if (
            videoDownloadResolution !== null &&
            videoDownloadResolution !== undefined &&
            !validResolutions.includes(videoDownloadResolution)
        ) {
            return res.status(400).json({
                error: `videoDownloadResolution must be one of: ${validResolutions.join(', ')} or null`
            })
        }
        if (
            videoDownloadMaxDuration !== null &&
            videoDownloadMaxDuration !== undefined
        ) {
            const dur = Number(videoDownloadMaxDuration)
            if (!Number.isInteger(dur) || dur < 0) {
                return res.status(400).json({
                    error: 'videoDownloadMaxDuration must be a non-negative integer or null'
                })
            }
        }

        if (videoDownloadEnabled === null) {
            delete sysConfig.groupConfigs[groupId].videoDownloadEnabled
        } else if (videoDownloadEnabled !== undefined) {
            sysConfig.groupConfigs[groupId].videoDownloadEnabled = videoDownloadEnabled
        }
        if (videoDownloadResolution === null) {
            delete sysConfig.groupConfigs[groupId].videoDownloadResolution
        } else if (videoDownloadResolution !== undefined) {
            sysConfig.groupConfigs[groupId].videoDownloadResolution =
                videoDownloadResolution
        }
        if (videoDownloadMaxDuration === null) {
            delete sysConfig.groupConfigs[groupId].videoDownloadMaxDuration
        } else if (videoDownloadMaxDuration !== undefined) {
            sysConfig.groupConfigs[groupId].videoDownloadMaxDuration =
                videoDownloadMaxDuration
        }

        sysConfig.save()
        res.json({ success: true, config: sysConfig.groupConfigs[groupId] })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// DELETE /api/groups/:groupId/video-download-config - Reset group-level video download config
router.delete('/groups/:groupId/video-download-config', async (req, res) => {
    try {
        const guarded = assertWebuiManageableGroup(req, res, sysConfig, {
            paramName: 'groupId'
        })
        if (!guarded) return
        const groupId = guarded.groupId
        if (sysConfig.groupConfigs[groupId]) {
            delete sysConfig.groupConfigs[groupId].videoDownloadEnabled
            delete sysConfig.groupConfigs[groupId].videoDownloadResolution
            delete sysConfig.groupConfigs[groupId].videoDownloadMaxDuration
            sysConfig.save()
        }
        res.json({ success: true })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

module.exports = router
