'use strict'

const http = require('http')
const express = require('express')
const cors = require('cors')
const path = require('path')
const WebSocket = require('ws')
const jwt = require('jsonwebtoken')
const logger = require('../utils/logger')
const { logBuffer, matchesFilters } = require('./logBuffer')
const apiRoutes = require('./routes/api')
const sysConfig = require('../config')
const { csrfProtection } = require('./middleware/auth')
const updateChecker = require('../services/subscription/updateChecker')
const serviceManager = require('../services/ServiceManager')
const qqProviderRuntime = require('../providers/qq/runtime')
const { getCurrentMigrationStatus } = require('./migrationStatus')
const { validateDashboardAllowedOrigins } = require('../config/validator')
const { buildReadinessPayload } = require('./readiness')
const { applicationAdmissionGate } = require('../services/runtime/applicationAdmissionGate')
const { DASHBOARD_INGRESS_PORT } = require('../config/schemaV1')

const handles = new Set()
let activeHandle = null
let logUnsubscribe = null
let reloadUnregister = null
let pendingReload = null

function buildPublicProviderStatus(providerStatus) {
    if (!providerStatus) return null
    return {
        id: providerStatus.id || 'unknown',
        name: providerStatus.name || providerStatus.id || 'unknown',
        connectionState: providerStatus.connectionState || providerStatus.gateway?.state || providerStatus.state || 'unknown',
        readyState: providerStatus.readyState ?? null,
        resourceGeneration: Number(providerStatus.resourceGeneration || providerStatus.generation || 0),
        releaseEpoch: providerStatus.releaseEpoch || null
    }
}

function safeSubscriptionStatus() {
    try {
        return typeof updateChecker.getStatus === 'function' ? updateChecker.getStatus() : null
    } catch {
        return null
    }
}

function buildStatusPayload() {
    const subscription = safeSubscriptionStatus()
    const runtime = subscription?.runtime || {}
    const subscriptionState = runtime.lastError || runtime.startState === 'error'
        ? 'degraded'
        : (runtime.ready || subscription?.running ? 'ok' : 'starting')
    const providerStatus = qqProviderRuntime.getProviderStatus()
    const publicProviderStatus = buildPublicProviderStatus(providerStatus)
    const providerState = providerStatus
        ? (['ready', 'open'].includes(publicProviderStatus.connectionState) ? 'ok' : 'starting')
        : 'not_started'
    return {
        status: subscriptionState === 'degraded' ? 'degraded' : (subscriptionState === 'ok' ? 'ok' : 'starting'),
        uptime: process.uptime(),
        components: {
            dashboard: activeHandle?.enabled ? 'ok' : 'starting',
            subscriptionRuntime: subscriptionState,
            qqProvider: providerState
        },
        qqProvider: publicProviderStatus,
        subscription
    }
}

function findComponent(components, candidates) {
    for (const candidate of candidates) {
        if (components?.[candidate]) return components[candidate]
    }
    const entry = Object.entries(components || {}).find(([id]) => candidates.some((candidate) => id.includes(candidate)))
    return entry?.[1] || null
}

