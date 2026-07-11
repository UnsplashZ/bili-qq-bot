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
        logger.logEvent('warn', 'AUTH', req.logScope || '', 'login-locked', {
            ip,
            remainingSeconds: rateLimit.remainingSeconds
        })
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

        logger.logEvent('info', 'AUTH', req.logScope || '', 'login-succeeded', {
            ip
        })
        let recoveryRequired = false
        try {
            recoveryRequired = sysConfig.getStatus?.().recoveryRequired?.required === true
        } catch {
            // Authentication must remain available even when status projection is unavailable.
        }
        return res.json({
            token,
            recoveryRequired,
            redirectPath: recoveryRequired ? '/settings' : '/'
        })
    }

    recordFailedAttempt(ip)

    const remainingAttempts = MAX_LOGIN_ATTEMPTS - getAttemptCount(ip)

    logger.logEvent('warn', 'AUTH', req.logScope || '', 'login-failed', {
        ip,
        remainingAttempts
    })
    return res.status(401).json({
        error: 'Invalid password',
        remainingAttempts: Math.max(0, remainingAttempts)
    })
})

module.exports = router
