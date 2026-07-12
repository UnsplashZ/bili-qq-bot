#!/usr/bin/env node
'use strict'

const assert = require('assert')

const logger = require('../../../src/utils/logger')

const notificationServicePath = require.resolve('../../../src/services/notificationService')

async function run() {
    const logs = []
    const off = logger.onLog((entry) => logs.push(entry.message))

    const originalSetInterval = global.setInterval

    try {
        global.setInterval = () => ({
            unref() {}
        })

        delete require.cache[notificationServicePath]
        const notificationService = require(notificationServicePath)

        assert.ok(!logs.some(line => line.includes('temp-image-cleanup-scheduler-started')))
        notificationService.startTempImageCleanupScheduler()

        await new Promise(resolve => setImmediate(resolve))

        assert.ok(logs.some(line => line.includes('INF SEND') && line.includes('[svc:notification]') && line.includes('temp-image-cleanup-scheduler-started')))
        assert.ok(!logs.some(line => line.includes('[NotificationService]')))
        await notificationService.stop()
        console.log('✓ notificationService 显式启动 cleanup scheduler 时输出 SEND 摘要日志')
    } finally {
        off()
        global.setInterval = originalSetInterval
        delete require.cache[notificationServicePath]
    }
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