async function buildDefaultReadinessContext(options = {}) {
    const mode = options.mode || (process.env.BILI_UPGRADE_MODE === 'probe' ? 'upgrade-probe' : 'normal')
    const configStatus = sysConfig.getStatus()
    const components = configStatus.components || {}
    const migration = await (options.getMigrationStatus || getCurrentMigrationStatus)()
    const subscriptionStatus = safeSubscriptionStatus() || {}
    const subscriptionComponent = findComponent(components, ['subscription-runtime', 'subscription'])
    const providerStatus = buildPublicProviderStatus(qqProviderRuntime.getProviderStatus()) || {}
    const providerComponent = findComponent(components, ['qq-provider-runtime', 'qqProvider', 'provider'])
    const pythonComponent = findComponent(components, ['python-runtime', 'python'])
    const dashboardComponent = findComponent(components, ['dashboard-runtime', 'dashboard'])
    const providerSlots = qqProviderRuntime.providerRuntimeManager?.getStatus?.() || {}
    const operationStatus = updateChecker.operationRegistry?.getResourceCounts?.() || {}
    const pythonResources = serviceManager.getResourceCounts?.() || {}
    const pythonHealthy = typeof serviceManager.isServiceHealthy === 'function'
        ? await serviceManager.isServiceHealthy(300).catch(() => false)
        : Boolean(serviceManager.process)
    const pythonResidualFree = Number(pythonResources.residualChildren || 0) === 0
    const documentGeneration = Number(configStatus.documentGeneration || 0)
    const providerHasFormalStatus = Boolean(providerStatus.connectionState || providerStatus.state || providerSlots.active)
    const providerProbe = qqProviderRuntime.providerRuntimeManager?.probeStatus || null
    const probeProviderDeferred = mode === 'upgrade-probe' && !providerHasFormalStatus && providerProbe?.state !== 'preflight-ready'
    const probeSubscriptionIdle = mode === 'upgrade-probe' &&
        !subscriptionStatus.running &&
        Number.isSafeInteger(operationStatus.activeOperations) &&
        operationStatus.activeOperations === 0

    return {
        mode,
        config: configStatus,
        migration,
        dashboard: {
            ...dashboardComponent,
            state: activeHandle?.enabled ? 'ready' : 'not-ready',
            observedDocumentGeneration: dashboardComponent?.observedDocumentGeneration || documentGeneration,
            effectApplied: dashboardComponent
                ? undefined
                : Boolean(activeHandle?.enabled)
        },
        python: {
            ...pythonComponent,
            state: pythonHealthy && pythonResidualFree ? 'ready' : 'not-ready',
            instanceId: pythonComponent?.instanceId || (serviceManager.process?.pid ? `pid-${serviceManager.process.pid}` : null),
            cleanupPending: Boolean(pythonComponent?.cleanupPending || !pythonResidualFree),
            residualPids: pythonResources.residualPids || []
        },
        qqProvider: {
            ...providerComponent,
            ...providerStatus,
            id: providerStatus.id || providerComponent?.id || providerProbe?.id || sysConfig.qqProvider,
            state: providerProbe?.state === 'preflight-ready'
                ? 'preflight-ready'
                : probeProviderDeferred
                ? 'deferred'
                : (providerStatus.connectionState || providerStatus.state || (providerSlots.active ? 'ready' : 'not-ready')),
            releaseEpoch: providerStatus.releaseEpoch || providerComponent?.releaseEpoch || ((probeProviderDeferred || providerProbe?.state === 'preflight-ready') ? migration?.releaseEpoch || null : null),
            resourceGeneration: providerComponent?.resourceGeneration || providerSlots.active?.generation || 0,
            effectApplied: (probeProviderDeferred || providerProbe?.state === 'preflight-ready') && !providerComponent
                ? true
                : providerComponent?.effectApplied,
            activeSlot: providerSlots.active
                ? { ...providerSlots.active, releaseEpoch: providerSlots.releaseEpoch || providerStatus.releaseEpoch || null }
                : null,
            candidate: providerSlots.candidate || null,
            cleanupPending: Boolean(providerComponent?.cleanupPending || providerSlots.cleanupPending || providerSlots.residualCount > 0),
            residual: providerSlots.residual || []
        },
        subscription: {
            ...subscriptionComponent,
            state: probeSubscriptionIdle || subscriptionStatus.runtime?.ready || subscriptionStatus.running ? 'ready' : 'not-ready',
            paused: probeSubscriptionIdle || operationStatus.paused === true,
            observedDocumentGeneration: subscriptionComponent?.observedDocumentGeneration || (probeSubscriptionIdle ? documentGeneration : 0),
            effectApplied: probeSubscriptionIdle && !subscriptionComponent ? true : subscriptionComponent?.effectApplied
        }
    }
}

async function buildReadyPayload(options = {}) {
    return buildReadinessPayload(await buildDefaultReadinessContext(options))
}

