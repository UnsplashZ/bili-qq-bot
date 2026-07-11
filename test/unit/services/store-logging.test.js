#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const logger = require('../../../src/utils/logger')
const config = require('../../../src/config')
const cacheManager = require('../../../src/utils/cacheManager')
const { checkSizeAndTrim } = require('../../../src/utils/storageUtils')
const requestApprovalService = require('../../../src/services/requestApprovalService')
const notificationService = require('../../../src/services/notificationService')

const originals = {
    setTimeout: global.setTimeout,
    clearTimeout: global.clearTimeout,
    cacheDir: cacheManager.cacheDir,
    cacheInitPromise: cacheManager.initPromise,
    dataCacheTTL: config.dataCacheTTL,
    getRootAdminQQ: config.getRootAdminQQ,
    callAction: notificationService.callAction,
}

function restore() {
    global.setTimeout = originals.setTimeout
    global.clearTimeout = originals.clearTimeout
    cacheManager.cacheDir = originals.cacheDir
    cacheManager.initPromise = originals.cacheInitPromise
    config.__getMutableCompatStateForTests().dataCacheTTL = originals.dataCacheTTL
    config.getRootAdminQQ = originals.getRootAdminQQ
    notificationService.callAction = originals.callAction
    requestApprovalService.pendingByKey.clear()
    requestApprovalService.queue = []
    requestApprovalService.keyByNotifyMessageId.clear()
    requestApprovalService.keyByShortId.clear()
    requestApprovalService.inflightKeys.clear()
    requestApprovalService.recentlyHandled.clear()
}

async function run() {
    const logs = []
    const off = logger.onLog((entry) => logs.push(entry.message))
    const tempCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-cache-log-'))

    try {
        global.setTimeout = (fn) => {
            fn()
            return { fake: true }
        }
        global.clearTimeout = () => {}
        config.__getMutableCompatStateForTests().dataCacheTTL = 1
        cacheManager.cacheDir = tempCacheDir
        cacheManager.initPromise = fs.promises.mkdir(tempCacheDir, { recursive: true })
        config.getRootAdminQQ = () => '10000'
        notificationService.callAction = async () => ({
            status: 'ok',
            retcode: 0,
            data: { message_id: 12345 }
        })

        checkSizeAndTrim(new Array(40).fill({ text: 'x'.repeat(64) }), 128, 0.25)

        const expiredPath = path.join(tempCacheDir, 'video_demo.json')
        fs.writeFileSync(expiredPath, JSON.stringify({
            __cacheMeta: { fetchedAt: Date.now() - 5000 },
            payload: { status: 'success' }
        }))
        await cacheManager.get('video_demo')

        await requestApprovalService.handleRequestEvent({}, {
            post_type: 'request',
            request_type: 'friend',
            flag: 'flag_store_log',
            user_id: '30001',
            comment: 'hello'
        })

        assert.ok(logs.some(line => line.includes('INF STORE') && line.includes('[svc:storage]') && line.includes('trim-complete')))
        console.log('✓ storageUtils.checkSizeAndTrim 会输出 STORE 摘要日志')
        assert.ok(logs.some(line => line.includes('INF STORE') && line.includes('[svc:cache]') && line.includes('cache-expired') && line.includes('key=video_demo')))
        console.log('✓ cacheManager 过期清理会输出 STORE 摘要日志')
        assert.ok(logs.some(line => line.includes('INF STORE') && line.includes('[svc:approval]') && line.includes('request-queued') && line.includes('requestType=friend')))
        console.log('✓ requestApprovalService 会输出 STORE 摘要日志')
    } finally {
        off()
        restore()
        fs.rmSync(tempCacheDir, { recursive: true, force: true })
    }
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
