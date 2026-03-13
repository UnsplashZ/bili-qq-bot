const express = require('express')
const fs = require('fs').promises
const path = require('path')
const logger = require('../../../../utils/logger')
const biliApi = require('../../../../services/biliApi')
const authenticateToken = require('../../../middleware/auth')
const { dashLog, authLog } = require('../shared/logging')

const router = express.Router()

// GET /api/groups/:id/bili-groups - Get Bilibili follow groups
router.get('/groups/:id/bili-groups', async (req, res) => {
    try {
        const result = await biliApi.getFollowGroups(null)
        if (result && result.status === 'success') {
            dashLog(req, 'info', 'bili-groups-fetched', {
                groupId: req.params.id,
                count: Array.isArray(result.data) ? result.data.length : 0
            })
            res.json(result.data)
        } else {
            dashLog(req, 'info', 'bili-groups-fetched', {
                groupId: req.params.id,
                count: 0
            })
            res.json([])
        }
    } catch (error) {
        dashLog(req, 'error', 'bili-groups-fetch-failed', {
            groupId: req.params.id,
            error: logger.getErrorMessage(error)
        })
        res.status(500).json({ error: 'Failed to fetch Bilibili groups' })
    }
})

// GET /api/bili/login-url - Get Bilibili Login QR
router.get('/bili/login-url', async (req, res) => {
    try {
        const result = await biliApi.getLoginUrl()
        dashLog(req, 'info', 'bili-login-url-ready')
        res.json(result)
    } catch (error) {
        dashLog(req, 'error', 'bili-login-url-failed', {
            error: logger.getErrorMessage(error)
        })
        res.status(500).json({ error: 'Failed to get login URL' })
    }
})

// POST /api/bili/check-login - Check Login Status
router.post('/bili/check-login', async (req, res) => {
    try {
        const { key } = req.body || {}
        if (!key) {
            return res.status(400).json({ error: 'Missing login key' })
        }

        const result = await biliApi.checkLogin(key, null)
        dashLog(req, 'info', 'bili-login-status-ready', {
            status: result && result.status
        })
        res.json(result)
    } catch (error) {
        dashLog(req, 'error', 'bili-login-status-failed', {
            error: logger.getErrorMessage(error)
        })
        res.status(500).json({ error: 'Failed to check login' })
    }
})

// GET /api/bili/my-info - Get current logged-in user info
router.get('/bili/my-info', async (req, res) => {
    try {
        const groupId = req.query.groupId ? parseInt(req.query.groupId) : null
        if (groupId !== null && (isNaN(groupId) || groupId <= 0)) {
            return res.status(400).json({ error: 'Invalid groupId' })
        }
        const result = await biliApi.getMyInfo(groupId)
        dashLog(req, 'info', 'bili-my-info-ready', {
            groupId: groupId === null ? 'global' : groupId
        })
        res.json(result)
    } catch (error) {
        dashLog(req, 'error', 'bili-my-info-failed', {
            error: logger.getErrorMessage(error)
        })
        res.status(500).json({ error: 'Failed to get user info' })
    }
})

// GET /api/bili/global-status - 获取全局Cookie登录状态
router.get('/bili/global-status', authenticateToken, async (req, res) => {
    try {
        const refresh = req.query.refresh === '1' || req.query.refresh === 'true'
        const result = await biliApi.getGlobalCredentialInfo(refresh)
        dashLog(req, 'info', 'bili-global-status-ready', {
            refresh,
            status: result && result.status
        })

        if (result.status === 'success') {
            res.json({
                isLoggedIn: true,
                uid: result.data.uid,
                username: result.data.username,
                timestamp: result.data.timestamp
            })
        } else {
            res.json({
                isLoggedIn: false,
                message: result.message || 'Not logged in'
            })
        }
    } catch (error) {
        dashLog(req, 'error', 'bili-global-status-failed', {
            error: logger.getErrorMessage(error)
        })
        res.status(500).json({
            isLoggedIn: false,
            error: 'Failed to check login status'
        })
    }
})

// POST /api/bili/logout - Logout (clear cookies)
router.post('/bili/logout', async (req, res) => {
    try {
        const { groupId } = req.body

        if (
            groupId &&
            (!/^\d+$/.test(String(groupId)) || String(groupId).includes('..'))
        ) {
            return res.status(400).json({ error: 'Invalid groupId' })
        }

        const cookieFile = groupId
            ? path.resolve(__dirname, `../../../../../data/cookies_${groupId}.json`)
            : path.resolve(__dirname, '../../../../../data/cookies.json')

        const fileName = path.basename(cookieFile)

        const cookieFilePattern = /^cookies(_\d+)?\.json$/
        if (!cookieFilePattern.test(fileName)) {
            authLog(req, 'warn', 'bili-logout-non-cookie-denied', {
                fileName
            })
            return res.status(400).json({ error: 'Invalid cookie file name' })
        }

        const dataDir = path.resolve(__dirname, '../../../../../data')
        const resolvedPath = path.resolve(cookieFile)
        if (
            !resolvedPath.startsWith(dataDir + path.sep) &&
            resolvedPath !== dataDir
        ) {
            authLog(req, 'warn', 'bili-logout-path-traversal', {
                resolvedPath
            })
            return res.status(400).json({ error: 'Path traversal detected' })
        }

        try {
            await fs.unlink(cookieFile)
            authLog(req, 'info', 'bili-cookie-deleted', {
                fileName,
                groupId: groupId || 'global'
            })
        } catch (err) {
            if (err.code !== 'ENOENT') {
                authLog(req, 'warn', 'bili-cookie-delete-failed', {
                    fileName,
                    error: logger.getErrorMessage(err)
                })
            }
        }

        if (groupId) {
            const mapFile = path.resolve(__dirname, '../../../../../data/cookies_map.json')
            try {
                const mapData = JSON.parse(await fs.readFile(mapFile, 'utf-8'))
                delete mapData[String(groupId)]
                await fs.writeFile(mapFile, JSON.stringify(mapData, null, 4))
            } catch (err) {
                if (err.code !== 'ENOENT') {
                    authLog(req, 'warn', 'bili-cookie-map-update-failed', {
                        groupId,
                        error: logger.getErrorMessage(err)
                    })
                }
            }
        }

        dashLog(req, 'info', 'bili-logout-complete', {
            groupId: groupId || 'global'
        })
        res.json({ success: true })
    } catch (error) {
        dashLog(req, 'error', 'bili-logout-failed', {
            error: logger.getErrorMessage(error)
        })
        res.status(500).json({ error: 'Failed to logout' })
    }
})

module.exports = router
