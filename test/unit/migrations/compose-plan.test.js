'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createDefaultV1Config } = require('../../../src/migrations/config/legacyLoader')
const { stringifyConfigYaml } = require('../../../src/migrations/config/configDocument')
const { buildDeploymentPlan } = require('../../../src/migrations/config/compose')
const { uniqueRelocations } = require('../../../src/migrations/config/compose')

function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-compose-plan-'))
    const configPath = path.join(root, 'config.yaml')
    const composePath = path.join(root, 'compose.yaml')
    const config = createDefaultV1Config({ jwtSecret: 'fixture-jwt' })
    config.deployment.mounts.napcatQq = './new-napcat-qq'
    fs.writeFileSync(configPath, stringifyConfigYaml(config), { mode: 0o600 })
    fs.writeFileSync(composePath, 'services: {}\n', { mode: 0o600 })
    return { root, configPath, composePath }
}

describe('deployment mount plan', () => {
    it('models mounts by service and container target while deduplicating a shared relocation', () => {
        const value = fixture()
        try {
            const compose = {
                services: {
                    'bili-qq-bot': { volumes: ['./old-napcat-qq:/app/.config/QQ'] },
                    napcat: {
                        volumes: [
                            './napcat-config:/app/napcat/config',
                            './old-napcat-qq:/app/.config/QQ'
                        ]
                    }
                }
            }
            const plan = buildDeploymentPlan({ ...value, existingComposePath: value.composePath, readCompose: () => compose })
            const shared = plan.mounts.filter((mount) => mount.key === 'napcatQq')
            assert.deepStrictEqual(shared.map((mount) => mount.service).sort(), ['bili-qq-bot', 'napcat'])
            assert.ok(shared.every((mount) => mount.sharedIdentity === 'napcat-qq-home'))
            assert.strictEqual(plan.requiredOperationCount, 2) // shared napcatQq + napcatConfig
            assert.strictEqual(uniqueRelocations(plan.mounts).find((item) => item.key === 'napcatQq').bindings.length, 2)
        } finally {
            fs.rmSync(value.root, { recursive: true, force: true })
        }
    })

    it('blocks divergent Bot/NapCat sources for the declared shared QQ identity', () => {
        const value = fixture()
        try {
            const compose = {
                services: {
                    'bili-qq-bot': { volumes: ['./bot-qq:/app/.config/QQ'] },
                    napcat: { volumes: ['./napcat-qq:/app/.config/QQ'] }
                }
            }
            assert.throws(
                () => buildDeploymentPlan({ ...value, existingComposePath: value.composePath, readCompose: () => compose }),
                (error) => error.code === 'DEPLOYMENT_SHARED_MOUNT_IDENTITY_MISMATCH'
            )
        } finally {
            fs.rmSync(value.root, { recursive: true, force: true })
        }
    })
})
