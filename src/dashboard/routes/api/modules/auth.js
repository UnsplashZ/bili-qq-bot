const express = require('express')
const jwt = require('jsonwebtoken')
const logger = require('../../../../utils/logger')
const sysConfig = require('../../../../config')
const {
    MAX_LOGIN_ATTEMPTS,
    checkRateLimit,
    recordFailedAttempt,
    resetAttempts,
    getAttemptCount,
    startLoginRateLimitCleanup
} = require('../shared/login-rate-limit')

const router = express.Router()

startLoginRateLimitCleanup()

// POST /api/login - Dashboard Login
router.post('/login', (req, res) => {
    const { password } = req.body
    const ip = req.ip || req.connection.remoteAddress

    const rateLimit = checkRateLimit(ip)
    if (!rateLimit.allowed) {
        logger.warn(
            `[Security] Login attempt from locked IP ${ip} (${rateLimit.remainingSeconds}s remaining)`
        )
        return res.status(429).json({
            error: 'Too many failed attempts',
            retryAfter: rateLimit.remainingSeconds
        })
    }

    if (password === sysConfig.dashboardPassword) {
        resetAttempts(ip)

        const token = jwt.sign(
            { role: 'admin', timestamp: Date.now() },
            sysConfig.jwtSecret,
            { expiresIn: '24h' }
        )

        logger.info(`[Security] Successful login from ${ip}`)
        return res.json({ token })
    }

    recordFailedAttempt(ip)

    const remainingAttempts = MAX_LOGIN_ATTEMPTS - getAttemptCount(ip)

    logger.warn(
        `[Security] Failed login attempt from ${ip} (${remainingAttempts} attempts remaining)`
    )
    return res.status(401).json({
        error: 'Invalid password',
        remainingAttempts: Math.max(0, remainingAttempts)
    })
})

module.exports = router
