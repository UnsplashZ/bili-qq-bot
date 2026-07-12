'use strict'

const assert = require('assert')
const request = require('supertest')
const { buildApplication } = require('../../../src/dashboard/server')

describe('dashboard public health v1', () => {
    it('keeps liveness separate from generation-aware readiness', async () => {
        const app = buildApplication({
            buildReadyPayload: async () => ({
                ready: false,
                mode: 'upgrade-probe',
                config: { valid: true, documentGeneration: 2, effectiveGeneration: 2, fingerprint: 'public' },
                migration: { checkpoint: 'probe_started', phase: 'probe' },
                dashboard: { state: 'ready', effectApplied: true },
                python: { state: 'ready', effectApplied: true },
                qqProvider: { state: 'deferred', effectApplied: true },
                subscription: { state: 'ready', paused: false, effectApplied: true }
            })
        })
        const live = await request(app).get('/api/live')
        assert.strictEqual(live.status, 200)
        assert.strictEqual(live.body.live, true)

        const ready = await request(app).get('/api/ready')
        assert.strictEqual(ready.status, 503)
        assert.strictEqual(ready.body.ready, false)
        assert.strictEqual(ready.body.mode, 'upgrade-probe')
        assert.strictEqual(ready.body.migration.checkpoint, 'probe_started')
    })

    it('returns 200 only for a ready payload', async () => {
        const app = buildApplication({
            buildReadyPayload: async () => ({ ready: true, mode: 'normal' })
        })
        const ready = await request(app).get('/api/ready')
        assert.strictEqual(ready.status, 200)
        assert.strictEqual(ready.body.ready, true)
    })
})
