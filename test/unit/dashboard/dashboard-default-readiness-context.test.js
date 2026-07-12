'use strict'

const assert = require('assert')

const sysConfig = require('../../../src/config')
const updateChecker = require('../../../src/services/subscription/updateChecker')
const serviceManager = require('../../../src/services/ServiceManager')
const qqProviderRuntime = require('../../../src/providers/qq/runtime')
const { buildDefaultReadinessContext } = require('../../../src/dashboard/server')

describe('dashboard default readiness context', () => {
    const originals = {}

    beforeEach(() => {
        originals.getConfigStatus = sysConfig.getStatus
        originals.qqProviderDescriptor = Object.getOwnPropertyDescriptor(sysConfig, 'qqProvider')
        originals.getSubscriptionStatus = updateChecker.getStatus
        originals.getOperationCounts = updateChecker.operationRegistry.getResourceCounts
        originals.isServiceHealthy = serviceManager.isServiceHealthy
        originals.getServiceResources = serviceManager.getResourceCounts
        originals.getProviderStatus = qqProviderRuntime.getProviderStatus
        originals.getProviderSlots = qqProviderRuntime.providerRuntimeManager.getStatus

        sysConfig.getStatus = () => ({
            valid: true,
            documentGeneration: 7,
            effectiveGeneration: 6,
            fingerprint: 'public-7',
            components: {}
        })
        Object.defineProperty(sysConfig, 'qqProvider', {
            configurable: true,
            enumerable: true,
            writable: true,
            value: 'official'
        })
        updateChecker.getStatus = () => ({ running: false, runtime: { ready: false } })
        updateChecker.operationRegistry.getResourceCounts = () => ({ activeOperations: 0, paused: false })
        serviceManager.isServiceHealthy = async () => true
        serviceManager.getResourceCounts = () => ({ residualChildren: 0, residualPids: [] })
        qqProviderRuntime.getProviderStatus = () => null
        qqProviderRuntime.providerRuntimeManager.getStatus = () => ({ active: null, candidate: null })
    })

    afterEach(() => {
        sysConfig.getStatus = originals.getConfigStatus
        Object.defineProperty(sysConfig, 'qqProvider', originals.qqProviderDescriptor)
        updateChecker.getStatus = originals.getSubscriptionStatus
        updateChecker.operationRegistry.getResourceCounts = originals.getOperationCounts
        serviceManager.isServiceHealthy = originals.isServiceHealthy
        serviceManager.getResourceCounts = originals.getServiceResources
        qqProviderRuntime.getProviderStatus = originals.getProviderStatus
        qqProviderRuntime.providerRuntimeManager.getStatus = originals.getProviderSlots
    })

    it('projects an idle upgrade probe as deferred provider and ready paused subscription', async () => {
        const migration = {
            checkpoint: 'probe_started',
            releaseEpoch: 'release-epoch-7',
            appliesToCommittedRuntime: false
        }
        const context = await buildDefaultReadinessContext({
            mode: 'upgrade-probe',
            getMigrationStatus: async () => migration
        })

        assert.strictEqual(context.qqProvider.id, 'official')
        assert.strictEqual(context.qqProvider.state, 'deferred')
        assert.strictEqual(context.qqProvider.releaseEpoch, 'release-epoch-7')
        assert.strictEqual(context.qqProvider.effectApplied, true)
        assert.strictEqual(context.subscription.state, 'ready')
        assert.strictEqual(context.subscription.paused, true)
        assert.strictEqual(context.subscription.observedDocumentGeneration, 7)
        assert.strictEqual(context.subscription.effectApplied, true)
    })

    it('keeps normal readiness strict when provider and subscription are not running', async () => {
        const context = await buildDefaultReadinessContext({
            mode: 'normal',
            getMigrationStatus: async () => null
        })

        assert.strictEqual(context.qqProvider.id, 'official')
        assert.strictEqual(context.qqProvider.state, 'not-ready')
        assert.strictEqual(context.subscription.state, 'not-ready')
        assert.strictEqual(context.subscription.paused, false)
        assert.strictEqual(context.subscription.effectApplied, undefined)
    })

    it('projects active generation, release epoch, candidate and cleanup state for strict readiness', async () => {
        sysConfig.getStatus = () => ({
            valid: true,
            documentGeneration: 7,
            effectiveGeneration: 7,
            fingerprint: 'public-7',
            components: {
                'qq-provider-runtime': {
                    observedDocumentGeneration: 7,
                    appliedEffectHash: 'provider-7',
                    desiredEffectHash: 'provider-7',
                    resourceGeneration: 9,
                    cleanupPending: true
                }
            }
        })
        qqProviderRuntime.getProviderStatus = () => ({
            id: 'official',
            connectionState: 'ready',
            resourceGeneration: 9,
            releaseEpoch: 'epoch-9'
        })
        qqProviderRuntime.providerRuntimeManager.getStatus = () => ({
            releaseEpoch: 'epoch-9',
            active: { providerId: 'official', generation: 9, state: 'active' },
            candidate: { providerId: 'official', generation: 10, state: 'ready' },
            cleanupPending: false
        })

        const context = await buildDefaultReadinessContext({
            mode: 'normal',
            getMigrationStatus: async () => ({ releaseEpoch: 'epoch-9' })
        })
        assert.equal(context.qqProvider.activeSlot.generation, 9)
        assert.equal(context.qqProvider.activeSlot.releaseEpoch, 'epoch-9')
        assert.equal(context.qqProvider.candidate.generation, 10)
        assert.equal(context.qqProvider.cleanupPending, true)
    })

    it('marks Python and Provider cleanup residuals as not ready', async () => {
        serviceManager.getResourceCounts = () => ({ residualChildren: 1, residualPids: [4242] })
        qqProviderRuntime.getProviderStatus = () => ({
            id: 'official',
            connectionState: 'ready',
            resourceGeneration: 9,
            releaseEpoch: 'epoch-9'
        })
        qqProviderRuntime.providerRuntimeManager.getStatus = () => ({
            releaseEpoch: 'epoch-9',
            active: { providerId: 'official', generation: 9, state: 'active' },
            candidate: null,
            residualCount: 1,
            residual: [{ providerId: 'old', generation: 8, state: 'residual' }]
        })

        const context = await buildDefaultReadinessContext({
            mode: 'normal',
            getMigrationStatus: async () => ({ releaseEpoch: 'epoch-9' })
        })
        assert.equal(context.python.state, 'not-ready')
        assert.equal(context.python.cleanupPending, true)
        assert.deepEqual(context.python.residualPids, [4242])
        assert.equal(context.qqProvider.cleanupPending, true)
        assert.equal(context.qqProvider.residual.length, 1)
    })
})
