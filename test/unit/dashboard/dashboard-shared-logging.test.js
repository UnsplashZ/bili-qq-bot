#!/usr/bin/env node
'use strict'

const assert = require('assert')

const logger = require('../../../src/utils/logger')

const loginRateLimitPath = require.resolve('../../../src/dashboard/routes/api/shared/login-rate-limit')

async function run() {
    const logs = []
    const off = logger.onLog((entry) => logs.push(entry))

    try {
        delete require.cache[loginRateLimitPath]
        const rateLimit = require(loginRateLimitPath)
        const ip = '203.0.113.42'
        for (let index = 0; index < rateLimit.MAX_LOGIN_ATTEMPTS; index += 1) {
            rateLimit.recordFailedAttempt(ip)
        }

        assert.ok(logs.some(entry =>
            entry.level === 'warn'
            && entry.channel === 'AUTH'
            && entry.scope === 'svc:login-rate-limit'
            && entry.action === 'lockout-activated'
            && entry.fields.ip === '203.0.113.42'
        ))
        assert.ok(!logs.some(entry => entry.scope === 'Security'))

        console.log('✓ dashboard shared helper 会输出统一摘要日志')
    } finally {
        off()
        delete require.cache[loginRateLimitPath]
    }
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
