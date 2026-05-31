#!/usr/bin/env node
'use strict'

const assert = require('assert')
const express = require('express')
const request = require('supertest')
const jwt = require('jsonwebtoken')

const apiRouter = require('../../../src/dashboard/routes/api')
const config = require('../../../src/config')

function buildToken() {
    return jwt.sign(
        { role: 'admin', timestamp: Date.now() },
        config.jwtSecret,
        { expiresIn: '1h' }
    )
}

describe('Dashboard preview layout API', function () {
    let app
    let token
    let originalSave
    let originalPreviewLayoutConfig

    before(function () {
        app = express()
        app.use(express.json({ limit: '128kb' }))
        app.use('/api', apiRouter)
        token = buildToken()
    })

    beforeEach(function () {
        originalSave = config.save
        originalPreviewLayoutConfig = config.previewLayoutConfig
        config.save = () => {}
        config.previewLayoutConfig = {}
    })

    afterEach(function () {
        config.previewLayoutConfig = originalPreviewLayoutConfig
        config.save = originalSave
    })

    it('requires auth for preview layout schema', async function () {
        const res = await request(app).get('/api/preview-layout/schema')
        assert.strictEqual(res.status, 401)
    })

    it('returns schema after auth', async function () {
        const res = await request(app)
            .get('/api/preview-layout/schema')
            .set('Authorization', `Bearer ${token}`)

        assert.strictEqual(res.status, 200)
        assert.strictEqual(res.body.types.video.status, 'editable')
        assert.strictEqual(res.body.types.dynamic.status, 'planned')
    })

    it('rejects unknown preview layout fields on save', async function () {
        const res = await request(app)
            .post('/api/preview-layout/config')
            .set('Authorization', `Bearer ${token}`)
            .send({
                scope: 'global',
                type: 'video',
                patch: {
                    elements: {
                        cover: {
                            style: 'height:999px'
                        }
                    }
                }
            })

        assert.strictEqual(res.status, 400)
        assert.match(res.body.error, /unknown preview layout field/)
    })

    it('rejects invalid preview request options instead of coercing them', async function () {
        const cases = [
            {
                body: { mode: 'demo' },
                error: /mode must be link or structure/
            },
            {
                body: { mode: 'structure', cacheMode: 'always-fresh' },
                error: /cacheMode must be cached or fresh/
            },
            {
                body: { mode: 'structure', showId: 'false' },
                error: /showId must be a boolean/
            },
            {
                body: { mode: 'structure', unexpected: true },
                error: /preview layout preview request contains unknown field/
            }
        ]

        for (const item of cases) {
            const res = await request(app)
                .post('/api/preview-layout/preview')
                .set('Authorization', `Bearer ${token}`)
                .send(item.body)

            assert.strictEqual(res.status, 400)
            assert.match(res.body.error, item.error)
        }
    })

    it('rejects unknown top-level fields on config and reset requests', async function () {
        const configRes = await request(app)
            .post('/api/preview-layout/config')
            .set('Authorization', `Bearer ${token}`)
            .send({
                scope: 'global',
                type: 'video',
                patch: {},
                extra: true
            })

        assert.strictEqual(configRes.status, 400)
        assert.match(configRes.body.error, /preview layout config request contains unknown field/)

        const resetRes = await request(app)
            .post('/api/preview-layout/reset')
            .set('Authorization', `Bearer ${token}`)
            .send({
                scope: 'global',
                type: 'video',
                extra: true
            })

        assert.strictEqual(resetRes.status, 400)
        assert.match(resetRes.body.error, /preview layout reset request contains unknown field/)
    })

    it('rejects non-video config saves in the first phase', async function () {
        const res = await request(app)
            .post('/api/preview-layout/config')
            .set('Authorization', `Bearer ${token}`)
            .send({
                scope: 'global',
                type: 'dynamic',
                patch: {}
            })

        assert.strictEqual(res.status, 400)
        assert.match(res.body.error, /not editable: dynamic/)
    })

    it('rejects oversized preview layout payloads', async function () {
        const res = await request(app)
            .post('/api/preview-layout/config')
            .set('Authorization', `Bearer ${token}`)
            .send({
                scope: 'global',
                type: 'video',
                patch: {
                    elements: {
                        cover: {
                            layout: {
                                offsetX: 12
                            }
                        }
                    },
                    note: 'x'.repeat(70 * 1024)
                }
            })

        assert.strictEqual(res.status, 413)
        assert.match(res.body.error, /too large/)
    })

    it('saves and resets a single saved element without clearing siblings', async function () {
        const saveRes = await request(app)
            .post('/api/preview-layout/config')
            .set('Authorization', `Bearer ${token}`)
            .send({
                scope: 'global',
                type: 'video',
                patch: {
                    elements: {
                        cover: {
                            layout: {
                                offsetX: 12
                            }
                        },
                        title: {
                            typography: {
                                fontSize: 28
                            }
                        }
                    }
                }
            })

        assert.strictEqual(saveRes.status, 200)
        assert.strictEqual(saveRes.body.config.global.elements.cover.layout.offsetX, 12)
        assert.strictEqual(saveRes.body.config.global.elements.title.typography.fontSize, 28)

        const resetRes = await request(app)
            .post('/api/preview-layout/reset')
            .set('Authorization', `Bearer ${token}`)
            .send({
                scope: 'global',
                type: 'video',
                element: 'cover'
            })

        assert.strictEqual(resetRes.status, 200)
        assert.strictEqual(resetRes.body.config.global.elements.cover, undefined)
        assert.strictEqual(resetRes.body.config.global.elements.title.typography.fontSize, 28)
    })
})
