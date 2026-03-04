const express = require('express')
const authenticateToken = require('../../middleware/auth')

const authRoutes = require('./modules/auth')
const configRoutes = require('./modules/config')
const groupsRoutes = require('./modules/groups')
const groupAiRoutes = require('./modules/group-ai')
const groupVideoDownloadRoutes = require('./modules/group-video-download')
const subscriptionsRoutes = require('./modules/subscriptions')
const blacklistRoutes = require('./modules/blacklist')
const biliRoutes = require('./modules/bili')
const mcpRoutes = require('./modules/mcp')
const aiRoutes = require('./modules/ai')
const systemRoutes = require('./modules/system')
const profilesRoutes = require('./modules/profiles')

const router = express.Router()

// Public routes
router.use(authRoutes)

// Protected routes
router.use(authenticateToken)
router.use(configRoutes)
router.use(groupsRoutes)
router.use(groupAiRoutes)
router.use(groupVideoDownloadRoutes)
router.use(subscriptionsRoutes)
router.use(blacklistRoutes)
router.use(biliRoutes)
router.use(mcpRoutes)
router.use(aiRoutes)
router.use(systemRoutes)
router.use(profilesRoutes)

module.exports = router

