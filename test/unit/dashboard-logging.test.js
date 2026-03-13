#!/usr/bin/env node
'use strict'

const assert = require('assert')
const express = require('express')
const request = require('supertest')

const logger = require('../../src/utils/logger')
const config = require('../../src/config')

const originalSetInterval = global.setInterval
global.setInterval = (...args) => {
    const timer = originalSetInterval(...args)
    if (timer && typeof timer.unref === 'function') {
        timer.unref()
    }
    return timer
}
const apiRouter = require('../../src/dashboard/routes/api')
global.setInterval = originalSetInterval

const originals = {
    dashboardPassword: config.dashboardPassword,
    ensureGroupConfig: config.ensureGroupConfig,
    save: config.save,
    groupConfigs: JSON.parse(JSON.stringify(config.groupConfigs || {})),
    bot: global.bot
}

function restore() {
    config.dashboardPassword = originals.dashboardPassword
    config.ensureGroupConfig = originals.ensureGroupConfig
    config.save = originals.save
    const groupConfigs = config.groupConfigs || {}
    for (const key of Object.keys(groupConfigs)) delete groupConfigs[key]
    Object.assign(groupConfigs, JSON.parse(JSON.stringify(originals.groupConfigs)))
    if (originals.bot) {
        global.bot = originals.bot
    } else {
        delete global.bot
    }
}

async function run() {
    const logs = []
    const off = logger.onLog((entry) => logs.push(entry.message))

    try {
        const app = express()
        app.use(express.json())
        app.use('/api', apiRouter)

        config.dashboardPassword = 'test-pass'
        config.ensureGroupConfig = (groupId) => {
            config.groupConfigs[groupId] = config.groupConfigs[groupId] || {}
        }
        config.save = () => {}
        global.bot = {
            groupList: new Map([['1000', { group_name: 'Test Group' }]])
        }

        const loginRes = await request(app)
            .post('/api/login')
            .send({ password: 'test-pass' })

        assert.strictEqual(loginRes.status, 200)
        const token = loginRes.body.token
        assert.ok(token)

        const updateRes = await request(app)
            .put('/api/groups/1000/ai-config')
            .set('Authorization', `Bearer ${token}`)
            .send({ aiEnabled: true })

        assert.strictEqual(updateRes.status, 200)

        assert.ok(logs.some(line => line.includes('INF HTTP') && line.includes('[req:') && line.includes('recv')))
        assert.ok(logs.some(line => line.includes('INF AUTH') && line.includes('[req:') && line.includes('login-succeeded')))
        assert.ok(logs.some(line => line.includes('INF DASH') && line.includes('[req:') && line.includes('ai-config-updated')))
        assert.ok(!logs.some(line => line.includes('[Config]')))
        console.log('✓ dashboard API 会输出 HTTP/AUTH/DASH 摘要日志')
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
