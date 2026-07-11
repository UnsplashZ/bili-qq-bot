'use strict'

const assert = require('assert')
const express = require('express')
const request = require('supertest')
const config = require('../../../src/config')
const { createDefaultConfig } = require('../../../src/config/schemaV1')
const { csrfProtection, canonicalOrigin, canonicalRequestOrigin } = require('../../../src/dashboard/middleware/auth')
const { buildApplication } = require('../../../src/dashboard/server')

const originalSetInterval = global.setInterval
global.setInterval = (...args) => {
    const timer = originalSetInterval(...args)
    timer?.unref?.()
    return timer
}
const authRouter = require('../../../src/dashboard/routes/api/modules/auth')
global.setInterval = originalSetInterval

describe('Dashboard CSRF allowed origins', () => {
    const passwordDescriptor = Object.getOwnPropertyDescriptor(config, 'dashboardPassword')
    const jwtDescriptor = Object.getOwnPropertyDescriptor(config, 'jwtSecret')
    let compat
    let originalOrigins
    let originalPort

    beforeEach(() => {
        compat = config.__getMutableCompatStateForTests()
        originalOrigins = structuredClone(compat.dashboardAllowedOrigins)
        originalPort = compat.dashboardPort
        compat.dashboardAllowedOrigins = []
        compat.dashboardPort = 3000
        Object.defineProperty(config, 'dashboardPassword', { configurable: true, value: 'csrf-pass' })
        Object.defineProperty(config, 'jwtSecret', { configurable: true, value: 'csrf-jwt-secret' })
    })

    afterEach(() => {
        compat.dashboardAllowedOrigins = originalOrigins
        compat.dashboardPort = originalPort
        Object.defineProperty(config, 'dashboardPassword', passwordDescriptor)
        Object.defineProperty(config, 'jwtSecret', jwtDescriptor)
    })

    function app() {
        const instance = express()
        instance.use(express.json())
        instance.use('/api', csrfProtection)
        instance.use('/api', authRouter)
        return instance
    }

    it('allows only exact default or configured URL origins on the real login route and hot-updates', async () => {
        assert.strictEqual(canonicalOrigin('https://bot.example.com'), 'https://bot.example.com')
        for (const invalid of ['https://bot.example.com/', 'https://bot.example.com/path', 'ftp://bot.example.com', ' https://bot.example.com']) {
            assert.strictEqual(canonicalOrigin(invalid), null)
        }

        const server = app()
        assert.strictEqual((await request(server).post('/api/login').set('Origin', 'http://localhost:3000').send({ password: 'csrf-pass' })).status, 200)
        assert.strictEqual((await request(server).post('/api/login').set('Origin', 'http://192.168.1.8:3000').send({ password: 'csrf-pass' })).status, 403)

        compat.dashboardAllowedOrigins = ['https://bot.example.com']
        assert.strictEqual((await request(server).post('/api/login').set('Origin', 'https://bot.example.com').send({ password: 'csrf-pass' })).status, 200)
        assert.strictEqual((await request(server).post('/api/login').set('Origin', 'https://other.example.com').send({ password: 'csrf-pass' })).status, 403)

        compat.dashboardAllowedOrigins = ['https://new.example.com']
        assert.strictEqual((await request(server).post('/api/login').set('Origin', 'https://bot.example.com').send({ password: 'csrf-pass' })).status, 403)
        assert.strictEqual((await request(server).post('/api/login').set('Origin', 'https://new.example.com').send({ password: 'csrf-pass' })).status, 200)
    })

    it('accepts the normalized request Host origin for custom external ports and rejects malformed authority', async () => {
        const server = app()
        assert.strictEqual((await request(server)
            .post('/api/login')
            .set('Host', 'dashboard.example.test:8123')
            .set('Origin', 'http://dashboard.example.test:8123')
            .send({ password: 'csrf-pass' })).status, 200)
        assert.strictEqual((await request(server)
            .post('/api/login')
            .set('Host', 'dashboard.example.test:8123')
            .set('Origin', 'http://dashboard.example.test:8124')
            .send({ password: 'csrf-pass' })).status, 403)
        assert.strictEqual((await request(server)
            .post('/api/login')
            .set('Host', 'dashboard.example.test:8123')
            .set('Origin', 'http://dashboard.example.test:8123/path')
            .send({ password: 'csrf-pass' })).status, 403)
        assert.strictEqual(canonicalRequestOrigin({
            headers: { host: 'dashboard.example.test:8123@example.invalid' },
            socket: { encrypted: false }
        }), null)
        assert.strictEqual(canonicalRequestOrigin({
            headers: { host: 'dashboard%2eexample.test:8123' },
            socket: { encrypted: false }
        }), null)
    })

    it('uses the same canonical origin set for CORS responses', async () => {
        const snapshot = createDefaultConfig()
        snapshot.dashboard.jwtSecret = 'cors-test-jwt-secret'
        snapshot.dashboard.allowedOrigins = ['https://bot.example.com']
        const server = buildApplication({ configSnapshot: snapshot })

        const configured = await request(server).get('/api/live').set('Origin', 'https://bot.example.com')
        assert.strictEqual(configured.headers['access-control-allow-origin'], 'https://bot.example.com')
        const localhost = await request(server).get('/api/live').set('Origin', 'http://localhost:3000')
        assert.strictEqual(localhost.headers['access-control-allow-origin'], 'http://localhost:3000')
        const rejected = await request(server).get('/api/live').set('Origin', 'https://other.example.com')
        assert.strictEqual(rejected.headers['access-control-allow-origin'], undefined)
    })
})
