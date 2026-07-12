'use strict'

const assert = require('assert')
const express = require('express')
const request = require('supertest')

const { createBlacklistRouter } = require('../../../src/dashboard/routes/api/modules/blacklist')

function createConfigStub() {
    let generation = 8
    let blacklist = ['10001', '10002']
    const calls = []
    return {
        calls,
        service: {
            toPublicError(error) {
                return { code: error?.code || 'CONFIG_ERROR', path: '', line: null, column: null }
            }
        },
        getSnapshot() {
            return { blacklistedQQs: [...blacklist] }
        },
        getStatus() {
            return {
                documentGeneration: generation,
                effectiveGeneration: generation,
                fingerprint: `public-${generation}`
            }
        },
        async patch(operations, options) {
            if (options.expectedGeneration !== generation) {
                const error = new Error('generation conflict')
                error.code = 'CONFIG_GENERATION_CONFLICT'
                error.conflictPaths = []
                throw error
            }
            calls.push({ operations: structuredClone(operations), options: { ...options } })
            blacklist = [...operations[0].value]
            generation += 1
            return {
                origin: options.actor,
                documentGeneration: generation,
                effectiveGeneration: generation,
                generation,
                applied: ['blacklistedQQs'],
                reloaded: [],
                deploymentApplyRequired: [],
                warnings: []
            }
        }
    }
}

describe('Dashboard blacklist ConfigService transaction API', () => {
    let config
    let app

    beforeEach(() => {
        config = createConfigStub()
        app = express()
        app.use(express.json())
        app.use(createBlacklistRouter({ config }))
    })

    it('GET normalizes without mutating configuration', async () => {
        const response = await request(app).get('/blacklist/global')
        assert.strictEqual(response.status, 200)
        assert.deepStrictEqual(response.body, ['10001', '10002'])
        assert.strictEqual(config.calls.length, 0)
    })

    it('adds and removes through expected-generation patch operations', async () => {
        const added = await request(app)
            .post('/blacklist/global')
            .send({ qq: '10003', expectedGeneration: 8 })
        assert.strictEqual(added.status, 200)
        assert.strictEqual(added.body.documentGeneration, 9)
        assert.deepStrictEqual(added.body.blacklist, ['10001', '10002', '10003'])
        assert.deepStrictEqual(config.calls[0], {
            operations: [{ op: 'set', path: ['blacklistedQQs'], value: ['10001', '10002', '10003'] }],
            options: { actor: 'dashboard', expectedGeneration: 8 }
        })

        const removed = await request(app)
            .delete('/blacklist/global/10001')
            .send({ expectedGeneration: 9 })
        assert.strictEqual(removed.status, 200)
        assert.strictEqual(removed.body.documentGeneration, 10)
        assert.deepStrictEqual(removed.body.blacklist, ['10002', '10003'])
        assert.deepStrictEqual(config.calls[1].operations, [
            { op: 'set', path: ['blacklistedQQs'], value: ['10002', '10003'] }
        ])
    })

    it('keeps idempotent mutations read-only but still checks generation', async () => {
        const duplicate = await request(app)
            .post('/blacklist/global')
            .send({ qq: '10001', expectedGeneration: 8 })
        assert.strictEqual(duplicate.status, 200)
        assert.strictEqual(duplicate.body.documentGeneration, 8)
        assert.strictEqual(config.calls.length, 0)

        const conflict = await request(app)
            .delete('/blacklist/global/99999')
            .send({ expectedGeneration: 7 })
        assert.strictEqual(conflict.status, 409)
        assert.strictEqual(conflict.body.code, 'CONFIG_GENERATION_CONFLICT')
        assert.strictEqual(conflict.body.generation, 8)
    })

    it('rejects missing expectedGeneration', async () => {
        const response = await request(app).post('/blacklist/global').send({ qq: '10003' })
        assert.strictEqual(response.status, 400)
        assert.strictEqual(response.body.code, 'CONFIG_EXPECTED_GENERATION_REQUIRED')
        assert.strictEqual(config.calls.length, 0)
    })

    it('accepts safe Official identifiers and rejects unsafe values', async () => {
        const opaque = await request(app)
            .post('/blacklist/global')
            .send({ qq: 'openid_abc-123', expectedGeneration: 8 })
        assert.strictEqual(opaque.status, 200)
        assert.ok(opaque.body.blacklist.includes('openid_abc-123'))

        const unsafe = await request(app)
            .post('/blacklist/global')
            .send({ qq: 'bad/id', expectedGeneration: 9 })
        assert.strictEqual(unsafe.status, 400)
        assert.strictEqual(unsafe.body.error, 'Missing QQ number')
    })
})
