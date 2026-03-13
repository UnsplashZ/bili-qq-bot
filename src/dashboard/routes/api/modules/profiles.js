const express = require('express')
const logger = require('../../../../utils/logger')
const authenticateToken = require('../../../middleware/auth')
const userProfileService = require('../../../../services/userProfileService')
const {
    normalizeGroupId,
    isValidProfileGroupId
} = require('../shared/normalize')
const { dashLog } = require('../shared/logging')

const router = express.Router()

// GET /api/profiles/:groupId - Get all user profiles for a group
router.get('/profiles/:groupId', authenticateToken, async (req, res) => {
    try {
        const groupId = normalizeGroupId(req.params.groupId)
        if (!groupId || !isValidProfileGroupId(groupId)) {
            return res.status(400).json({ error: 'Invalid groupId' })
        }
        const profiles = await userProfileService.getAllProfiles(groupId)
        dashLog(req, 'info', 'profiles-fetched', {
            groupId,
            count: Array.isArray(profiles) ? profiles.length : 0
        })
        res.json(profiles)
    } catch (error) {
        dashLog(req, 'error', 'profiles-fetch-failed', {
            groupId: req.params.groupId,
            error: logger.getErrorMessage(error)
        })
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
        dashLog(req, 'info', 'profile-deleted', {
            groupId,
            userId
        })
        res.json({ success: true })
    } catch (error) {
        dashLog(req, 'error', 'profile-delete-failed', {
            groupId: req.params.groupId,
            userId: req.params.userId,
            error: logger.getErrorMessage(error)
        })
        res.status(500).json({ error: 'Failed to delete user profile' })
    }
})

module.exports = router
