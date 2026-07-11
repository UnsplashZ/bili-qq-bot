#!/usr/bin/env node
'use strict'

const assert = require('assert')
const express = require('express')
const request = require('supertest')

const logger = require('../../../src/utils/logger')
const config = require('../../../src/config')

const originalSetInterval = global.setInterval
global.setInterval = (...args) => {
    const timer = originalSetInterval(...args)
    if (timer && typeof timer.unref === 'function') {
        timer.unref()
    }
    return timer
}
const apiRouter = require('../../../src/dashboard/routes/api')
global.setInterval = originalSetInterval

const originals = {
    dashboardPasswordDescriptor: Object.getOwnPropertyDescriptor(config, 'dashboardPassword'),
    jwtSecretDescriptor: Object.getOwnPropertyDescriptor(config, 'jwtSecret'),
    ensureGroupConfig: config.ensureGroupConfig,
    save: config.save,
    patch: config.patch,
    getStatus: config.getStatus,
    getDashboardConfigSnapshot: config.getDashboardConfigSnapshot,
    groupConfigs: JSON.parse(JSON.stringify(config.groupConfigs || {})),
    bot: global.bot
}

function restore() {
    Object.defineProperty(config, 'dashboardPassword', originals.dashboardPasswordDescriptor)
    Object.defineProperty(config, 'jwtSecret', originals.jwtSecretDescriptor)
    config.ensureGroupConfig = originals.ensureGroupConfig
    config.save = originals.save
    config.patch = originals.patch
    config.getStatus = originals.getStatus
    config.getDashboardConfigSnapshot = originals.getDashboardConfigSnapshot
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
    const off = logger.onLog((entry) => logs.push(entry))

    try {
        const app = express()
        app.use(express.json())
        app.use('/api', apiRouter)

        Object.defineProperty(config, 'dashboardPassword', {
            configurable: true,
            enumerable: true,
            writable: true,
            value: 'test-pass'
        })
        Object.defineProperty(config, 'jwtSecret', {
            configurable: true,
            enumerable: true,
            writable: true,
            value: 'dashboard-logging-test-secret'
        })
        config.ensureGroupConfig = (groupId) => {
            config.__getMutableCompatStateForTests().groupConfigs[groupId] = config.groupConfigs[groupId] || {}
        }
        config.save = () => {}
        config.getStatus = () => ({
            documentGeneration: 1,
            effectiveGeneration: 1,
            fingerprint: 'public-1'
        })
        config.getDashboardConfigSnapshot = () => ({ showId: false, generation: 2 })
        config.patch = async () => ({
            documentGeneration: 2,
            effectiveGeneration: 2,
            generation: 2,
            applied: ['rendering.showId'],
            reloaded: ['rendering'],
            deploymentApplyRequired: [],
            warnings: []
        })
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
            .post('/api/config')
            .set('Authorization', `Bearer ${token}`)
            .send({ expectedGeneration: 1, values: { showId: false } })

        assert.strictEqual(updateRes.status, 200)

        assert.ok(logs.some(entry => entry.level === 'info' && entry.channel === 'HTTP' && entry.scope.startsWith('req:') && entry.action === 'recv'))
        assert.ok(logs.some(entry => entry.level === 'info' && entry.channel === 'AUTH' && entry.scope.startsWith('req:') && entry.action === 'login-succeeded'))
        assert.ok(logs.some(entry => entry.level === 'info' && entry.channel === 'DASH' && entry.scope.startsWith('req:') && entry.action === 'config-updated'))
        assert.ok(!logs.some(entry => entry.scope === 'Config'))
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
