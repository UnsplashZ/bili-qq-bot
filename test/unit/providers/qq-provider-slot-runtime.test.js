'use strict'

const assert = require('assert')
const { EventEmitter } = require('events')
const { ProviderRuntimeManager } = require('../../../src/providers/qq/providerSlotRuntime')
const { ReloadRegistry } = require('../../../src/config/reloadRegistry')
const { ApplicationAdmissionGate } = require('../../../src/services/runtime/applicationAdmissionGate')

function provider(id, events) {
    return {
        id,
        async preflight() { events.push(`${id}:preflight`) },
        async start() { events.push(`${id}:start`) },
        async waitUntilReady() { events.push(`${id}:ready`) },
        async stop() { events.push(`${id}:stop`) }
    }
}

describe('ProviderRuntimeManager', () => {
    it('blocks Provider admission while a release epoch is armed but not released', () => {
        const manager = new ProviderRuntimeManager()
        manager.setActiveProvider({ id: 'gated' })
        manager.releaseGate.arm('epoch-gated')
        assert.throws(() => manager.acquireLease(), (error) => error.code === 'RUNTIME_ADMISSION_DISABLED')
        manager.releaseGate.release('epoch-gated')
        manager.releaseGate.enableAdmission('epoch-gated')
        const lease = manager.acquireLease()
        lease.release()
    })

    it('prepares candidates without publishing and retires old slots only after leases drain', async () => {
        const events = []
        const manager = new ProviderRuntimeManager()
        const old = manager.setActiveProvider(provider('old', events))
        const lease = manager.acquireLease()

        const candidate = await manager.prepareCandidate(provider('new', events))
        assert.strictEqual(manager.getCurrentProvider().id, 'old')
        assert.strictEqual(candidate.state, 'ready')
        const committed = manager.commitCandidate()
        assert.strictEqual(manager.getCurrentProvider().id, 'new')
        assert.strictEqual(committed.previous, old)

        const retiring = manager.retireSlot(old, { timeoutMs: 500 })
        await new Promise((resolve) => setTimeout(resolve, 10))
        assert.ok(!events.includes('old:stop'))
        lease.release()
        await retiring
        assert.ok(events.includes('old:stop'))
        assert.deepStrictEqual(events.slice(0, 3), ['new:preflight', 'new:start', 'new:ready'])
    })

    it('rolls back an unpublished candidate without changing active generation', async () => {
        const events = []
        const manager = new ProviderRuntimeManager()
        manager.setActiveProvider(provider('old', events))
        const generation = manager.generation
        await manager.prepareCandidate(provider('candidate', events))
        await manager.rollbackCandidate()
        assert.strictEqual(manager.getCurrentProvider().id, 'old')
        assert.strictEqual(manager.generation, generation)
        assert.ok(events.includes('candidate:stop'))
    })

    it('cancels token-fenced Provider flush callbacks on slot replacement and rollback', async () => {
        const manager = new ProviderRuntimeManager()
        let oldCancelled = 0
        let candidateCancelled = 0
        manager.setActiveProvider({
            id: 'old',
            cancelPendingRuntimeEvents() { oldCancelled += 1 },
            async stop() {}
        })
        manager.setActiveProvider({ id: 'replacement', async stop() {} })
        assert.equal(oldCancelled, 1)

        await manager.prepareCandidate({
            id: 'candidate',
            async start() {},
            async waitUntilReady() {},
            cancelPendingRuntimeEvents() { candidateCancelled += 1 },
            async stop() {}
        })
        await manager.rollbackCandidate()
        assert.equal(candidateCancelled, 1)
    })

    it('closes a candidate that fails readiness without publishing it', async () => {
        const events = []
        const manager = new ProviderRuntimeManager()
        manager.setActiveProvider(provider('old', events))
        const broken = provider('broken', events)
        broken.waitUntilReady = async () => {
            events.push('broken:ready-failed')
            throw new Error('not ready')
        }

        await assert.rejects(() => manager.prepareCandidate(broken), /not ready/)
        assert.equal(manager.getCurrentProvider().id, 'old')
        assert.equal(manager.candidateSlot, null)
        assert.ok(events.includes('broken:stop'))
    })

    it('rejects a candidate that disconnects after READY but before commit', async () => {
        const events = []
        const manager = new ProviderRuntimeManager()
        manager.setActiveProvider(provider('old', events))
        const candidate = Object.assign(new EventEmitter(), provider('candidate', events), {
            runtimeReady: true,
            isRuntimeReady() { return this.runtimeReady }
        })

        await manager.prepareCandidate(candidate)
        candidate.runtimeReady = false
        candidate.emit('close')

        assert.throws(
            () => manager.commitCandidate(),
            (error) => error.code === 'PROVIDER_CANDIDATE_NOT_READY'
        )
        assert.equal(manager.getCurrentProvider().id, 'old')
        await manager.rollbackCandidate()
    })

    it('runs a final provider readiness check immediately before commit', async () => {
        const events = []
        const manager = new ProviderRuntimeManager()
        manager.setActiveProvider(provider('old', events))
        const candidate = {
            ...provider('candidate', events),
            runtimeReady: true,
            isRuntimeReady() { return this.runtimeReady }
        }
        await manager.prepareCandidate(candidate)
        candidate.runtimeReady = false

        assert.throws(
            () => manager.commitCandidate(),
            (error) => error.code === 'PROVIDER_CANDIDATE_NOT_READY'
        )
        assert.equal(manager.getCurrentProvider().id, 'old')
        await manager.rollbackCandidate()
    })

    it('builds a reload handler that drains, commits, releases an epoch, and disposes old', async () => {
        const events = []
        const manager = new ProviderRuntimeManager()
        manager.setActiveProvider(provider('old', events))
        const lease = manager.acquireLease()
        const handler = manager.createReloadHandler({
            createCandidate: async () => ({ provider: provider('new', events) }),
            pauseOperations: async () => events.push('operations:pause'),
            drainOperations: async () => events.push('operations:drain'),
            activateCandidate: async ({ activeSlot }) => events.push(`activate:${activeSlot.provider.id}`),
            commitAdmission: async () => events.push('runtime-state:commit'),
            resumeOperations: async () => events.push('operations:resume')
        })
        const context = { releaseEpoch: 'epoch-provider-1' }

        await handler.preflight({}, {}, context)
        await handler.prepareParallel({}, {}, context)
        assert.equal(manager.getCurrentProvider().id, 'old')
        await handler.pauseIngress({}, {}, context)
        let drained = false
        const drain = handler.preCommitDrain({}, {}, context).then(() => { drained = true })
        await new Promise(resolve => setImmediate(resolve))
        assert.equal(drained, false)
        lease.release()
        await drain
        await handler.prepareExclusive({}, {}, context)
        await handler.commitHandles({}, {}, context)
        await handler.validateAdmission({}, {}, context)
        await handler.enableIngress({}, {}, context)
        handler.finalizeAdmission({}, {}, context)
        await handler.commitAdmission({}, {}, context)
        handler.finalizeAdmission({}, {}, context)
        await handler.afterAdmissionOpen({}, {}, context)
        await handler.postCommitDrain({}, {}, context)
        await handler.disposeOld({}, {}, context)

        assert.equal(manager.getCurrentProvider().id, 'new')
        assert.equal(manager.ingressPaused, false)
        assert.equal(manager.getStatus().releaseEpoch, 'epoch-provider-1')
        assert.equal(manager.getStatus().release.admissionEnabled, true)
        assert.ok(events.includes('old:stop'))
        assert.ok(events.includes('activate:new'))
        assert.ok(events.indexOf('operations:resume') < events.indexOf('runtime-state:commit'))
    })

    it('rejects a Provider that fails after async validation but before the admission gate opens', async () => {
        const events = []
        const manager = new ProviderRuntimeManager()
        manager.setActiveProvider(provider('old', events))
        const candidate = Object.assign(new EventEmitter(), provider('candidate', events), {
            runtimeReady: true,
            isRuntimeReady() { return this.runtimeReady }
        })
        const handler = manager.createReloadHandler({ createCandidate: async () => candidate })

        await handler.preflight({}, {}, {})
        await handler.prepareParallel({}, {}, {})
        await handler.pauseIngress({}, {}, {})
        await handler.preCommitDrain({}, {}, {})
        await handler.prepareExclusive({}, {}, {})
        await handler.commitHandles({}, {}, {})
        await handler.validateAdmission({}, {}, {})
        await handler.enableIngress({}, {}, {})
        candidate.runtimeReady = false
        candidate.emit('close')

        assert.throws(() => handler.finalizeAdmission({}, {}, {}), error => error.code === 'PROVIDER_CANDIDATE_NOT_READY')
        await handler.rollbackExclusive({}, {}, {})
        await handler.rollbackPrepared({}, {}, {})
        await handler.restorePrevious({}, {})
        assert.equal(manager.getCurrentProvider().id, 'old')
    })

    it('rolls a committed candidate back to the previous slot and release gate snapshot', async () => {
        const events = []
        const manager = new ProviderRuntimeManager()
        manager.setActiveProvider(provider('old', events))
        const handler = manager.createReloadHandler({
            createCandidate: async () => provider('new', events),
            restorePrevious: async () => events.push('external:restore'),
            resumeOperations: async () => events.push('operations:resume')
        })
        const context = { releaseEpoch: 'epoch-rollback' }

        await handler.preflight({}, {}, context)
        await handler.prepareParallel({}, {}, context)
        await handler.pauseIngress({}, {}, context)
        await handler.preCommitDrain({}, {}, context)
        await handler.prepareExclusive({}, {}, context)
        await handler.commitHandles({}, {}, context)
        assert.equal(manager.getCurrentProvider().id, 'new')

        await handler.rollbackExclusive({}, {}, context)
        await handler.rollbackPrepared({}, {}, context)
        await handler.restorePrevious({}, context)

        assert.equal(manager.getCurrentProvider().id, 'old')
        assert.equal(manager.getStatus().releaseEpoch, null)
        assert.equal(manager.ingressPaused, false)
        assert.ok(events.includes('new:stop'))
        assert.ok(events.includes('external:restore'))
    })

    it('keeps liveness observers through admission validation and reverses a post-commit failure', async () => {
        const events = []
        const manager = new ProviderRuntimeManager()
        manager.setActiveProvider(provider('old', events))
        const candidate = Object.assign(new EventEmitter(), provider('candidate', events), {
            runtimeReady: true,
            isRuntimeReady() { return this.runtimeReady }
        })
        const handler = manager.createReloadHandler({ createCandidate: async () => candidate })

        await handler.preflight({}, {}, {})
        await handler.prepareParallel({}, {}, {})
        await handler.pauseIngress({}, {}, {})
        await handler.preCommitDrain({}, {}, {})
        await handler.prepareExclusive({}, {}, {})
        await handler.commitHandles({}, {}, {})
        candidate.runtimeReady = false
        candidate.emit('error', new Error('candidate overflow'))

        await assert.rejects(
            () => handler.validateAdmission({}, {}, {}),
            error => error.code === 'PROVIDER_CANDIDATE_NOT_READY'
        )
        await handler.rollbackExclusive({}, {}, {})
        await handler.rollbackPrepared({}, {}, {})
        await handler.restorePrevious({}, {})
        assert.equal(manager.getCurrentProvider().id, 'old')
        assert.equal(manager.ingressPaused, false)
    })

    it('surfaces rollback cleanup failure and preserves the residual Provider slot for retry', async () => {
        const events = []
        const manager = new ProviderRuntimeManager()
        manager.setActiveProvider(provider('old', events))
        let stopAttempts = 0
        const candidate = provider('candidate', events)
        candidate.stop = async () => {
            stopAttempts += 1
            if (stopAttempts === 1) {
                const error = new Error('stop failed')
                error.code = 'PROVIDER_STOP_FAILED'
                throw error
            }
            events.push('candidate:stop')
        }

        await manager.prepareCandidate(candidate)
        await assert.rejects(() => manager.rollbackCandidate(), error => error.code === 'PROVIDER_STOP_FAILED')
        assert.equal(manager.getStatus().residualCount, 1)
        assert.equal(manager.getStatus().candidate.state, 'residual')

        await manager.rollbackCandidate()
        assert.equal(manager.getStatus().residualCount, 0)
        assert.equal(manager.candidateSlot, null)
    })

    it('reports old Provider disposal failure without losing the residual resource handle', async () => {
        const events = []
        const manager = new ProviderRuntimeManager()
        const old = provider('old', events)
        old.stop = async () => {
            const error = new Error('old stop failed')
            error.code = 'OLD_PROVIDER_STOP_FAILED'
            throw error
        }
        manager.setActiveProvider(old)
        const handler = manager.createReloadHandler({ createCandidate: async () => provider('new', events) })

        await handler.preflight({}, {}, {})
        await handler.prepareParallel({}, {}, {})
        await handler.pauseIngress({}, {}, {})
        await handler.preCommitDrain({}, {}, {})
        await handler.prepareExclusive({}, {}, {})
        await handler.commitHandles({}, {}, {})
        await handler.validateAdmission({}, {}, {})
        await handler.enableIngress({}, {}, {})
        await assert.rejects(() => handler.disposeOld(), error => error.code === 'OLD_PROVIDER_STOP_FAILED')
        assert.equal(manager.getStatus().residualCount, 1)
        assert.equal(manager.getStatus().residual[0].providerId, 'old')
    })

    it('reports Provider rollback cleanup failure through ReloadRegistry rollbackErrors', async () => {
        const events = []
        const manager = new ProviderRuntimeManager()
        manager.setActiveProvider(provider('old', events))
        const candidate = provider('candidate', events)
        candidate.stop = async () => {
            throw Object.assign(new Error('candidate cleanup failed'), { code: 'PROVIDER_STOP_FAILED' })
        }
        const registry = new ReloadRegistry({ admissionGate: new ApplicationAdmissionGate() })
        registry.register(manager.createReloadHandler({
            id: 'provider-fault',
            effects: ['qqProvider'],
            createCandidate: async () => candidate
        }))
        registry.register({
            id: 'later-fault',
            effects: ['qqProvider'],
            async prepareParallel() {
                throw new Error('later prepare failed')
            }
        })

        await assert.rejects(
            () => registry.prepare({
                candidate: {},
                previous: {},
                diff: [{ path: ['qq'], effects: ['qqProvider'] }]
            }),
            error => error.rollbackErrors?.some((entry) => (
                entry.handlerId === 'provider-fault' && entry.code === 'PROVIDER_STOP_FAILED'
            ))
        )
        assert.equal(manager.getStatus().residualCount, 1)
    })

    it('keeps global and local ingress, operations, and timers paused after residual rollback cleanup', async () => {
        const events = []
        const admissionGate = new ApplicationAdmissionGate()
        const manager = new ProviderRuntimeManager()
        manager.setActiveProvider(provider('old', events))
        const candidate = provider('candidate', events)
        candidate.stop = async () => {
            throw Object.assign(new Error('candidate socket remains open'), { code: 'PROVIDER_STOP_FAILED' })
        }
        let resumed = 0
        let timerStarted = 0
        const registry = new ReloadRegistry({ admissionGate })
        registry.register(manager.createReloadHandler({
            id: 'provider-residual-fence',
            effects: ['qqProvider'],
            createCandidate: async () => candidate,
            pauseOperations: async () => events.push('operations:pause'),
            resumeOperations: async () => {
                resumed += 1
                timerStarted += 1
                events.push('operations:resume')
            }
        }))
        registry.register({
            id: 'downstream-failure',
            effects: ['qqProvider'],
            async preCommitDrain() {
                throw new Error('downstream drain failed')
            }
        })

        await assert.rejects(
            () => registry.prepare({
                candidate: {},
                previous: {},
                diff: [{ path: ['qq'], effects: ['qqProvider'] }]
            }),
            error => error.rollbackErrors?.some((entry) => (
                entry.handlerId === 'provider-residual-fence' &&
                entry.code === 'PROVIDER_RESIDUAL_CLEANUP_REQUIRED'
            ))
        )

        assert.equal(manager.getStatus().residualCount, 1)
        assert.equal(manager.ingressPaused, true)
        assert.equal(admissionGate.snapshot().closed, true)
        assert.equal(resumed, 0)
        assert.equal(timerStarted, 0)
        assert.throws(() => manager.acquireLease(), error => error.code === 'PROVIDER_INGRESS_PAUSED')
        assert.deepStrictEqual(events.filter(event => event.startsWith('operations:')), ['operations:pause'])
    })

    it('defers external Provider recovery until residual candidate cleanup succeeds', async () => {
        const events = []
        const manager = new ProviderRuntimeManager()
        manager.setActiveProvider(provider('old', events))
        let candidateStops = 0
        let externalRestores = 0
        let resumes = 0
        const candidate = provider('candidate', events)
        candidate.stop = async () => {
            candidateStops += 1
            if (candidateStops === 1) {
                throw Object.assign(new Error('candidate close pending'), { code: 'CANDIDATE_CLOSE_PENDING' })
            }
        }
        const handler = manager.createReloadHandler({
            createCandidate: async () => ({ provider: candidate, prepareInExclusive: true }),
            prepareExclusive: async () => events.push('old:stopped'),
            restorePrevious: async () => {
                externalRestores += 1
                return { provider: provider('old-restored', events) }
            },
            resumeOperations: async () => { resumes += 1 }
        })

        await handler.preflight({}, {}, {})
        await handler.prepareParallel({}, {}, {})
        await handler.pauseIngress({}, {}, {})
        await handler.preCommitDrain({}, {}, {})
        await handler.prepareExclusive({}, {}, {})

        await assert.rejects(
            () => handler.rollbackExclusive({}, {}, {}),
            error => error.code === 'PROVIDER_RESIDUAL_CLEANUP_REQUIRED' &&
                error.cleanupErrors?.[0]?.code === 'CANDIDATE_CLOSE_PENDING'
        )
        assert.equal(externalRestores, 0)
        assert.equal(resumes, 0)
        assert.equal(manager.ingressPaused, true)
        assert.equal(manager.getStatus().residualCount, 1)

        await manager.retryResidualCleanup()
        await handler.restorePrevious({}, {})
        assert.equal(externalRestores, 1)
        assert.equal(resumes, 1)
        assert.equal(manager.ingressPaused, false)
        assert.equal(manager.getStatus().residualCount, 0)
        assert.equal(manager.getCurrentProvider().id, 'old-restored')
    })

    it('blocks replacement candidates until every residual slot is cleaned up', async () => {
        const events = []
        const manager = new ProviderRuntimeManager()
        let stopAttempts = 0
        const broken = provider('broken', events)
        broken.stop = async () => {
            stopAttempts += 1
            if (stopAttempts === 1) throw Object.assign(new Error('cleanup pending'), { code: 'STOP_PENDING' })
        }

        await manager.prepareCandidate(broken)
        await assert.rejects(() => manager.rollbackCandidate(), error => error.code === 'STOP_PENDING')
        await assert.rejects(
            () => manager.prepareCandidate(provider('replacement', events)),
            error => error.code === 'PROVIDER_RESIDUAL_CLEANUP_REQUIRED' && error.residualCount === 1
        )
        await manager.retryResidualCleanup()
        await manager.prepareCandidate(provider('replacement', events))
        await manager.rollbackCandidate()
        assert.equal(manager.getStatus().residualCount, 0)
    })

    it('moves failed active and candidate shutdown handles to residual state for forced retry', async () => {
        const events = []
        const manager = new ProviderRuntimeManager()
        let activeStops = 0
        const active = provider('active', events)
        active.stop = async () => {
            activeStops += 1
            if (activeStops === 1) throw Object.assign(new Error('active stop failed'), { code: 'ACTIVE_STOP_FAILED' })
        }
        manager.setActiveProvider(active)
        await manager.prepareCandidate(provider('candidate', events))

        await assert.rejects(
            () => manager.stopAll({ timeoutMs: 50 }),
            error => error.code === 'PROVIDER_RUNTIME_STOP_FAILED' && error.residualCount === 1
        )
        assert.equal(manager.activeSlot, null)
        assert.equal(manager.candidateSlot, null)
        assert.equal(manager.getStatus().residualCount, 1)

        await manager.forceCloseAll()
        assert.equal(manager.getStatus().residualCount, 0)
    })
})
