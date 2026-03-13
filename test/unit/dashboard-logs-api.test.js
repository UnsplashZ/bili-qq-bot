#!/usr/bin/env node
'use strict'

const assert = require('assert')
const jwt = require('jsonwebtoken')
const WebSocket = require('ws')

const dashboardServer = require('../../src/dashboard/server')
const sysConfig = require('../../src/config')
const logger = require('../../src/utils/logger')
const { logBuffer } = require('../../src/dashboard/logBuffer')

function waitForMessage(ws, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error('websocket message timeout'))
        }, timeoutMs)

        ws.once('message', (payload) => {
            clearTimeout(timer)
            resolve(JSON.parse(String(payload)))
        })
    })
}

async function run() {
    const port = 38000 + Math.floor(Math.random() * 1000)
    const token = jwt.sign({ role: 'admin', timestamp: Date.now() }, sysConfig.jwtSecret, { expiresIn: '24h' })

    await dashboardServer.start(port)
    logBuffer.clear()

    try {
        logger.logEvent('info', 'HTTP', 'req:http1', 'history-http', { sample: 1 })
        logger.logEvent('warn', 'RPC', 'req:rpc1', 'history-rpc', { sample: 2 })
        logger.logEvent('error', 'PY', 'svc:lifecycle', 'history-py', { sample: 3 })

        const response = await fetch(`http://127.0.0.1:${port}/api/logs/recent?level=warn&channels=RPC,PY&keyword=history&limit=5`, {
            headers: {
                Authorization: `Bearer ${token}`
            }
        })

        assert.strictEqual(response.status, 200, 'GET /api/logs/recent should succeed')
        const body = await response.json()
        assert.ok(Array.isArray(body.logs), 'history API should return a logs array')
        assert.deepStrictEqual(body.logs.map((entry) => entry.action), ['history-rpc', 'history-py'], 'history API should honor level/channel/keyword filters')

        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/logs?token=${token}&level=warn&channels=RPC`)
        await new Promise((resolve, reject) => {
            ws.once('open', resolve)
            ws.once('error', reject)
        })

        logger.logEvent('info', 'HTTP', 'req:http2', 'ws-http', { sample: 4 })
        logger.logEvent('warn', 'RPC', 'req:rpc2', 'ws-rpc', { sample: 5 })

        const wsMessage = await waitForMessage(ws)
        assert.strictEqual(wsMessage.channel, 'RPC', 'WebSocket log stream should honor channel filters')
        assert.strictEqual(wsMessage.action, 'ws-rpc', 'WebSocket log stream should honor level filters')

        ws.close()
        console.log('PASS dashboard-logs-api')
    } finally {
        logBuffer.clear()
        dashboardServer.stop()
    }
}

run().catch((error) => {
    console.error(error)
    process.exit(1)
})
