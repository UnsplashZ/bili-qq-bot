#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')

const logger = require('../../src/utils/logger')

const configStorePath = require.resolve('../../src/dashboard/routes/api/shared/config-store')
const loginRateLimitPath = require.resolve('../../src/dashboard/routes/api/shared/login-rate-limit')

async function run() {
    const logs = []
    const off = logger.onLog((entry) => logs.push(entry.message))

    const originalReadFile = fs.promises.readFile

    try {
        fs.promises.readFile = async () => {
            const error = new Error('config boom')
            error.code = 'EACCES'
            throw error
        }

        delete require.cache[configStorePath]
        const { readConfig } = require(configStorePath)
        await assert.rejects(readConfig(), /config boom/)

        delete require.cache[loginRateLimitPath]
        const rateLimit = require(loginRateLimitPath)
        const ip = '203.0.113.42'
        for (let index = 0; index < rateLimit.MAX_LOGIN_ATTEMPTS; index += 1) {
            rateLimit.recordFailedAttempt(ip)
        }

        assert.ok(logs.some(line => line.includes('ERR STORE') && line.includes('[svc:dashboard-config]') && line.includes('config-read-failed')))
        assert.ok(logs.some(line => line.includes('WRN AUTH') && line.includes('[svc:login-rate-limit]') && line.includes('lockout-activated') && line.includes('ip=203.0.113.42')))
        assert.ok(!logs.some(line => line.includes('[Security]')))

        console.log('✓ dashboard shared helper 会输出统一摘要日志')
    } finally {
        off()
        fs.promises.readFile = originalReadFile
        delete require.cache[configStorePath]
        delete require.cache[loginRateLimitPath]
    }
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
