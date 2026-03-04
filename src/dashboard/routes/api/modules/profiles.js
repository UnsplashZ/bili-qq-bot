const express = require('express')
const logger = require('../../../../utils/logger')
const authenticateToken = require('../../../middleware/auth')
const userProfileService = require('../../../../services/userProfileService')
const {
    normalizeGroupId,
    isValidProfileGroupId
} = require('../shared/normalize')

const router = express.Router()

// GET /api/profiles/:groupId - Get all user profiles for a group
router.get('/profiles/:groupId', authenticateToken, async (req, res) => {
    try {
        const groupId = normalizeGroupId(req.params.groupId)
        if (!groupId || !isValidProfileGroupId(groupId)) {
            return res.status(400).json({ error: 'Invalid groupId' })
        }
        const profiles = await userProfileService.getAllProfiles(groupId)
        res.json(profiles)
    } catch (error) {
        logger.error('[API] Error fetching user profiles:', error)
        res.status(500).json({ error: 'Failed to fetch user profiles' })
    }
})

// DELETE /api/profiles/:groupId/:userId - Reset a single user's profile
router.delete('/profiles/:groupId/:userId', authenticateToken, async (req, res) => {
    try {
        const groupId = normalizeGroupId(req.params.groupId)
        const userId = req.params.userId
        if (!groupId || !isValidProfileGroupId(groupId) || !userId) {
            return res.status(400).json({ error: 'Invalid groupId or userId' })
        }
        await userProfileService.deleteProfile(groupId, userId)
        res.json({ success: true })
    } catch (error) {
        logger.error('[API] Error deleting user profile:', error)
        res.status(500).json({ error: 'Failed to delete user profile' })
    }
})

module.exports = router

