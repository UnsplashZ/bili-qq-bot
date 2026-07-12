'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const YAML = require('yaml')
const { ApplicationMigrationBootstrap } = require('../../../src/bootstrap/applicationMigrationBootstrap')
const { RuntimeOwnerLock } = require('../../../src/config/configLock')
const { createDefaultV1Config } = require('../../../src/migrations/config/legacyLoader')
const { stringifyConfigYaml } = require('../../../src/migrations/config/configDocument')

function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-app-bootstrap-'))
    const configDir = path.join(root, 'config')
    const dataDir = path.join(root, 'data')
    fs.mkdirSync(configDir, { mode: 0o700 })
    fs.mkdirSync(dataDir, { mode: 0o700 })
    return { root, configDir, dataDir }
}

function bootstrap(paths, options = {}) {
    return new ApplicationMigrationBootstrap({ ...paths, ...options })
}

describe('ApplicationMigrationBootstrap', () => {
    const roots = []
    afterEach(() => {
        while (roots.length > 0) fs.rmSync(roots.pop(), { recursive: true, force: true })
    })

    it('creates the only managed YAML from private fresh-install input', async () => {
        const paths = fixture(); roots.push(paths.root)
        const result = await bootstrap(paths).run({
            installInput: { provider: 'official', officialAppId: 'app', officialClientSecret: 'secret', rootAdminQQ: '42' }
        })
        await bootstrap(paths).release()
        assert.strictEqual(result.sourceClass, 'fresh-install')
        assert.strictEqual(result.config.created, true)
        assert.strictEqual(YAML.parse(fs.readFileSync(path.join(paths.configDir, 'config.yaml'), 'utf8')).qq.provider, 'official')
        assert.deepStrictEqual(fs.readdirSync(paths.configDir), ['config.yaml'])
        assert.strictEqual(fs.statSync(path.join(paths.configDir, 'config.yaml')).mode & 0o777, 0o600)
        assert.ok(!JSON.stringify(result.publicStatus).includes('secret'))
    })

    it('freezes four legacy sources with their established priority', async () => {
        const paths = fixture(); roots.push(paths.root)
        fs.writeFileSync(path.join(paths.configDir, '.env'), 'WS_URL=ws://dotenv\nJWT_SECRET=' + 'a'.repeat(64) + '\nQQ_OFFICIAL_CLIENT_SECRET=env-secret\n', { mode: 0o600 })
        fs.writeFileSync(path.join(paths.configDir, 'config.json'), JSON.stringify({ wsUrl: 'ws://json', dashboardPort: 3456 }), { mode: 0o600 })
        fs.writeFileSync(path.join(paths.configDir, '.jwtSecret'), 'b'.repeat(64), { mode: 0o600 })
        fs.writeFileSync(path.join(paths.configDir, '.qqOfficialClientSecret'), 'file-secret\n', { mode: 0o600 })
        const result = await bootstrap(paths).run({ runtimeEnv: { WS_URL: 'ws://runtime', JWT_SECRET: 'c'.repeat(64) } })
        const value = YAML.parse(fs.readFileSync(path.join(paths.configDir, 'config.yaml'), 'utf8'))
        assert.strictEqual(value.qq.napcat.wsUrl, 'ws://json')
        assert.strictEqual(value.dashboard.listenPort, 3456)
        assert.strictEqual(result.archive.eligible, true)
        assert.deepStrictEqual(result.archive.legacyFiles.sort(), ['.env', '.jwtSecret', '.qqOfficialClientSecret', 'config.json'].sort())
    })

    it('automatically migrates a legacy Official image mount without a fencing flag', async () => {
        const paths = fixture(); roots.push(paths.root)
        fs.writeFileSync(path.join(paths.configDir, '.env'), [
            'QQ_PROVIDER=official',
            'QQ_OFFICIAL_APP_ID=official-app',
            'QQ_OFFICIAL_ROOT_OPENIDS=root-a,root-b',
            `JWT_SECRET=${'9'.repeat(64)}`,
            ''
        ].join('\n'), { mode: 0o600 })
        fs.writeFileSync(path.join(paths.configDir, '.qqOfficialClientSecret'), 'official-secret\n', { mode: 0o600 })
        const result = await bootstrap(paths).run({ runtimeEnv: {} })
        const value = YAML.parse(fs.readFileSync(path.join(paths.configDir, 'config.yaml'), 'utf8'))
        assert.strictEqual(result.sourceClass, 'legacy-v0')
        assert.strictEqual(value.qq.provider, 'official')
        assert.strictEqual(value.qq.official.appId, 'official-app')
        assert.strictEqual(value.qq.official.clientSecret, 'official-secret')
        assert.deepStrictEqual(value.qq.official.rootOpenids, ['root-a', 'root-b', 'root-a', 'root-b'])
    })

    it('keeps an existing valid YAML authoritative over all legacy files', async () => {
        const paths = fixture(); roots.push(paths.root)
        const config = createDefaultV1Config({ wsUrl: 'ws://managed', jwtSecret: 'd'.repeat(64) })
        fs.writeFileSync(path.join(paths.configDir, 'config.yaml'), stringifyConfigYaml(config), { mode: 0o600 })
        fs.writeFileSync(path.join(paths.configDir, 'config.json'), '{broken', { mode: 0o600 })
        const result = await bootstrap(paths).run()
        assert.strictEqual(result.sourceClass, 'managed-v1+')
        assert.strictEqual(result.archive.eligible, false)
        assert.strictEqual(YAML.parse(fs.readFileSync(path.join(paths.configDir, 'config.yaml'), 'utf8')).qq.napcat.wsUrl, 'ws://managed')
    })

    it('rejects future and invalid YAML without falling back to legacy', async () => {
        for (const yaml of ['version: 99\n', 'version: [\n']) {
            const paths = fixture(); roots.push(paths.root)
            fs.writeFileSync(path.join(paths.configDir, 'config.yaml'), yaml, { mode: 0o600 })
            fs.writeFileSync(path.join(paths.configDir, 'config.json'), '{}', { mode: 0o600 })
            await assert.rejects(bootstrap(paths).run(), (error) => ['CONFIG_SCHEMA_FUTURE_VERSION', 'CONFIG_BOOTSTRAP_INVALID_INPUT'].includes(error.code))
            assert.strictEqual(fs.readFileSync(path.join(paths.configDir, 'config.yaml'), 'utf8'), yaml)
        }
    })

    it('fails before writes when a runtime owner is active', async () => {
        const paths = fixture(); roots.push(paths.root)
        const lockPath = path.join(paths.dataDir, 'runtime/config-owner.lock')
        const owner = new RuntimeOwnerLock({ lockPath })
        await owner.acquire()
        try {
            await assert.rejects(bootstrap(paths).run({ createIfMissing: true }), (error) => error.code === 'CONFIG_BOOTSTRAP_OWNER_CONFLICT')
            assert.strictEqual(fs.existsSync(path.join(paths.configDir, 'config.yaml')), false)
        } finally {
            await owner.release()
        }
    })

    it('is idempotent and resumes after interruption following config durability', async () => {
        const paths = fixture(); roots.push(paths.root)
        const crashing = bootstrap(paths, { faultInjector(phase) { if (phase === 'config-ready') throw Object.assign(new Error('crash'), { code: 'SIMULATED_CRASH' }) } })
        await assert.rejects(crashing.run({ createIfMissing: true }), (error) => error.code === 'CONFIG_BOOTSTRAP_RECOVERY_REQUIRED')
        const first = fs.readFileSync(path.join(paths.configDir, 'config.yaml'))
        const resumed = await bootstrap(paths).run()
        const repeated = await bootstrap(paths).run()
        assert.deepStrictEqual(fs.readFileSync(path.join(paths.configDir, 'config.yaml')), first)
        assert.strictEqual(resumed.migrationId, repeated.migrationId)
        assert.strictEqual(repeated.config.created, false)
    })

    it('retains archive proof and release association across probe and normal runs', async () => {
        const paths = fixture(); roots.push(paths.root)
        fs.writeFileSync(path.join(paths.configDir, '.env'), `JWT_SECRET=${'e'.repeat(64)}\n`, { mode: 0o600 })
        const probe = await bootstrap(paths).run({ releaseEpoch: 'epoch-1', deploymentAttemptId: 'attempt-1' })
        const normal = await bootstrap(paths).run({ releaseEpoch: 'epoch-1', deploymentAttemptId: 'attempt-1' })
        assert.strictEqual(probe.archive.eligible, true)
        assert.strictEqual(normal.archive.eligible, true)
        assert.strictEqual(normal.archive.proofId, probe.archive.proofId)
        assert.strictEqual(normal.sourceClass, 'legacy-v0')
        assert.strictEqual(normal.publicStatus.releaseEpoch, 'epoch-1')
    })

    it('restores the original old-schema YAML when a later bootstrap stage fails', async () => {
        const paths = fixture(); roots.push(paths.root)
        const source = 'version: 0\nlegacy: true\n'
        fs.writeFileSync(path.join(paths.configDir, 'config.yaml'), source, { mode: 0o600 })
        const schemaRegistry = {
            migrate(value) {
                assert.strictEqual(value.version, 0)
                return { config: createDefaultV1Config({ jwtSecret: 'f'.repeat(64) }), applied: ['v0-to-v1'] }
            }
        }
        const dataRegistry = { async apply() { throw Object.assign(new Error('data failed'), { code: 'DATA_MIGRATION_FAILED' }) } }
        await assert.rejects(bootstrap(paths, { schemaRegistry, dataRegistry }).run(), (error) => error.code === 'DATA_MIGRATION_FAILED')
        assert.strictEqual(fs.readFileSync(path.join(paths.configDir, 'config.yaml'), 'utf8'), source)
        assert.strictEqual(fs.statSync(path.join(paths.dataDir, 'application-migration/config-schema-source.yaml')).mode & 0o777, 0o600)
    })
})