function buildApplication(options = {}) {
    const app = express()
    const configSnapshot = options.configSnapshot || null
    const readinessProvider = options.buildReadyPayload || buildReadyPayload
    const listenPort = configSnapshot?.dashboard?.listenPort || sysConfig.dashboardPort || 3000
    const allowedOrigins = new Set([
        `http://localhost:${DASHBOARD_INGRESS_PORT}`,
        `http://127.0.0.1:${DASHBOARD_INGRESS_PORT}`,
        `http://localhost:${listenPort}`,
        `http://127.0.0.1:${listenPort}`,
        ...validateDashboardAllowedOrigins(
            configSnapshot?.dashboard?.allowedOrigins || sysConfig.dashboardAllowedOrigins || []
        )
    ])
    app.use(cors({
        origin(origin, callback) {
            callback(null, !origin || allowedOrigins.has(origin))
        }
    }))
    app.use(express.json())

    const napcatTemp = configSnapshot?.paths?.napcatTemp || sysConfig.napcatTempPath
    app.use('/qq-official-temp', express.static(path.join(napcatTemp, 'qq-official-temp'), {
        index: false,
        maxAge: '10m',
        immutable: false
    }))

    app.get('/api/live', (req, res) => {
        res.json({ live: true, uptime: process.uptime() })
    })
    app.get('/api/status', (req, res) => {
        res.json(buildStatusPayload())
    })
    app.get('/api/ready', async (req, res) => {
        try {
            const payload = await readinessProvider()
            res.status(payload.ready ? 200 : 503).json(payload)
        } catch (error) {
            res.status(503).json({
                ready: false,
                mode: process.env.BILI_UPGRADE_MODE === 'probe' ? 'upgrade-probe' : 'normal',
                error: typeof error?.code === 'string' ? error.code : 'READINESS_UNAVAILABLE'
            })
        }
    })

    app.use('/api', csrfProtection)
    app.use('/api', apiRoutes)

    const distPath = path.join(__dirname, '../../dashboard/dist')
    app.use(express.static(distPath))
    app.get(/(.*)/, (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'))
    })
    return app
}

function authenticateLogSocket(ws, req) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
    const token = url.searchParams.get('token')
    ws.logFilters = {
        level: url.searchParams.get('level') || undefined,
        channels: url.searchParams.get('channels')
            ? url.searchParams.get('channels').split(',').map((item) => item.trim()).filter(Boolean)
            : undefined,
        keyword: url.searchParams.get('keyword') || undefined
    }
    if (!token) return ws.close(1008, 'Token required')
    try {
        jwt.verify(token, sysConfig.jwtSecret)
    } catch {
        ws.close(1008, 'Authentication failed')
    }
}

function isAdmissionRecoveryRequest(req) {
    if (req.method !== 'POST' || typeof req.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//')) {
        return false
    }
    const queryIndex = req.url.indexOf('?')
    const rawPathname = queryIndex === -1 ? req.url : req.url.slice(0, queryIndex)
    if (rawPathname !== '/api/config/recover') return false
    try {
        return new URL(req.url, 'http://dashboard.invalid').pathname === '/api/config/recover'
    } catch {
        return false
    }
}

function isAdmissionLoginRequest(req) {
    return req.method === 'POST' && readStrictRequestPath(req) === '/api/login'
}

