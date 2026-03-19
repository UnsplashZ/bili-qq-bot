const express = require('express')
const logger = require('../../../../utils/logger')
const sysConfig = require('../../../../config')
const subscriptionService = require('../../../../services/subscriptionService')
const { dashLog } = require('../shared/logging')

const router = express.Router()

const ALLOWED_GLOBAL_CONFIG_KEYS = [
    'subscriptionCheckInterval',
    'linkCacheTimeout',
    'showId',
    'aiEnabled',
    'aiRagEnabled',
    'aiProfileEnabled',
    'videoDownloadEnabled',
    'videoDownloadResolution',
    'videoDownloadMaxDuration',
    'videoDownloadAutoClean',
    'videoDownloadCleanTimeout'
]

// GET /api/config - Read config
router.get('/config', async (req, res) => {
    try {
        const config = sysConfig.getDashboardConfigSnapshot()
        config.rootAdminQQ = sysConfig.getRootAdminQQ()
        dashLog(req, 'info', 'config-fetched', {
            hasRootAdminQQ: Boolean(config.rootAdminQQ)
        })
        res.json(config)
    } catch (error) {
        dashLog(req, 'error', 'config-fetch-failed', {
            error: logger.getErrorMessage(error)
        })
        res.status(500).json({ error: 'Failed to read configuration' })
    }
})

// POST /api/config - Update global config
router.post('/config', async (req, res) => {
    try {
        const newConfig = req.body
        if (!newConfig || typeof newConfig !== 'object') {
            return res.status(400).json({ error: 'Invalid configuration data' })
        }

        const filtered = {}
        for (const key of Object.keys(newConfig)) {
            if (ALLOWED_GLOBAL_CONFIG_KEYS.includes(key)) {
                filtered[key] = newConfig[key]
            }
        }
        if (Object.keys(filtered).length === 0) {
            return res
                .status(400)
                .json({ error: 'No valid configuration keys provided' })
        }

        if (filtered.subscriptionCheckInterval !== undefined) {
            const interval = parseInt(filtered.subscriptionCheckInterval, 10)
            if (isNaN(interval) || interval <= 0) {
                return res.status(400).json({
                    error: 'subscriptionCheckInterval must be a positive integer'
                })
            }
            filtered.subscriptionCheckInterval = interval
        }

        if (filtered.linkCacheTimeout !== undefined) {
            const timeout = parseInt(filtered.linkCacheTimeout, 10)
            if (isNaN(timeout) || timeout < 0) {
                return res.status(400).json({
                    error: 'linkCacheTimeout must be a non-negative integer'
                })
            }
            filtered.linkCacheTimeout = timeout
        }

        if (
            filtered.showId !== undefined &&
            typeof filtered.showId !== 'boolean'
        ) {
            return res.status(400).json({ error: 'showId must be a boolean' })
        }

        const validResolutions = ['360p', '480p', '720p', '1080p', '1080p+']
        if (
            filtered.videoDownloadResolution !== undefined &&
            !validResolutions.includes(filtered.videoDownloadResolution)
        ) {
            return res
                .status(400)
                .json({ error: 'invalid videoDownloadResolution' })
        }

        Object.assign(sysConfig, filtered)
        sysConfig.save()
        dashLog(req, 'info', 'config-updated', {
            keys: Object.keys(filtered).join(',')
        })

        if (filtered.subscriptionCheckInterval !== undefined) {
            const interval = parseInt(filtered.subscriptionCheckInterval, 10)
            if (!isNaN(interval) && interval > 0) {
                subscriptionService.updateCheckInterval(interval)
                dashLog(req, 'info', 'subscription-interval-updated', {
                    intervalSeconds: interval
                })
            }
        }

        res.json({ message: 'Configuration updated successfully', config: filtered })
    } catch (error) {
        dashLog(req, 'error', 'config-update-failed', {
            error: logger.getErrorMessage(error)
        })
        res.status(500).json({ error: 'Failed to save configuration' })
    }
})

module.exports = router
