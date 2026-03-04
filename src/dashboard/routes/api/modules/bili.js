const express = require('express')
const fs = require('fs').promises
const path = require('path')
const logger = require('../../../../utils/logger')
const biliApi = require('../../../../services/biliApi')
const authenticateToken = require('../../../middleware/auth')

const router = express.Router()

// GET /api/groups/:id/bili-groups - Get Bilibili follow groups
router.get('/groups/:id/bili-groups', async (req, res) => {
    try {
        const result = await biliApi.getFollowGroups(null)
        if (result && result.status === 'success') {
            res.json(result.data)
        } else {
            res.json([])
        }
    } catch (error) {
        logger.error('Error fetching Bilibili groups (global cookie):', error)
        res.status(500).json({ error: 'Failed to fetch Bilibili groups' })
    }
})

// GET /api/bili/login-url - Get Bilibili Login QR
router.get('/bili/login-url', async (req, res) => {
    try {
        const result = await biliApi.getLoginUrl()
        res.json(result)
    } catch (error) {
        logger.error('Error getting login URL:', error)
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
        res.json(result)
    } catch (error) {
        logger.error('Error checking login:', error)
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
        res.json(result)
    } catch (error) {
        logger.error('Error getting my info:', error)
        res.status(500).json({ error: 'Failed to get user info' })
    }
})

// GET /api/bili/global-status - 获取全局Cookie登录状态
router.get('/bili/global-status', authenticateToken, async (req, res) => {
    try {
        const refresh = req.query.refresh === '1' || req.query.refresh === 'true'
        const result = await biliApi.getGlobalCredentialInfo(refresh)

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
        logger.error('Error fetching global Bilibili status:', error)
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
            logger.warn(`[Security] Attempted to delete non-cookie file: ${fileName}`)
            return res.status(400).json({ error: 'Invalid cookie file name' })
        }

        const dataDir = path.resolve(__dirname, '../../../../../data')
        const resolvedPath = path.resolve(cookieFile)
        if (
            !resolvedPath.startsWith(dataDir + path.sep) &&
            resolvedPath !== dataDir
        ) {
            logger.warn(`[Security] Attempted path traversal: ${resolvedPath}`)
            return res.status(400).json({ error: 'Path traversal detected' })
        }

        try {
            await fs.unlink(cookieFile)
            logger.info(`[Security] Cookie file deleted: ${fileName}`)
        } catch (err) {
            if (err.code !== 'ENOENT') {
                logger.warn('Error deleting cookie file:', err)
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
                    logger.warn('Error updating cookie map:', err)
                }
            }
        }

        res.json({ success: true })
    } catch (error) {
        logger.error('Error logging out:', error)
        res.status(500).json({ error: 'Failed to logout' })
    }
})

module.exports = router