function readStrictRequestPath(req) {
    if (typeof req.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//')) return null
    const queryIndex = req.url.indexOf('?')
    const rawPathname = queryIndex === -1 ? req.url : req.url.slice(0, queryIndex)
    try {
        const parsedPathname = new URL(req.url, 'http://dashboard.invalid').pathname
        return parsedPathname === rawPathname ? rawPathname : null
    } catch {
        return null
    }
}

function isAdmissionRecoveryBootstrapRequest(req) {
    if (!['GET', 'HEAD'].includes(req.method)) return false
    const pathname = readStrictRequestPath(req)
    if (!pathname) return false
    if (pathname === '/api/config' || pathname === '/api/config/status') return true
    if (pathname === '/' || pathname === '/login' || pathname === '/settings') return true
    if (pathname === '/vite.svg' || pathname === '/favicon.ico') return true
    return /^\/assets\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(pathname)
}

function createListener(app, port, options = {}) {
    return new Promise((resolve, reject) => {
        const handle = {
            app,
            port,
            enabled: options.enabled !== false,
            server: null,
            wss: null,
            closing: false
        }
        const server = http.createServer((req, res) => {
            if (!handle.enabled) {
                res.statusCode = 503
                res.setHeader('content-type', 'application/json')
                res.end('{"error":"DASHBOARD_CANDIDATE_NOT_COMMITTED"}')
                return
            }
            const admission = applicationAdmissionGate.snapshot()
            const livenessRequest = req.method === 'GET' && req.url === '/api/live'
            if (admission.closed && !livenessRequest && !isAdmissionLoginRequest(req) && !isAdmissionRecoveryRequest(req) && !isAdmissionRecoveryBootstrapRequest(req)) {
                res.statusCode = 503
                res.setHeader('content-type', 'application/json')
                res.end(JSON.stringify({
                    error: 'APPLICATION_INGRESS_PAUSED',
                    reason: admission.reason
                }))
                return
            }
            handle.app(req, res)
        })
        const wss = new WebSocket.Server({ server, path: '/ws/logs' })
        handle.server = server
        handle.wss = wss
        wss.on('error', (error) => {
            logger.logEvent('warn', 'DASH', 'svc:lifecycle', 'websocket-server-error', {
                code: error?.code || 'DASHBOARD_WEBSOCKET_ERROR'
            })
        })
        wss.on('connection', (ws, req) => {
            if (!handle.enabled || applicationAdmissionGate.snapshot().closed) {
                return ws.close(1013, 'Dashboard admission paused')
            }
            authenticateLogSocket(ws, req)
        })
        const handleStartError = (error) => {
            wss.close(() => {})
            reject(error)
        }
        server.once('error', handleStartError)
        server.listen(port, () => {
            server.removeListener('error', handleStartError)
            server.on('error', (error) => {
                logger.logEvent('error', 'DASH', 'svc:lifecycle', 'server-error', {
                    code: error?.code || 'DASHBOARD_SERVER_ERROR'
                })
            })
            handles.add(handle)
            resolve(handle)
        })
    })
}

async function closeHandle(handle, options = {}) {
    if (!handle || handle.closing) return
    handle.closing = true
    handle.enabled = false
    const timeoutMs = Number(options.timeoutMs || 5000)
    for (const client of handle.wss?.clients || []) {
        if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
            client.close(1001, 'Dashboard shutting down')
        }
    }
    const forceTimer = setTimeout(() => {
        for (const client of handle.wss?.clients || []) client.terminate()
        handle.server?.closeAllConnections?.()
    }, timeoutMs)
    forceTimer.unref?.()
    await Promise.all([
        new Promise((resolve) => handle.wss ? handle.wss.close(() => resolve()) : resolve()),
        new Promise((resolve) => handle.server ? handle.server.close(() => resolve()) : resolve())
    ])
    clearTimeout(forceTimer)
    handles.delete(handle)
}

function ensureLogSubscription() {
    if (logUnsubscribe) return
    logUnsubscribe = logger.onLog((event) => {
        logBuffer.push(event)
        for (const handle of handles) {
            for (const client of handle.wss?.clients || []) {
                if (client.readyState === WebSocket.OPEN && matchesFilters(event, client.logFilters || {})) {
                    client.send(JSON.stringify(event))
                }
            }
        }
    })
}

