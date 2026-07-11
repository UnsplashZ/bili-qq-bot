'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createDefaultV1Config } = require('../../../src/migrations/config/legacyLoader')
const { buildCompose, readOwnership } = require('../../../src/cli/compose')

describe('Compose ownership safety', () => {
    let root

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-compose-ownership-'))
        fs.chmodSync(root, 0o700)
    })

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true })
    })

    it('detects an ownership inode swap during fd-anchored reading', () => {
        const ownershipPath = path.join(root, 'ownership.json')
        fs.writeFileSync(ownershipPath, '{"version":1,"ownedPointers":[]}\n', { mode: 0o600 })
        assert.throws(() => readOwnership(ownershipPath, {
            beforeRead() {
                const replacement = `${ownershipPath}.replacement`
                fs.writeFileSync(replacement, '{"version":1,"ownedPointers":["/services/x"]}\n', { mode: 0o600 })
                fs.renameSync(replacement, ownershipPath)
            }
        }), (error) => error.code === 'COMPOSE_OWNERSHIP_CHANGED')
    })

    it('fails closed for v1 ownership without explicit adoption', () => {
        const ownershipPath = path.join(root, 'ownership.json')
        fs.writeFileSync(ownershipPath, '{"version":1,"ownedPointers":["/services/bili-qq-bot/volumes"]}\n', { mode: 0o600 })
        const config = createDefaultV1Config({ jwtSecret: 'fixture-jwt' })
        const existing = {
            services: {
                'bili-qq-bot': {
                    ports: ['3000:3000'],
                    volumes: ['./config:/app/config', './data:/app/data', './napcat/qq:/app/.config/QQ']
                },
                napcat: { volumes: ['./napcat/config:/app/napcat/config', './napcat/qq:/app/.config/QQ'] }
            }
        }

        assert.throws(
            () => buildCompose(config, existing, { ownershipPath }),
            (error) => error.code === 'COMPOSE_LEGACY_OWNERSHIP_ADOPTION_REQUIRED'
        )
        assert.doesNotThrow(() => buildCompose(config, existing, { ownershipPath, adoptExisting: true }))
    })

    it('removes the setup-owned QQ home mount when switching from NapCat to Official', () => {
        const ownershipPath = path.join(root, 'ownership.json')
        const napcatConfig = createDefaultV1Config({ jwtSecret: 'fixture-jwt' })
        const existing = {
            services: {
                'bili-qq-bot': {
                    ports: ['3000:3000'],
                    volumes: [
                        './config:/app/config', './data:/app/data', './logs:/app/logs',
                        './fonts/custom:/app/fonts/custom', './napcat/qq:/app/.config/QQ'
                    ]
                },
                napcat: {
                    ports: ['6099:6099', '3001:3001'],
                    volumes: ['./napcat/config:/app/napcat/config', './napcat/qq:/app/.config/QQ']
                }
            }
        }
        const first = buildCompose(napcatConfig, existing, { adoptExisting: true })
        fs.writeFileSync(ownershipPath, `${JSON.stringify(first.ownership)}\n`, { mode: 0o600 })

        const officialConfig = structuredClone(napcatConfig)
        officialConfig.qq.provider = 'official'
        officialConfig.qq.official.appId = 'fixture-app'
        officialConfig.qq.official.clientSecret = 'fixture-secret'
        const switched = buildCompose(officialConfig, first.compose, { ownershipPath })

        assert.strictEqual(switched.compose.services.napcat, undefined)
        assert.ok(!switched.compose.services['bili-qq-bot'].volumes.some((item) => String(item).includes('/app/.config/QQ')))
    })
})
