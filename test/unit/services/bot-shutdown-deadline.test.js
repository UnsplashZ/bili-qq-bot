#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')

const botPath = path.join(__dirname, '../../../src/bot.js')

function mockModule(modulePath, exports) {
    const resolved = require.resolve(modulePath)
    require.cache[resolved] = {
        id: resolved,
        filename: resolved,
        loaded: true,
        exports
    }
    return resolved
}

async function run() {
    const mocked = []
    let abortRequests = 0
    let drainCalls = 0
    let exitCode = null
    let dashboardHangs = false
    let forceCleanupRequests = 0
    let blockConfigStopMs = 0
    const shutdownEvents = []
    const originalExit = process.exit
    process.exit = (code) => { exitCode = code }

    try {
        mocked.push(mockModule('../../../src/config', {
            stop: async () => {
                shutdownEvents.push('config-stop')
                if (blockConfigStopMs > 0) {
                    const until = Date.now() + blockConfigStopMs
                    while (Date.now() < until) { /* simulate a synchronous tail race */ }
                }
            },
            getSnapshot: () => ({})
        }))
        mocked.push(mockModule('../../../src/services/subscriptionService', {
            pauseOperations() {},
            drainOperations: async () => {
                drainCalls += 1
                if (drainCalls === 1) {
                    const error = new Error('graceful drain timed out')
                    error.code = 'OPERATION_DRAIN_TIMEOUT'
                    throw error
                }
                return true
            },
            abortOperations() { abortRequests += 1 },
            stop: async () => {}
        }))
        mocked.push(mockModule('../../../src/services/videoDownloadService', {
            pauseOperations() {},
            drainOperations: async () => true,
            abortOperations() { abortRequests += 1 },
            cleanup: async () => {}
        }))
        mocked.push(mockModule('../../../src/services/ServiceManager', {
            abortOperations() { abortRequests += 1 },
            forceTerminateAll() { forceCleanupRequests += 1 },
            cleanup: async () => {
                shutdownEvents.push('python-cleanup')
                return { residualPids: [4321] }
            }
        }))
        mocked.push(mockModule('../../../src/services/imageGenerator', {
            cleanup: async () => {},
            forceCleanup() { forceCleanupRequests += 1 }
        }))
        mocked.push(mockModule('../../../src/dashboard/server', {
            stop: async () => dashboardHangs ? new Promise(() => {}) : undefined,
            forceStop() { forceCleanupRequests += 1 }
        }))
        mocked.push(mockModule('../../../src/services/requestApprovalService', { stop: async () => {} }))
        mocked.push(mockModule('../../../src/services/notificationService', { stop: async () => {} }))
        mocked.push(mockModule('../../../src/providers/qq/runtime', {
            getCurrentProvider: () => null,
            clearCurrentProvider() {},
            providerRuntimeManager: {
                ingressPaused: false,
                releaseGate: { snapshot: () => ({ epoch: null, admissionEnabled: true }) }
            }
        }))

        delete require.cache[require.resolve(botPath)]
        const bot = require(botPath)
        const result = await bot.gracefulShutdown(0, { drainTimeoutMs: 5, abortDrainTimeoutMs: 5 })

        assert.strictEqual(drainCalls, 2, 'shutdown must retry a bounded drain after abort')
        assert.strictEqual(abortRequests, 3, 'all owned runtime registries must receive abort')
        assert.strictEqual(result, 1, 'any drain or residual-process failure must force non-zero exit')
        assert.strictEqual(exitCode, 1)
        assert.ok(
            shutdownEvents.indexOf('config-stop') > shutdownEvents.indexOf('python-cleanup'),
            'ConfigService must stop after runtime side effects are cleaned up'
        )

        bot.__testHooks.resetRuntimeState()
        dashboardHangs = true
        drainCalls = 1
        abortRequests = 0
        exitCode = null
        const startedAt = Date.now()
        const deadlineResult = await bot.gracefulShutdown(0, {
            drainTimeoutMs: 1000,
            abortDrainTimeoutMs: 1000,
            shutdownTimeoutMs: 25
        })
        assert.ok(Date.now() - startedAt < 500, 'a hanging shutdown stage must not exceed the process deadline')
        assert.strictEqual(deadlineResult, 1)
        assert.strictEqual(exitCode, 1)
        assert.ok(abortRequests >= 3, 'the absolute deadline must abort all owned runtime operations')
        assert.strictEqual(forceCleanupRequests, 3, 'the absolute deadline must force owned server, browser, and child cleanup')

        bot.__testHooks.resetRuntimeState()
        dashboardHangs = false
        drainCalls = 1
        abortRequests = 0
        exitCode = null
        blockConfigStopMs = 35
        const tailRaceResult = await bot.gracefulShutdown(0, {
            drainTimeoutMs: 5,
            abortDrainTimeoutMs: 5,
            shutdownTimeoutMs: 20
        })
        assert.strictEqual(tailRaceResult, 1, 'elapsed absolute deadline must win even when its timer callback was starved')
        assert.strictEqual(exitCode, 1)
    } finally {
        process.exit = originalExit
        delete require.cache[require.resolve(botPath)]
        for (const resolved of mocked) delete require.cache[resolved]
    }
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
