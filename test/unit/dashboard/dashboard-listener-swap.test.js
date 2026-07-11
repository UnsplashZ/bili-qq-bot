'use strict'

const assert = require('assert')
const express = require('express')
const request = require('supertest')
const jwt = require('jsonwebtoken')
const {
    buildApplication,
    createListener,
    closeHandle,
    createDashboardReloadHandler,
    getRuntimeStatus
} = require('../../../src/dashboard/server')
const { applicationAdmissionGate } = require('../../../src/services/runtime/applicationAdmissionGate')
const sysConfig = require('../../../src/config')

function appWithValue(value) {
    const app = express()
    app.get('/api/live', (req, res) => res.json({ live: true }))
    app.get('/api/ready', (req, res) => res.status(503).json({ ready: false }))
    app.get('/value', (req, res) => res.json({ value }))
    return app
}

function snapshot(port) {
    return {
        dashboard: { listenPort: port, allowedOrigins: [] },
        paths: { napcatTemp: '/tmp' }
    }
}

describe('dashboard stable listener', () => {
    afterEach(() => {
        assert.equal(getRuntimeStatus().listenerCount, 0, 'test must not leave Dashboard listeners or WebSocket servers open')
    })

    it('keeps the stable local ingress origin allowed when listenPort changes', async () => {
        const app = buildApplication({
            configSnapshot: snapshot(4000),
            buildReadyPayload: async () => ({ ready: true })
        })
        const response = await request(app)
            .get('/api/live')
            .set('Origin', 'http://localhost:3000')
            .expect(200)
        assert.equal(response.headers['access-control-allow-origin'], 'http://localhost:3000')
    })

    it('keeps liveness available while the application admission gate rejects new API work', async () => {
        const port = 42000 + Math.floor(Math.random() * 1000)
        const app = express()
        app.get('/api/live', (req, res) => res.json({ live: true }))
        app.get('/api/value', (req, res) => res.json({ value: 'unsafe-during-cutover' }))
        const handle = await createListener(app, port)
        let token = null
        try {
            token = applicationAdmissionGate.close('test-cutover')
            const blocked = await fetch(`http://127.0.0.1:${port}/api/value`)
            assert.strictEqual(blocked.status, 503)
            assert.strictEqual((await blocked.json()).error, 'APPLICATION_INGRESS_PAUSED')
            const live = await fetch(`http://127.0.0.1:${port}/api/live`)
            assert.strictEqual(live.status, 200)
        } finally {
            if (token && applicationAdmissionGate.snapshot().closed) applicationAdmissionGate.open(token)
            await closeHandle(handle)
        }
    })

    it('serves the recovery SPA and authenticated redacted bootstrap while keeping every other API closed', async () => {
        const jwtDescriptor = Object.getOwnPropertyDescriptor(sysConfig, 'jwtSecret')
        const passwordDescriptor = Object.getOwnPropertyDescriptor(sysConfig, 'dashboardPassword')
        const originalGetStatus = sysConfig.getStatus
        const originalRecover = sysConfig.recover
        const secret = 'listener-recovery-jwt-secret'
        const password = 'listener-recovery-password'
        Object.defineProperty(sysConfig, 'jwtSecret', {
            configurable: true,
            enumerable: true,
            get: () => secret
        })
        Object.defineProperty(sysConfig, 'dashboardPassword', {
            configurable: true,
            enumerable: true,
            get: () => password
        })
        sysConfig.getStatus = () => ({
            documentGeneration: 4,
            effectiveGeneration: 3,
            recoveryRequired: { required: true, code: 'CONFIG_RECOVERY_FAILED', reason: 'listener-test' }
        })
        const app = buildApplication({
            configSnapshot: snapshot(3000),
            buildReadyPayload: async () => ({ ready: true })
        })
        const handle = await createListener(app, 0)
        const port = handle.server.address().port
        const baseUrl = `http://127.0.0.1:${port}`
        const auth = `Bearer ${jwt.sign({ role: 'admin' }, secret)}`
        let token = null
        let recoverCalls = 0
        try {
            token = applicationAdmissionGate.close('listener-recovery-test')
            sysConfig.recover = async () => {
                recoverCalls += 1
                applicationAdmissionGate.open(token)
                token = null
                return { recovered: true, handlers: ['qq-provider-runtime'] }
            }

            const settingsPage = await fetch(`${baseUrl}/settings`)
            assert.strictEqual(settingsPage.status, 200)
            assert.match(settingsPage.headers.get('content-type') || '', /text\/html/)
            const indexHtml = await settingsPage.text()
            const assetPath = indexHtml.match(/(?:src|href)="(\/assets\/[A-Za-z0-9._-]+)"/)?.[1]
            assert.ok(assetPath, 'built recovery SPA must reference a static asset')
            assert.strictEqual((await fetch(`${baseUrl}${assetPath}`, { method: 'HEAD' })).status, 200)

            assert.strictEqual((await fetch(`${baseUrl}/api/config/status`)).status, 401)
            assert.strictEqual((await fetch(`${baseUrl}/api/config`)).status, 401)
            const configResponse = await fetch(`${baseUrl}/api/config`, { headers: { Authorization: auth } })
            assert.strictEqual(configResponse.status, 200)
            const publicConfig = await configResponse.json()
            assert.strictEqual(publicConfig.qqOfficialClientSecret, undefined)
            assert.strictEqual(publicConfig.jwtSecret, undefined)
            assert.ok(!JSON.stringify(publicConfig).includes(secret))
            const statusResponse = await fetch(`${baseUrl}/api/config/status`, { headers: { Authorization: auth } })
            assert.strictEqual(statusResponse.status, 200)
            assert.ok(!JSON.stringify(await statusResponse.json()).includes(secret))
            assert.strictEqual((await fetch(`${baseUrl}/api/config`, { method: 'HEAD', headers: { Authorization: auth } })).status, 200)
            assert.strictEqual((await fetch(`${baseUrl}/api/config/status`, { method: 'HEAD', headers: { Authorization: auth } })).status, 200)

            assert.strictEqual((await fetch(`${baseUrl}/api/config/migrations`, { headers: { Authorization: auth } })).status, 503)
            assert.strictEqual((await fetch(`${baseUrl}/api/status`)).status, 503)
            assert.strictEqual((await fetch(`${baseUrl}/api/config`, { method: 'POST', headers: { Authorization: auth } })).status, 503)
            assert.strictEqual((await fetch(`${baseUrl}/qq-official-temp/private-file`)).status, 503)
            assert.strictEqual((await fetch(`${baseUrl}/assets/%2e%2e%2fsettings`)).status, 503)
            assert.strictEqual((await fetch(`${baseUrl}/api/config/recover`)).status, 503)
            assert.strictEqual((await fetch(`${baseUrl}/api/config/recover/`, { method: 'POST' })).status, 503)
            assert.strictEqual((await fetch(`${baseUrl}/api/config/%72ecover`, { method: 'POST' })).status, 503)
            assert.strictEqual((await fetch(`${baseUrl}/api/login/`, { method: 'POST' })).status, 503)
            assert.strictEqual((await fetch(`${baseUrl}/api/%6cogin`, { method: 'POST' })).status, 503)
            const websocketClose = await new Promise((resolve, reject) => {
                const ws = new (require('ws'))(`ws://127.0.0.1:${port}/ws/logs?token=${encodeURIComponent(auth.slice(7))}`)
                ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() }))
                ws.once('error', reject)
            })
            assert.deepStrictEqual(websocketClose, { code: 1013, reason: 'Dashboard admission paused' })

            const expiredAuth = `Bearer ${jwt.sign({ role: 'admin' }, secret, { expiresIn: -1 })}`
            assert.strictEqual((await fetch(`${baseUrl}/api/config/status`, { headers: { Authorization: expiredAuth } })).status, 401)
            const maliciousLogin = await request(handle.server)
                .post('/api/login')
                .set('Host', 'dashboard.example.test:8123')
                .set('Origin', 'https://attacker.invalid')
                .send({ password })
            assert.strictEqual(maliciousLogin.status, 403)
            const rejectedPassword = await request(handle.server)
                .post('/api/login')
                .set('Host', 'dashboard.example.test:8123')
                .set('Origin', 'http://dashboard.example.test:8123')
                .send({ password: 'wrong-password' })
            assert.strictEqual(rejectedPassword.status, 401)
            const loginResponse = await request(handle.server)
                .post('/api/login')
                .set('Host', 'dashboard.example.test:8123')
                .set('Origin', 'http://dashboard.example.test:8123')
                .send({ password })
            assert.strictEqual(loginResponse.status, 200)
            const loginPayload = loginResponse.body
            assert.strictEqual(loginPayload.recoveryRequired, true)
            assert.strictEqual(loginPayload.redirectPath, '/settings')
            const recoveredAuth = `Bearer ${loginPayload.token}`
            assert.strictEqual((await fetch(`${baseUrl}/api/config`, { headers: { Authorization: recoveredAuth } })).status, 200)
            assert.strictEqual((await fetch(`${baseUrl}/api/config/status`, { headers: { Authorization: recoveredAuth } })).status, 200)

            const unauthenticated = await fetch(`${baseUrl}/api/config/recover`, { method: 'POST' })
            assert.strictEqual(unauthenticated.status, 401)
            assert.equal(recoverCalls, 0)

            const invalidCsrf = await fetch(`${baseUrl}/api/config/recover`, {
                method: 'POST',
                headers: { Authorization: auth, Origin: 'https://attacker.invalid' }
            })
            assert.strictEqual(invalidCsrf.status, 403)
            assert.equal(recoverCalls, 0)

            const recovered = await fetch(`${baseUrl}/api/config/recover`, {
                method: 'POST',
                headers: { Authorization: recoveredAuth, Origin: baseUrl }
            })
            assert.strictEqual(recovered.status, 200)
            assert.deepStrictEqual(await recovered.json(), {
                recovered: true,
                handlers: ['qq-provider-runtime']
            })
            assert.equal(recoverCalls, 1)
            assert.equal(applicationAdmissionGate.snapshot().closed, false)
        } finally {
            if (token && applicationAdmissionGate.snapshot().closed) applicationAdmissionGate.open(token)
            sysConfig.recover = originalRecover
            sysConfig.getStatus = originalGetStatus
            if (jwtDescriptor) Object.defineProperty(sysConfig, 'jwtSecret', jwtDescriptor)
            if (passwordDescriptor) Object.defineProperty(sysConfig, 'dashboardPassword', passwordDescriptor)
            await closeHandle(handle)
        }
    })

    it('keeps the old listener alive on candidate bind failure and supports same-port app swap', async () => {
        const port = 41000 + Math.floor(Math.random() * 1000)
        const handle = await createListener(appWithValue('old'), port)
        try {
            const before = await fetch(`http://127.0.0.1:${port}/value`).then((response) => response.json())
            assert.strictEqual(before.value, 'old')

            await assert.rejects(
                createListener(appWithValue('candidate'), port, { enabled: false }),
                (error) => error.code === 'EADDRINUSE'
            )
            const afterFailure = await fetch(`http://127.0.0.1:${port}/value`).then((response) => response.json())
            assert.strictEqual(afterFailure.value, 'old')

            handle.app = appWithValue('new')
            const afterSwap = await fetch(`http://127.0.0.1:${port}/value`).then((response) => response.json())
            assert.strictEqual(afterSwap.value, 'new')
        } finally {
            await closeHandle(handle)
        }
    })

    it('keeps a same-port app swap behind commit and restores the old app on rollback', async () => {
        const port = 43000 + Math.floor(Math.random() * 500)
        const oldHandle = await createListener(appWithValue('old'), port)
        let active = oldHandle
        const handler = createDashboardReloadHandler({
            getActiveHandle: () => active,
            setActiveHandle: (handle) => { active = handle },
            buildApplication: () => appWithValue('new')
        })
        try {
            await handler.preflight(snapshot(port))
            await handler.prepareParallel(snapshot(port))
            assert.equal((await fetch(`http://127.0.0.1:${port}/value`).then(r => r.json())).value, 'old')
            await handler.pauseIngress()
            assert.equal((await fetch(`http://127.0.0.1:${port}/value`)).status, 503)
            await handler.commitHandles()
            await handler.validateAdmission()
            await handler.rollbackExclusive()
            await handler.rollbackPrepared()
            await handler.restorePrevious()
            assert.equal((await fetch(`http://127.0.0.1:${port}/value`).then(r => r.json())).value, 'old')
            assert.equal(active, oldHandle)
        } finally {
            await closeHandle(oldHandle)
        }
    })

    it('hot reloads a changed listenPort through the stable ingress without moving health traffic', async () => {
        const oldPort = 43500 + Math.floor(Math.random() * 200)
        const newPort = oldPort + 300
        const oldHandle = await createListener(appWithValue('old'), oldPort)
        let active = oldHandle
        const handler = createDashboardReloadHandler({
            getActiveHandle: () => active,
            setActiveHandle: (handle) => { active = handle },
            buildApplication: () => appWithValue('new')
        })
        try {
            await handler.preflight(snapshot(newPort))
            await handler.prepareParallel(snapshot(newPort))
            assert.equal((await fetch(`http://127.0.0.1:${oldPort}/value`).then(r => r.json())).value, 'old')
            await handler.pauseIngress()
            await handler.commitHandles()
            assert.equal(active.port, oldPort)
            assert.equal((await fetch(`http://127.0.0.1:${oldPort}/value`)).status, 503)
            await handler.validateAdmission()
            await handler.enableIngress()
            assert.equal((await fetch(`http://127.0.0.1:${oldPort}/value`).then(r => r.json())).value, 'new')
            await handler.disposeOld()
            assert.equal(active.server.listening, true)
            assert.equal(active.port, oldPort)
        } finally {
            if (active?.server?.listening) await closeHandle(active)
            if (oldHandle.server?.listening) await closeHandle(oldHandle)
        }
    })

    it('fails candidate contract health during prepare without pausing the old listener', async () => {
        const port = 44000 + Math.floor(Math.random() * 500)
        const oldHandle = await createListener(appWithValue('old'), port)
        let active = oldHandle
        const handler = createDashboardReloadHandler({
            getActiveHandle: () => active,
            setActiveHandle: (handle) => { active = handle },
            buildApplication: () => express()
        })
        try {
            await handler.preflight(snapshot(port))
            await assert.rejects(() => handler.prepareParallel(snapshot(port)))
            assert.equal(oldHandle.enabled, true)
            assert.equal((await fetch(`http://127.0.0.1:${port}/value`).then(r => r.json())).value, 'old')
        } finally {
            await closeHandle(oldHandle)
        }
    })

    it('restores the old application on the stable ingress when a changed listenPort candidate fails admission', async () => {
        const oldPort = 44500 + Math.floor(Math.random() * 100)
        const newPort = oldPort + 200
        const oldHandle = await createListener(appWithValue('old'), oldPort)
        let active = oldHandle
        const handler = createDashboardReloadHandler({
            getActiveHandle: () => active,
            setActiveHandle: (handle) => { active = handle },
            buildApplication: () => appWithValue('new')
        })
        try {
            await handler.preflight(snapshot(newPort))
            await handler.prepareParallel(snapshot(newPort))
            await handler.pauseIngress()
            await handler.commitHandles()
            active.server.emit('error', Object.assign(new Error('candidate failed'), { code: 'EIO' }))
            await assert.rejects(
                () => handler.validateAdmission(),
                error => error.code === 'DASHBOARD_CANDIDATE_NOT_READY'
            )
            await handler.rollbackExclusive()
            await handler.rollbackPrepared()
            await handler.restorePrevious()
            assert.equal(active, oldHandle)
            assert.equal(active.port, oldPort)
            assert.equal(oldHandle.enabled, true)
            assert.equal((await fetch(`http://127.0.0.1:${oldPort}/value`).then(r => r.json())).value, 'old')
        } finally {
            if (active?.server?.listening) await closeHandle(active)
            if (oldHandle.server?.listening) await closeHandle(oldHandle)
        }
    })

    it('rejects a listener invalidated after async validation but before the gate opens', async () => {
        const oldPort = 44700 + Math.floor(Math.random() * 100)
        const newPort = oldPort + 200
        const oldHandle = await createListener(appWithValue('old'), oldPort)
        let active = oldHandle
        const handler = createDashboardReloadHandler({
            getActiveHandle: () => active,
            setActiveHandle: (handle) => { active = handle },
            buildApplication: () => appWithValue('new')
        })
        try {
            await handler.preflight(snapshot(newPort))
            await handler.prepareParallel(snapshot(newPort))
            await handler.pauseIngress()
            await handler.commitHandles()
            await handler.validateAdmission()
            await handler.enableIngress()
            active.server.emit('error', Object.assign(new Error('listener failed'), { code: 'EIO' }))

            assert.throws(() => handler.finalizeAdmission(), error => error.code === 'DASHBOARD_CANDIDATE_NOT_READY')
            await handler.rollbackExclusive()
            await handler.rollbackPrepared()
            await handler.restorePrevious()
            assert.equal(active, oldHandle)
            assert.equal(oldHandle.enabled, true)
        } finally {
            if (active?.server?.listening) await closeHandle(active)
            if (oldHandle.server?.listening) await closeHandle(oldHandle)
        }
    })
})
