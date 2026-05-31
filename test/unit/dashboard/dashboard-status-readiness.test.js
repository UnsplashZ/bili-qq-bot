#!/usr/bin/env node
'use strict'

const assert = require('assert')

const updateChecker = require('../../../src/services/subscription/updateChecker')
const dashboardServer = require('../../../src/dashboard/server')

const originalGetStatus = updateChecker.getStatus

async function run() {
    const port = 39000 + Math.floor(Math.random() * 1000)

    try {
        updateChecker.getStatus = () => ({
            running: false,
            runtime: {
                startState: 'initializing',
                startupPending: true,
                initialized: false,
                initializing: true,
                ready: false,
                lastError: null,
                lastErrorAt: null
            },
            timers: {}
        })

        await dashboardServer.start(port)

        const startingResponse = await fetch(`http://127.0.0.1:${port}/api/status`)
        assert.equal(startingResponse.status, 200)
        const startingPayload = await startingResponse.json()
        assert.equal(startingPayload.status, 'starting')
        assert.equal(startingPayload.components.dashboard, 'ok')
        assert.equal(startingPayload.components.subscriptionRuntime, 'starting')
        assert.equal(startingPayload.subscription.runtime.startupPending, true)

        updateChecker.getStatus = () => ({
            running: false,
            runtime: {
                startState: 'error',
                startupPending: false,
                initialized: false,
                initializing: false,
                ready: false,
                lastError: 'init failed',
                lastErrorAt: 123
            },
            timers: {}
        })

        const degradedResponse = await fetch(`http://127.0.0.1:${port}/api/status`)
        assert.equal(degradedResponse.status, 200)
        const degradedPayload = await degradedResponse.json()
        assert.equal(degradedPayload.status, 'degraded')
        assert.equal(degradedPayload.components.subscriptionRuntime, 'degraded')
        assert.equal(degradedPayload.subscription.runtime.lastError, 'init failed')

        console.log('PASS dashboard status readiness')
    } finally {
        updateChecker.getStatus = originalGetStatus
        dashboardServer.stop()
    }
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
