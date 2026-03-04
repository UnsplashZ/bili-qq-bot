const logger = require('../../../../utils/logger')

const loginAttempts = new Map() // IP -> { count, lockUntil }
const MAX_LOGIN_ATTEMPTS = 5
const LOCKOUT_DURATION = 5 * 60 * 1000 // 5 minutes
const CLEANUP_INTERVAL = 10 * 60 * 1000

let cleanupStarted = false

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
        logger.warn(
            `[Security] IP ${ip} locked out after ${MAX_LOGIN_ATTEMPTS} failed attempts`
        )
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
    }, CLEANUP_INTERVAL)
}

module.exports = {
    MAX_LOGIN_ATTEMPTS,
    checkRateLimit,
    recordFailedAttempt,
    resetAttempts,
    getAttemptCount,
    startLoginRateLimitCleanup
}
