'use strict'

const assert = require('assert')
const { buildReadinessPayload } = require('../../../src/dashboard/readiness')

function component(overrides = {}) {
    return {
        state: 'ready',
        observedDocumentGeneration: 3,
        appliedEffectHash: 'effect-3',
        desiredEffectHash: 'effect-3',
        resourceGeneration: 2,
        ...overrides
    }
}

function baseContext(overrides = {}) {
    return {
        mode: 'normal',
        config: {
            valid: true,
            documentGeneration: 3,
            effectiveGeneration: 2,
            fingerprint: 'public-fingerprint'
        },
        migration: {
            migrationId: 'config-v0-to-v1',
            checkpoint: 'runtime_ready',
            phase: 'complete',
            releaseEpoch: 'epoch-1',
            appliesToCommittedRuntime: true
        },
        applicationBootstrap: {
            status: 'ready',
            configSchemaVersion: 1,
            dataGeneration: 1,
            releaseEpoch: 'epoch-1'
        },
        dashboard: component(),
        python: component({ instanceId: 'python-1' }),
        qqProvider: component({
            id: 'napcat',
            releaseEpoch: 'epoch-1',
            activeSlot: { generation: 2, releaseEpoch: 'epoch-1', state: 'active' },
            candidate: null
        }),
        subscription: component({ paused: false }),
        ...overrides
    }
}

describe('dashboard readiness v1', () => {
    it('accepts final normal readiness only when generation/effect/releaseEpoch align', () => {
        const payload = buildReadinessPayload(baseContext())
        assert.strictEqual(payload.ready, true)
        assert.strictEqual(payload.config.documentGeneration, 3)
        assert.strictEqual(payload.qqProvider.releaseEpoch, 'epoch-1')

        const mismatch = buildReadinessPayload(baseContext({
            qqProvider: component({
                id: 'napcat',
                releaseEpoch: 'epoch-2',
                activeSlot: { generation: 2, releaseEpoch: 'epoch-2', state: 'active' }
            })
        }))
        assert.strictEqual(mismatch.ready, false)
    })

    it('accepts runtime_released only after provider/subscription are truly ready', () => {
        const payload = buildReadinessPayload(baseContext({
            migration: {
                checkpoint: 'runtime_released',
                phase: 'release',
                releaseEpoch: 'epoch-1',
                appliesToCommittedRuntime: true
            }
        }))
        assert.strictEqual(payload.ready, true)

        const providerNotReady = buildReadinessPayload(baseContext({
            migration: {
                checkpoint: 'runtime_released',
                phase: 'release',
                releaseEpoch: 'epoch-1',
                appliesToCommittedRuntime: true
            },
            qqProvider: component({
                id: 'napcat',
                state: 'connecting',
                releaseEpoch: 'epoch-1',
                activeSlot: { generation: 2, releaseEpoch: 'epoch-1', state: 'active' }
            })
        }))
        assert.strictEqual(providerNotReady.ready, false)
    })

    it('enforces no-consume probe provider and paused subscription predicates', () => {
        const payload = buildReadinessPayload(baseContext({
            mode: 'upgrade-probe',
            migration: {
                checkpoint: 'probe_ready',
                phase: 'probe',
                appliesToCommittedRuntime: false
            },
            qqProvider: component({ id: 'napcat', state: 'deferred', releaseEpoch: null }),
            subscription: component({ paused: true })
        }))
        assert.strictEqual(payload.ready, true)

        const consumingProvider = buildReadinessPayload(baseContext({
            mode: 'upgrade-probe',
            migration: {
                checkpoint: 'probe_ready',
                phase: 'probe',
                appliesToCommittedRuntime: false
            },
            qqProvider: component({ id: 'napcat', state: 'ready' }),
            subscription: component({ paused: true })
        }))
        assert.strictEqual(consumingProvider.ready, false)
    })

    it('does not require unrelated resource generations to equal global generation', () => {
        const payload = buildReadinessPayload(baseContext({
            python: component({ resourceGeneration: 1, instanceId: 'python-1' }),
            dashboard: component({ resourceGeneration: 1 })
        }))
        assert.strictEqual(payload.ready, true)
    })

    it('rejects provider candidates, pending cleanup, stale active generations, and unapplied effects', () => {
        const candidate = buildReadinessPayload(baseContext({
            qqProvider: component({
                id: 'napcat',
                releaseEpoch: 'epoch-1',
                activeSlot: { generation: 2, releaseEpoch: 'epoch-1' },
                candidate: { generation: 3 }
            })
        }))
        assert.strictEqual(candidate.ready, false)

        const cleanup = buildReadinessPayload(baseContext({
            qqProvider: component({
                id: 'napcat',
                releaseEpoch: 'epoch-1',
                activeSlot: { generation: 2, releaseEpoch: 'epoch-1' },
                cleanupPending: true
            })
        }))
        assert.strictEqual(cleanup.ready, false)

        const stale = buildReadinessPayload(baseContext({
            qqProvider: component({
                id: 'napcat',
                resourceGeneration: 3,
                releaseEpoch: 'epoch-1',
                activeSlot: { generation: 2, releaseEpoch: 'epoch-1' }
            })
        }))
        assert.strictEqual(stale.ready, false)

        const unapplied = buildReadinessPayload(baseContext({
            qqProvider: component({
                id: 'napcat',
                releaseEpoch: 'epoch-1',
                activeSlot: { generation: 2, releaseEpoch: 'epoch-1' },
                effectApplied: false
            })
        }))
        assert.strictEqual(unapplied.ready, false)
    })
})
