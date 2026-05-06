#!/usr/bin/env node
'use strict'

const assert = require('assert')

const logger = require('../../../src/utils/logger')
const config = require('../../../src/config')

async function run() {
    const logs = []
    const off = logger.onLog((entry) => logs.push(entry.message))

    try {
        void config.jwtSecret
        void config.jwtSecret
        void config.jwtSecret

        const loadLogs = logs.filter(line =>
            line.includes('AUTH') && line.includes('jwt-secret-loaded')
        )

        assert.strictEqual(loadLogs.length, 1)
        console.log('✓ jwtSecret 重复访问只输出一次加载日志')
    } finally {
        off()
    }
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