async function probeDashboardApplication(app, options = {}) {
    const timeoutMs = Number(options.timeoutMs || 3000)
    const server = http.createServer(app)
    await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    const baseUrl = `http://127.0.0.1:${address.port}`
    const request = async (pathname) => {
        const response = await fetch(`${baseUrl}${pathname}`, {
            signal: AbortSignal.timeout(timeoutMs)
        })
        const body = await response.json()
        return { response, body }
    }
    try {
        const live = await request('/api/live')
        if (live.response.status !== 200 || live.body?.live !== true) {
            const error = new Error('Dashboard candidate liveness contract failed')
            error.code = 'DASHBOARD_CANDIDATE_LIVENESS_FAILED'
            throw error
        }
        const ready = await request('/api/ready')
        if (![200, 503].includes(ready.response.status) || typeof ready.body?.ready !== 'boolean') {
            const error = new Error('Dashboard candidate readiness contract failed')
            error.code = 'DASHBOARD_CANDIDATE_READINESS_FAILED'
            throw error
        }
        return true
    } finally {
        await new Promise((resolve) => server.close(() => resolve()))
    }
}

function createDashboardReloadHandler(options = {}) {
    const getActive = options.getActiveHandle || (() => activeHandle)
    const setActive = options.setActiveHandle || ((handle) => { activeHandle = handle })
    const buildCandidateApplication = options.buildApplication || ((candidate) => buildApplication({ configSnapshot: candidate }))
    const createCandidateListener = options.createListener || createListener
    const closeCandidateHandle = options.closeHandle || closeHandle
    const probeCandidate = options.probeApplication || probeDashboardApplication
    let pending = null

    return {
        id: 'dashboard-runtime',
        effects: ['dashboard'],
        ownedPaths: ['dashboard', 'paths.napcatTemp'],
        async preflight(candidate) {
            const port = Number(candidate.dashboard.listenPort)
            if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid Dashboard port')
        },
        async prepareParallel(candidate) {
            if (pending) throw new Error('Dashboard reload already pending')
            const app = buildCandidateApplication(candidate)
            await probeCandidate(app)
            const previous = getActive()
            // Keep the process/container ingress stable. A listenPort change rebuilds
            // and atomically swaps the Express application (so config-derived CORS and
            // routes update) without moving the Docker target or health endpoint.
            const port = Number(previous?.port || options.ingressPort || DASHBOARD_INGRESS_PORT)
            const samePort = Boolean(previous && previous.port === port)
            pending = {
                app,
                port,
                samePort,
                previous,
                previousApp: previous?.app || null,
                candidate: samePort ? null : await createCandidateListener(app, port, { enabled: false }),
                committed: false,
                enabled: false,
                paused: false,
                preparedRolledBack: false,
                invalidated: false,
                lifecycleListeners: []
            }
            const observedHandle = samePort ? previous : pending.candidate
            const invalidate = () => { if (pending) pending.invalidated = true }
            for (const event of ['close', 'error']) {
                observedHandle?.server?.on?.(event, invalidate)
                pending.lifecycleListeners.push({ emitter: observedHandle?.server, event, listener: invalidate })
            }
            pendingReload = pending
        },
        async pauseIngress() {
            if (pending?.previous) pending.previous.enabled = false
            if (pending) pending.paused = true
        },
        async commitHandles() {
            if (!pending) throw new Error('Dashboard reload has no prepared candidate')
            if (pending.samePort) {
                pending.previous.app = pending.app
                setActive(pending.previous)
            } else {
                setActive(pending.candidate)
            }
            pending.committed = true
        },
        async validateAdmission() {
            if (!pending?.committed) throw new Error('Dashboard candidate is not committed')
            const admitted = pending.samePort ? pending.previous : pending.candidate
            if (pending.invalidated || !admitted?.server?.listening || admitted.closing) {
                const error = new Error('Dashboard candidate listener is unavailable before admission')
                error.code = 'DASHBOARD_CANDIDATE_NOT_READY'
                throw error
            }
        },
        async enableIngress() {
            const admitted = pending.samePort ? pending.previous : pending.candidate
            admitted.enabled = true
            pending.enabled = true
        },
        finalizeAdmission() {
            if (!pending?.committed) throw new Error('Dashboard candidate is not committed')
            const admitted = pending.samePort ? pending.previous : pending.candidate
            if (pending.invalidated || !admitted?.server?.listening || admitted.closing || !admitted.app) {
                const error = new Error('Dashboard candidate listener is unavailable at final admission')
                error.code = 'DASHBOARD_CANDIDATE_NOT_READY'
                throw error
            }
        },
        async afterAdmissionOpen() {
            for (const { emitter, event, listener } of pending?.lifecycleListeners || []) {
                emitter?.removeListener?.(event, listener)
            }
            if (pending) pending.lifecycleListeners = []
        },
        async rollbackExclusive() {
            if (!pending?.committed) return
            if (pending.samePort) {
                pending.previous.app = pending.previousApp
                setActive(pending.previous)
            } else {
                pending.candidate.enabled = false
                setActive(pending.previous)
            }
            pending.committed = false
            pending.enabled = false
        },
        async rollbackPrepared() {
            if (!pending) return
            for (const { emitter, event, listener } of pending.lifecycleListeners || []) {
                emitter?.removeListener?.(event, listener)
            }
            pending.lifecycleListeners = []
            if (pending.candidate) await closeCandidateHandle(pending.candidate)
            pending.preparedRolledBack = true
            if (!pending.paused) {
                pending = null
                pendingReload = null
            }
        },
        async restorePrevious() {
            if (pending?.previous) pending.previous.enabled = true
            if (pending?.preparedRolledBack) {
                pending = null
                pendingReload = null
            }
        },
        async disposeOld() {
            if (!pending) return
            if (!pending.samePort && pending.previous) {
                await closeCandidateHandle(pending.previous)
            }
            pending = null
            pendingReload = null
        }
    }
}

