'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { EventEmitter } = require('events')
const { createDefaultConfig } = require('../../../src/config/schemaV1')
const bot = require('../../../src/bot')
const notificationService = require('../../../src/services/notificationService')
const qqRuntime = require('../../../src/providers/qq/runtime')
const NapcatProvider = require('../../../src/providers/qq/napcatProvider')
const messageHandler = require('../../../src/handlers/messageHandler')
const subscriptionService = require('../../../src/services/subscriptionService')
const { applicationAdmissionGate } = require('../../../src/services/runtime/applicationAdmissionGate')
const { ReloadRegistry } = require('../../../src/config/reloadRegistry')
const OfficialQqProvider = require('../../../src/providers/qq/officialProvider')
const { botOperationRegistry } = require('../../../src/services/runtime/botOperationRegistry')
const videoDownloadService = require('../../../src/services/videoDownloadService')
const { ConfigService } = require('../../../src/config/configService')

const fsp = fs.promises

class FakeSocket extends EventEmitter {
    constructor() {
        super()
        this.readyState = 1
    }
    send() {}
    close() { this.readyState = 3; this.emit('close', 1000, 'test') }
    terminate() { this.readyState = 3 }
}

describe('Bot QQ Provider runtime wiring', () => {
    after(async () => {
        await notificationService.stopTempImageCleanupScheduler()
        await videoDownloadService.cleanup({ drainTimeoutMs: 1000, abortDrainTimeoutMs: 1000 })
    })
    afterEach(() => {
        if (applicationAdmissionGate.snapshot().closed && applicationAdmissionGate.activeToken) {
            applicationAdmissionGate.open(applicationAdmissionGate.activeToken)
        }
    })

    it('owns the online config control server for the Bot process lifetime', async () => {
        const calls = []
        const server = {
            async start() { calls.push('start') },
            async stop() { calls.push('stop') }
        }
        await bot.__testHooks.startConfigControlServer({ server })
        await bot.__testHooks.startConfigControlServer({ server })
        await bot.__testHooks.stopConfigControlServer()
        assert.deepStrictEqual(calls, ['start', 'start', 'stop'])
    })

    it('builds an Official candidate from the candidate snapshot without publishing globals', () => {
        const snapshot = createDefaultConfig()
        snapshot.dashboard.jwtSecret = 'test-jwt-secret'
        snapshot.qq.provider = 'official'
        snapshot.qq.official.appId = 'candidate-app'
        snapshot.qq.official.clientSecret = 'candidate-secret'
        snapshot.qq.official.apiBase = 'https://candidate.invalid'

        const previousGlobal = global.bot
        global.bot = { groupList: new Map([['old-group', {}]]), selfId: 'old-self', provider: null }
        try {
            const facade = bot.__testHooks.createSnapshotFacade(snapshot)
            assert.strictEqual(facade.qqOfficialAppId, 'candidate-app')
            assert.strictEqual(facade.get('qq.official.clientSecret'), 'candidate-secret')
            assert.throws(() => { facade.qqOfficialAppId = 'mutated' }, /read-only/)

            const descriptor = bot.__testHooks.createProviderDescriptor(snapshot)
            assert.strictEqual(descriptor.provider.id, 'official')
            assert.strictEqual(descriptor.prepareInExclusive, true)
            assert.strictEqual(descriptor.supportsParallelSession, false)
            assert.strictEqual(descriptor.provider.publishGlobal, false)
            assert.strictEqual(descriptor.provider.runtimeActive, false)
            assert.strictEqual(global.bot.selfId, 'old-self')
            assert.deepStrictEqual([...global.bot.groupList.keys()], ['old-group'])
        } finally {
            global.bot = previousGlobal
        }
    })

    it('registers one token-fenced Official flush for a non-Provider reload gate', async () => {
        const snapshot = createDefaultConfig()
        snapshot.dashboard.jwtSecret = 'test-jwt-secret'
        snapshot.qq.provider = 'official'
        snapshot.qq.official.appId = 'candidate-app'
        snapshot.qq.official.clientSecret = 'candidate-secret'
        const provider = bot.__testHooks.createProviderDescriptor(snapshot).provider
        const manager = qqRuntime.providerRuntimeManager
        const saved = manager.activeSlot
        try {
            manager.setActiveProvider(provider)
            const token = applicationAdmissionGate.close('logging-reload')
            provider.onEvent({ post_type: 'meta_event' })
            provider.onEvent({ post_type: 'meta_event' })
            assert.equal(applicationAdmissionGate.snapshot().pendingOpenCallbacks, 1)
            applicationAdmissionGate.open(token)
            const nextToken = applicationAdmissionGate.close('immediate-next-reload')
            await new Promise(resolve => setImmediate(resolve))
            assert.equal(applicationAdmissionGate.snapshot().pendingOpenCallbacks, 1)
            assert.equal(provider.flushPendingRuntimeEvents(), 0)
            applicationAdmissionGate.open(nextToken)
            await new Promise(resolve => setImmediate(resolve))
            assert.equal(provider.flushPendingRuntimeEvents(), 0)
        } finally {
            provider.cancelPendingRuntimeEvents?.()
            manager.activeSlot = saved
        }
    })

    it('registers the Provider handler with the qq effect and owned path', () => {
        const handler = bot.__testHooks.createQqProviderReloadHandler()
        assert.strictEqual(handler.id, 'qq-provider-runtime')
        assert.deepStrictEqual(handler.effects, ['qqProvider'])
        assert.deepStrictEqual(handler.ownedPaths, ['qq', 'paths.napcatTemp'])
        assert.strictEqual(typeof handler.prepareParallel, 'function')
        assert.strictEqual(typeof handler.rollbackExclusive, 'function')
    })

    it('reuses the existing Provider when subscription shutdown rejects before Provider stop', async () => {
        const manager = qqRuntime.providerRuntimeManager
        const originalCreateReloadHandler = qqRuntime.createReloadHandler
        const originalSubscriptionStop = subscriptionService.stop
        const saved = {
            activeSlot: manager.activeSlot,
            residualSlots: manager.residualSlots,
            globalBot: global.bot
        }
        const provider = { id: 'official', stopCalls: 0, async stop() { this.stopCalls += 1 } }
        const slot = manager.createSlot(provider, { state: 'active' })
        let captured
        try {
            manager.activeSlot = slot
            manager.residualSlots = new Set()
            global.bot = { provider, groupList: new Map(), selfId: '1' }
            qqRuntime.createReloadHandler = (options) => { captured = options; return options }
            subscriptionService.stop = async () => {
                throw Object.assign(new Error('subscription stop failed'), { code: 'SUBSCRIPTION_STOP_FAILED' })
            }
            bot.__testHooks.createQqProviderReloadHandler()
            const snapshot = createDefaultConfig()
            snapshot.dashboard.jwtSecret = 'test-jwt-secret'
            snapshot.qq.provider = 'official'
            snapshot.qq.official.appId = 'previous-app'
            snapshot.qq.official.clientSecret = 'previous-secret'
            captured.createCandidate({ candidate: snapshot, previousSlot: slot })

            await assert.rejects(() => captured.prepareExclusive({ previousSlot: slot }), error => error.code === 'SUBSCRIPTION_STOP_FAILED')
            const restored = await captured.restorePrevious({
                previous: snapshot,
                previousSlot: slot
            })
            assert.strictEqual(restored.provider, provider)
            assert.equal(provider.stopCalls, 0)
            assert.equal(manager.getStatus().residualCount, 0)
        } finally {
            qqRuntime.createReloadHandler = originalCreateReloadHandler
            subscriptionService.stop = originalSubscriptionStop
            manager.activeSlot = saved.activeSlot
            manager.residualSlots = saved.residualSlots
            global.bot = saved.globalBot
        }
    })

    it('fails closed and tracks the original Provider when its stop partially fails', async () => {
        const manager = qqRuntime.providerRuntimeManager
        const originalCreateReloadHandler = qqRuntime.createReloadHandler
        const originalSubscriptionStop = subscriptionService.stop
        const saved = {
            activeSlot: manager.activeSlot,
            residualSlots: manager.residualSlots,
            globalBot: global.bot
        }
        const stopFailure = Object.assign(new Error('partial provider stop'), { code: 'PROVIDER_STOP_FAILED' })
        const provider = { id: 'official', async stop() { throw stopFailure } }
        const slot = manager.createSlot(provider, { state: 'active' })
        let captured
        try {
            manager.activeSlot = slot
            manager.residualSlots = new Set()
            global.bot = { provider, groupList: new Map(), selfId: '1' }
            qqRuntime.createReloadHandler = (options) => { captured = options; return options }
            subscriptionService.stop = async () => {}
            bot.__testHooks.createQqProviderReloadHandler()
            const snapshot = createDefaultConfig()
            snapshot.dashboard.jwtSecret = 'test-jwt-secret'
            snapshot.qq.provider = 'official'
            snapshot.qq.official.appId = 'previous-app'
            snapshot.qq.official.clientSecret = 'previous-secret'
            captured.createCandidate({ candidate: snapshot, previousSlot: slot })
            applicationAdmissionGate.close('provider-partial-stop-test')

            await assert.rejects(() => captured.prepareExclusive({ previousSlot: slot }), error => error === stopFailure)
            assert.equal(manager.getStatus().residualCount, 1)
            assert.strictEqual(manager.getStatus().residual[0].providerId, 'official')
            await assert.rejects(
                () => captured.restorePrevious({
                    previous: snapshot,
                    previousSlot: slot
                }),
                error => error.code === 'PROVIDER_RESIDUAL_CLEANUP_REQUIRED'
            )
            assert.strictEqual(manager.activeSlot.provider, provider)
            assert.strictEqual(applicationAdmissionGate.snapshot().closed, true)
        } finally {
            if (applicationAdmissionGate.snapshot().closed && applicationAdmissionGate.activeToken) {
                applicationAdmissionGate.open(applicationAdmissionGate.activeToken)
            }
            qqRuntime.createReloadHandler = originalCreateReloadHandler
            subscriptionService.stop = originalSubscriptionStop
            manager.activeSlot = saved.activeSlot
            manager.residualSlots = saved.residualSlots
            global.bot = saved.globalBot
        }
    })

    it('does not create a second Official session when candidate cleanup fails after READY', async () => {
        const manager = qqRuntime.providerRuntimeManager
        const previousSnapshot = createDefaultConfig()
        previousSnapshot.dashboard.jwtSecret = 'previous-jwt-secret'
        previousSnapshot.qq.provider = 'official'
        previousSnapshot.qq.official.appId = 'previous-app'
        previousSnapshot.qq.official.clientSecret = 'previous-secret'
        const candidateSnapshot = structuredClone(previousSnapshot)
        candidateSnapshot.qq.official.appId = 'candidate-app'
        candidateSnapshot.qq.official.clientSecret = 'candidate-secret'

        const saved = {
            activeSlot: manager.activeSlot,
            candidateSlot: manager.candidateSlot,
            residualSlots: manager.residualSlots,
            generation: manager.generation,
            ingressPaused: manager.ingressPaused,
            release: manager.releaseGate.snapshot(),
            globalBot: global.bot,
            subscriptionStop: subscriptionService.stop,
            subscriptionStart: subscriptionService.start,
            officialPreflight: OfficialQqProvider.prototype.preflight,
            officialStart: OfficialQqProvider.prototype.start,
            officialReady: OfficialQqProvider.prototype.waitUntilReady,
            officialRuntimeReady: OfficialQqProvider.prototype.isRuntimeReady,
            officialStop: OfficialQqProvider.prototype.stop,
            downloadStart: videoDownloadService.startCleanupScheduler,
            botPaused: botOperationRegistry.getResourceCounts().paused,
            subscriptionPaused: subscriptionService.getOperationStatus().paused,
            downloadPaused: videoDownloadService.getResourceCounts().paused
        }
        let oldStopCount = 0
        let providerFactoryCount = 0
        let providerStartCount = 0
        let candidateStopCount = 0
        let subscriptionStartCount = 0
        let downloadTimerStartCount = 0
        const oldProvider = {
            id: 'official',
            deactivateGlobal() {},
            async stop() { oldStopCount += 1 }
        }
        const admissionGate = new (applicationAdmissionGate.constructor)()
        try {
            manager.activeSlot = manager.createSlot(oldProvider, { state: 'active', generation: 1 })
            manager.candidateSlot = null
            manager.residualSlots = new Set()
            manager.generation = 1
            manager.ingressPaused = false
            manager.releaseGate.reset()
            global.bot = { provider: oldProvider, groupList: new Map(), selfId: 'previous-app' }

            subscriptionService.stop = async () => {}
            subscriptionService.start = async () => { subscriptionStartCount += 1 }
            videoDownloadService.startCleanupScheduler = () => { downloadTimerStartCount += 1 }
            OfficialQqProvider.prototype.preflight = async function preflight() {}
            OfficialQqProvider.prototype.start = async function start() {
                providerStartCount += 1
                this.state = 'ready'
                return this
            }
            OfficialQqProvider.prototype.waitUntilReady = async function waitUntilReady() { return this }
            OfficialQqProvider.prototype.isRuntimeReady = function isRuntimeReady() { return true }
            OfficialQqProvider.prototype.stop = async function stop() {
                candidateStopCount += 1
                throw Object.assign(new Error('candidate gateway remains open'), {
                    code: 'OFFICIAL_CANDIDATE_CLOSE_FAILED'
                })
            }

            const registry = new ReloadRegistry({ admissionGate })
            registry.register(bot.__testHooks.createQqProviderReloadHandler({
                createDescriptor(snapshot, options) {
                    providerFactoryCount += 1
                    return bot.__testHooks.createProviderDescriptor(snapshot, options)
                }
            }))
            registry.register({
                id: 'official-sequential-fault',
                effects: ['qqProvider'],
                async prepareExclusive() {
                    throw Object.assign(new Error('failure after Official candidate READY'), {
                        code: 'AFTER_READY_FAILED'
                    })
                }
            })

            await assert.rejects(
                () => registry.prepare({
                    candidate: candidateSnapshot,
                    previous: previousSnapshot,
                    diff: [{ path: ['qq', 'official', 'clientSecret'], effects: ['qqProvider'] }]
                }),
                error => error.cause?.code === 'AFTER_READY_FAILED' &&
                    error.rollbackErrors?.some(entry => (
                        entry.handlerId === 'qq-provider-runtime' &&
                        entry.code === 'PROVIDER_RESIDUAL_CLEANUP_REQUIRED'
                    ))
            )

            assert.equal(oldStopCount, 1)
            assert.equal(providerFactoryCount, 1)
            assert.equal(providerStartCount, 1)
            assert.ok(candidateStopCount >= 1)
            assert.equal(subscriptionStartCount, 0)
            assert.equal(downloadTimerStartCount, 0)
            assert.equal(manager.getStatus().residualCount, 1)
            assert.equal(manager.ingressPaused, true)
            assert.equal(admissionGate.snapshot().closed, true)
            assert.equal(botOperationRegistry.getResourceCounts().paused, true)
            assert.equal(subscriptionService.getOperationStatus().paused, true)
            assert.equal(videoDownloadService.getResourceCounts().paused, true)
            assert.throws(() => manager.acquireLease(), error => error.code === 'PROVIDER_INGRESS_PAUSED')
        } finally {
            subscriptionService.stop = saved.subscriptionStop
            subscriptionService.start = saved.subscriptionStart
            videoDownloadService.startCleanupScheduler = saved.downloadStart
            OfficialQqProvider.prototype.preflight = saved.officialPreflight
            OfficialQqProvider.prototype.start = saved.officialStart
            OfficialQqProvider.prototype.waitUntilReady = saved.officialReady
            OfficialQqProvider.prototype.isRuntimeReady = saved.officialRuntimeReady
            OfficialQqProvider.prototype.stop = saved.officialStop
            if (saved.botPaused) botOperationRegistry.pause('restored-test-state')
            else botOperationRegistry.resume()
            if (saved.subscriptionPaused) subscriptionService.pauseOperations('restored-test-state')
            else subscriptionService.resumeOperations()
            if (saved.downloadPaused) videoDownloadService.pauseOperations('restored-test-state')
            else videoDownloadService.resumeOperations()
            manager.activeSlot = saved.activeSlot
            manager.candidateSlot = saved.candidateSlot
            manager.residualSlots = saved.residualSlots
            manager.generation = saved.generation
            manager.ingressPaused = saved.ingressPaused
            manager.releaseGate.restore(saved.release)
            global.bot = saved.globalBot
        }
    })

    it('recovers a failed Official cutover through ConfigService with one token-fenced old Provider rebuild', async () => {
        const manager = qqRuntime.providerRuntimeManager
        const gate = new (applicationAdmissionGate.constructor)()
        const reloadRegistry = new ReloadRegistry({ admissionGate: gate })
        const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'bili-provider-recovery-'))
        const previousSnapshot = createDefaultConfig()
        previousSnapshot.dashboard.jwtSecret = 'previous-jwt-secret'
        previousSnapshot.qq.provider = 'official'
        previousSnapshot.qq.official.appId = 'previous-app'
        previousSnapshot.qq.official.clientSecret = 'previous-secret'
        const service = new ConfigService({
            configDir: path.join(root, 'config'),
            stateDir: path.join(root, 'data', 'config-state'),
            reloadRegistry
        })
        const saved = {
            activeSlot: manager.activeSlot,
            candidateSlot: manager.candidateSlot,
            residualSlots: manager.residualSlots,
            pendingExternalRestore: manager.pendingExternalRestore,
            cleanupGeneration: manager.residualCleanupGeneration,
            generation: manager.generation,
            ingressPaused: manager.ingressPaused,
            release: manager.releaseGate.snapshot(),
            globalBot: global.bot,
            subscriptionStop: subscriptionService.stop,
            subscriptionStart: subscriptionService.start,
            subscriptionUpdate: subscriptionService.updateCheckInterval,
            officialPreflight: OfficialQqProvider.prototype.preflight,
            officialStart: OfficialQqProvider.prototype.start,
            officialReady: OfficialQqProvider.prototype.waitUntilReady,
            officialRuntimeReady: OfficialQqProvider.prototype.isRuntimeReady,
            officialStop: OfficialQqProvider.prototype.stop,
            downloadStart: videoDownloadService.startCleanupScheduler,
            botPaused: botOperationRegistry.getResourceCounts().paused,
            subscriptionPaused: subscriptionService.getOperationStatus().paused,
            downloadPaused: videoDownloadService.getResourceCounts().paused
        }
        const factoryCounts = { candidate: 0, previous: 0 }
        const startCounts = { candidate: 0, previous: 0 }
        let candidateStopCount = 0
        let subscriptionTimerRunning = false
        let downloadTimerRunning = false
        const oldProvider = {
            id: 'official',
            deactivateGlobal() {},
            async stop() {}
        }
        try {
            await service.initialize({ createIfMissing: true, initialConfig: previousSnapshot, watch: false })
            manager.activeSlot = manager.createSlot(oldProvider, { state: 'active', generation: 1 })
            manager.candidateSlot = null
            manager.residualSlots = new Set()
            manager.pendingExternalRestore = null
            manager.residualCleanupGeneration = 0
            manager.generation = 1
            manager.ingressPaused = false
            manager.releaseGate.reset()
            global.bot = { provider: oldProvider, groupList: new Map(), selfId: 'previous-app' }

            subscriptionService.stop = async () => { subscriptionTimerRunning = false }
            subscriptionService.start = async () => {
                subscriptionTimerRunning = true
                subscriptionService.resumeOperations()
            }
            subscriptionService.updateCheckInterval = () => {}
            videoDownloadService.startCleanupScheduler = () => { downloadTimerRunning = true }
            OfficialQqProvider.prototype.preflight = async function preflight() {}
            OfficialQqProvider.prototype.start = async function start() {
                const kind = this.config.qqOfficialAppId === 'previous-app' ? 'previous' : 'candidate'
                startCounts[kind] += 1
                this.state = 'ready'
                return this
            }
            OfficialQqProvider.prototype.waitUntilReady = async function waitUntilReady() { return this }
            OfficialQqProvider.prototype.isRuntimeReady = function isRuntimeReady() { return true }
            OfficialQqProvider.prototype.stop = async function stop() {
                if (this.config.qqOfficialAppId !== 'candidate-app') return
                candidateStopCount += 1
                if (candidateStopCount <= 3) {
                    throw Object.assign(new Error('candidate gateway remains open'), {
                        code: 'OFFICIAL_CANDIDATE_CLOSE_FAILED'
                    })
                }
                this.state = 'stopped'
            }

            service.registerReloadHandler(bot.__testHooks.createQqProviderReloadHandler({
                createDescriptor(snapshot, options) {
                    const kind = snapshot.qq.official.appId === 'previous-app' ? 'previous' : 'candidate'
                    factoryCounts[kind] += 1
                    const descriptor = bot.__testHooks.createProviderDescriptor(snapshot, options)
                    descriptor.provider.commitSharedState = () => descriptor.provider.getSharedState()
                    return descriptor
                }
            }))
            service.registerReloadHandler({
                id: 'official-after-ready-fault',
                effects: ['qqProvider'],
                async prepareExclusive() {
                    throw Object.assign(new Error('failure after Official candidate READY'), {
                        code: 'AFTER_READY_FAILED'
                    })
                }
            })

            await assert.rejects(
                () => service.patch([{
                    op: 'set',
                    path: ['qq', 'official', 'appId'],
                    value: 'candidate-app'
                }, {
                    op: 'set',
                    path: ['qq', 'official', 'clientSecret'],
                    value: 'candidate-secret'
                }]),
                error => error.cause?.code === 'AFTER_READY_FAILED'
            )
            assert.equal(service.getStatus().recoveryRequired.required, true)
            assert.equal(gate.snapshot().closed, true)
            assert.equal(factoryCounts.candidate, 1)
            assert.equal(startCounts.candidate, 1)
            assert.equal(factoryCounts.previous, 0)

            await assert.rejects(
                () => service.recover({ source: 'test-cleanup-failure' }),
                error => error.code === 'PROVIDER_RESIDUAL_CLEANUP_FAILED'
            )
            assert.equal(candidateStopCount, 3)
            assert.equal(factoryCounts.previous, 0)
            assert.equal(startCounts.previous, 0)
            assert.equal(subscriptionTimerRunning, false)
            assert.equal(downloadTimerRunning, false)
            assert.equal(service.getStatus().recoveryRequired.required, true)
            assert.equal(gate.snapshot().closed, true)
            assert.equal(manager.ingressPaused, true)

            const recovery = await service.recover({ source: 'test-retry' })
            assert.equal(recovery.recovered, true)
            assert.deepStrictEqual(recovery.handlers, ['qq-provider-runtime'])
            assert.equal(candidateStopCount, 4)
            assert.equal(factoryCounts.previous, 1)
            assert.equal(startCounts.previous, 1)
            assert.equal(service.get('qq.official.clientSecret'), 'previous-secret')
            assert.equal(service.getStatus().recoveryRequired, null)
            assert.equal(gate.snapshot().closed, false)
            assert.equal(manager.ingressPaused, false)
            assert.equal(manager.getStatus().residualCount, 0)
            assert.equal(manager.pendingExternalRestore, null)
            assert.equal(manager.getCurrentProvider().config.qqOfficialAppId, 'previous-app')
            assert.strictEqual(global.bot.provider, manager.getCurrentProvider())
            assert.equal(subscriptionTimerRunning, true)
            assert.equal(downloadTimerRunning, true)
            assert.equal(botOperationRegistry.getResourceCounts().paused, false)
            assert.equal(subscriptionService.getOperationStatus().paused, false)
            assert.equal(videoDownloadService.getResourceCounts().paused, false)
        } finally {
            await service.stop().catch(() => {})
            await fsp.rm(root, { recursive: true, force: true })
            subscriptionService.stop = saved.subscriptionStop
            subscriptionService.start = saved.subscriptionStart
            subscriptionService.updateCheckInterval = saved.subscriptionUpdate
            videoDownloadService.startCleanupScheduler = saved.downloadStart
            OfficialQqProvider.prototype.preflight = saved.officialPreflight
            OfficialQqProvider.prototype.start = saved.officialStart
            OfficialQqProvider.prototype.waitUntilReady = saved.officialReady
            OfficialQqProvider.prototype.isRuntimeReady = saved.officialRuntimeReady
            OfficialQqProvider.prototype.stop = saved.officialStop
            if (saved.botPaused) botOperationRegistry.pause('restored-test-state')
            else botOperationRegistry.resume()
            if (saved.subscriptionPaused) subscriptionService.pauseOperations('restored-test-state')
            else subscriptionService.resumeOperations()
            if (saved.downloadPaused) videoDownloadService.pauseOperations('restored-test-state')
            else videoDownloadService.resumeOperations()
            manager.activeSlot = saved.activeSlot
            manager.candidateSlot = saved.candidateSlot
            manager.residualSlots = saved.residualSlots
            manager.pendingExternalRestore = saved.pendingExternalRestore
            manager.residualCleanupGeneration = saved.cleanupGeneration
            manager.generation = saved.generation
            manager.ingressPaused = saved.ingressPaused
            manager.releaseGate.restore(saved.release)
            global.bot = saved.globalBot
        }
    })

    it('defers Official COW publication to commitAdmission and exposes rollback before gate open', () => {
        const originalCreateReloadHandler = qqRuntime.createReloadHandler
        const previousSharedState = qqRuntime.providerRuntimeManager.sharedState
        let captured = null
        const events = []
        const committedState = { idStore: {}, messageIdStore: {} }
        const provider = {
            id: 'official',
            commitSharedState() { events.push('cow:commit'); return committedState },
            rollbackSharedStateCommit() { events.push('cow:rollback') },
            finalizeSharedStateCommit() { events.push('cow:finalize') },
            activateGlobal() { events.push('global:activate') }
        }
        try {
            qqRuntime.createReloadHandler = (options) => {
                captured = options
                return options
            }
            bot.__testHooks.createQqProviderReloadHandler()
            assert.ok(captured)
            assert.equal(typeof captured.commitAdmission, 'function')
            assert.equal(typeof captured.rollbackAdmission, 'function')
            assert.deepEqual(events, [])

            captured.commitAdmission({ activeSlot: { provider } })
            assert.deepEqual(events, ['cow:commit', 'global:activate'])
            assert.strictEqual(qqRuntime.providerRuntimeManager.sharedState, committedState)
            captured.rollbackAdmission({ activeSlot: { provider } })
            captured.afterAdmissionOpen({ activeSlot: { provider } })
            assert.deepEqual(events, ['cow:commit', 'global:activate', 'cow:rollback', 'cow:finalize'])
        } finally {
            qqRuntime.createReloadHandler = originalCreateReloadHandler
            qqRuntime.providerRuntimeManager.sharedState = previousSharedState
        }
    })

    it('awaits subscription readiness and propagates Provider cutover startup errors', async () => {
        const originalStart = subscriptionService.start
        const originalUpdate = subscriptionService.updateCheckInterval
        let releaseStart
        subscriptionService.updateCheckInterval = () => {}
        try {
            subscriptionService.start = () => new Promise((resolve) => { releaseStart = resolve })
            let settled = false
            const starting = bot.__testHooks.startActiveProviderRuntime({ id: 'official' }, createDefaultConfig(), {
                throwOnSubscriptionError: true
            }).then(() => { settled = true })
            await new Promise(resolve => setImmediate(resolve))
            assert.equal(settled, false)
            releaseStart()
            await starting

            subscriptionService.start = async () => {
                const error = new Error('subscription READY failed')
                error.code = 'SUBSCRIPTION_RUNTIME_START_FAILED'
                throw error
            }
            await assert.rejects(
                () => bot.__testHooks.startActiveProviderRuntime({ id: 'official' }, createDefaultConfig(), {
                    throwOnSubscriptionError: true
                }),
                error => error.code === 'SUBSCRIPTION_RUNTIME_START_FAILED'
            )
        } finally {
            subscriptionService.start = originalStart
            subscriptionService.updateCheckInterval = originalUpdate
        }
    })

    it('fails closed before Provider construction when the runtime release marker is not committed', async () => {
        const gate = qqRuntime.providerRuntimeManager.releaseGate
        const before = gate.snapshot()
        gate.reset()
        try {
            await assert.rejects(
                bot.__testHooks.armCurrentReleaseEpoch({
                    getMigrationStatus: async () => ({ checkpoint: 'probe_ready', releaseEpoch: 'epoch-before-marker' })
                }),
                (error) => error.code === 'RUNTIME_RELEASE_MARKER_REQUIRED'
            )
            for (const code of ['ENOENT', 'MIGRATION_STATUS_FILE_UNSAFE', 'EACCES', 'MIGRATION_MANIFEST_INVALID']) {
                await assert.rejects(
                    bot.__testHooks.armCurrentReleaseEpoch({
                        getMigrationStatus: async () => {
                            const error = new Error(code)
                            error.code = code
                            throw error
                        }
                    }),
                    (error) => error.code === 'RUNTIME_RELEASE_MARKER_REQUIRED' && error.cause?.code === code
                )
            }
            assert.strictEqual(gate.snapshot().epoch, null)

            const epoch = await bot.__testHooks.armCurrentReleaseEpoch({
                getMigrationStatus: async () => ({ checkpoint: 'runtime_released', releaseEpoch: 'epoch-committed' })
            })
            assert.strictEqual(epoch, 'epoch-committed')
            assert.strictEqual(gate.snapshot().admissionEnabled, false)
        } finally {
            gate.restore(before)
        }
    })

    it('aggregates Official probe and stop failures and retains the cleanup handle', async () => {
        const manager = qqRuntime.providerRuntimeManager
        const savedProbe = manager.probeStatus
        const savedResidual = manager.residualSlots
        manager.residualSlots = new Set()
        const preflightFailure = Object.assign(new Error('probe failed'), { code: 'PROBE_FAILED' })
        const stopFailure = Object.assign(new Error('stop failed'), { code: 'STOP_FAILED' })
        const provider = {
            id: 'official',
            async preflight() { throw preflightFailure },
            async stop() { throw stopFailure }
        }
        try {
            await assert.rejects(
                () => bot.__testHooks.preflightSelectedProvider({
                    snapshot: { qq: { provider: 'official' } },
                    createProvider: () => provider
                }),
                error => error.code === 'OFFICIAL_PREFLIGHT_AND_CLEANUP_FAILED' &&
                    error.preflightError === preflightFailure &&
                    error.cleanupErrors?.[0] === stopFailure
            )
            assert.equal(manager.getStatus().residualCount, 1)
            assert.equal(manager.probeStatus.state, 'cleanup-pending')
        } finally {
            manager.residualSlots = savedResidual
            manager.probeStatus = savedProbe
        }
    })

    it('fails an otherwise successful Official probe when its temporary Provider cannot stop', async () => {
        const manager = qqRuntime.providerRuntimeManager
        const savedProbe = manager.probeStatus
        const savedResidual = manager.residualSlots
        manager.residualSlots = new Set()
        const stopFailure = Object.assign(new Error('stop failed'), { code: 'STOP_FAILED' })
        try {
            await assert.rejects(
                () => bot.__testHooks.preflightSelectedProvider({
                    snapshot: { qq: { provider: 'official' } },
                    createProvider: () => ({
                        id: 'official',
                        async preflight() {},
                        async stop() { throw stopFailure }
                    })
                }),
                error => error.code === 'OFFICIAL_PREFLIGHT_CLEANUP_FAILED' &&
                    error.cleanupErrors?.[0] === stopFailure
            )
            assert.equal(manager.getStatus().residualCount, 1)
            assert.equal(manager.probeStatus.state, 'cleanup-pending')
        } finally {
            manager.residualSlots = savedResidual
            manager.probeStatus = savedProbe
        }
    })

    it('ignores stale NapCat events after the active slot changes', async () => {
        const manager = qqRuntime.providerRuntimeManager
        const saved = {
            activeSlot: manager.activeSlot,
            candidateSlot: manager.candidateSlot,
            generation: manager.generation,
            ingressPaused: manager.ingressPaused,
            release: manager.releaseGate.snapshot(),
            handleMessage: messageHandler.handleMessage,
            globalBot: global.bot
        }
        const oldSocket = new FakeSocket()
        const newSocket = new FakeSocket()
        const oldProvider = new NapcatProvider(oldSocket)
        const newProvider = new NapcatProvider(newSocket)
        let handled = 0
        messageHandler.handleMessage = async () => { handled += 1 }
        manager.releaseGate.reset()
        manager.activeSlot = null
        manager.candidateSlot = null
        manager.generation = 0
        manager.ingressPaused = false
        global.bot = { groupList: new Map(), selfId: '1' }

        try {
            manager.setActiveProvider(oldProvider)
            bot.createWebSocketConnection({ ws: oldSocket, provider: oldProvider, startRuntime: false, registerRuntime: false })
            manager.setActiveProvider(newProvider)
            bot.createWebSocketConnection({ ws: newSocket, provider: newProvider, startRuntime: false, registerRuntime: false })

            oldSocket.emit('message', JSON.stringify({
                post_type: 'message',
                message_type: 'group',
                group_id: 1000,
                user_id: 42,
                message_id: 7,
                raw_message: 'stale'
            }))
            await new Promise(resolve => setImmediate(resolve))
            assert.strictEqual(handled, 0)

            const gateToken = applicationAdmissionGate.close('non-provider-config-reload')
            newSocket.emit('message', JSON.stringify({
                post_type: 'message',
                message_type: 'group',
                group_id: 1000,
                user_id: 42,
                message_id: 8,
                raw_message: 'buffered'
            }))
            await new Promise(resolve => setImmediate(resolve))
            assert.strictEqual(handled, 0)
            assert.strictEqual(applicationAdmissionGate.snapshot().pendingOpenCallbacks, 1)
            applicationAdmissionGate.open(gateToken)
            await new Promise(resolve => setImmediate(resolve))
            assert.strictEqual(handled, 1)
            assert.strictEqual(newProvider.flushPendingRuntimeEvents(), 0)
        } finally {
            messageHandler.handleMessage = saved.handleMessage
            manager.activeSlot = saved.activeSlot
            manager.candidateSlot = saved.candidateSlot
            manager.generation = saved.generation
            manager.ingressPaused = saved.ingressPaused
            manager.releaseGate.restore(saved.release)
            global.bot = saved.globalBot
            bot.__testHooks.resetRuntimeState()
        }
    })

    it('buffers NapCat candidate inbound from socket creation and atomically hands it to the active runtime', async () => {
        const manager = qqRuntime.providerRuntimeManager
        const socket = new FakeSocket()
        const provider = new NapcatProvider(socket)
        const saved = {
            activeSlot: manager.activeSlot,
            candidateSlot: manager.candidateSlot,
            generation: manager.generation,
            ingressPaused: manager.ingressPaused,
            globalBot: global.bot
        }
        let handled = 0
        const originalHandle = messageHandler.handleMessage
        messageHandler.handleMessage = async () => { handled += 1 }
        global.bot = { groupList: new Map(), selfId: '1' }
        try {
            bot.__testHooks.attachNapcatPrecommitBuffer(socket, provider)
            socket.emit('message', JSON.stringify({
                post_type: 'message',
                message_type: 'group',
                group_id: 1000,
                user_id: 42,
                message_id: 9,
                raw_message: 'precommit'
            }))
            manager.setActiveProvider(provider)
            bot.createWebSocketConnection({ ws: socket, provider, startRuntime: false, registerRuntime: false })
            await new Promise(resolve => setImmediate(resolve))
            assert.equal(handled, 1)

            const overflowSocket = new FakeSocket()
            const overflowProvider = new NapcatProvider(overflowSocket)
            const controller = bot.__testHooks.attachNapcatPrecommitBuffer(overflowSocket, overflowProvider)
            for (let index = 0; index <= 1000; index += 1) overflowSocket.emit('message', '{}')
            assert.throws(() => controller.assertHealthy(), error => error.code === 'PROVIDER_EVENT_BUFFER_OVERFLOW')
            controller.cancel()
        } finally {
            messageHandler.handleMessage = originalHandle
            manager.activeSlot = saved.activeSlot
            manager.candidateSlot = saved.candidateSlot
            manager.generation = saved.generation
            manager.ingressPaused = saved.ingressPaused
            global.bot = saved.globalBot
            bot.__testHooks.resetRuntimeState()
        }
    })
})
