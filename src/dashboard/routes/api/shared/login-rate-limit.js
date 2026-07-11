const logger = require('../../../../utils/logger')

const loginAttempts = new Map() // IP -> { count, lockUntil }
const MAX_LOGIN_ATTEMPTS = 5
const LOCKOUT_DURATION = 5 * 60 * 1000 // 5 minutes
const CLEANUP_INTERVAL = 10 * 60 * 1000

let cleanupStarted = false
const RATE_LIMIT_SCOPE = logger.createScope('svc', 'login-rate-limit')

function checkRateLimit(ip) {
    const now = Date.now()
    const attempt = loginAttempts.get(ip)

    if (attempt && attempt.lockUntil && now > attempt.lockUntil) {
        loginAttempts.delete(ip)
        return { allowed: true }
    }

    if (attempt && attempt.lockUntil && now < attempt.lockUntil) {
        const remainingMs = attempt.lockUntil - now
        return {
            allowed: false,
            remainingSeconds: Math.ceil(remainingMs / 1000)
        }
    }

    return { allowed: true }
}

function recordFailedAttempt(ip) {
    const now = Date.now()
    const attempt = loginAttempts.get(ip) || { count: 0, lockUntil: null }

    attempt.count++

    if (attempt.count >= MAX_LOGIN_ATTEMPTS) {
        attempt.lockUntil = now + LOCKOUT_DURATION
        logger.logEvent('warn', 'AUTH', RATE_LIMIT_SCOPE, 'lockout-activated', {
            ip,
            maxAttempts: MAX_LOGIN_ATTEMPTS,
            lockoutSeconds: Math.ceil(LOCKOUT_DURATION / 1000)
        })
    }

    loginAttempts.set(ip, attempt)
}

function resetAttempts(ip) {
    loginAttempts.delete(ip)
}

function getAttemptCount(ip) {
    return (loginAttempts.get(ip) || {}).count || 0
}

function startLoginRateLimitCleanup() {
    if (cleanupStarted) return
    cleanupStarted = true

    setInterval(() => {
        const now = Date.now()
        for (const [ip, attempt] of loginAttempts.entries()) {
            if (attempt.lockUntil && now > attempt.lockUntil) {
                loginAttempts.delete(ip)
            }
        }
    }, CLEANUP_INTERVAL).unref?.()
}

module.exports = {
    MAX_LOGIN_ATTEMPTS,
    checkRateLimit,
    recordFailedAttempt,
    resetAttempts,
    getAttemptCount,
    startLoginRateLimitCleanup
}
