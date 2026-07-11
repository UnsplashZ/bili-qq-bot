#!/usr/bin/env node
'use strict'

const assert = require('assert')
const express = require('express')
const request = require('supertest')
const jwt = require('jsonwebtoken')

const apiRouter = require('../../../src/dashboard/routes/api')
const config = require('../../../src/config')
const { getDefaultTemplate } = require('../../../src/services/previewTemplate/defaults')

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
    let suiteOriginalSave
    let originalPreviewLayoutConfig
    let originalJwtSecret
    let originalPatch
    let originalGetSnapshot
    let originalGetStatus
    let generation

    before(function () {
        app = express()
        app.use(express.json({ limit: '128kb' }))
        app.use((req, res, next) => {
            if (['/api/preview-layout/config', '/api/preview-layout/reset'].includes(req.path) &&
                req.method === 'POST' && req.headers['x-test-omit-generation'] !== '1' &&
                req.body?.expectedGeneration === undefined) {
                req.body.expectedGeneration = generation
            }
            next()
        })
        app.use('/api', apiRouter)
        originalJwtSecret = config.jwtSecret
        suiteOriginalSave = config.save
        config.save = () => {}
        config.__getMutableCompatStateForTests().jwtSecret = 'dashboard-preview-test-secret'
        originalPatch = config.patch
        originalGetSnapshot = config.getSnapshot
        originalGetStatus = config.getStatus
        token = buildToken()
    })

    beforeEach(function () {
        originalSave = config.save
        originalPreviewLayoutConfig = config.previewLayoutConfig
        config.save = () => {}
        config.__getMutableCompatStateForTests().previewLayoutConfig = {}
        generation = 1
        config.getSnapshot = () => ({
            rendering: { previewLayout: JSON.parse(JSON.stringify(config.previewLayoutConfig || {})) }
        })
        config.getStatus = () => ({
            documentGeneration: generation,
            effectiveGeneration: generation,
            fingerprint: `public-${generation}`
        })
        config.patch = async (operations) => {
            config.__getMutableCompatStateForTests().previewLayoutConfig = JSON.parse(JSON.stringify(operations[0].value))
            generation += 1
            return {
                documentGeneration: generation,
                effectiveGeneration: generation,
                generation,
                applied: ['rendering.previewLayout'],
                reloaded: ['rendering'],
                deploymentApplyRequired: [],
                warnings: []
            }
        }
    })

    afterEach(function () {
        config.__getMutableCompatStateForTests().previewLayoutConfig = originalPreviewLayoutConfig
        config.save = originalSave
        config.patch = originalPatch
        config.getSnapshot = originalGetSnapshot
        config.getStatus = originalGetStatus
    })

    after(function () {
        config.save = () => {}
        config.__getMutableCompatStateForTests().jwtSecret = originalJwtSecret
        config.save = suiteOriginalSave
    })

    it('requires expectedGeneration for preview layout mutations', async function () {
        const res = await request(app)
            .post('/api/preview-layout/config')
            .set('Authorization', `Bearer ${token}`)
            .set('X-Test-Omit-Generation', '1')
            .send({ scope: 'global', type: 'video', template: getDefaultTemplate('video') })

        assert.strictEqual(res.status, 400)
        assert.strictEqual(res.body.code, 'CONFIG_EXPECTED_GENERATION_REQUIRED')
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
        assert.strictEqual(res.body.types.dynamic.status, 'editable')
        assert.strictEqual(res.body.types.article.status, 'editable')
        assert.strictEqual(res.body.types.live.status, 'editable')
        assert.strictEqual(res.body.types.bangumi.status, 'editable')
        assert.strictEqual(res.body.types.user.status, 'editable')
        assert.strictEqual(res.body.version, 2)
        assert.ok(res.body.componentRegistry.tag)
        assert.ok(res.body.legacyFieldGroups.layout)
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

    it('returns 400 for invalid link preview input instead of internal error', async function () {
        const res = await request(app)
            .post('/api/preview-layout/preview')
            .set('Authorization', `Bearer ${token}`)
            .send({
                mode: 'link',
                input: 'not a bilibili link'
            })

        assert.strictEqual(res.status, 400)
        assert.match(res.body.error, /未识别到可处理的 B 站链接/)
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

    it('rejects ambiguous v1/v2 preview and save payloads', async function () {
        const template = getDefaultTemplate('video')
        const saveRes = await request(app)
            .post('/api/preview-layout/config')
            .set('Authorization', `Bearer ${token}`)
            .send({
                scope: 'global',
                type: 'video',
                template,
                patch: { elements: { title: { visible: true } } }
            })

        assert.strictEqual(saveRes.status, 400)
        assert.strictEqual(saveRes.body.code, 'PREVIEW_TEMPLATE_AMBIGUOUS_INPUT')

        const previewRes = await request(app)
            .post('/api/preview-layout/preview')
            .set('Authorization', `Bearer ${token}`)
            .send({
                mode: 'structure',
                mockType: 'video',
                draftTemplate: template,
                renderOverrides: { elements: { title: { visible: true } } }
            })

        assert.strictEqual(previewRes.status, 400)
        assert.strictEqual(previewRes.body.code, 'PREVIEW_TEMPLATE_AMBIGUOUS_INPUT')
    })

    it('saves non-video Bilibili link card layout patches', async function () {
        const res = await request(app)
            .post('/api/preview-layout/config')
            .set('Authorization', `Bearer ${token}`)
            .send({
                scope: 'global',
                type: 'dynamic',
                patch: {
                    elements: {
                        media: {
                            visible: false
                        }
                    }
                }
            })

        assert.strictEqual(res.status, 200)
        assert.strictEqual(res.body.config.template.nodesById.media.visible, false)
        assert.strictEqual(res.body.config.template.version, 2)
    })

    it('previews a draft template through the v2 renderer and returns overlay metadata', async function () {
        this.timeout(60000)
        const template = getDefaultTemplate('video')
        template.nodesById.title.style.fontSize = 34

        const res = await request(app)
            .post('/api/preview-layout/preview')
            .set('Authorization', `Bearer ${token}`)
            .send({
                mode: 'structure',
                mockType: 'video',
                draftTemplate: template
            })

        assert.strictEqual(res.status, 200)
        assert.strictEqual(res.body.status, 'success')
        assert.strictEqual(res.body.debugMeta.renderer, 'preview-template-v2')
        assert.ok(res.body.image.base64.length > 1000)
        assert.ok(res.body.container.width > 0)
        assert.ok(res.body.elements.title.box)
        assert.strictEqual(res.body.template.nodesById.title.style.fontSize, 34)
    })

    it('rejects core role absolute layout and uses saved safe global templates', async function () {
        this.timeout(60000)
        const unsafeTemplate = getDefaultTemplate('video')
        unsafeTemplate.nodesById.title.layout = {
            mode: 'absolute',
            x: 72,
            y: 188,
            width: 780,
            height: 88,
            zIndex: 40
        }

        const unsafeSaveRes = await request(app)
            .post('/api/preview-layout/config')
            .set('Authorization', `Bearer ${token}`)
            .send({
                scope: 'global',
                type: 'video',
                template: unsafeTemplate
            })

        assert.strictEqual(unsafeSaveRes.status, 400)

        const template = getDefaultTemplate('video')
        template.nodesById.title.layout = {
            mode: 'flow',
            transform: { x: 12, y: -8 }
        }
        const saveRes = await request(app)
            .post('/api/preview-layout/config')
            .set('Authorization', `Bearer ${token}`)
            .send({
                scope: 'global',
                type: 'video',
                template
            })
        assert.strictEqual(saveRes.status, 200)
        assert.strictEqual(config.previewLayoutConfig.version, 2)

        const previewRes = await request(app)
            .post('/api/preview-layout/preview')
            .set('Authorization', `Bearer ${token}`)
            .send({
                mode: 'structure',
                mockType: 'video'
            })

        assert.strictEqual(previewRes.status, 200)
        assert.strictEqual(previewRes.body.debugMeta.renderer, 'preview-template-v2')
        assert.strictEqual(previewRes.body.template.nodesById.title.layout.mode, 'flow')
        assert.deepStrictEqual(previewRes.body.template.nodesById.title.layout.transform, { x: 12, y: -8 })
        assert.ok(previewRes.body.elements.title.box)
    })

    it('rejects internal card types for structure preview layout editing', async function () {
        const res = await request(app)
            .post('/api/preview-layout/preview')
            .set('Authorization', `Bearer ${token}`)
            .send({
                mode: 'structure',
                mockType: 'help_user'
            })

        assert.strictEqual(res.status, 400)
        assert.match(res.body.error, /not editable: help_user/)
    })

    it('allows non-video structure targets before validating their render overrides', async function () {
        const res = await request(app)
            .post('/api/preview-layout/preview')
            .set('Authorization', `Bearer ${token}`)
            .send({
                mode: 'structure',
                mockType: 'dynamic',
                renderOverrides: {
                    elements: {
                        notAnElement: {
                            visible: false
                        }
                    }
                }
            })

        assert.strictEqual(res.status, 400)
        assert.match(res.body.error, /unknown preview layout element: notAnElement/)
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

    it('rejects unknown artifactMode values', async function () {
        const res = await request(app)
            .post('/api/preview-layout/preview')
            .set('Authorization', `Bearer ${token}`)
            .send({
                mode: 'structure',
                mockType: 'video',
                artifactMode: 'html-only'
            })

        assert.strictEqual(res.status, 400)
        assert.match(res.body.error, /artifactMode must be/)
    })

    it('returns htmlArtifact with correct shape when artifactMode is image+html', async function () {
        this.timeout(60000)
        const template = getDefaultTemplate('video')

        const res = await request(app)
            .post('/api/preview-layout/preview')
            .set('Authorization', `Bearer ${token}`)
            .send({
                mode: 'structure',
                mockType: 'video',
                draftTemplate: template,
                artifactMode: 'image+html'
            })

        assert.strictEqual(res.status, 200)
        assert.ok(res.body.htmlArtifact, 'htmlArtifact should be present')
        assert.strictEqual(res.body.htmlArtifact.renderer, 'preview-template-v2')
        assert.ok(typeof res.body.htmlArtifact.html === 'string' && res.body.htmlArtifact.html.length > 100)
        assert.ok(typeof res.body.htmlArtifact.css === 'string')
        assert.ok(res.body.htmlArtifact.container)
        assert.ok(res.body.htmlArtifact.container.width > 0)
        assert.ok(res.body.htmlArtifact.elements && typeof res.body.htmlArtifact.elements === 'object')
        assert.ok(res.body.htmlArtifact.elements.title, 'elements should include title node')
        assert.ok(typeof res.body.htmlArtifact.fullCss === 'string' && res.body.htmlArtifact.fullCss.length > 500, 'fullCss should be the complete theme CSS')
        assert.match(res.body.htmlArtifact.bodyHtml, /class="container/, 'bodyHtml should include container wrapper')
        assert.doesNotMatch(res.body.htmlArtifact.bodyHtml, /<html|<head|<body/, 'bodyHtml should be a fragment, not a full document')
    })

    it('htmlArtifact html contains data-template-node-id but no script tags', async function () {
        this.timeout(60000)
        const template = getDefaultTemplate('video')

        const res = await request(app)
            .post('/api/preview-layout/preview')
            .set('Authorization', `Bearer ${token}`)
            .send({
                mode: 'structure',
                mockType: 'video',
                draftTemplate: template,
                artifactMode: 'image+html'
            })

        assert.strictEqual(res.status, 200)
        const html = res.body.htmlArtifact.html
        assert.match(html, /data-template-node-id=/)
        assert.doesNotMatch(html, /<script/i)
        assert.doesNotMatch(html, /on[a-z]+\s*=/i)
        const bodyHtml = res.body.htmlArtifact.bodyHtml
        assert.match(bodyHtml, /data-template-node-id=/)
        assert.doesNotMatch(bodyHtml, /<script/i)
        assert.doesNotMatch(bodyHtml, /on[a-z]+\s*=/i)
    })

    it('does not include htmlArtifact in response when artifactMode is not specified', async function () {
        this.timeout(60000)
        const template = getDefaultTemplate('video')

        const res = await request(app)
            .post('/api/preview-layout/preview')
            .set('Authorization', `Bearer ${token}`)
            .send({
                mode: 'structure',
                mockType: 'video',
                draftTemplate: template
            })

        assert.strictEqual(res.status, 200)
        assert.strictEqual(res.body.htmlArtifact, undefined)
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
        assert.strictEqual(saveRes.body.config.template.nodesById.cover.layout.mode, 'flow')
        assert.strictEqual(saveRes.body.config.template.nodesById.cover.layout.transform.x, 12)
        assert.strictEqual(saveRes.body.config.template.nodesById.title.style.fontSize, 28)

        const resetRes = await request(app)
            .post('/api/preview-layout/reset')
            .set('Authorization', `Bearer ${token}`)
            .send({
                scope: 'global',
                type: 'video',
                element: 'cover'
            })

        assert.strictEqual(resetRes.status, 200)
        assert.strictEqual(resetRes.body.config.template.nodesById.cover.layout.transform, undefined)
        assert.strictEqual(resetRes.body.config.template.nodesById.title.style.fontSize, 28)
    })
})
