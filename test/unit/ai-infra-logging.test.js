#!/usr/bin/env node
'use strict'

const assert = require('assert')

const logger = require('../../src/utils/logger')
const aiContextService = require('../../src/services/aiContextService')
const browserManager = require('../../src/services/imageGenerator/core/browser')

const originals = {
    browser: browserManager.browser,
    clearTrackedPageState: browserManager.clearTrackedPageState,
    loggerLevel: logger.level
}

function restore() {
    for (const timer of aiContextService.saveTimers.values()) {
        clearTimeout(timer)
    }
    aiContextService.saveTimers.clear()
    aiContextService.contexts.delete('private_990001')
    aiContextService.lastAccess.delete('private_990001')
    browserManager.browser = originals.browser
    browserManager.clearTrackedPageState = originals.clearTrackedPageState
    browserManager.activeRenderCount = 0
    browserManager.idleCloseInProgress = false
    logger.level = originals.loggerLevel
}

async function run() {
    const logs = []
    const off = logger.onLog((entry) => logs.push(entry.message))

    try {
        logger.level = 'debug'
        aiContextService.resetContext('private_990001')

        let closed = false
        browserManager.browser = {
            close: async () => {
                closed = true
            }
        }
        browserManager.clearTrackedPageState = () => {}
        browserManager.activeRenderCount = 0
        browserManager.idleCloseInProgress = false

        browserManager.markRequestStart()
        browserManager.markRequestEnd()
        browserManager.lastRequestAt = Date.now() - browserManager.idleTimeoutMs - 1000
        await browserManager.checkAndCloseIdleBrowser()

        assert.strictEqual(closed, true)
        assert.ok(logs.some(line => line.includes('INF AI') && line.includes('[ctx:private_990001]') && line.includes('context-reset')))
        assert.ok(logs.some(line => line.includes('DBG SERVICE') && line.includes('[svc:browser]') && line.includes('render-request-started')))
        assert.ok(logs.some(line => line.includes('DBG SERVICE') && line.includes('[svc:browser]') && line.includes('render-request-finished')))
        assert.ok(logs.some(line => line.includes('INF SERVICE') && line.includes('[svc:browser]') && line.includes('idle-browser-closing')))
        assert.ok(!logs.some(line => line.includes('[AiContextService]')))
        assert.ok(!logs.some(line => line.includes('[AiContext]')))
        assert.ok(!logs.some(line => line.includes('[Browser]')))
        console.log('✓ AI context 与 browser 基础设施会输出统一摘要日志')
    } finally {
        off()
        restore()
    }
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