function registerReloadHandler() {
    if (reloadUnregister || !sysConfig.isInitialized?.()) return
    reloadUnregister = sysConfig.registerReloadHandler(createDashboardReloadHandler())
}

async function start(port = 3000) {
    if (activeHandle) {
        if (activeHandle.port === Number(port)) return
        throw new Error('Dashboard server is already running on another port')
    }
    const app = buildApplication()
    activeHandle = await createListener(app, Number(port), { enabled: true })
    ensureLogSubscription()
    registerReloadHandler()
    logger.logEvent('info', 'DASH', 'svc:lifecycle', 'server-started', { port: Number(port) })
}

async function stop(options = {}) {
    const currentHandles = [...handles]
    activeHandle = null
    pendingReload = null
    if (reloadUnregister) {
        reloadUnregister()
        reloadUnregister = null
    }
    if (logUnsubscribe) {
        logUnsubscribe()
        logUnsubscribe = null
    }
    await Promise.all(currentHandles.map((handle) => closeHandle(handle, options)))
    logger.logEvent('info', 'DASH', 'svc:lifecycle', 'server-stopped')
}

function forceStop() {
    const currentHandles = [...handles]
    activeHandle = null
    pendingReload = null
    for (const handle of currentHandles) {
        handle.enabled = false
        handle.closing = true
        for (const client of handle.wss?.clients || []) {
            try { client.terminate() } catch { /* best effort before process exit */ }
        }
        try { handle.wss?.close?.() } catch { /* best effort before process exit */ }
        try { handle.server?.closeAllConnections?.() } catch { /* best effort before process exit */ }
        try { handle.server?.close?.() } catch { /* best effort before process exit */ }
        handles.delete(handle)
    }
    return getRuntimeStatus()
}

function getRuntimeStatus() {
    return {
        state: activeHandle?.enabled ? 'ready' : 'stopped',
        port: activeHandle?.port || null,
        listenerCount: handles.size,
        websocketClients: [...handles].reduce((total, handle) => total + (handle.wss?.clients?.size || 0), 0)
    }
}

module.exports = {
    start,
    stop,
    buildApplication,
    buildReadyPayload,
    buildDefaultReadinessContext,
    buildStatusPayload,
    buildPublicProviderStatus,
    createListener,
    isAdmissionRecoveryRequest,
    isAdmissionRecoveryBootstrapRequest,
    closeHandle,
    forceStop,
    getRuntimeStatus,
    registerReloadHandler,
    probeDashboardApplication,
    createDashboardReloadHandler
}
