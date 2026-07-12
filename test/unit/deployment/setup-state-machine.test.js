'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')
const YAML = require('yaml')
const { canonicalValue, valueHash } = require('../../../src/cli/compose')
const {
    readDeploymentBaseline,
    writeDeploymentBaseline,
    deploymentStatus
} = require('../../../src/config/deploymentBaseline')

const repoRoot = path.resolve(__dirname, '../../..')
const setupScript = path.join(repoRoot, 'setup.sh')
const fixtureRoot = path.join(repoRoot, 'test/fixtures/deployment')
const fakeDocker = path.join(fixtureRoot, 'fake-docker.sh')
const fakeCli = path.join(fixtureRoot, 'fake-cli.sh')
const fakeLsof = path.join(fixtureRoot, 'fake-lsof.sh')

function copyFile(source, target, mode = 0o600) {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(source, target)
    fs.chmodSync(target, mode)
}

function treeInventory(root, { exclude = new Set() } = {}) {
    const result = []
    function visit(current, relative = '') {
        for (const name of fs.readdirSync(current).sort()) {
            if (!relative && exclude.has(name)) continue
            const absolute = path.join(current, name)
            const child = relative ? path.join(relative, name) : name
            const stat = fs.lstatSync(absolute)
            if (stat.isDirectory()) {
                result.push([child, 'dir', stat.mode & 0o777])
                visit(absolute, child)
            } else if (stat.isFile()) {
                result.push([child, 'file', stat.mode & 0o777, fs.readFileSync(absolute).toString('base64')])
            } else result.push([child, 'other'])
        }
    }
    visit(root)
    return result
}

function findFileContaining(root, needle) {
    if (!fs.existsSync(root)) return null
    const pending = [root]
    while (pending.length > 0) {
        const current = pending.pop()
        const stat = fs.lstatSync(current)
        if (stat.isDirectory()) {
            for (const name of fs.readdirSync(current)) pending.push(path.join(current, name))
        } else if (stat.isFile() && fs.readFileSync(current).includes(Buffer.from(needle))) return current
    }
    return null
}

function createLegacyInstall() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-setup-fixture-'))
    const stateDir = path.join(root, '.fake-docker')
    fs.mkdirSync(stateDir, { recursive: true })
    fs.mkdirSync(path.join(root, 'config'), { recursive: true })
    fs.mkdirSync(path.join(root, 'data'), { recursive: true })
    fs.mkdirSync(path.join(root, 'napcat/config'), { recursive: true })
    fs.mkdirSync(path.join(root, 'napcat/qq'), { recursive: true })
    fs.mkdirSync(path.join(root, 'fonts/custom'), { recursive: true })
    fs.mkdirSync(path.join(root, 'logs'), { recursive: true })

    copyFile(path.join(fixtureRoot, 'legacy-env.txt'), path.join(root, 'config/.env'))
    copyFile(path.join(fixtureRoot, 'legacy-config.json'), path.join(root, 'config/config.json'))
    copyFile(path.join(fixtureRoot, 'subscriptions.json'), path.join(root, 'data/subscriptions.json'))
    copyFile(path.join(fixtureRoot, 'subscription-state.json'), path.join(root, 'data/subscription_state.json'))
    copyFile(path.join(fixtureRoot, 'subscription-delivery.json'), path.join(root, 'data/subscription_delivery.json'))
    copyFile(path.join(fixtureRoot, 'legacy-compose.yml'), path.join(root, 'docker-compose.yml'))
    fs.writeFileSync(path.join(root, 'napcat/config/onebot11_fixture.json'), '{"network":{}}\n', { mode: 0o600 })
    fs.writeFileSync(path.join(root, 'napcat/qq/identity.fixture'), 'fixture-qq-state\n', { mode: 0o600 })
    fs.writeFileSync(path.join(root, 'fonts/custom/fixture-font.txt'), 'fixture-font\n', { mode: 0o600 })
    fs.writeFileSync(path.join(stateDir, 'bot-old.running'), 'true\n')
    fs.writeFileSync(path.join(stateDir, 'bot-old.paused'), 'false\n')
    fs.writeFileSync(path.join(stateDir, 'napcat-old.running'), 'true\n')
    fs.writeFileSync(path.join(stateDir, 'napcat-old.paused'), 'false\n')

    return { root, stateDir }
}

function loosenLegacyConfigPermissions(root) {
    for (const name of ['.env', 'config.json']) fs.chmodSync(path.join(root, 'config', name), 0o644)
}

function createFreshInstall() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-setup-fresh-fixture-'))
    const stateDir = path.join(root, '.fake-docker')
    fs.mkdirSync(stateDir, { recursive: true })
    return { root, stateDir }
}

function writeManagedOwnership(root, setupState) {
    const compose = YAML.parse(fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8'))
    const pointer = '/services/bili-qq-bot/volumes'
    const volumes = compose.services['bili-qq-bot'].volumes
    const serialized = canonicalValue(volumes)
    fs.writeFileSync(path.join(setupState, 'compose-ownership.json'), `${JSON.stringify({
        version: 2,
        ownedPointers: [pointer],
        fields: { [pointer]: { value: serialized, hash: valueHash(volumes) } }
    })}\n`, { mode: 0o600 })
}

function createManagedInstall() {
    const fixture = createLegacyInstall()
    fs.rmSync(path.join(fixture.root, 'config/.env'))
    fs.rmSync(path.join(fixture.root, 'config/config.json'))
    copyFile(path.join(fixtureRoot, 'managed-config.yaml'), path.join(fixture.root, 'config/config.yaml'))
    const setupState = path.join(fixture.root, 'data/setup-state')
    fs.mkdirSync(setupState, { recursive: true, mode: 0o700 })
    fs.writeFileSync(path.join(setupState, 'managed-v1'), 'previous-release\n', { mode: 0o600 })
    writeManagedOwnership(fixture.root, setupState)
    return fixture
}

function assertConcurrentComposeUpgradeRefused(createInstall) {
    const fixture = createInstall()
    const concurrentPath = path.join(fixture.root, 'concurrent-compose.yml')
    const concurrent = `${fs.readFileSync(path.join(fixture.root, 'docker-compose.yml'), 'utf8')}\n# concurrent user edit before publish\n`
    fs.writeFileSync(concurrentPath, concurrent, { mode: 0o600 })
    const result = runSetup(fixture, [
        '--upgrade', '--non-interactive', '--install-dir', fixture.root,
        '--image', 'fixture/target:1', '--health-timeout', '5'
    ], { BILI_SETUP_TEST_CONCURRENT_COMPOSE_SOURCE: concurrentPath })
    assert.notStrictEqual(result.status, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`)
    assert.match(result.stderr, /Compose changed after snapshot/)
    assert.strictEqual(fs.readFileSync(path.join(fixture.root, 'docker-compose.yml'), 'utf8'), concurrent)
    assert.strictEqual(fs.readFileSync(path.join(fixture.stateDir, 'bot-old.running'), 'utf8'), 'true\n')
    return fixture
}

function assertConcurrentComposeDuringPublishRefused(createInstall) {
    const fixture = createInstall()
    const concurrentPath = path.join(fixture.root, 'concurrent-compose-during-publish.yml')
    const concurrent = `${fs.readFileSync(path.join(fixture.root, 'docker-compose.yml'), 'utf8')}\n# concurrent user edit during publish\n`
    fs.writeFileSync(concurrentPath, concurrent, { mode: 0o600 })
    const result = runSetup(fixture, [
        '--upgrade', '--non-interactive', '--install-dir', fixture.root,
        '--image', 'fixture/target:1', '--health-timeout', '5'
    ], { BILI_SETUP_TEST_CONCURRENT_COMPOSE_DURING_PUBLISH_SOURCE: concurrentPath })
    assert.notStrictEqual(result.status, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`)
    assert.match(result.stderr, /Compose appeared during publication/)
    assert.strictEqual(fs.readFileSync(path.join(fixture.root, 'docker-compose.yml'), 'utf8'), concurrent)
    assert.deepStrictEqual(
        fs.readdirSync(fixture.root).filter((name) => name.startsWith('.docker-compose.yml.')),
        []
    )
    assert.strictEqual(fs.readFileSync(path.join(fixture.stateDir, 'bot-old.running'), 'utf8'), 'true\n')
    return fixture
}

function createRealCliManagedInstall({ relocateConfig = false } = {}) {
    const fixture = createLegacyInstall()
    fs.rmSync(path.join(fixture.root, 'config'), { recursive: true, force: true })
    fs.mkdirSync(path.join(fixture.root, 'config'), { mode: 0o700 })
    const configPath = path.join(fixture.root, 'config/config.yaml')
    const initialized = spawnSync(process.execPath, [
        path.join(repoRoot, 'src/cli/config.js'),
        'init', '--output', configPath, '--provider', 'napcat', '--json'
    ], { cwd: repoRoot, encoding: 'utf8' })
    assert.strictEqual(initialized.status, 0, initialized.stderr)
    let config = fs.readFileSync(configPath, 'utf8').replace('data: ./data', 'data: ./relocated-real-data')
    if (relocateConfig) config = config.replace('config: ./config', 'config: ./relocated-real-config')
    fs.writeFileSync(configPath, config, { mode: 0o600 })
    const setupState = path.join(fixture.root, 'data/setup-state')
    fs.mkdirSync(setupState, { recursive: true, mode: 0o700 })
    fs.writeFileSync(path.join(setupState, 'managed-v1'), 'previous-release\n', { mode: 0o600 })
    writeManagedOwnership(fixture.root, setupState)
    return fixture
}

function baseEnv(fixture, extra = {}) {
    const cliCalls = path.join(fixture.stateDir, 'cli-calls.log')
    fs.writeFileSync(cliCalls, '')
    return {
        ...process.env,
        BILI_SETUP_TEST_MODE: '1',
        BILI_SETUP_DOCKER_BIN: fakeDocker,
        BILI_SETUP_CLI_DRIVER: fakeCli,
        BILI_SETUP_ATTEMPT_ID: 'fixture-attempt',
        BILI_SETUP_HEALTH_CONSECUTIVE_SUCCESSES: '1',
        BILI_SETUP_HEALTH_INTERVAL_SECONDS: '1',
        BILI_SETUP_STOP_TIMEOUT_SECONDS: '1',
        FAKE_DOCKER_STATE_DIR: fixture.stateDir,
        FAKE_INSTALL_DIR: fixture.root,
        FAKE_REPO_ROOT: repoRoot,
        FAKE_CLI_CALLS_FILE: cliCalls,
        ...extra
    }
}

function runSetup(fixture, args, extraEnv = {}, options = {}) {
    return spawnSync('bash', [setupScript, ...args], {
        cwd: fixture.root,
        env: baseEnv(fixture, extraEnv),
        encoding: 'utf8',
        input: options.input,
        timeout: 30000
    })
}

function readCalls(fixture) {
    const calls = path.join(fixture.stateDir, 'calls.log')
    return fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : ''
}

function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex')
}

function retainedVault(root) {
    const attempt = path.join(root, 'data/setup-state/fixture-attempt')
    const vault = path.join(attempt, 'retained-vault')
    const generations = fs.readdirSync(vault)
        .filter((name) => /^inventory-[0-9]{12}\.json$/.test(name))
        .sort()
    const inventoryPath = generations.length > 0
        ? path.join(vault, generations.at(-1))
        : path.join(vault, 'inventory.json')
    if (generations.length > 0) {
        assert.deepStrictEqual(generations, generations.map((_, index) => `inventory-${String(index + 1).padStart(12, '0')}.json`))
    }
    assert.strictEqual(fs.statSync(vault).mode & 0o777, 0o700)
    assert.strictEqual(fs.statSync(inventoryPath).mode & 0o777, 0o600)
    const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'))
    assert.strictEqual(inventory.version, 1)
    assert.strictEqual(inventory.attemptId, 'fixture-attempt')
    assert.strictEqual(inventory.releaseEpoch, 'release-fixture-attempt')
    assert.ok(Array.isArray(inventory.retained) && inventory.retained.length > 0)
    for (const item of inventory.retained) {
        assert.strictEqual(item.attemptId, 'fixture-attempt')
        assert.strictEqual(item.releaseEpoch, 'release-fixture-attempt')
        assert.ok(item.originalPath)
        assert.ok(item.retainedPath)
        assert.ok(['expected', 'unknown'].includes(item.disposition))
        if (!fs.existsSync(item.retainedPath) || fs.lstatSync(item.retainedPath).isSymbolicLink()) continue
        const stat = fs.lstatSync(item.retainedPath)
        assert.strictEqual(stat.mode & 0o777, stat.isDirectory() ? 0o700 : 0o600)
    }
    return { attempt, vault, inventory }
}

function recursiveFingerprint(target) {
    const stat = fs.lstatSync(target)
    if (stat.isFile()) return sha256(Buffer.from(JSON.stringify({
        type: 'file', mode: stat.mode & 0o777, size: stat.size, hash: sha256(fs.readFileSync(target))
    })))
    assert.strictEqual(stat.isDirectory(), true)
    return sha256(Buffer.from(JSON.stringify({
        type: 'dir', mode: stat.mode & 0o777,
        entries: fs.readdirSync(target).sort().map((name) => [name, recursiveFingerprintNode(path.join(target, name))])
    })))
}

function recursiveFingerprintNode(target) {
    const stat = fs.lstatSync(target)
    if (stat.isFile()) return { type: 'file', mode: stat.mode & 0o777, size: stat.size, hash: sha256(fs.readFileSync(target)) }
    return {
        type: 'dir', mode: stat.mode & 0o777,
        entries: fs.readdirSync(target).sort().map((name) => [name, recursiveFingerprintNode(path.join(target, name))])
    }
}

function assertRetainedScope(root, scope) {
    const result = retainedVault(root)
    assert.ok(result.inventory.retained.some((item) => item.scope === scope), `missing retained scope: ${scope}`)
    return result
}

function readManifest(fixture) {
    let dataRoot = path.join(fixture.root, 'data')
    const deploymentState = path.join(fixture.root, '.bili-deployment-state')
    if (fs.existsSync(deploymentState)) {
        for (const line of fs.readFileSync(deploymentState, 'utf8').trim().split('\n')) {
            const [key, value] = line.split('|')
            if (key === 'data') dataRoot = value
        }
    }
    const manifest = path.join(dataRoot, 'setup-state/fixture-attempt/upgrade-manifest.json')
    const value = JSON.parse(fs.readFileSync(manifest, 'utf8'))
    if (!value.checkpoint && value.status) value.checkpoint = value.status
    return value
}

describe('setup.sh deployment state machine', function () {
    this.timeout(60000)
    const roots = []

    before(function () {
        fs.chmodSync(setupScript, 0o755)
        fs.chmodSync(fakeDocker, 0o755)
        fs.chmodSync(fakeCli, 0o755)
        fs.chmodSync(fakeLsof, 0o755)
    })

    afterEach(function () {
        while (roots.length > 0) {
            fs.rmSync(roots.pop(), { recursive: true, force: true })
        }
    })

    it('parses --help before checking Docker or mutating the installation', function () {
        const fixture = createLegacyInstall()
        roots.push(fixture.root)
        const before = fs.readdirSync(fixture.root).sort()
        const result = spawnSync('bash', [setupScript, '--help'], {
            cwd: fixture.root,
            env: {
                ...process.env,
                BILI_SETUP_DOCKER_BIN: '/definitely/missing/docker'
            },
            encoding: 'utf8'
        })

        assert.strictEqual(result.status, 0, result.stderr)
        assert.match(result.stdout, /--dry-run/)
        assert.deepStrictEqual(fs.readdirSync(fixture.root).sort(), before)
    })

    it('reclaims an abandoned portable lock left before its owner record was durable', function () {
        const fixture = createLegacyInstall()
        roots.push(fixture.root)
        const lockRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-setup-lock-root-'))
        roots.push(lockRoot)
        const checksumProbe = spawnSync('cksum', { input: fs.realpathSync(fixture.root), encoding: 'utf8' })
        assert.strictEqual(checksumProbe.status, 0, checksumProbe.stderr)
        const checksum = checksumProbe.stdout.trim().split(/\s+/)[0]
        const lockDir = path.join(lockRoot, `bili-qq-bot-setup-lock.${checksum}`)
        fs.mkdirSync(lockDir, { mode: 0o700 })
        const staleTime = new Date(Date.now() - 10_000)
        fs.utimesSync(lockDir, staleTime, staleTime)

        const result = runSetup(fixture, [
            '--upgrade', '--dry-run', '--non-interactive',
            '--install-dir', fixture.root, '--image', 'fixture/target:1'
        ], {
            TMPDIR: lockRoot,
            BILI_SETUP_FORCE_PORTABLE_LOCK: '1'
        })

        assert.strictEqual(result.status, 0, result.stderr)
        assert.strictEqual(fs.existsSync(lockDir), false)
    })

    it('never reclaims a portable lock whose process identity is still live', function () {
        const fixture = createLegacyInstall()
        roots.push(fixture.root)
        const lockRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-setup-live-lock-root-'))
        roots.push(lockRoot)
        const canonicalRoot = fs.realpathSync(fixture.root)
        const checksumProbe = spawnSync('cksum', { input: canonicalRoot, encoding: 'utf8' })
        assert.strictEqual(checksumProbe.status, 0, checksumProbe.stderr)
        const checksum = checksumProbe.stdout.trim().split(/\s+/)[0]
        const identityProbe = spawnSync('ps', ['-p', String(process.pid), '-o', 'lstart=', '-o', 'command='], { encoding: 'utf8' })
        assert.strictEqual(identityProbe.status, 0, identityProbe.stderr)
        const identityHash = spawnSync('cksum', { input: identityProbe.stdout.replace(/\n$/, ''), encoding: 'utf8' })
        assert.strictEqual(identityHash.status, 0, identityHash.stderr)
        const identity = identityHash.stdout.trim().split(/\s+/)[0]
        const lockDir = path.join(lockRoot, `bili-qq-bot-setup-lock.${checksum}`)
        fs.mkdirSync(lockDir, { mode: 0o700 })
        fs.writeFileSync(path.join(lockDir, 'owner'), `${process.pid}|${identity}\n`, { mode: 0o600 })

        const result = runSetup(fixture, [
            '--upgrade', '--dry-run', '--non-interactive',
            '--install-dir', fixture.root, '--image', 'fixture/target:1'
        ], {
            TMPDIR: lockRoot,
            BILI_SETUP_FORCE_PORTABLE_LOCK: '1'
        })

        assert.notStrictEqual(result.status, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`)
        assert.match(result.stderr, /another setup process holds the installation lock/)
        assert.strictEqual(fs.existsSync(lockDir), true)
    })

    it('keeps every runtime config and deployment pointer out of the Docker build context', function () {
        const ignored = fs.readFileSync(path.join(repoRoot, '.dockerignore'), 'utf8').split(/\r?\n/)
        for (const entry of [
            'config/.env',
            'config/config.json',
            'config/.jwtSecret',
            'config/.qqOfficialClientSecret',
            'config/config.yaml',
            'config/config.yaml.*',
            '.bili-deployment-state'
        ]) {
            assert.ok(ignored.includes(entry), `missing .dockerignore entry: ${entry}`)
        }
    })

    it('keeps publication restore renames local across real Docker bind mounts', function () {
        const available = spawnSync('docker', ['info'], { encoding: 'utf8' })
        if (available.status !== 0) this.skip()
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-setup-bind-smoke-'))
        roots.push(root)
        const install = path.join(root, 'install')
        const dataParent = path.join(root, 'data-parent')
        fs.mkdirSync(install, { mode: 0o700 })
        fs.mkdirSync(path.join(dataParent, 'data/setup-state'), { recursive: true, mode: 0o700 })
        const script = `
const fs = require('fs')
const path = require('path')
const installWorkspace = '/install/.setup-publication-restore.fixture'
const dataWorkspace = '/data-parent/data/setup-state/.setup-publication-restore.fixture'
fs.mkdirSync(installWorkspace, { mode: 0o700 })
fs.mkdirSync(dataWorkspace, { mode: 0o700 })
fs.writeFileSync('/install/.bili-publication-quarantine.fixture', 'install')
fs.renameSync('/install/.bili-publication-quarantine.fixture', path.join(installWorkspace, 'install-quarantine'))
fs.writeFileSync('/data-parent/data/setup-state/.compose-ownership.candidate.fixture', 'ownership')
fs.renameSync('/data-parent/data/setup-state/.compose-ownership.candidate.fixture', path.join(dataWorkspace, 'ownership-candidate'))
fs.mkdirSync(path.join(dataWorkspace, 'data-candidate'))
fs.writeFileSync(path.join(dataWorkspace, 'data-candidate', 'state.json'), '{}')
fs.renameSync(path.join(dataWorkspace, 'data-candidate', 'state.json'), '/data-parent/data/state.json')
let crossMountRejected = false
try { fs.renameSync(path.join(installWorkspace, 'install-quarantine'), path.join(dataWorkspace, 'cross-mount')) } catch (error) { crossMountRejected = error.code === 'EXDEV' }
if (!crossMountRejected) process.exit(2)
`
        const result = spawnSync('docker', [
            'run', '--rm', '-v', `${install}:/install:rw`, '-v', `${dataParent}:/data-parent:rw`,
            '--entrypoint', 'node', 'node:22-alpine', '-e', script
        ], { encoding: 'utf8' })
        assert.strictEqual(result.status, 0, result.stderr)
        assert.strictEqual(fs.readFileSync(path.join(dataParent, 'data/state.json'), 'utf8'), '{}')
    })

    it('passes a pre-existing fresh-install Compose snapshot to the renderer', function () {
        const fixture = createFreshInstall()
        roots.push(fixture.root)
        const compose = `services:\n  reverse-proxy:\n    image: example/proxy:1\n    labels:\n      user.owner: true\n`
        fs.writeFileSync(path.join(fixture.root, 'docker-compose.yml'), compose, { mode: 0o600 })
        const input = path.join(fixture.root, 'input-config.yaml')
        copyFile(path.join(fixtureRoot, 'managed-config.yaml'), input)
        const result = runSetup(fixture, [
            '--install', '--provider', 'napcat', '--non-interactive',
            '--config', input, '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ])

        assert.strictEqual(result.status, 0, result.stderr)
        const calls = fs.readFileSync(path.join(fixture.stateDir, 'cli-calls.log'), 'utf8')
        assert.match(calls, /--existing-compose[^\n]*\/staging\/snapshot\/docker-compose\.yml/)
    })

    it('dry-run emits a typed best-effort plan without writes or container mutations', function () {
        const fixture = createLegacyInstall()
        roots.push(fixture.root)
        loosenLegacyConfigPermissions(fixture.root)
        const result = runSetup(fixture, [
            '--upgrade',
            '--dry-run',
            '--non-interactive',
            '--install-dir', fixture.root,
            '--image', 'fixture/target:1'
        ])

        assert.strictEqual(result.status, 0, result.stderr)
        const report = JSON.parse(result.stdout.trim())
        assert.strictEqual(report.status, 'OK')
        assert.strictEqual(report.plannedDeliveryGuarantee, 'best-effort')
        assert.strictEqual(report.plannedExceptionScope, 'legacy-v0-first-cutover-inflight-outbound')
        assert.deepStrictEqual(report.plannedFeatureInventory, [
            'fallback-send', 'napcat-queued-send', 'subscription-push'
        ])
        assert.ok(report.wouldModifyLogicalPaths.every(value => value.startsWith('/')))
        assert.ok(!result.stdout.includes('fake-token'))
        assert.ok(!result.stdout.includes(fixture.root))
        assert.doesNotMatch(result.stdout, /[a-f0-9]{64}/)
        assert.strictEqual(fs.existsSync(path.join(fixture.root, 'data/setup-state')), false)
        const calls = readCalls(fixture)
        assert.doesNotMatch(calls, /\bpull\b/)
        assert.doesNotMatch(calls, /\bkill\b/)
        assert.doesNotMatch(calls, /\bup\b/)
    })

    it('evaluates a fresh no-config dry-run in temporary storage without creating install paths', function () {
        const fixture = createFreshInstall()
        roots.push(fixture.root)
        const result = runSetup(fixture, [
            '--install', '--provider', 'napcat', '--dry-run', '--non-interactive',
            '--install-dir', fixture.root, '--image', 'fixture/target:1'
        ])

        assert.strictEqual(result.status, 0, result.stderr)
        const report = JSON.parse(result.stdout)
        assert.strictEqual(report.mode, 'install')
        for (const entry of ['config', 'data', 'logs', 'napcat', 'fonts', 'docker-compose.yml']) {
            assert.strictEqual(fs.existsSync(path.join(fixture.root, entry)), false, `${entry} must remain absent`)
        }
        const cliCalls = fs.readFileSync(path.join(fixture.stateDir, 'cli-calls.log'), 'utf8')
        assert.match(cliCalls, /init[\s\S]*--output[^\n]*\/staging\/work\/config\/config\.yaml/)
        assert.match(cliCalls, /render-compose[\s\S]*--ownership-output[^\n]*\/staging\/compose-owned\.json/)
        assert.match(readCalls(fixture), /config/)
    })

    it('fails a dry-run when strict render or Compose validation fails without publishing files', function () {
        for (const extraEnv of [{ FAKE_RENDER_COMPOSE_FAIL: '1' }, { FAKE_COMPOSE_CONFIG_FAIL: '1' }]) {
            const fixture = createFreshInstall()
            roots.push(fixture.root)
            const result = runSetup(fixture, [
                '--install', '--provider', 'official', '--dry-run', '--non-interactive',
                '--install-dir', fixture.root, '--image', 'fixture/target:1'
            ], extraEnv)

            assert.notStrictEqual(result.status, 0)
            for (const entry of ['config', 'data', 'logs', 'napcat', 'fonts', 'docker-compose.yml']) {
                assert.strictEqual(fs.existsSync(path.join(fixture.root, entry)), false, `${entry} must remain absent`)
            }
            assert.strictEqual(result.stdout.trim(), '')
        }
    })

    for (const unsafeKind of ['0644', 'symlink', 'hardlink', 'fifo']) {
        it(`rejects an unsafe --config ${unsafeKind} before dry-run reads it`, function () {
            const fixture = createFreshInstall()
            roots.push(fixture.root)
            const input = path.join(fixture.root, 'input-config.yaml')
            copyFile(path.join(fixtureRoot, 'official-config.yaml'), input)
            if (unsafeKind === '0644') fs.chmodSync(input, 0o644)
            if (unsafeKind === 'symlink') {
                const target = path.join(fixture.root, 'real-config.yaml')
                fs.renameSync(input, target)
                fs.symlinkSync(target, input)
            }
            if (unsafeKind === 'hardlink') fs.linkSync(input, path.join(fixture.root, 'second-config-link.yaml'))
            if (unsafeKind === 'fifo') {
                fs.rmSync(input)
                const made = spawnSync('mkfifo', [input], { encoding: 'utf8' })
                assert.strictEqual(made.status, 0, made.stderr)
                fs.chmodSync(input, 0o600)
            }
            const result = runSetup(fixture, [
                '--install', '--provider', 'official', '--config', input,
                '--dry-run', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1'
            ])

            assert.notStrictEqual(result.status, 0)
            assert.match(result.stderr, /must (?:have mode 0600|not be a symlink|be an ordinary file|have exactly one hard link)/)
            assert.strictEqual(fs.existsSync(path.join(fixture.root, 'data/setup-state')), false)
            assert.doesNotMatch(fs.readFileSync(path.join(fixture.stateDir, 'cli-calls.log'), 'utf8'), /validate/)
        })
    }

    for (const artifact of ['.env', 'config.json', '.jwtSecret', '.qqOfficialClientSecret', 'config.yaml']) {
        it(`rejects a dangling ${artifact} symlink before publishing a cutover marker`, function () {
            const fixture = artifact === 'config.yaml' ? createManagedInstall() : createLegacyInstall()
            roots.push(fixture.root)
            const candidate = path.join(fixture.root, 'config', artifact)
            fs.rmSync(candidate, { force: true })
            fs.symlinkSync(path.join(fixture.root, 'missing-secret-or-config'), candidate)
            const result = runSetup(fixture, [
                '--upgrade', '--dry-run', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1'
            ])

            assert.notStrictEqual(result.status, 0)
            assert.match(result.stderr, /must not be a symlink/)
            assert.strictEqual(fs.existsSync(path.join(fixture.root, 'data/setup-state/active-attempt')), false)
            assert.doesNotMatch(readCalls(fixture), /image tag|network disconnect|kill --signal/)
            assert.doesNotMatch(fs.readFileSync(path.join(fixture.stateDir, 'cli-calls.log'), 'utf8'), /--status cutover_intent/)
        })
    }

    it('does not classify a clean source checkout as an upgrade from tracked Compose alone', function () {
        const fixture = createFreshInstall()
        roots.push(fixture.root)
        copyFile(path.join(repoRoot, 'docker-compose.yml'), path.join(fixture.root, 'docker-compose.yml'))
        const input = path.join(fixture.root, 'input-config.yaml')
        const initialized = spawnSync(process.execPath, [
            path.join(repoRoot, 'src/cli/config.js'),
            'init', '--output', input, '--provider', 'napcat', '--json'
        ], { cwd: repoRoot, encoding: 'utf8' })
        assert.strictEqual(initialized.status, 0, initialized.stderr)
        const result = runSetup(fixture, [
            '--dry-run', '--provider', 'napcat',
            '--config', input,
            '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1'
        ], { BILI_SETUP_CLI_DRIVER: '' })

        assert.strictEqual(result.status, 0, result.stderr)
        assert.strictEqual(JSON.parse(result.stdout).mode, 'install')
        assert.strictEqual(fs.existsSync(path.join(fixture.root, 'data/setup-state')), false)
    })

    it('does not pull a missing NapCat target during dry-run without --allow-pull', function () {
        const fixture = createLegacyInstall()
        roots.push(fixture.root)
        const result = runSetup(fixture, [
            '--upgrade',
            '--upgrade-napcat',
            '--napcat-image', 'fixture/napcat:missing',
            '--dry-run',
            '--non-interactive',
            '--install-dir', fixture.root,
            '--image', 'fixture/target:1'
        ], {
            FAKE_NAPCAT_TARGET_MISSING: '1'
        })

        assert.strictEqual(result.status, 3, result.stderr)
        assert.strictEqual(JSON.parse(result.stdout).status, 'INCOMPLETE_NAPCAT_IMAGE_UNAVAILABLE')
        assert.doesNotMatch(readCalls(fixture), /pull fixture\/napcat:missing/)
        assert.strictEqual(fs.existsSync(path.join(fixture.root, 'data/setup-state')), false)
    })

    it('installs the Official provider without rendering or waiting for NapCat', function () {
        const fixture = createFreshInstall()
        roots.push(fixture.root)
        const officialConfig = path.join(fixture.root, 'official-config.yaml')
        copyFile(path.join(fixtureRoot, 'official-config.yaml'), officialConfig)
        const result = runSetup(fixture, [
            '--install',
            '--provider', 'official',
            '--config', officialConfig,
            '--non-interactive',
            '--install-dir', fixture.root,
            '--image', 'fixture/target:1',
            '--health-timeout', '5'
        ])

        assert.strictEqual(result.status, 0, result.stderr)
        assert.deepStrictEqual(fs.readdirSync(path.join(fixture.root, 'config')).sort(), ['config.yaml'])
        const compose = fs.readFileSync(path.join(fixture.root, 'docker-compose.yml'), 'utf8')
        assert.doesNotMatch(compose, /\bnapcat:/)
        assert.doesNotMatch(compose, /depends_on/)
        assert.strictEqual(readManifest(fixture).checkpoint, 'upgrade_complete')
        assert.strictEqual(
            fs.readFileSync(path.join(fixture.root, 'data/setup-state/managed-v1'), 'utf8').trim(),
            'release-fixture-attempt'
        )
    })

    it('builds an interactive Official config with the real init DTO without exposing the Secret', function () {
        const fixture = createFreshInstall()
        roots.push(fixture.root)
        const secret = 'official-interactive-secret'
        const result = runSetup(fixture, [
            '--install', '--provider', 'official', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ], { BILI_SETUP_CLI_DRIVER: '' }, {
            input: `official-app-id\n${secret}\nroot-openid-a,root-openid-b\n`
        })

        assert.strictEqual(result.status, 0, result.stderr)
        const generated = YAML.parse(fs.readFileSync(path.join(fixture.root, 'config/config.yaml'), 'utf8'))
        assert.strictEqual(generated.qq.provider, 'official')
        assert.strictEqual(generated.qq.official.appId, 'official-app-id')
        assert.strictEqual(generated.qq.official.clientSecret, secret)
        assert.deepStrictEqual(generated.qq.official.rootOpenids, ['root-openid-a', 'root-openid-b'])
        assert.doesNotMatch(`${result.stdout}\n${result.stderr}\n${readCalls(fixture)}`, new RegExp(secret))
        assert.strictEqual(fs.existsSync(path.join(fixture.root, 'data/setup-state/fixture-attempt/official-init-input.json')), false)
    })

    it('builds an interactive NapCat config with the explicit service URL, administrator and protected token DTO', function () {
        const fixture = createFreshInstall()
        roots.push(fixture.root)
        const token = 'napcat-interactive-token'
        const result = runSetup(fixture, [
            '--install', '--provider', 'napcat', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--napcat-image', 'fixture/napcat:2', '--health-timeout', '5'
        ], { BILI_SETUP_CLI_DRIVER: '' }, {
            input: `123456789\n${token}\n`
        })

        assert.strictEqual(result.status, 0, result.stderr)
        const generated = YAML.parse(fs.readFileSync(path.join(fixture.root, 'config/config.yaml'), 'utf8'))
        assert.strictEqual(generated.qq.provider, 'napcat')
        assert.strictEqual(generated.qq.napcat.wsUrl, 'ws://napcat:3001')
        assert.strictEqual(generated.qq.napcat.wsToken, token)
        assert.strictEqual(generated.admin.rootQQ, '123456789')
        assert.doesNotMatch(`${result.stdout}\n${result.stderr}\n${readCalls(fixture)}`, new RegExp(token))
        assert.strictEqual(fs.existsSync(path.join(fixture.root, 'data/setup-state/fixture-attempt/napcat-init-input.json')), false)
    })

    it('fails an Official first install before probe when AppID or ClientSecret is empty', function () {
        const fixture = createFreshInstall()
        roots.push(fixture.root)
        const invalidConfig = path.join(fixture.root, 'official-empty-secret.yaml')
        const initialized = spawnSync(process.execPath, [
            path.join(repoRoot, 'src/cli/config.js'),
            'init', '--output', invalidConfig, '--provider', 'official', '--json'
        ], { cwd: repoRoot, encoding: 'utf8' })
        assert.strictEqual(initialized.status, 0, initialized.stderr)
        const result = runSetup(fixture, [
            '--install', '--provider', 'official', '--config', invalidConfig,
            '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ], { BILI_SETUP_CLI_DRIVER: '' })

        assert.notStrictEqual(result.status, 0)
        assert.match(result.stderr, /AppID and ClientSecret must both be configured/)
        assert.doesNotMatch(readCalls(fixture), /runtime-probe\.yml/)
    })

    it('installs NapCat with both images pinned by content ID through the real Config CLI', function () {
        const fixture = createFreshInstall()
        roots.push(fixture.root)
        const input = path.join(fixture.root, 'input-config.yaml')
        const initialized = spawnSync(process.execPath, [
            path.join(repoRoot, 'src/cli/config.js'),
            'init', '--output', input, '--provider', 'napcat', '--json'
        ], { cwd: repoRoot, encoding: 'utf8' })
        assert.strictEqual(initialized.status, 0, initialized.stderr)
        const suppliedConfig = fs.readFileSync(input)
        const result = runSetup(fixture, [
            '--install',
            '--provider', 'napcat',
            '--config', input,
            '--non-interactive',
            '--install-dir', fixture.root,
            '--image', 'fixture/target:1',
            '--napcat-image', 'fixture/napcat:2',
            '--health-timeout', '5'
        ], {
            BILI_SETUP_CLI_DRIVER: ''
        })

        assert.strictEqual(result.status, 0, result.stderr)
        assert.deepStrictEqual(fs.readFileSync(input), suppliedConfig)
        assert.deepStrictEqual(fs.readFileSync(path.join(fixture.root, 'config/config.yaml')), suppliedConfig)
        const compose = fs.readFileSync(path.join(fixture.root, 'docker-compose.yml'), 'utf8')
        assert.match(compose, /image: sha256:target-image/)
        assert.match(compose, /image: sha256:target-napcat-image/)
        assert.strictEqual((compose.match(/pull_policy: never/g) || []).length, 2)
        assert.match(compose, /depends_on:[\s\S]*napcat:/)
        assert.strictEqual(readManifest(fixture).checkpoint, 'upgrade_complete')
    })

    it('upgrades legacy config, preserves state, and archives legacy files only after runtime readiness', function () {
        const fixture = createLegacyInstall()
        roots.push(fixture.root)
        fs.writeFileSync(path.join(fixture.root, 'config/.env.example'), 'EXAMPLE_ONLY=true\n', { mode: 0o600 })
        fs.writeFileSync(path.join(fixture.root, 'config/config.json.example'), '{}\n', { mode: 0o600 })
        const beforeState = fs.readFileSync(path.join(fixture.root, 'data/subscription_state.json'), 'utf8')
        const beforeLedger = fs.readFileSync(path.join(fixture.root, 'data/subscription_delivery.json'), 'utf8')
        const result = runSetup(fixture, [
            '--upgrade',
            '--non-interactive',
            '--install-dir', fixture.root,
            '--image', 'fixture/target:1',
            '--health-timeout', '5'
        ])

        assert.strictEqual(result.status, 0, result.stderr)
        assert.deepStrictEqual(fs.readdirSync(path.join(fixture.root, 'config')).sort(), ['config.yaml'])
        assert.strictEqual(fs.readFileSync(path.join(fixture.root, 'data/subscription_state.json'), 'utf8'), beforeState)
        assert.strictEqual(fs.readFileSync(path.join(fixture.root, 'data/subscription_delivery.json'), 'utf8'), beforeLedger)
        assert.strictEqual(readManifest(fixture).checkpoint, 'upgrade_complete')
        assert.strictEqual(
            fs.readFileSync(path.join(fixture.root, 'data/setup-state/managed-v1'), 'utf8').trim(),
            'release-fixture-attempt'
        )
        const archive = path.join(fixture.root, 'data/setup-state/fixture-attempt/retained-vault/archive/legacy')
        assert.ok(fs.existsSync(path.join(archive, '.env')))
        assert.ok(fs.existsSync(path.join(archive, 'config.json')))
        assert.ok(fs.existsSync(path.join(archive, '.env.example')))
        assert.ok(fs.existsSync(path.join(archive, 'config.json.example')))
        assert.deepStrictEqual(readManifest(fixture).cutover.legacyFeatureInventory, [
            'fallback-send', 'napcat-queued-send', 'subscription-push'
        ])
        assert.strictEqual(
            fs.existsSync(path.join(fixture.root, 'data/setup-state/fixture-attempt/runtime-env.snapshot')),
            false
        )
        const calls = readCalls(fixture)
        assert.match(calls, /image tag sha256:old-image bili-qq-bot-rollback:fixture-attempt/)
        assert.match(calls, /runtime-probe\.yml/)
        assert.match(calls, /runtime-release\.yml/)
    })

    it('upgrades legacy sources created with historical 0644 permissions', function () {
        const fixture = createLegacyInstall()
        roots.push(fixture.root)
        loosenLegacyConfigPermissions(fixture.root)
        const result = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ])

        assert.strictEqual(result.status, 0, result.stderr)
        assert.deepStrictEqual(fs.readdirSync(path.join(fixture.root, 'config')), ['config.yaml'])
        assert.strictEqual(fs.statSync(path.join(fixture.root, 'config/config.yaml')).mode & 0o777, 0o600)
        const archive = path.join(fixture.root, 'data/setup-state/fixture-attempt/retained-vault/archive/legacy')
        assert.strictEqual(fs.statSync(path.join(archive, '.env')).mode & 0o777, 0o600)
        assert.strictEqual(fs.statSync(path.join(archive, 'config.json')).mode & 0o777, 0o600)
    })

    it('fails capacity preflight before stopping runtime or mutating data', function () {
        const fixture = createLegacyInstall()
        roots.push(fixture.root)
        const beforeData = fs.readFileSync(path.join(fixture.root, 'data/subscription_state.json'))
        const result = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ], { BILI_SETUP_TEST_AVAILABLE_BYTES: '0', BILI_SETUP_TEST_AVAILABLE_INODES: '0' })

        assert.notStrictEqual(result.status, 0)
        assert.match(result.stderr, /SETUP_CAPACITY_INSUFFICIENT/)
        assert.doesNotMatch(readCalls(fixture), /stop --time| kill | pause /)
        assert.deepStrictEqual(fs.readFileSync(path.join(fixture.root, 'data/subscription_state.json')), beforeData)
        assert.strictEqual(fs.readFileSync(path.join(fixture.stateDir, 'bot-old.running'), 'utf8'), 'true\n')
    })

    for (const mutation of ['symlink', 'hardlink', 'byte-swap']) {
        it(`fails closed when a legacy archive source is replaced by ${mutation}`, function () {
            const fixture = createLegacyInstall()
            roots.push(fixture.root)
            const result = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], { BILI_SETUP_TEST_LEGACY_ARCHIVE_MUTATION: mutation })

            assert.notStrictEqual(result.status, 0)
            assert.match(result.stderr, /archive source changed|same epoch/)
            assert.strictEqual(readManifest(fixture).checkpoint, 'runtime_ready')
            assert.strictEqual(fs.existsSync(path.join(
                fixture.root, 'data/setup-state/fixture-attempt/retained-vault/archive/legacy/config.json'
            )), false)
            assert.strictEqual(fs.existsSync(path.join(fixture.root, 'data/setup-state/active-attempt')), true)
        })
    }

    for (const failpoint of [
        'archive-after-intent-fsync',
        'archive-after-source-rename'
    ]) {
        it(`resumes safely after ${failpoint}`, function () {
            const fixture = createLegacyInstall()
            roots.push(fixture.root)
            const expected = fs.readFileSync(path.join(fixture.root, 'config/.env'))
            const first = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], { BILI_SETUP_TEST_FAILPOINT: failpoint })
            assert.notStrictEqual(first.status, 0)
            assert.strictEqual(readManifest(fixture).checkpoint, 'runtime_ready')
            const source = path.join(fixture.root, 'config/.env')
            const destination = path.join(fixture.root, 'data/setup-state/fixture-attempt/retained-vault/archive/legacy/.env')
            const activeClaims = path.join(fixture.root, 'data/setup-state/fixture-attempt/retained-vault/archive-control/active')
            const claimCopies = fs.existsSync(activeClaims)
                ? fs.readdirSync(activeClaims).filter((name) => name.endsWith('.source-claim')).map((name) => path.join(activeClaims, name))
                : []
            const validCopies = [source, destination, ...claimCopies]
                .filter((candidate) => fs.existsSync(candidate) && !fs.lstatSync(candidate).isSymbolicLink())
                .map((candidate) => fs.readFileSync(candidate))
                .filter((bytes) => bytes.equals(expected))
            assert.ok(validCopies.length >= 1, 'at least one valid archive copy must survive every crash boundary')

            const resumed = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ])
            assert.strictEqual(resumed.status, 0, resumed.stderr)
            assert.strictEqual(fs.existsSync(source), false)
            assert.deepStrictEqual(fs.readFileSync(destination), expected)
            assert.strictEqual(readManifest(fixture).checkpoint, 'upgrade_complete')
        })
    }

    it('retains an archive intent as typed private inventory instead of unlinking it', function () {
        const fixture = createLegacyInstall()
        roots.push(fixture.root)
        const result = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ])
        assert.strictEqual(result.status, 0, result.stderr)
        const retained = retainedVault(fixture.root)
        const intents = retained.inventory.retained.filter((item) => item.scope === 'archive-control-intent')
        assert.ok(intents.length >= 2)
        for (const item of intents) {
            assert.match(item.retainedPath, /retained-vault\/archive-control\/completed\/[a-f0-9]{64}\.json$/)
            assert.strictEqual(fs.statSync(item.retainedPath).mode & 0o777, 0o600)
            assert.strictEqual(fs.statSync(item.retainedPath).nlink, 1)
            const value = JSON.parse(fs.readFileSync(item.retainedPath, 'utf8'))
            assert.strictEqual(value.kind, 'archive-file')
            assert.strictEqual(value.attemptId, 'fixture-attempt')
            assert.strictEqual(value.releaseEpoch, 'release-fixture-attempt')
        }
        assert.ok(Number.isSafeInteger(retained.inventory.generation) && retained.inventory.generation > 0)
    })

    it('fails closed and preserves a replaced archive destination after fd verification', function () {
        const fixture = createLegacyInstall()
        roots.push(fixture.root)
        const result = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ], { BILI_SETUP_TEST_ARCHIVE_DESTINATION_REPLACEMENT: 'verify-before-fchmod' })
        assert.notStrictEqual(result.status, 0)
        assert.match(result.stderr, /archive source changed|same epoch/)
        assert.ok(findFileContaining(fixture.root, 'unknown archive destination replacement'))
        assert.strictEqual(readManifest(fixture).checkpoint, 'runtime_ready')
    })

    it('does not replace an archive destination that appears at the no-replace publication boundary', function () {
        const fixture = createLegacyInstall()
        roots.push(fixture.root)
        const result = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ], { BILI_SETUP_TEST_ARCHIVE_DESTINATION_REPLACEMENT: 'before-no-replace-publish' })
        assert.notStrictEqual(result.status, 0)
        assert.match(result.stderr, /archive source changed|same epoch/)
        assert.ok(findFileContaining(fixture.root, 'unknown archive destination before publish'))
        assert.strictEqual(readManifest(fixture).checkpoint, 'runtime_ready')
    })

    it('preserves an archive destination that appears after the final source verification', function () {
        const fixture = createLegacyInstall()
        roots.push(fixture.root)
        const result = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ], { BILI_SETUP_TEST_ARCHIVE_DESTINATION_REPLACEMENT: 'final-check-race' })
        assert.notStrictEqual(result.status, 0)
        assert.match(result.stderr, /archive source changed|same epoch/)
        assert.ok(findFileContaining(fixture.root, 'unknown archive destination at final check'))
        assert.strictEqual(readManifest(fixture).checkpoint, 'runtime_ready')
    })

    it('does not replace a completed archive intent that appears at publication', function () {
        const fixture = createLegacyInstall()
        roots.push(fixture.root)
        const result = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ], { BILI_SETUP_TEST_ARCHIVE_COMPLETED_INTENT_REPLACEMENT: 'before-no-replace-publish' })
        assert.notStrictEqual(result.status, 0)
        assert.match(result.stderr, /archive source changed|same epoch/)
        assert.ok(findFileContaining(fixture.root, 'unknown completed intent before publish'), result.stderr)
        assert.strictEqual(readManifest(fixture).checkpoint, 'runtime_ready')
    })

    it('rechecks capacity before resuming a durable archive intent', function () {
        const fixture = createLegacyInstall()
        roots.push(fixture.root)
        const first = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ], { BILI_SETUP_TEST_FAILPOINT: 'archive-after-intent-fsync' })
        assert.notStrictEqual(first.status, 0)
        const attempt = path.join(fixture.root, 'data/setup-state/fixture-attempt')
        const active = path.join(attempt, 'retained-vault/archive-control/active')
        assert.ok(fs.readdirSync(active).some((name) => name.endsWith('.json')))
        const resumed = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ], { BILI_SETUP_TEST_AVAILABLE_BYTES: '0', BILI_SETUP_TEST_AVAILABLE_INODES: '0' })
        assert.notStrictEqual(resumed.status, 0)
        assert.match(resumed.stderr, /SETUP_CAPACITY_INSUFFICIENT/)
        assert.ok(fs.readdirSync(active).some((name) => name.endsWith('.json')))
        assert.strictEqual(readManifest(fixture).checkpoint, 'runtime_ready')
    })

    for (const unsafe of ['corrupt', 'symlink', '0644', 'hardlink']) {
        it(`preserves recovery-required state for an unsafe archive intent (${unsafe})`, function () {
            const fixture = createLegacyInstall()
            roots.push(fixture.root)
            const first = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], { BILI_SETUP_TEST_FAILPOINT: 'archive-after-intent-fsync' })
            assert.notStrictEqual(first.status, 0)
            const active = path.join(fixture.root, 'data/setup-state/fixture-attempt/retained-vault/archive-control/active')
            const intent = path.join(active, fs.readdirSync(active).find((name) => name.endsWith('.json')))
            if (unsafe === 'corrupt') fs.writeFileSync(intent, '{bad\n', { mode: 0o600 })
            if (unsafe === 'symlink') {
                fs.rmSync(intent)
                const outside = path.join(fixture.root, 'unsafe-archive-intent.json')
                fs.writeFileSync(outside, '{}\n', { mode: 0o600 })
                fs.symlinkSync(outside, intent)
            }
            if (unsafe === '0644') fs.chmodSync(intent, 0o644)
            if (unsafe === 'hardlink') fs.linkSync(intent, path.join(fixture.root, 'archive-intent-second-link'))
            const resumed = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ])
            assert.notStrictEqual(resumed.status, 0)
            assert.match(resumed.stderr, /archive source changed|same epoch/)
            assert.doesNotThrow(() => fs.lstatSync(intent))
            assert.strictEqual(readManifest(fixture).checkpoint, 'runtime_ready')
        })
    }

    it('does not overwrite a concurrent archive inventory generation', function () {
        const fixture = createLegacyInstall()
        roots.push(fixture.root)
        const result = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ], { BILI_SETUP_TEST_ARCHIVE_INVENTORY_REPLACEMENT: 'inode' })
        assert.notStrictEqual(result.status, 0)
        assert.match(result.stderr, /archive source changed|same epoch/)
        const vault = path.join(fixture.root, 'data/setup-state/fixture-attempt/retained-vault')
        assert.ok(findFileContaining(vault, 'concurrent-inventory'))
        assert.strictEqual(readManifest(fixture).checkpoint, 'runtime_ready')
    })

    it('preserves an archive inventory replacement after CAS and before publication', function () {
        const fixture = createLegacyInstall()
        roots.push(fixture.root)
        const result = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ], { BILI_SETUP_TEST_ARCHIVE_INVENTORY_REPLACEMENT: 'after-cas-before-publish' })
        assert.notStrictEqual(result.status, 0)
        assert.match(result.stderr, /archive source changed|same epoch/)
        const vault = path.join(fixture.root, 'data/setup-state/fixture-attempt/retained-vault')
        assert.ok(findFileContaining(vault, 'concurrent-inventory-after-cas'), result.stderr)
        assert.strictEqual(readManifest(fixture).checkpoint, 'runtime_ready')
    })

    for (const failpoint of [
        ...[1, 2, 3].map((index) => `publication-restore-before-data-entry-${index}`),
        ...[1, 2, 3].map((index) => `publication-restore-after-data-entry-rename-${index}`),
        ...[1, 2, 3].map((index) => `publication-restore-after-data-entry-journal-${index}`)
    ]) {
        // Accepted residual risk: publication-restore process interruption is outside
        // the supported automatic recovery guarantee (plan section 18.45).
        it.skip(`resumes per-entry data publication across ${failpoint}`, function () {
            const fixture = createManagedInstall()
            roots.push(fixture.root)
            fs.writeFileSync(path.join(fixture.root, 'data/alpha-state.json'), '{"alpha":1}\n', { mode: 0o600 })
            fs.mkdirSync(path.join(fixture.root, 'data/middle-state'), { mode: 0o700 })
            fs.writeFileSync(path.join(fixture.root, 'data/middle-state/value'), 'middle\n', { mode: 0o600 })
            fs.writeFileSync(path.join(fixture.root, 'data/zeta-state.json'), '{"zeta":1}\n', { mode: 0o600 })
            const expected = treeInventory(path.join(fixture.root, 'data'), { exclude: new Set(['setup-state']) })
            const seeded = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], { BILI_SETUP_TEST_FAILPOINT: 'publish-after-compose-before-ownership' })
            assert.notStrictEqual(seeded.status, 0)
            const interrupted = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], { BILI_SETUP_TEST_PUBLICATION_RESTORE_FAILPOINT: failpoint })
            assert.notStrictEqual(interrupted.status, 0)
            const recovered = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ])
            assert.strictEqual(recovered.status, 75, recovered.stderr)
            assert.deepStrictEqual(treeInventory(path.join(fixture.root, 'data'), { exclude: new Set(['setup-state']) }), expected)
        })
    }

    for (const failpoint of [
        'prepublication-restore-after-workspace-mkdir',
        'prepublication-restore-after-discard-mkdir',
        'prepublication-restore-after-candidate-mkdir',
        'prepublication-restore-after-candidate-clear',
        'prepublication-restore-after-candidate-copy',
        ...[1, 2, 3].flatMap((index) => [
            `prepublication-restore-before-live-entry-${index}`,
            `prepublication-restore-after-live-entry-rename-${index}`,
            `prepublication-restore-before-data-entry-${index}`,
            `prepublication-restore-after-data-entry-rename-${index}`,
            `prepublication-restore-before-cleanup-entry-${index}`,
            `prepublication-restore-after-cleanup-entry-rename-${index}`,
            `prepublication-restore-after-cleanup-entry-delete-${index}`
        ]),
        'prepublication-restore-before-candidate-delete',
        'prepublication-restore-after-candidate-delete',
        'prepublication-restore-before-discard-delete',
        'prepublication-restore-after-discard-delete',
        'prepublication-restore-before-workspace-delete',
        'prepublication-restore-after-workspace-delete'
    ]) {
        it(`resumes pre-publication snapshot restore across ${failpoint}`, function () {
            const fixture = createManagedInstall()
            roots.push(fixture.root)
            const expected = treeInventory(path.join(fixture.root, 'data'), { exclude: new Set(['setup-state']) })
            const interrupted = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], {
                BILI_SETUP_TEST_FAILPOINT: 'upgrade-after-compose-render',
                BILI_SETUP_TEST_PREPUBLICATION_RESTORE_FAILPOINT: failpoint
            })
            assert.notStrictEqual(interrupted.status, 0)
            const recovered = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ])
            assert.strictEqual(recovered.status, 75, recovered.stderr)
            assert.deepStrictEqual(treeInventory(path.join(fixture.root, 'data'), { exclude: new Set(['setup-state']) }), expected)
            assert.strictEqual(fs.existsSync(path.join(
                fixture.root, 'data/setup-state/fixture-attempt/prepublication-data-restore'
            )), true)
            assertRetainedScope(fixture.root, 'prepublication')
        })
    }

    it('fails closed when the journaled data candidate inode is replaced', function () {
        const fixture = createManagedInstall()
        roots.push(fixture.root)
        const seeded = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ], { BILI_SETUP_TEST_FAILPOINT: 'publish-after-compose-before-ownership' })
        assert.notStrictEqual(seeded.status, 0)
        const replaced = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ], { BILI_SETUP_TEST_DATA_CANDIDATE_REPLACEMENT: 'inode' })
        assert.notStrictEqual(replaced.status, 75)
        const candidate = path.join(fixture.root, 'data/setup-state/.setup-publication-restore.fixture-attempt/data-candidate')
        assert.strictEqual(fs.readFileSync(path.join(candidate, 'unknown'), 'utf8'), 'unknown-data-candidate\n')
    })

    it('preserves an unknown deterministic data candidate temp directory', function () {
        const fixture = createManagedInstall()
        roots.push(fixture.root)
        const seeded = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ], { BILI_SETUP_TEST_FAILPOINT: 'publish-after-compose-before-ownership' })
        assert.notStrictEqual(seeded.status, 0)
        const recovered = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ], { BILI_SETUP_TEST_DATA_CANDIDATE_TEMP_CONFLICT: '1' })

        assert.notStrictEqual(recovered.status, 75)
        const temporary = path.join(fixture.root, 'data/setup-state/.setup-publication-restore.fixture-attempt/data-candidate.tmp')
        assert.strictEqual(fs.readFileSync(path.join(temporary, 'unknown'), 'utf8'), 'unknown-data-candidate-temp\n')
    })

    for (const failpoint of [
        'publication-restore-after-data-candidate-mkdir',
        'publication-restore-after-data-candidate-ready',
        'publication-restore-after-data-candidate-rename'
    ]) {
        it(`reconciles the journal-bound random data candidate across ${failpoint}`, function () {
            const fixture = createManagedInstall()
            roots.push(fixture.root)
            const seeded = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], { BILI_SETUP_TEST_FAILPOINT: 'publish-after-compose-before-ownership' })
            assert.notStrictEqual(seeded.status, 0)
            const interrupted = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], { BILI_SETUP_TEST_PUBLICATION_RESTORE_FAILPOINT: failpoint })
            assert.notStrictEqual(interrupted.status, 0)
            const recovered = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ])
            assert.strictEqual(recovered.status, 75, recovered.stderr)
            assert.strictEqual(readManifest(fixture).checkpoint, 'rolled_back')
        })
    }

    for (const workspaceKind of ['install', 'data']) {
        it(`fails closed on a preoccupied ${workspaceKind} publication restore workspace`, function () {
            const fixture = createManagedInstall()
            roots.push(fixture.root)
            const seeded = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], { BILI_SETUP_TEST_FAILPOINT: 'publish-after-compose-before-ownership' })
            assert.notStrictEqual(seeded.status, 0)
            const workspace = workspaceKind === 'install'
                ? path.join(fixture.root, '.setup-publication-restore.fixture-attempt')
                : path.join(fixture.root, 'data/setup-state/.setup-publication-restore.fixture-attempt')
            fs.mkdirSync(workspace, { mode: 0o700 })
            fs.writeFileSync(path.join(workspace, 'unknown'), 'unknown-workspace-bytes\n', { mode: 0o600 })
            const recovered = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ])
            assert.notStrictEqual(recovered.status, 75)
            assert.strictEqual(fs.readFileSync(path.join(workspace, 'unknown'), 'utf8'), 'unknown-workspace-bytes\n')
        })
    }

    for (const workspaceKind of ['install', 'data']) {
        it(`resumes publication workspace creation after ${workspaceKind} mkdir`, function () {
            const fixture = createManagedInstall()
            roots.push(fixture.root)
            const seeded = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], { BILI_SETUP_TEST_FAILPOINT: 'publish-after-compose-before-ownership' })
            assert.notStrictEqual(seeded.status, 0)
            const interrupted = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], { BILI_SETUP_TEST_PUBLICATION_RESTORE_FAILPOINT: `publication-workspace-after-mkdir-${workspaceKind}` })
            assert.notStrictEqual(interrupted.status, 0)
            const recovered = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ])
            assert.strictEqual(recovered.status, 75, recovered.stderr)
        })
    }

    for (const workspaceKind of ['install', 'data']) {
        it(`rejects ${workspaceKind} workspace inode replacement before cleanup`, function () {
            const fixture = createManagedInstall()
            roots.push(fixture.root)
            const seeded = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], { BILI_SETUP_TEST_FAILPOINT: 'publish-after-compose-before-ownership' })
            assert.notStrictEqual(seeded.status, 0)
            const replaced = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], { BILI_SETUP_TEST_PUBLICATION_WORKSPACE_REPLACEMENT: workspaceKind })
            assert.notStrictEqual(replaced.status, 75)
            const workspace = workspaceKind === 'install'
                ? path.join(fixture.root, '.setup-publication-restore.fixture-attempt')
                : path.join(fixture.root, 'data/setup-state/.setup-publication-restore.fixture-attempt')
            assert.strictEqual(fs.readFileSync(path.join(workspace, 'unknown'), 'utf8'), 'unknown-workspace-bytes\n')
        })
    }

    for (const stashIndex of [1, 2, 3, 4]) {
        it(`preserves unknown bytes at deterministic publication restore stash ${stashIndex}`, function () {
            const fixture = createManagedInstall()
            roots.push(fixture.root)
            const seeded = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], { BILI_SETUP_TEST_FAILPOINT: stashIndex >= 3 ? 'publication-after-claim-1' : 'publish-after-compose-before-ownership' })
            assert.notStrictEqual(seeded.status, 0)
            const conflicted = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], { BILI_SETUP_TEST_PUBLICATION_RESTORE_STASH_CONFLICT: String(stashIndex) })
            assert.notStrictEqual(conflicted.status, 0)
            const names = ['ownership-candidate', 'ownership-claimed', 'install-quarantine', 'ownership-quarantine']
            const workspace = stashIndex === 3
                ? path.join(fixture.root, '.setup-publication-restore.fixture-attempt')
                : path.join(fixture.root, 'data/setup-state/.setup-publication-restore.fixture-attempt')
            const stash = path.join(workspace, names[stashIndex - 1])
            assert.strictEqual(fs.readFileSync(stash, 'utf8'), `unknown-stash-${stashIndex}\n`)
            assert.strictEqual(readManifest(fixture).checkpoint, 'failed')
        })
    }

    for (const mutation of ['missing', 'dangling']) {
        it(`keeps legacy archive recovery in the same epoch for a ${mutation} source`, function () {
            const fixture = createLegacyInstall()
            roots.push(fixture.root)
            const result = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], { BILI_SETUP_TEST_LEGACY_ARCHIVE_MUTATION: mutation })
            assert.notStrictEqual(result.status, 0)
            assert.match(result.stderr, /archive source changed|same epoch/)
            assert.strictEqual(readManifest(fixture).checkpoint, 'runtime_ready')
            assert.ok(fs.existsSync(path.join(fixture.root, 'data/setup-state/active-attempt')))
        })
    }

    it('renders an upgrade only from the frozen Compose snapshot', function () {
        const fixture = createLegacyInstall()
        roots.push(fixture.root)
        const before = fs.readFileSync(path.join(fixture.root, 'docker-compose.yml'), 'utf8')
        const result = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ], { BILI_SETUP_TEST_FAILPOINT: 'upgrade-after-compose-render' })

        assert.notStrictEqual(result.status, 0)
        const calls = fs.readFileSync(path.join(fixture.stateDir, 'cli-calls.log'), 'utf8')
        assert.match(calls, /--existing-compose[^\n]*\/staging\/snapshot\/docker-compose\.yml/)
        assert.doesNotMatch(calls, /--existing-compose[^\n]*\/install\/docker-compose\.yml/)
        assert.strictEqual(fs.readFileSync(path.join(fixture.root, 'docker-compose.yml'), 'utf8'), before)
    })

    it('renders managed Compose and ownership from the same frozen snapshot', function () {
        const fixture = createManagedInstall()
        roots.push(fixture.root)
        const result = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ], { BILI_SETUP_TEST_FAILPOINT: 'upgrade-after-compose-render' })

        assert.notStrictEqual(result.status, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`)
        const calls = fs.readFileSync(path.join(fixture.stateDir, 'cli-calls.log'), 'utf8')
        assert.match(calls, /--existing-compose[^\n]*\/staging\/snapshot\/docker-compose\.yml/)
        assert.match(calls, /--ownership[^\n]*\/staging\/snapshot\/setup-control\/compose-ownership\.json/)
        assert.doesNotMatch(calls, /--ownership[^\n]*\/current\/data\/setup-state\/compose-ownership\.json/)
    })

    it('preserves a concurrent Compose replacement immediately before upgrade publish', function () {
        const fixture = assertConcurrentComposeUpgradeRefused(createLegacyInstall)
        roots.push(fixture.root)
    })

    it('preserves a concurrent Compose replacement during managed upgrade', function () {
        const fixture = assertConcurrentComposeUpgradeRefused(createManagedInstall)
        roots.push(fixture.root)
    })

    it('preserves a concurrent Compose replacement that races candidate publication', function () {
        const fixture = assertConcurrentComposeDuringPublishRefused(createManagedInstall)
        roots.push(fixture.root)
    })

    it('preserves concurrent ownership bytes when the second artifact publication loses the race', function () {
        const fixture = createManagedInstall()
        roots.push(fixture.root)
        const ownership = path.join(fixture.root, 'data/setup-state/compose-ownership.json')
        const concurrentSource = path.join(fixture.root, 'concurrent-ownership.json')
        const concurrent = '{"version":1,"owner":"concurrent-user"}\n'
        fs.writeFileSync(concurrentSource, concurrent, { mode: 0o600 })
        const result = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ], { BILI_SETUP_TEST_CONCURRENT_OWNERSHIP_DURING_PUBLISH_SOURCE: concurrentSource })

        assert.notStrictEqual(result.status, 0)
        assert.match(result.stderr, /ownership appeared during publication/)
        assert.strictEqual(fs.readFileSync(ownership, 'utf8'), concurrent)
        assert.deepStrictEqual(
            fs.readdirSync(path.dirname(ownership)).filter((name) => name.startsWith('.compose-ownership.')),
            []
        )
        assert.strictEqual(fs.readFileSync(path.join(fixture.stateDir, 'bot-old.running'), 'utf8'), 'true\n')
    })

    it('preserves ownership mutated after the frozen snapshot', function () {
        const fixture = createManagedInstall()
        roots.push(fixture.root)
        const ownership = path.join(fixture.root, 'data/setup-state/compose-ownership.json')
        const concurrentSource = path.join(fixture.root, 'concurrent-ownership-before-publish.json')
        const concurrent = '{"version":1,"owner":"snapshot-race"}\n'
        fs.writeFileSync(concurrentSource, concurrent, { mode: 0o600 })
        const result = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ], { BILI_SETUP_TEST_CONCURRENT_OWNERSHIP_SOURCE: concurrentSource })

        assert.notStrictEqual(result.status, 0)
        assert.match(result.stderr, /ownership changed after snapshot/)
        assert.strictEqual(fs.readFileSync(ownership, 'utf8'), concurrent)
    })

    it('preserves ownership that appears while publishing from an absent snapshot', function () {
        const fixture = createManagedInstall()
        roots.push(fixture.root)
        const ownership = path.join(fixture.root, 'data/setup-state/compose-ownership.json')
        fs.rmSync(ownership)
        const concurrentSource = path.join(fixture.root, 'concurrent-ownership-appeared.json')
        const concurrent = '{"version":1,"owner":"appeared"}\n'
        fs.writeFileSync(concurrentSource, concurrent, { mode: 0o600 })
        const result = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ], { BILI_SETUP_TEST_CONCURRENT_OWNERSHIP_DURING_PUBLISH_SOURCE: concurrentSource })

        assert.notStrictEqual(result.status, 0)
        assert.match(result.stderr, /ownership appeared during publication/)
        assert.strictEqual(fs.readFileSync(ownership, 'utf8'), concurrent)
    })

    it('recovers a crash between Compose and ownership publication in the same epoch', function () {
        const fixture = createManagedInstall()
        roots.push(fixture.root)
        const compose = path.join(fixture.root, 'docker-compose.yml')
        const ownership = path.join(fixture.root, 'data/setup-state/compose-ownership.json')
        const oldCompose = fs.readFileSync(compose)
        const oldOwnership = fs.readFileSync(ownership)
        const crashed = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ], { BILI_SETUP_TEST_FAILPOINT: 'publish-after-compose-before-ownership' })
        assert.notStrictEqual(crashed.status, 0)

        const recovered = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ])
        assert.strictEqual(recovered.status, 75, recovered.stderr)
        assert.deepStrictEqual(fs.readFileSync(compose), oldCompose)
        assert.deepStrictEqual(fs.readFileSync(ownership), oldOwnership)
        assert.deepStrictEqual(fs.readdirSync(fixture.root).filter((name) => name.startsWith('.docker-compose.yml.')), [])
        assert.deepStrictEqual(fs.readdirSync(path.dirname(ownership)).filter((name) => name.startsWith('.compose-ownership.')), [])
    })

    for (const conflict of ['compose-candidate', 'compose-claim', 'ownership-candidate', 'ownership-claim']) {
        it(`retains an unjournaled pre-existing ${conflict} publication path`, function () {
            const fixture = createManagedInstall()
            roots.push(fixture.root)
            const stateRoot = path.join(fixture.root, 'data/setup-state')
            const targets = {
                'compose-candidate': path.join(fixture.root, '.docker-compose.yml.candidate.fixture-attempt'),
                'compose-claim': path.join(fixture.root, '.docker-compose.yml.claimed.fixture-attempt'),
                'ownership-candidate': path.join(stateRoot, '.compose-ownership.candidate.fixture-attempt'),
                'ownership-claim': path.join(stateRoot, '.compose-ownership.claimed.fixture-attempt')
            }
            const target = targets[conflict]
            const bytes = Buffer.from(`foreign-${conflict}\n`)
            fs.writeFileSync(target, bytes, { mode: 0o600 })
            const result = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ])

            assert.notStrictEqual(result.status, 0)
            assert.match(result.stderr, /publication staging path already exists|publication-claim-cleanup/)
            assert.deepStrictEqual(fs.readFileSync(target), bytes)
            assert.strictEqual(readManifest(fixture).checkpoint, 'failed')
        })
    }

    for (const conflict of ['journal-tmp', 'claim-next']) {
        it(`preserves an unknown deterministic publication writer temp: ${conflict}`, function () {
            const fixture = createManagedInstall()
            roots.push(fixture.root)
            const result = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], { BILI_SETUP_TEST_PUBLICATION_WRITER_CONFLICT: conflict })

            assert.notStrictEqual(result.status, 0)
            const suffix = conflict === 'journal-tmp' ? '.tmp' : '.claim-next'
            const target = path.join(fixture.root, `data/setup-state/fixture-attempt/publication-journal.json${suffix}`)
            assert.ok(fs.existsSync(target), `unknown ${conflict} bytes must remain`) 
            assert.match(fs.readFileSync(target, 'utf8'), /unknown publication/)
        })
    }

    it('retains a journaled publication path whose inode is replaced before cleanup', function () {
        const fixture = createManagedInstall()
        roots.push(fixture.root)
        const target = path.join(fixture.root, '.docker-compose.yml.candidate.fixture-attempt')
        const result = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ], { BILI_SETUP_TEST_PUBLICATION_CLEANUP_REPLACEMENT: 'compose-candidate' })

        assert.notStrictEqual(result.status, 0)
        assert.match(result.stderr, /publication journal cleanup validation failed|publication-claim-cleanup/)
        assert.strictEqual(fs.readFileSync(target, 'utf8'), 'concurrent publication replacement\n')
        assert.strictEqual(readManifest(fixture).checkpoint, 'failed')
    })

    it('fails closed when a journaled original publication path disappears without a claimed record', function () {
        const fixture = createManagedInstall()
        roots.push(fixture.root)
        const seeded = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ], { BILI_SETUP_TEST_FAILPOINT: 'publish-after-compose-before-ownership' })
        assert.notStrictEqual(seeded.status, 0)
        const candidate = path.join(fixture.root, '.docker-compose.yml.candidate.fixture-attempt')
        fs.rmSync(candidate)
        const recovered = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ])
        assert.notStrictEqual(recovered.status, 75)
        assert.strictEqual(readManifest(fixture).checkpoint, 'failed')
    })

    for (const unsafeJournal of ['missing', 'symlink', '0644']) {
        it(`fails closed with publication traces and a ${unsafeJournal} journal`, function () {
            const fixture = createManagedInstall()
            roots.push(fixture.root)
            const seeded = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], { BILI_SETUP_TEST_FAILPOINT: 'publish-after-compose-before-ownership' })
            assert.notStrictEqual(seeded.status, 0)
            const journal = path.join(fixture.root, 'data/setup-state/fixture-attempt/publication-journal.json')
            if (unsafeJournal === 'missing') fs.rmSync(journal)
            if (unsafeJournal === 'symlink') {
                fs.rmSync(journal)
                fs.symlinkSync(path.join(fixture.root, 'docker-compose.yml'), journal)
            }
            if (unsafeJournal === '0644') fs.chmodSync(journal, 0o644)
            const composeCandidate = path.join(fixture.root, '.docker-compose.yml.candidate.fixture-attempt')
            const candidateBytes = fs.readFileSync(composeCandidate)

            const recovered = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ])
            assert.notStrictEqual(recovered.status, 75)
            assert.deepStrictEqual(fs.readFileSync(composeCandidate), candidateBytes)
            assert.strictEqual(readManifest(fixture).checkpoint, 'failed')
        })
    }

    for (const unsafeIntent of ['corrupt', 'symlink', '0644', 'hardlink', 'fifo', 'wrong-attempt', 'wrong-kind']) {
        it(`fails closed with an unsafe publication intent: ${unsafeIntent}`, function () {
            const fixture = createManagedInstall()
            roots.push(fixture.root)
            const seeded = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], { BILI_SETUP_TEST_FAILPOINT: 'publish-after-compose-before-ownership' })
            assert.notStrictEqual(seeded.status, 0)
            const attempt = path.join(fixture.root, 'data/setup-state/fixture-attempt')
            const intent = path.join(attempt, 'publication-intent.json')
            if (unsafeIntent === 'corrupt') fs.writeFileSync(intent, '{broken\n', { mode: 0o600 })
            if (unsafeIntent === 'symlink') { fs.rmSync(intent); fs.symlinkSync(path.join(fixture.root, 'docker-compose.yml'), intent) }
            if (unsafeIntent === '0644') fs.chmodSync(intent, 0o644)
            if (unsafeIntent === 'hardlink') fs.linkSync(intent, path.join(attempt, 'publication-intent-second-link'))
            if (unsafeIntent === 'fifo') { fs.rmSync(intent); spawnSync('mkfifo', [intent]); fs.chmodSync(intent, 0o600) }
            if (unsafeIntent === 'wrong-attempt') fs.writeFileSync(intent, '{"version":1,"attemptId":"other","kind":"compose-ownership-publication"}\n', { mode: 0o600 })
            if (unsafeIntent === 'wrong-kind') fs.writeFileSync(intent, '{"version":1,"attemptId":"fixture-attempt","kind":"other"}\n', { mode: 0o600 })
            const candidate = path.join(fixture.root, '.docker-compose.yml.candidate.fixture-attempt')
            const bytes = fs.readFileSync(candidate)
            const recovered = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ])
            assert.notStrictEqual(recovered.status, 75)
            assert.deepStrictEqual(fs.readFileSync(candidate), bytes)
        })
    }

    for (const failpoint of [
        'publication-before-compose-claim',
        'publication-after-compose-claim-before-journal',
        'publication-before-ownership-claim',
        'publication-after-ownership-claim-before-journal'
    ]) {
        it(`reconciles durable publication claim state after ${failpoint}`, function () {
            const fixture = createManagedInstall()
            roots.push(fixture.root)
            const crashed = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], { BILI_SETUP_TEST_FAILPOINT: failpoint })
            assert.notStrictEqual(crashed.status, 0)
            const recovered = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ])
            assert.strictEqual(recovered.status, 75, recovered.stderr)
            const retained = assertRetainedScope(fixture.root, 'publication-authoritative-journal')
            assert.strictEqual(fs.existsSync(path.join(retained.vault, 'publication/publication-journal.json')), true)
            assert.strictEqual(fs.existsSync(path.join(retained.vault, 'publication/publication-intent.json')), true)
        })
    }

    for (const failpoint of [
        'publication-terminal-before-intent-unlink',
        'publication-terminal-after-intent-unlink',
        'publication-terminal-after-intent-removed-journal',
        'publication-terminal-before-journal-unlink'
    ]) {
        const terminalCleanupTest = failpoint === 'publication-terminal-after-intent-unlink' ? it.skip : it
        terminalCleanupTest(`resumes terminal publication cleanup after ${failpoint}`, function () {
            const fixture = createManagedInstall()
            roots.push(fixture.root)
            const seeded = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], { BILI_SETUP_TEST_FAILPOINT: 'publish-after-compose-before-ownership' })
            assert.notStrictEqual(seeded.status, 0)
            const crashed = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], { BILI_SETUP_TEST_FAILPOINT: failpoint })
            assert.notStrictEqual(crashed.status, 0)
            const recovered = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ])
            assert.strictEqual(recovered.status, 75, recovered.stderr)
            const attempt = path.join(fixture.root, 'data/setup-state/fixture-attempt')
            assert.strictEqual(fs.existsSync(path.join(attempt, 'publication-intent.json')), false)
            assert.strictEqual(fs.existsSync(path.join(attempt, 'publication-journal.json')), false)
            const retained = assertRetainedScope(fixture.root, 'publication-intent')
            assert.strictEqual(fs.existsSync(path.join(retained.vault, 'publication/publication-intent.json')), true)
            assert.strictEqual(fs.existsSync(path.join(retained.vault, 'publication/publication-journal.json')), true)
        })
    }

    for (const failpoint of [
        'publication-workspace-cleanup-after-journal-unlink-before-state',
        'publication-workspace-cleanup-after-journal-unlink',
        'publication-workspace-cleanup-after-install-rmdir'
    ]) {
        it(`resumes publication workspace cleanup after ${failpoint}`, function () {
            const fixture = createManagedInstall()
            roots.push(fixture.root)
            const seeded = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], { BILI_SETUP_TEST_FAILPOINT: 'publish-after-compose-before-ownership' })
            assert.notStrictEqual(seeded.status, 0)
            const crashed = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], { BILI_SETUP_TEST_FAILPOINT: failpoint })
            assert.notStrictEqual(crashed.status, 0)
            const recovered = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ])
            assert.strictEqual(recovered.status, 75, recovered.stderr)
            assert.strictEqual(fs.existsSync(path.join(fixture.root, '.setup-publication-restore.fixture-attempt')), true)
            assert.strictEqual(fs.existsSync(path.join(fixture.root, 'data/setup-state/.setup-publication-restore.fixture-attempt')), true)
            assertRetainedScope(fixture.root, 'publication-install-workspace')
            assertRetainedScope(fixture.root, 'publication-data-workspace')
        })
    }

    for (const replacement of ['symlink', '0644', 'hardlink', 'inode', 'open-unlink']) {
        const externalJournalTest = ['symlink', '0644', 'hardlink'].includes(replacement) ? it.skip : it
        externalJournalTest(`fails closed when the external workspace journal is replaced by ${replacement}`, function () {
            const fixture = createManagedInstall()
            roots.push(fixture.root)
            const seeded = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], { BILI_SETUP_TEST_FAILPOINT: 'publish-after-compose-before-ownership' })
            assert.notStrictEqual(seeded.status, 0)
            const replaced = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], { BILI_SETUP_TEST_EXTERNAL_JOURNAL_REPLACEMENT: replacement })
            assert.notStrictEqual(replaced.status, 75)
            const external = path.join(fixture.root, 'data/setup-state/.setup-publication-restore.fixture-attempt/publication-journal.json')
            if (replacement === 'symlink') assert.strictEqual(fs.lstatSync(external).isSymbolicLink(), true)
            else {
                const unknown = path.join(fixture.root, 'data/setup-state/fixture-attempt/retained-vault/publication/external-journal-unknown')
                assert.strictEqual(fs.statSync(unknown).mode & 0o777, 0o600)
                if (['inode', 'open-unlink'].includes(replacement)) assert.match(fs.readFileSync(unknown, 'utf8'), /unknown-publication-race/)
                if (replacement === 'hardlink') assert.strictEqual(fs.statSync(unknown).nlink, 2)
            }
            const retained = retainedVault(fixture.root)
            assert.ok(retained.inventory.retained.some((item) => item.scope === 'publication-external-journal' && item.disposition === 'unknown'))
        })
    }

    for (const raceHook of [
        'lstat-open-2', 'lstat-open-4',
        'open-claim-2', 'open-claim-4',
        'claim-unlink-2', 'claim-unlink-4'
    ]) {
        // Same-UID namespace replacement at these final cleanup hooks is an
        // accepted setup-only residual risk (plan section 18.45).
        it.skip(`preserves every publication artifact on ${raceHook} replacement`, function () {
            const fixture = createManagedInstall()
            roots.push(fixture.root)
            const stateRoot = path.join(fixture.root, 'data/setup-state')
            const installQuarantine = path.join(fixture.root, '.bili-publication-quarantine.fixture-attempt')
            const ownershipQuarantine = path.join(stateRoot, '.bili-publication-quarantine.fixture-attempt')
            const originals = [
                path.join(fixture.root, '.docker-compose.yml.candidate.fixture-attempt'),
                path.join(fixture.root, '.docker-compose.yml.claimed.fixture-attempt'),
                path.join(stateRoot, '.compose-ownership.candidate.fixture-attempt'),
                path.join(stateRoot, '.compose-ownership.claimed.fixture-attempt')
            ]
            const claims = [
                path.join(installQuarantine, `1-${path.basename(originals[0])}`),
                path.join(installQuarantine, `2-${path.basename(originals[1])}`),
                path.join(ownershipQuarantine, `3-${path.basename(originals[2])}`),
                path.join(ownershipQuarantine, `4-${path.basename(originals[3])}`)
            ]
            const result = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], { BILI_SETUP_TEST_PUBLICATION_CLEANUP_RACE: raceHook })

            assert.notStrictEqual(result.status, 0)
            assert.strictEqual(readManifest(fixture).checkpoint, 'failed')
            for (let index = 0; index < originals.length; index += 1) {
                assert.ok(fs.existsSync(originals[index]) || fs.existsSync(claims[index]), `artifact ${index + 1} was partially deleted`)
            }
            const unknown = Buffer.from(`unknown-publication-race-${raceHook}\n`)
            assert.ok(findFileContaining(fixture.root, unknown), 'replacement bytes must remain recoverable')
            const retained = retainedVault(fixture.root)
            assert.ok(retained.inventory.retained.some((item) => item.disposition === 'unknown'))
        })
    }

    for (const raceKind of ['top-replace', 'same-inode-write']) {
        it(`fails closed on publication terminal ${raceKind} deletion race`, function () {
            const fixture = createManagedInstall()
            roots.push(fixture.root)
            const result = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], { BILI_SETUP_TEST_PUBLICATION_TERMINAL_DELETE_RACE: `1:${raceKind}` })

            assert.notStrictEqual(result.status, 0)
            const needle = raceKind === 'same-inode-write' ? 'unknown-same-inode' : 'unknown-race'
            assert.ok(findFileContaining(fixture.root, needle), 'race bytes must remain in the attempt vault')
            assert.ok(retainedVault(fixture.root).inventory.retained.some((item) => item.disposition === 'unknown'))
        })
    }

    for (const finalDestinationRace of ['claim-retained-1', 'intent-vault', 'journal-vault']) {
        it(`does not replace a ${finalDestinationRace} destination created at the final publication boundary`, function () {
            const fixture = createManagedInstall()
            roots.push(fixture.root)
            const seeded = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], { BILI_SETUP_TEST_FAILPOINT: 'publish-after-compose-before-ownership' })
            assert.notStrictEqual(seeded.status, 0)

            const raced = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], { BILI_SETUP_TEST_PUBLICATION_FINAL_DESTINATION_RACE: finalDestinationRace })

            assert.notStrictEqual(raced.status, 75, raced.stderr)
            assert.ok(findFileContaining(fixture.root, `unknown final destination race: ${finalDestinationRace}`))
            assert.notStrictEqual(readManifest(fixture).checkpoint, 'upgrade_complete')
        })
    }

    it('retains a complete private vault inventory across rollback resume', function () {
        const fixture = createManagedInstall()
        roots.push(fixture.root)
        const crashed = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ], { BILI_SETUP_TEST_FAILPOINT: 'publication-after-terminal-journal-2' })
        assert.notStrictEqual(crashed.status, 0)
        const recovered = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ])
        assert.strictEqual(recovered.status, 75, recovered.stderr)

        const { vault, inventory } = retainedVault(fixture.root)
        const scopes = new Set(inventory.retained.map((item) => item.scope))
        for (const scope of [
            'publication-artifact', 'publication-vault-root', 'publication-intent',
            'publication-authoritative-journal', 'publication-external-journal',
            'publication-install-workspace', 'publication-data-workspace', 'publication-restore'
        ]) assert.ok(scopes.has(scope), `missing vault scope after resume: ${scope}`)
        assert.strictEqual(fs.existsSync(path.join(vault, 'publication/publication-journal.json')), true)
        assert.strictEqual(fs.existsSync(path.join(vault, 'publication/publication-intent.json')), true)
        for (const item of inventory.retained.filter((entry) => entry.scope === 'publication-artifact')) {
            assert.strictEqual(recursiveFingerprint(item.retainedPath), item.retainedFingerprint)
            const stat = fs.lstatSync(item.retainedPath)
            assert.strictEqual(String(stat.dev), item.dev)
            assert.strictEqual(String(stat.ino), item.ino)
        }
        assert.deepStrictEqual(fs.readdirSync(path.join(fixture.root, 'config')).sort(), ['config.yaml'])
    })

    for (const kind of ['direct', 'nested']) {
        it(`breaks a ${kind} vault hardlink without mutating the external alias`, function () {
            const fixture = createManagedInstall()
            roots.push(fixture.root)
            const result = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], { BILI_SETUP_TEST_VAULT_HARDLINK_KIND: kind })
            assert.strictEqual(result.status, 0, result.stderr)

            const attempt = path.join(fixture.root, 'data/setup-state/fixture-attempt')
            const alias = path.join(attempt, `vault-external-hardlink-${kind}`)
            const aliasStat = fs.statSync(alias)
            const aliasBytes = fs.readFileSync(alias)
            assert.strictEqual(aliasStat.mode & 0o777, 0o644)

            const matches = []
            const visit = (target) => {
                for (const name of fs.readdirSync(target)) {
                    const child = path.join(target, name)
                    const stat = fs.lstatSync(child)
                    if (stat.isDirectory()) visit(child)
                    else if (stat.isFile() && fs.readFileSync(child).equals(aliasBytes)) matches.push({ child, stat })
                }
            }
            visit(path.join(attempt, 'retained-vault'))
            assert.ok(matches.length > 0, 'vault must retain a private copy of the aliased bytes')
            for (const match of matches) {
                assert.notStrictEqual(match.stat.ino, aliasStat.ino)
                assert.strictEqual(match.stat.nlink, 1)
                assert.strictEqual(match.stat.mode & 0o777, 0o600)
            }
            assert.deepStrictEqual(fs.readFileSync(alias), aliasBytes)
            assert.strictEqual(fs.statSync(alias).ino, aliasStat.ino)
            assert.strictEqual(fs.statSync(alias).mode & 0o777, 0o644)
        })
    }

    for (const failpoint of [
        ...Array.from({ length: 4 }, (_, index) => `publication-after-claim-${index + 1}`),
        ...Array.from({ length: 4 }, (_, index) => `publication-before-terminal-${index + 1}`),
        ...Array.from({ length: 4 }, (_, index) => `publication-after-terminal-rename-${index + 1}`),
        ...Array.from({ length: 4 }, (_, index) => `publication-after-terminal-journal-${index + 1}`),
        ...Array.from({ length: 4 }, (_, index) => `publication-before-unlink-${index + 1}`),
        ...Array.from({ length: 4 }, (_, index) => `publication-after-unlink-${index + 1}`)
    ]) {
        it(`resumes journaled quarantine cleanup after ${failpoint}`, function () {
            const fixture = createManagedInstall()
            roots.push(fixture.root)
            const crashed = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], { BILI_SETUP_TEST_FAILPOINT: failpoint })
            assert.notStrictEqual(crashed.status, 0)
            const recovered = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ])
            assert.strictEqual(recovered.status, 75, recovered.stderr)
            const attempt = path.join(fixture.root, 'data/setup-state/fixture-attempt')
            assert.strictEqual(fs.existsSync(path.join(attempt, 'publication-journal.json')), false)
            assert.strictEqual(fs.existsSync(path.join(fixture.root, '.bili-publication-quarantine.fixture-attempt')), true)
            assert.strictEqual(fs.existsSync(path.join(fixture.root, 'data/setup-state/.bili-publication-quarantine.fixture-attempt')), true)
            assertRetainedScope(fixture.root, 'publication-vault-root')
            assert.deepStrictEqual(fs.readdirSync(fixture.root).filter((name) => name.includes('docker-compose.yml.candidate.fixture-attempt') || name.includes('docker-compose.yml.claimed.fixture-attempt')), [])
        })
    }

    for (const failpoint of [
        'publication-restore-before-quarantine-create-1',
        'publication-restore-after-quarantine-create-1',
        'publication-restore-before-quarantine-create-2',
        'publication-restore-after-quarantine-create-2'
    ]) {
        const quarantineCreationTest = failpoint.includes('after-quarantine-create') ? it.skip : it
        quarantineCreationTest(`reconciles quarantine creation across ${failpoint}`, function () {
            const fixture = createManagedInstall()
            roots.push(fixture.root)
            const crashed = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], { BILI_SETUP_TEST_FAILPOINT: failpoint })
            assert.notStrictEqual(crashed.status, 0)
            const recovered = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ])
            assert.strictEqual(recovered.status, 75, recovered.stderr)
            assert.strictEqual(fs.existsSync(path.join(fixture.root, '.bili-publication-quarantine.fixture-attempt')), true)
            assert.strictEqual(fs.existsSync(path.join(fixture.root, 'data/setup-state/.bili-publication-quarantine.fixture-attempt')), true)
            assertRetainedScope(fixture.root, 'publication-vault-root')
        })
    }

    for (const failpoint of [
        ...Array.from({ length: 4 }, (_, index) => `publication-restore-before-stash-${index + 1}`),
        ...Array.from({ length: 4 }, (_, index) => `publication-restore-after-stash-${index + 1}`),
        'publication-restore-before-data-delete', 'publication-restore-after-data-delete',
        ...Array.from({ length: 3 }, (_, index) => `publication-restore-before-live-delete-${index + 1}`),
        ...Array.from({ length: 3 }, (_, index) => `publication-restore-after-live-delete-rename-${index + 1}`),
        ...Array.from({ length: 3 }, (_, index) => `publication-restore-after-live-delete-${index + 1}`),
        'publication-restore-before-data-copy', 'publication-restore-after-data-publish-before-journal', 'publication-restore-after-data-copy',
        ...Array.from({ length: 4 }, (_, index) => `publication-restore-before-restore-${index + 1}`),
        ...Array.from({ length: 4 }, (_, index) => `publication-restore-after-restore-${index + 1}`)
    ]) {
        const publicationRestoreTest = failpoint === 'publication-restore-after-data-publish-before-journal' ? it.skip : it
        publicationRestoreTest(`resumes publication restore transaction across ${failpoint}`, function () {
            const fixture = createManagedInstall()
            roots.push(fixture.root)
            const compose = path.join(fixture.root, 'docker-compose.yml')
            const ownership = path.join(fixture.root, 'data/setup-state/compose-ownership.json')
            const oldCompose = fs.readFileSync(compose)
            const oldOwnership = fs.readFileSync(ownership)
            const quarantinePhase = /-(?:stash|restore)-[34]$/.test(failpoint)
            const seeded = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], { BILI_SETUP_TEST_FAILPOINT: 'publish-after-compose-before-ownership' })
            assert.notStrictEqual(seeded.status, 0)
            if (quarantinePhase) {
                const stateRoot = path.join(fixture.root, 'data/setup-state')
                const journalPath = path.join(stateRoot, 'fixture-attempt/publication-journal.json')
                const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'))
                const quarantineDirs = [
                    path.join(fixture.root, '.bili-publication-quarantine.fixture-attempt'),
                    path.join(stateRoot, '.bili-publication-quarantine.fixture-attempt')
                ]
                for (const directory of quarantineDirs) fs.mkdirSync(directory, { mode: 0o700 })
                journal.cleanup = {
                    quarantines: quarantineDirs.map((directory) => {
                        const stat = fs.statSync(directory)
                        return { path: directory, state: 'present', dev: String(stat.dev), ino: String(stat.ino) }
                    }),
                    claims: journal.entries.map((entry, index) => ({
                        original: entry.path,
                        claim: path.join(quarantineDirs[index < 2 ? 0 : 1], `${index + 1}-${path.basename(entry.path)}`),
                        state: 'original'
                    }))
                }
                fs.writeFileSync(journalPath, `${JSON.stringify(journal)}\n`, { mode: 0o600 })
            }

            const interrupted = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], { BILI_SETUP_TEST_PUBLICATION_RESTORE_FAILPOINT: failpoint })
            assert.notStrictEqual(interrupted.status, 0)

            const recovered = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ])
            assert.strictEqual(recovered.status, 75, recovered.stderr)
            assert.deepStrictEqual(fs.readFileSync(compose), oldCompose)
            assert.deepStrictEqual(fs.readFileSync(ownership), oldOwnership)
            assert.strictEqual(fs.existsSync(path.join(fixture.root, '.setup-publication-restore.fixture-attempt')), true)
            assertRetainedScope(fixture.root, 'publication-restore')
        })
    }

    it('reconciles ownership detach when rollback starts after rename but before journal', function () {
        const fixture = createManagedInstall()
        roots.push(fixture.root)
        const ownership = path.join(fixture.root, 'data/setup-state/compose-ownership.json')
        const expected = fs.readFileSync(ownership)
        const seeded = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ], { BILI_SETUP_TEST_FAILPOINT: 'publish-after-compose-before-ownership' })
        assert.notStrictEqual(seeded.status, 0)
        const interrupted = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ], { BILI_SETUP_TEST_PUBLICATION_RESTORE_FAILPOINT: 'publication-restore-after-ownership-detach-rename' })
        assert.strictEqual(interrupted.status, 75, interrupted.stderr)
        assert.match(interrupted.stderr, /rolled back safely/)
        assert.deepStrictEqual(fs.readFileSync(ownership), expected)
        assert.strictEqual(readManifest(fixture).checkpoint, 'rolled_back')
    })

    for (const failpoint of [
        'publication-restore-before-ownership-detach-delete',
        'publication-restore-after-ownership-detach-delete'
    ]) {
        it(`reconciles ownership detach deletion across ${failpoint}`, function () {
            const fixture = createManagedInstall()
            roots.push(fixture.root)
            const ownership = path.join(fixture.root, 'data/setup-state/compose-ownership.json')
            const expected = fs.readFileSync(ownership)
            const seeded = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], { BILI_SETUP_TEST_FAILPOINT: 'publish-after-compose-before-ownership' })
            assert.notStrictEqual(seeded.status, 0)
            const recovered = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], { BILI_SETUP_TEST_PUBLICATION_RESTORE_FAILPOINT: failpoint })

            assert.strictEqual(recovered.status, 75, recovered.stderr)
            assert.deepStrictEqual(fs.readFileSync(ownership), expected)
            assert.strictEqual(readManifest(fixture).checkpoint, 'rolled_back')
        })
    }

    for (const raceKind of ['top-replace', 'same-inode-write', 'descendant-add', 'descendant-replace']) {
        it(`fails closed on pre-publication anchored deletion race: ${raceKind}`, function () {
            const fixture = createManagedInstall()
            roots.push(fixture.root)
            const racedDirectory = path.join(fixture.root, 'data/aaa-raced-directory')
            fs.mkdirSync(racedDirectory, { mode: 0o700 })
            fs.writeFileSync(path.join(racedDirectory, 'value'), 'original-raced-value\n', { mode: 0o600 })
            const expected = treeInventory(path.join(fixture.root, 'data'), { exclude: new Set(['setup-state']) })
            const result = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], {
                BILI_SETUP_TEST_FAILPOINT: 'upgrade-after-compose-render',
                BILI_SETUP_TEST_PREPUBLICATION_DELETE_RACE: `1:${raceKind}`
            })

            assert.notStrictEqual(result.status, 0)
            assert.deepStrictEqual(treeInventory(path.join(fixture.root, 'data'), { exclude: new Set(['setup-state']) }), expected)
            const needle = raceKind === 'same-inode-write' ? 'unknown-same-inode' : 'unknown-race'
            assert.ok(findFileContaining(path.join(fixture.root, 'data/setup-state/fixture-attempt'), needle), 'race bytes must remain in the attempt vault')
            assert.ok(retainedVault(fixture.root).inventory.retained.some((item) => item.disposition === 'unknown'))
        })

        it(`fails closed on publication anchored deletion race: ${raceKind}`, function () {
            const fixture = createManagedInstall()
            roots.push(fixture.root)
            const racedDirectory = path.join(fixture.root, 'data/aaa-raced-directory')
            fs.mkdirSync(racedDirectory, { mode: 0o700 })
            fs.writeFileSync(path.join(racedDirectory, 'value'), 'original-raced-value\n', { mode: 0o600 })
            const seeded = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], { BILI_SETUP_TEST_FAILPOINT: 'publish-after-compose-before-ownership' })
            assert.notStrictEqual(seeded.status, 0)
            const recovered = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], { BILI_SETUP_TEST_PUBLICATION_DELETE_RACE: `1:${raceKind}` })

            assert.notStrictEqual(recovered.status, 75)
            const needle = raceKind === 'same-inode-write' ? 'unknown-same-inode' : 'unknown-race'
            assert.ok(findFileContaining(path.join(fixture.root, 'data/setup-state/fixture-attempt'), needle), 'race bytes must remain in the attempt vault')
            assert.ok(retainedVault(fixture.root).inventory.retained.some((item) => item.disposition === 'unknown'))
        })
    }

    it('fails closed when a restored file is modified in place before restash', function () {
        const fixture = createManagedInstall()
        roots.push(fixture.root)
        const seeded = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ], { BILI_SETUP_TEST_FAILPOINT: 'publish-after-compose-before-ownership' })
        assert.notStrictEqual(seeded.status, 0)
        const interrupted = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ], { BILI_SETUP_TEST_PUBLICATION_RESTORE_FAILPOINT: 'publication-restore-after-restore-1' })
        assert.notStrictEqual(interrupted.status, 75)
        const restored = path.join(fixture.root, 'data/setup-state/.compose-ownership.candidate.fixture-attempt')
        fs.appendFileSync(restored, 'unknown-restash-file\n')
        const rejected = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ])

        assert.notStrictEqual(rejected.status, 75)
        assert.ok(findFileContaining(path.join(fixture.root, 'data/setup-state'), 'unknown-restash-file'))
    })

    it('fails closed when a restored directory gains a descendant before restash', function () {
        const fixture = createManagedInstall()
        roots.push(fixture.root)
        const seeded = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ], { BILI_SETUP_TEST_FAILPOINT: 'publication-after-claim-1' })
        assert.notStrictEqual(seeded.status, 0)
        const interrupted = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ], { BILI_SETUP_TEST_PUBLICATION_RESTORE_FAILPOINT: 'publication-restore-after-restore-3' })
        assert.notStrictEqual(interrupted.status, 75)
        const restored = path.join(fixture.root, '.bili-publication-quarantine.fixture-attempt')
        fs.writeFileSync(path.join(restored, 'unknown-restash-descendant'), 'unknown-restash-dir\n', { mode: 0o600 })
        const rejected = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ])

        assert.notStrictEqual(rejected.status, 75)
        assert.ok(findFileContaining(fixture.root, 'unknown-restash-dir'))
    })

    it('persists cutover_intent before creating rollback tags or mutating runtime', function () {
        const fixture = createLegacyInstall()
        roots.push(fixture.root)
        const result = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ], { BILI_SETUP_TEST_FAILPOINT: 'after-cutover-intent-before-rollback-pin' })

        assert.notStrictEqual(result.status, 0)
        assert.strictEqual(readManifest(fixture).checkpoint, 'rolled_back')
        const dockerCalls = readCalls(fixture)
        assert.doesNotMatch(dockerCalls, /image tag/)
        assert.doesNotMatch(dockerCalls, /network disconnect/)
        assert.doesNotMatch(dockerCalls, /kill --signal/)
        const cliCalls = fs.readFileSync(path.join(fixture.stateDir, 'cli-calls.log'), 'utf8')
        assert.match(cliCalls, /--status cutover_intent/)
    })

    it('cleans a killed pre-publication intent without leaving a Secret snapshot', function () {
        const fixture = createLegacyInstall()
        roots.push(fixture.root)
        const killed = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ], { BILI_SETUP_TEST_FAILPOINT: 'intent-before-rename' })

        assert.notStrictEqual(killed.status, 0)
        const staging = path.join(fixture.root, 'data/.setup-intent-fixture-attempt')
        assert.ok(fs.existsSync(staging))
        const ownershipMarker = path.join(staging, '.bili-qq-bot-setup-intent-v1')
        assert.strictEqual(fs.readFileSync(ownershipMarker, 'utf8'), 'bili-qq-bot/setup-intent/v1|fixture-attempt\n')
        assert.strictEqual(fs.statSync(ownershipMarker).mode & 0o777, 0o600)
        assert.strictEqual(fs.existsSync(path.join(staging, 'runtime-env.snapshot')), false)
        assert.strictEqual(fs.existsSync(path.join(fixture.root, 'data/setup-state/active-attempt')), false)

        const resumed = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ])
        assert.strictEqual(resumed.status, 0, resumed.stderr)
        assert.strictEqual(fs.existsSync(staging), false)
        assert.deepStrictEqual(fs.readdirSync(path.join(fixture.root, 'config')).sort(), ['config.yaml'])
    })

    for (const unsafeMarker of ['missing', 'wrong-content', 'symlink', '0644', 'hardlink']) {
        it(`retains an unknown ${unsafeMarker} setup-intent prefix instead of deleting it`, function () {
            const fixture = createLegacyInstall()
            roots.push(fixture.root)
            const valid = path.join(fixture.root, 'data/.setup-intent-valid')
            const unknown = path.join(fixture.root, `data/.setup-intent-unknown-${unsafeMarker}`)
            fs.mkdirSync(valid, { mode: 0o700 })
            fs.writeFileSync(path.join(valid, '.bili-qq-bot-setup-intent-v1'), 'bili-qq-bot/setup-intent/v1|valid\n', { mode: 0o600 })
            fs.mkdirSync(unknown, { mode: 0o700 })
            const marker = path.join(unknown, '.bili-qq-bot-setup-intent-v1')
            if (unsafeMarker === 'wrong-content') fs.writeFileSync(marker, 'foreign\n', { mode: 0o600 })
            if (unsafeMarker === 'symlink') fs.symlinkSync(path.join(valid, '.bili-qq-bot-setup-intent-v1'), marker)
            if (unsafeMarker === '0644') fs.writeFileSync(marker, `bili-qq-bot/setup-intent/v1|unknown-${unsafeMarker}\n`, { mode: 0o644 })
            if (unsafeMarker === 'hardlink') {
                const source = path.join(unknown, '.marker-source')
                fs.writeFileSync(source, `bili-qq-bot/setup-intent/v1|unknown-${unsafeMarker}\n`, { mode: 0o600 })
                fs.linkSync(source, marker)
            }
            const result = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ])
            assert.notStrictEqual(result.status, 0)
            assert.match(result.stderr, /orphan setup intent|setup control state/)
            assert.ok(fs.existsSync(valid))
            assert.ok(fs.existsSync(unknown))
            assert.strictEqual(fs.existsSync(path.join(fixture.root, 'data/setup-state')), false)
        })
    }

    for (const unsafeShape of ['extra-file', 'nested-file', 'attempt-mismatch']) {
        it(`retains an orphan setup intent with ${unsafeShape} without deleting other candidates`, function () {
            const fixture = createLegacyInstall()
            roots.push(fixture.root)
            const valid = path.join(fixture.root, 'data/.setup-intent-valid')
            const unsafe = path.join(fixture.root, 'data/.setup-intent-unsafe')
            for (const [dir, attempt] of [[valid, 'valid'], [unsafe, 'unsafe']]) {
                fs.mkdirSync(path.join(dir, 'work'), { recursive: true, mode: 0o700 })
                fs.mkdirSync(path.join(dir, 'snapshot'), { mode: 0o700 })
                fs.writeFileSync(path.join(dir, '.bili-qq-bot-setup-intent-v1'), `bili-qq-bot/setup-intent/v1|${attempt}\n`, { mode: 0o600 })
                fs.writeFileSync(path.join(dir, 'mount-writers.tsv'), '', { mode: 0o600 })
                fs.writeFileSync(path.join(dir, 'networks.tsv'), '', { mode: 0o600 })
            }
            if (unsafeShape === 'extra-file') fs.writeFileSync(path.join(unsafe, 'foreign'), 'x', { mode: 0o600 })
            if (unsafeShape === 'nested-file') fs.writeFileSync(path.join(unsafe, 'work', 'foreign'), 'x', { mode: 0o600 })
            if (unsafeShape === 'attempt-mismatch') {
                fs.writeFileSync(path.join(unsafe, '.bili-qq-bot-setup-intent-v1'), 'bili-qq-bot/setup-intent/v1|other\n', { mode: 0o600 })
            }

            const result = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ])
            assert.notStrictEqual(result.status, 0)
            assert.match(result.stderr, /orphan setup intent/)
            assert.ok(fs.existsSync(valid), 'valid candidate must not be deleted before all candidates validate')
            assert.ok(fs.existsSync(unsafe))
        })
    }

    it('recovers a killed intent after atomic publication but before the active marker', function () {
        const fixture = createLegacyInstall()
        roots.push(fixture.root)
        const killed = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ], { BILI_SETUP_TEST_FAILPOINT: 'intent-after-rename-before-active' })
        assert.notStrictEqual(killed.status, 0)
        assert.ok(fs.existsSync(path.join(fixture.root, 'data/setup-state/fixture-attempt/upgrade-manifest.json')))
        assert.strictEqual(fs.existsSync(path.join(fixture.root, 'data/setup-state/active-attempt')), false)

        const recovered = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ])
        assert.strictEqual(recovered.status, 75, recovered.stderr)
        assert.strictEqual(readManifest(fixture).checkpoint, 'rolled_back')
        assert.strictEqual(fs.existsSync(path.join(fixture.root, 'data/setup-state/active-attempt')), false)
        assert.strictEqual(fs.existsSync(path.join(fixture.root, 'data/setup-state/fixture-attempt/runtime-env.snapshot')), false)
    })

    it('publishes the intent and pins rollback before pulling a missing bot target', function () {
        const fixture = createLegacyInstall()
        roots.push(fixture.root)
        fs.writeFileSync(path.join(fixture.root, 'config/.jwtSecret'), 'j'.repeat(64), { mode: 0o600 })
        const result = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:missing', '--health-timeout', '5'
        ], {
            BILI_SETUP_CLI_DRIVER: '',
            FAKE_TARGET_IMAGE_MISSING: '1',
            FAKE_REQUIRE_INTENT_BEFORE_BOT_PULL: '1'
        })

        assert.strictEqual(result.status, 0, result.stderr)
        const calls = readCalls(fixture)
        const pinIndex = calls.indexOf('image tag sha256:old-image bili-qq-bot-rollback:fixture-attempt')
        const pullIndex = calls.indexOf('pull fixture/target:missing')
        assert.ok(pinIndex >= 0, calls)
        assert.ok(pullIndex > pinIndex, calls)
        assert.strictEqual(readManifest(fixture).checkpoint, 'upgrade_complete')
    })

    for (const [label, env] of [
        ['non-zero exit', { FAKE_MANAGED_EXIT_CODE: '1' }],
        ['OOM kill', { FAKE_MANAGED_OOM_KILLED: 'true' }],
        ['drain residual', { FAKE_MANAGED_DRAIN_RESIDUAL: 'pending-operation' }]
    ]) {
        it(`rolls a managed upgrade back immediately on ${label}`, function () {
            const fixture = createManagedInstall()
            roots.push(fixture.root)
            const beforeMarker = fs.readFileSync(path.join(fixture.root, 'data/setup-state/managed-v1'))
            const result = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], env)

            assert.notStrictEqual(result.status, 0)
            assert.match(result.stderr, /did not drain and stop cleanly/)
            assert.strictEqual(readManifest(fixture).checkpoint, 'rolled_back', result.stderr)
            assert.deepStrictEqual(fs.readFileSync(path.join(fixture.root, 'data/setup-state/managed-v1')), beforeMarker)
            assert.doesNotMatch(readCalls(fixture), /runtime-probe\.yml/)
        })
    }

    it('pins, pulls, and applies an explicit NapCat image upgrade by content ID', function () {
        const fixture = createLegacyInstall()
        roots.push(fixture.root)
        const result = runSetup(fixture, [
            '--upgrade',
            '--upgrade-napcat',
            '--napcat-image', 'fixture/napcat:2',
            '--non-interactive',
            '--install-dir', fixture.root,
            '--image', 'fixture/target:1',
            '--health-timeout', '5'
        ], {
            FAKE_NAPCAT_TARGET_MISSING: '1'
        })

        assert.strictEqual(result.status, 0, result.stderr)
        const calls = readCalls(fixture)
        const pinIndex = calls.indexOf('image tag sha256:napcat-image bili-qq-bot-napcat-rollback:fixture-attempt')
        const pullIndex = calls.indexOf('pull fixture/napcat:2')
        assert.ok(pinIndex >= 0, calls)
        assert.ok(pullIndex > pinIndex, calls)
        const compose = fs.readFileSync(path.join(fixture.root, 'docker-compose.yml'), 'utf8')
        assert.match(compose, /image: sha256:target-napcat-image/)
        const metadata = fs.readFileSync(
            path.join(fixture.root, 'data/setup-state/fixture-attempt/attempt.env'),
            'utf8'
        )
        assert.match(metadata, /OLD_NAPCAT_IMAGE_ID=sha256:napcat-image/)
        assert.match(metadata, /TARGET_NAPCAT_IMAGE_ID=sha256:target-napcat-image/)
    })

    it('restores the independently pinned NapCat image when pre-marker health fails', function () {
        const fixture = createLegacyInstall()
        roots.push(fixture.root)
        const result = runSetup(fixture, [
            '--upgrade',
            '--upgrade-napcat',
            '--napcat-image', 'fixture/napcat:2',
            '--non-interactive',
            '--install-dir', fixture.root,
            '--image', 'fixture/target:1',
            '--health-timeout', '1'
        ], {
            FAKE_NAPCAT_TARGET_MISSING: '1',
            FAKE_PROBE_HEALTH_FAIL: '1'
        })

        assert.notStrictEqual(result.status, 0)
        assert.strictEqual(readManifest(fixture).checkpoint, 'rolled_back')
        const override = fs.readFileSync(
            path.join(fixture.root, 'data/setup-state/fixture-attempt/rollback-compose.yml'),
            'utf8'
        )
        assert.match(override, /bili-qq-bot-napcat-rollback:fixture-attempt/)
        assert.strictEqual((override.match(/pull_policy: never/g) || []).length, 2)
        assert.match(readCalls(fixture), /rollback-compose\.yml.*pull never/)
    })

    it('retains the active attempt when the pinned NapCat rollback image disappears', function () {
        const fixture = createLegacyInstall()
        roots.push(fixture.root)
        const result = runSetup(fixture, [
            '--upgrade',
            '--upgrade-napcat',
            '--napcat-image', 'fixture/napcat:2',
            '--non-interactive',
            '--install-dir', fixture.root,
            '--image', 'fixture/target:1',
            '--health-timeout', '1'
        ], {
            FAKE_NAPCAT_TARGET_MISSING: '1',
            FAKE_PROBE_HEALTH_FAIL: '1',
            FAKE_NAPCAT_ROLLBACK_DISAPPEARS_ON_DOWN: '1'
        })

        assert.notStrictEqual(result.status, 0)
        assert.strictEqual(readManifest(fixture).checkpoint, 'failed')
        assert.strictEqual(
            fs.readFileSync(path.join(fixture.root, 'data/setup-state/active-attempt'), 'utf8').trim(),
            'fixture-attempt'
        )
        assert.match(result.stderr, /active attempt retained for recovery/)
    })

    it('does not declare a NapCat image upgrade complete until normal login readiness passes', function () {
        const fixture = createLegacyInstall()
        roots.push(fixture.root)
        const result = runSetup(fixture, [
            '--upgrade',
            '--upgrade-napcat',
            '--napcat-image', 'fixture/napcat:2',
            '--non-interactive',
            '--install-dir', fixture.root,
            '--image', 'fixture/target:1',
            '--health-timeout', '1'
        ], {
            FAKE_NAPCAT_TARGET_MISSING: '1',
            FAKE_NORMAL_HEALTH_FAIL: '1'
        })

        assert.notStrictEqual(result.status, 0)
        assert.strictEqual(readManifest(fixture).checkpoint, 'runtime_released')
        assert.ok(fs.existsSync(path.join(
            fixture.root,
            'data/setup-state/fixture-attempt/RECOVER_SAME_RELEASE_EPOCH'
        )))
        assert.doesNotMatch(readCalls(fixture), /rollback-compose\.yml/)
    })

    it('applies an empty-target data mount relocation and persists the new deployment path', function () {
        const fixture = createManagedInstall()
        roots.push(fixture.root)
        const beforeState = fs.readFileSync(path.join(fixture.root, 'data/subscription_state.json'), 'utf8')
        const result = runSetup(fixture, [
            '--apply',
            '--non-interactive',
            '--install-dir', fixture.root,
            '--image', 'fixture/target:1',
            '--health-timeout', '5'
        ], {
            FAKE_RELOCATE_DATA_SOURCE: './relocated-data'
        })

        assert.strictEqual(result.status, 0, result.stderr)
        const relocated = path.join(fixture.root, 'relocated-data')
        assert.strictEqual(fs.readFileSync(path.join(relocated, 'subscription_state.json'), 'utf8'), beforeState)
        assert.strictEqual(readManifest(fixture).checkpoint, 'upgrade_complete')
        const deploymentState = fs.readFileSync(path.join(fixture.root, '.bili-deployment-state'), 'utf8')
        const canonicalRelocated = fs.realpathSync(relocated)
        assert.match(deploymentState, new RegExp(`data\\|${canonicalRelocated.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
        assert.match(fs.readFileSync(path.join(fixture.root, 'docker-compose.yml'), 'utf8'), /\.\/relocated-data:\/app\/data/)
        assert.strictEqual(fs.existsSync(path.join(relocated, 'setup-state/active-attempt')), false)
        assert.strictEqual(fs.statSync(path.join(fixture.root, '.bili-deployment-state')).mode & 0o777, 0o600)
        assert.strictEqual(fs.statSync(path.join(relocated, 'setup-state')).mode & 0o777, 0o700)
        const artifact = JSON.parse(fs.readFileSync(
            path.join(relocated, 'setup-state/fixture-attempt/validated-relocation.json'),
            'utf8'
        ))
        assert.strictEqual(artifact.operations[0].operation, 'copy-and-switch')
        assert.strictEqual(artifact.operations[0].inventory.matched, true)
    })

    it('passes a real Config CLI relocation plan and artifact through render-compose', function () {
        const fixture = createRealCliManagedInstall()
        roots.push(fixture.root)
        const result = runSetup(fixture, [
            '--apply',
            '--non-interactive',
            '--install-dir', fixture.root,
            '--image', 'fixture/target:1',
            '--health-timeout', '5'
        ], {
            BILI_SETUP_CLI_DRIVER: ''
        })

        assert.strictEqual(result.status, 0, result.stderr)
        const relocated = path.join(fixture.root, 'relocated-real-data')
        assert.ok(fs.existsSync(path.join(relocated, 'subscription_state.json')))
        assert.match(fs.readFileSync(path.join(fixture.root, 'docker-compose.yml'), 'utf8'), /\.\/relocated-real-data:\/app\/data/)
        const artifact = JSON.parse(fs.readFileSync(
            path.join(relocated, 'setup-state/fixture-attempt/validated-relocation.json'),
            'utf8'
        ))
        assert.strictEqual(artifact.planFingerprint.length, 64)
        assert.strictEqual(artifact.operations[0].inventory.matched, true)
    })

    it('applies a non-relocation deployment port change through the real Config CLI', function () {
        const fixture = createRealCliManagedInstall()
        roots.push(fixture.root)
        const configPath = path.join(fixture.root, 'config/config.yaml')
        const config = fs.readFileSync(configPath, 'utf8')
            .replace('data: ./relocated-real-data', 'data: ./data')
            .replace('listenPort: 3000', 'listenPort: 4000')
            .replace('dashboardHost: 3000', 'dashboardHost: 4000')
        fs.writeFileSync(configPath, config, { mode: 0o600 })
        const result = runSetup(fixture, [
            '--apply',
            '--non-interactive',
            '--install-dir', fixture.root,
            '--image', 'fixture/target:1',
            '--health-timeout', '5'
        ], {
            BILI_SETUP_CLI_DRIVER: ''
        })

        assert.strictEqual(result.status, 0, result.stderr)
        const rendered = fs.readFileSync(path.join(fixture.root, 'docker-compose.yml'), 'utf8')
        assert.match(rendered, /4000:3000/)
        assert.match(rendered, /127\.0\.0\.1:3000\/api\/ready/)
        assert.strictEqual(
            fs.readFileSync(path.join(fixture.root, 'data/setup-state/fixture-attempt/health-container-port'), 'utf8').trim(),
            '3000'
        )
        assert.strictEqual(fs.existsSync(path.join(fixture.root, '.bili-deployment-state')), false)
        assert.strictEqual(readManifest(fixture).checkpoint, 'upgrade_complete')
    })

    it('switches the real Compose model to Official without a dangling NapCat dependency', function () {
        const fixture = createRealCliManagedInstall()
        roots.push(fixture.root)
        const configPath = path.join(fixture.root, 'config/config.yaml')
        const config = fs.readFileSync(configPath, 'utf8')
            .replace('provider: napcat', 'provider: official')
            .replace('appId: ""', 'appId: fixture-official-app')
            .replace('clientSecret: ""', 'clientSecret: fixture-official-secret')
            .replace('data: ./relocated-real-data', 'data: ./data')
        fs.writeFileSync(configPath, config, { mode: 0o600 })
        copyFile(path.join(repoRoot, 'docker-compose.yml'), path.join(fixture.root, 'docker-compose.yml'))
        const result = runSetup(fixture, [
            '--apply',
            '--adopt-existing',
            '--non-interactive',
            '--install-dir', fixture.root,
            '--image', 'fixture/target:1',
            '--health-timeout', '5'
        ], {
            BILI_SETUP_CLI_DRIVER: ''
        })

        assert.strictEqual(result.status, 0, result.stderr)
        const compose = fs.readFileSync(path.join(fixture.root, 'docker-compose.yml'), 'utf8')
        assert.doesNotMatch(compose, /^  napcat:/m)
        assert.doesNotMatch(compose, /depends_on:[\s\S]*napcat:/)
        assert.strictEqual(readManifest(fixture).checkpoint, 'upgrade_complete')
    })

    it('relocates config and data with one active YAML truth and supports a later dry-run', function () {
        const fixture = createRealCliManagedInstall({ relocateConfig: true })
        roots.push(fixture.root)
        const applied = runSetup(fixture, [
            '--apply',
            '--non-interactive',
            '--install-dir', fixture.root,
            '--image', 'fixture/target:1',
            '--health-timeout', '5'
        ], {
            BILI_SETUP_CLI_DRIVER: ''
        })

        assert.strictEqual(applied.status, 0, applied.stderr)
        const relocatedConfig = path.join(fixture.root, 'relocated-real-config')
        assert.deepStrictEqual(fs.readdirSync(relocatedConfig).sort(), ['config.yaml'])
        assert.strictEqual(fs.existsSync(path.join(fixture.root, 'config/config.yaml')), false)
        const deploymentState = fs.readFileSync(path.join(fixture.root, '.bili-deployment-state'), 'utf8')
        assert.match(deploymentState, /config\|.*relocated-real-config/)
        assert.match(deploymentState, /data\|.*relocated-real-data/)

        const dryRun = runSetup(fixture, [
            '--apply',
            '--dry-run',
            '--non-interactive',
            '--install-dir', fixture.root,
            '--image', 'fixture/target:1'
        ], {
            BILI_SETUP_CLI_DRIVER: '',
            BILI_SETUP_ATTEMPT_ID: 'unused-dry-run-attempt'
        })
        assert.strictEqual(dryRun.status, 0, dryRun.stderr)
        assert.strictEqual(JSON.parse(dryRun.stdout).plannedDeliveryGuarantee, 'exactly-once')
    })

    it('fails closed before completion when relocated config archive provenance changes', function () {
        const fixture = createRealCliManagedInstall({ relocateConfig: true })
        roots.push(fixture.root)
        const result = runSetup(fixture, [
            '--apply', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ], {
            BILI_SETUP_CLI_DRIVER: '',
            BILI_SETUP_TEST_RELOCATED_ARCHIVE_MUTATION: 'byte-swap'
        })

        assert.notStrictEqual(result.status, 0)
        assert.match(result.stderr, /archive source changed|same epoch/)
        assert.strictEqual(readManifest(fixture).checkpoint, 'runtime_ready')
        assert.strictEqual(fs.existsSync(path.join(
            fixture.root, 'data/setup-state/fixture-attempt/retained-vault/archive/relocated/config.yaml'
        )), false)
        assert.strictEqual(fs.existsSync(path.join(fixture.root, 'data/setup-state/active-attempt')), true)
    })

    for (const mutation of ['missing', 'dangling']) {
        it(`keeps relocated archive recovery in the same epoch for a ${mutation} source`, function () {
            const fixture = createRealCliManagedInstall({ relocateConfig: true })
            roots.push(fixture.root)
            const result = runSetup(fixture, [
                '--apply', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], {
                BILI_SETUP_CLI_DRIVER: '',
                BILI_SETUP_TEST_RELOCATED_ARCHIVE_MUTATION: mutation
            })
            assert.notStrictEqual(result.status, 0)
            assert.match(result.stderr, /archive source changed|same epoch/)
            assert.strictEqual(readManifest(fixture).checkpoint, 'runtime_ready')
            assert.ok(fs.existsSync(path.join(fixture.root, 'data/setup-state/active-attempt')))
        })
    }

    it('keeps the old deployment pointer and Compose when a relocated candidate fails health', function () {
        const fixture = createManagedInstall()
        roots.push(fixture.root)
        const oldCompose = fs.readFileSync(path.join(fixture.root, 'docker-compose.yml'), 'utf8')
        const result = runSetup(fixture, [
            '--apply',
            '--non-interactive',
            '--install-dir', fixture.root,
            '--image', 'fixture/target:1',
            '--health-timeout', '1'
        ], {
            FAKE_RELOCATE_DATA_SOURCE: './relocated-data',
            FAKE_PROBE_HEALTH_FAIL: '1'
        })

        assert.notStrictEqual(result.status, 0)
        assert.strictEqual(fs.existsSync(path.join(fixture.root, '.bili-deployment-state')), false)
        assert.strictEqual(fs.readFileSync(path.join(fixture.root, 'docker-compose.yml'), 'utf8'), oldCompose)
        assert.strictEqual(readManifest(fixture).checkpoint, 'rolled_back')
        assert.ok(fs.existsSync(path.join(fixture.root, 'relocated-data/subscription_state.json')))
        assert.strictEqual(fs.readFileSync(path.join(fixture.root, 'data/subscription_state.json'), 'utf8').length > 0, true)
    })

    it('keeps deployment apply pending after rollback and clears it only after a successful setup health gate', function () {
        const fixture = createManagedInstall()
        roots.push(fixture.root)
        const configPath = path.join(fixture.root, 'config/config.yaml')
        const baselinePath = path.join(fixture.root, 'data/config-state/deployment-applied.json')
        const initialConfig = YAML.parse(fs.readFileSync(configPath, 'utf8'))
        writeDeploymentBaseline(baselinePath, initialConfig, { releaseEpoch: 'previous-release' })
        const beforeBaseline = fs.readFileSync(baselinePath)

        fs.writeFileSync(
            configPath,
            fs.readFileSync(configPath, 'utf8').replace('dashboardHost: 3000', 'dashboardHost: 4321'),
            { mode: 0o600 }
        )
        const failed = runSetup(fixture, [
            '--apply', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '1'
        ], { FAKE_PROBE_HEALTH_FAIL: '1' })

        assert.notStrictEqual(failed.status, 0)
        assert.deepStrictEqual(fs.readFileSync(baselinePath), beforeBaseline)
        const desired = YAML.parse(fs.readFileSync(configPath, 'utf8'))
        assert.deepStrictEqual(
            deploymentStatus(desired, readDeploymentBaseline(baselinePath)).pendingPaths,
            ['deployment.ports.dashboardHost']
        )

        const applied = runSetup(fixture, [
            '--apply', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ], { BILI_SETUP_ATTEMPT_ID: 'fixture-attempt-2' })
        assert.strictEqual(applied.status, 0, applied.stderr)
        const finalBaseline = readDeploymentBaseline(baselinePath)
        assert.strictEqual(finalBaseline.generation, 2)
        assert.strictEqual(finalBaseline.releaseEpoch, 'release-fixture-attempt-2')
        assert.deepStrictEqual(deploymentStatus(desired, finalBaseline).pendingPaths, [])
    })

    it('rolls back when probe mutates preserve-required relocated data', function () {
        const fixture = createManagedInstall()
        roots.push(fixture.root)
        const oldCompose = fs.readFileSync(path.join(fixture.root, 'docker-compose.yml'), 'utf8')
        const result = runSetup(fixture, [
            '--apply',
            '--non-interactive',
            '--install-dir', fixture.root,
            '--image', 'fixture/target:1',
            '--health-timeout', '5'
        ], {
            FAKE_RELOCATE_DATA_SOURCE: './relocated-data',
            FAKE_PROBE_MUTATE_RELOCATED_DATA: '1'
        })

        assert.notStrictEqual(result.status, 0)
        assert.match(result.stderr, /probe changed preserved relocation inventory/)
        assert.strictEqual(fs.readFileSync(path.join(fixture.root, 'docker-compose.yml'), 'utf8'), oldCompose)
        assert.strictEqual(readManifest(fixture).checkpoint, 'rolled_back')
        assert.strictEqual(fs.existsSync(path.join(fixture.root, '.bili-deployment-state')), false)
    })

    it('refuses a stale apply when Compose changes after the deployment plan', function () {
        const fixture = createManagedInstall()
        roots.push(fixture.root)
        const oldCompose = fs.readFileSync(path.join(fixture.root, 'docker-compose.yml'), 'utf8')
        const result = runSetup(fixture, [
            '--apply',
            '--non-interactive',
            '--install-dir', fixture.root,
            '--image', 'fixture/target:1'
        ], {
            FAKE_RELOCATE_DATA_SOURCE: './relocated-data',
            FAKE_MUTATE_COMPOSE_AFTER_PLAN: '1'
        })

        assert.notStrictEqual(result.status, 0)
        assert.match(result.stderr, /Compose changed after deployment plan/)
        assert.strictEqual(fs.readFileSync(path.join(fixture.root, 'docker-compose.yml'), 'utf8'), oldCompose)
        assert.strictEqual(readManifest(fixture).checkpoint, 'rolled_back')
    })

    it('rolls back after a crash injection immediately after relocation fsync', function () {
        const fixture = createManagedInstall()
        roots.push(fixture.root)
        const oldCompose = fs.readFileSync(path.join(fixture.root, 'docker-compose.yml'), 'utf8')
        const result = runSetup(fixture, [
            '--apply',
            '--non-interactive',
            '--install-dir', fixture.root,
            '--image', 'fixture/target:1'
        ], {
            FAKE_RELOCATE_DATA_SOURCE: './relocated-data',
            BILI_SETUP_TEST_FAILPOINT: 'relocation-after-copy-fsync'
        })

        assert.notStrictEqual(result.status, 0)
        assert.match(result.stderr, /relocation-after-copy-fsync/)
        assert.strictEqual(fs.readFileSync(path.join(fixture.root, 'docker-compose.yml'), 'utf8'), oldCompose)
        assert.strictEqual(readManifest(fixture).checkpoint, 'rolled_back')
        assert.strictEqual(fs.existsSync(path.join(fixture.root, '.bili-deployment-state')), false)
    })

    it('rolls back when the rendered relocation Compose model is invalid', function () {
        const fixture = createManagedInstall()
        roots.push(fixture.root)
        const oldCompose = fs.readFileSync(path.join(fixture.root, 'docker-compose.yml'), 'utf8')
        const result = runSetup(fixture, [
            '--apply',
            '--non-interactive',
            '--install-dir', fixture.root,
            '--image', 'fixture/target:1'
        ], {
            FAKE_RELOCATE_DATA_SOURCE: './relocated-data',
            FAKE_COMPOSE_CONFIG_FAIL: '1'
        })

        assert.notStrictEqual(result.status, 0)
        assert.strictEqual(fs.readFileSync(path.join(fixture.root, 'docker-compose.yml'), 'utf8'), oldCompose)
        assert.strictEqual(readManifest(fixture).checkpoint, 'rolled_back')
        assert.strictEqual(fs.existsSync(path.join(fixture.root, '.bili-deployment-state')), false)
    })

    it('recovers a committed relocation in the same release epoch and then switches the pointer', function () {
        const fixture = createManagedInstall()
        roots.push(fixture.root)
        const first = runSetup(fixture, [
            '--apply',
            '--non-interactive',
            '--install-dir', fixture.root,
            '--image', 'fixture/target:1',
            '--health-timeout', '1'
        ], {
            FAKE_RELOCATE_DATA_SOURCE: './relocated-data',
            FAKE_NORMAL_HEALTH_FAIL: '1'
        })

        assert.notStrictEqual(first.status, 0)
        assert.strictEqual(fs.existsSync(path.join(fixture.root, '.bili-deployment-state')), false)
        assert.strictEqual(readManifest(fixture).checkpoint, 'runtime_released')

        const second = runSetup(fixture, [
            '--apply',
            '--non-interactive',
            '--install-dir', fixture.root,
            '--image', 'fixture/unrelated-current-flag:9',
            '--health-timeout', '5'
        ])

        assert.strictEqual(second.status, 0, second.stderr)
        assert.strictEqual(readManifest(fixture).checkpoint, 'upgrade_complete')
        assert.match(fs.readFileSync(path.join(fixture.root, '.bili-deployment-state'), 'utf8'), /data\|.*relocated-data/)
        assert.doesNotMatch(readCalls(fixture), /pull fixture\/unrelated-current-flag:9/)
    })

    it('resumes from the relocated state after a crash immediately after pointer switch', function () {
        const fixture = createManagedInstall()
        roots.push(fixture.root)
        const first = runSetup(fixture, [
            '--apply',
            '--non-interactive',
            '--install-dir', fixture.root,
            '--image', 'fixture/target:1',
            '--health-timeout', '5'
        ], {
            FAKE_RELOCATE_DATA_SOURCE: './relocated-data',
            BILI_SETUP_TEST_FAILPOINT: 'relocation-after-pointer-switch'
        })

        assert.notStrictEqual(first.status, 0)
        assert.match(fs.readFileSync(path.join(fixture.root, '.bili-deployment-state'), 'utf8'), /data\|.*relocated-data/)
        assert.ok(fs.existsSync(path.join(fixture.root, 'relocated-data/setup-state/active-attempt')))

        const second = runSetup(fixture, [
            '--apply',
            '--non-interactive',
            '--install-dir', fixture.root,
            '--image', 'fixture/unrelated-current-flag:9',
            '--health-timeout', '5'
        ])

        assert.strictEqual(second.status, 0, second.stderr)
        assert.strictEqual(fs.existsSync(path.join(fixture.root, 'relocated-data/setup-state/active-attempt')), false)
        assert.strictEqual(fs.existsSync(path.join(fixture.root, 'data/setup-state/active-attempt')), false)
        assert.strictEqual(readManifest(fixture).checkpoint, 'upgrade_complete')
    })

    it('rejects a non-empty relocation target before cutover without --adopt-existing', function () {
        const fixture = createManagedInstall()
        roots.push(fixture.root)
        fs.mkdirSync(path.join(fixture.root, 'relocated-data'))
        fs.writeFileSync(path.join(fixture.root, 'relocated-data/foreign.json'), '{}\n', { mode: 0o600 })
        const result = runSetup(fixture, [
            '--apply',
            '--non-interactive',
            '--install-dir', fixture.root,
            '--image', 'fixture/target:1'
        ], {
            FAKE_RELOCATE_DATA_SOURCE: './relocated-data'
        })

        assert.notStrictEqual(result.status, 0)
        assert.match(result.stderr, /explicit --adopt-existing is required/)
        assert.doesNotMatch(readCalls(fixture), /kill --signal/)
        assert.strictEqual(fs.existsSync(path.join(fixture.root, 'data/setup-state/active-attempt')), false)
    })

    it('adopts a non-empty target only when its preserved inventory exactly matches', function () {
        const fixture = createManagedInstall()
        roots.push(fixture.root)
        const target = path.join(fixture.root, 'relocated-data')
        fs.mkdirSync(target, { mode: fs.statSync(path.join(fixture.root, 'data')).mode & 0o777 })
        for (const file of ['subscriptions.json', 'subscription_state.json', 'subscription_delivery.json']) {
            copyFile(path.join(fixture.root, 'data', file), path.join(target, file))
        }
        const result = runSetup(fixture, [
            '--apply',
            '--adopt-existing',
            '--non-interactive',
            '--install-dir', fixture.root,
            '--image', 'fixture/target:1',
            '--health-timeout', '5'
        ], {
            FAKE_RELOCATE_DATA_SOURCE: './relocated-data'
        })

        assert.strictEqual(result.status, 0, result.stderr)
        const artifact = JSON.parse(fs.readFileSync(
            path.join(target, 'setup-state/fixture-attempt/validated-relocation.json'),
            'utf8'
        ))
        assert.strictEqual(artifact.operations[0].operation, 'preserve-in-place')
        assert.strictEqual(artifact.operations[0].inventory.matched, true)
    })

    it('rolls back when --adopt-existing inventory does not match', function () {
        const fixture = createManagedInstall()
        roots.push(fixture.root)
        const target = path.join(fixture.root, 'relocated-data')
        fs.mkdirSync(target, { mode: 0o700 })
        fs.writeFileSync(path.join(target, 'subscription_state.json'), '{"different":true}\n', { mode: 0o600 })
        const oldCompose = fs.readFileSync(path.join(fixture.root, 'docker-compose.yml'), 'utf8')
        const result = runSetup(fixture, [
            '--apply',
            '--adopt-existing',
            '--non-interactive',
            '--install-dir', fixture.root,
            '--image', 'fixture/target:1'
        ], {
            FAKE_RELOCATE_DATA_SOURCE: './relocated-data'
        })

        assert.notStrictEqual(result.status, 0)
        assert.match(result.stderr, /inventory does not match/)
        assert.strictEqual(fs.readFileSync(path.join(fixture.root, 'docker-compose.yml'), 'utf8'), oldCompose)
        assert.strictEqual(readManifest(fixture).checkpoint, 'rolled_back')
        assert.strictEqual(fs.existsSync(path.join(fixture.root, '.bili-deployment-state')), false)
    })

    it('rejects overlapping relocation paths before stopping writers', function () {
        const fixture = createManagedInstall()
        roots.push(fixture.root)
        const result = runSetup(fixture, [
            '--apply',
            '--non-interactive',
            '--install-dir', fixture.root,
            '--image', 'fixture/target:1'
        ], {
            FAKE_RELOCATE_DATA_SOURCE: './data/nested-target'
        })

        assert.notStrictEqual(result.status, 0)
        assert.match(result.stderr, /relocation paths overlap/)
        assert.doesNotMatch(readCalls(fixture), /kill --signal/)
    })

    it('rejects a relocation target whose parent path contains a symlink', function () {
        const fixture = createManagedInstall()
        roots.push(fixture.root)
        fs.mkdirSync(path.join(fixture.root, 'real-target-parent'))
        fs.symlinkSync(path.join(fixture.root, 'real-target-parent'), path.join(fixture.root, 'relocated-link'))
        const result = runSetup(fixture, [
            '--apply',
            '--non-interactive',
            '--install-dir', fixture.root,
            '--image', 'fixture/target:1'
        ], {
            FAKE_RELOCATE_DATA_SOURCE: './relocated-link/data'
        })

        assert.notStrictEqual(result.status, 0)
        assert.match(result.stderr, /contains symlink/)
        assert.doesNotMatch(readCalls(fixture), /kill --signal/)
    })

    it('rejects an otherwise empty relocation target mounted by an unknown container', function () {
        const fixture = createManagedInstall()
        roots.push(fixture.root)
        const target = path.join(fixture.root, 'relocated-data')
        fs.mkdirSync(target)
        const result = runSetup(fixture, [
            '--apply',
            '--non-interactive',
            '--install-dir', fixture.root,
            '--image', 'fixture/target:1'
        ], {
            FAKE_RELOCATE_DATA_SOURCE: './relocated-data',
            FAKE_EXTERNAL_WRITER: '1',
            FAKE_EXTERNAL_WRITER_MOUNT: target
        })

        assert.notStrictEqual(result.status, 0)
        assert.match(result.stderr, /relocation target is mounted by a container/)
        assert.doesNotMatch(readCalls(fixture), /kill --signal/)
    })

    it('rolls back image, config, data, Compose, and writer state when probe fails before marker', function () {
        const fixture = createLegacyInstall()
        roots.push(fixture.root)
        fs.writeFileSync(path.join(fixture.stateDir, 'bot-old.paused'), 'true\n')
        fs.writeFileSync(path.join(fixture.stateDir, 'napcat-old.running'), 'false\n')
        const oldCompose = fs.readFileSync(path.join(fixture.root, 'docker-compose.yml'), 'utf8')
        const result = runSetup(fixture, [
            '--upgrade',
            '--non-interactive',
            '--install-dir', fixture.root,
            '--image', 'fixture/target:1',
            '--health-timeout', '1'
        ], {
            FAKE_PROBE_HEALTH_FAIL: '1'
        })

        assert.notStrictEqual(result.status, 0)
        assert.ok(fs.existsSync(path.join(fixture.root, 'config/.env')))
        assert.ok(fs.existsSync(path.join(fixture.root, 'config/config.json')))
        assert.strictEqual(fs.readFileSync(path.join(fixture.root, 'docker-compose.yml'), 'utf8'), oldCompose)
        assert.strictEqual(readManifest(fixture).checkpoint, 'rolled_back')
        assert.strictEqual(fs.existsSync(path.join(fixture.root, 'data/setup-state/fixture-attempt/RECOVER_SAME_RELEASE_EPOCH')), false)
        const calls = readCalls(fixture)
        assert.match(calls, /pull never/)
        assert.match(calls, /network connect --ip 172\.20\.0\.2 --alias bili-qq-bot bot_network bot-old/)
        assert.match(calls, /network connect --ip 172\.20\.0\.2 --alias bili-qq-bot bot_network napcat-old/)
        assert.strictEqual(fs.readFileSync(path.join(fixture.stateDir, 'bot-old.running'), 'utf8').trim(), 'true')
        assert.strictEqual(fs.readFileSync(path.join(fixture.stateDir, 'bot-old.paused'), 'utf8').trim(), 'true')
        assert.strictEqual(fs.readFileSync(path.join(fixture.stateDir, 'napcat-old.running'), 'utf8').trim(), 'false')
    })

    it('aggregates rollback faults and retains recovery-required active state', function () {
        const fixture = createLegacyInstall()
        roots.push(fixture.root)
        const result = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '1'
        ], {
            FAKE_PROBE_HEALTH_FAIL: '1',
            FAKE_ROLLBACK_DOWN_FAIL: '1',
            BILI_SETUP_TEST_FAILPOINT: 'rollback-snapshot-restore'
        })

        assert.notStrictEqual(result.status, 0)
        assert.strictEqual(readManifest(fixture).checkpoint, 'failed')
        assert.match(result.stderr, /recovery-required \(compose-down snapshot-restore/)
        assert.strictEqual(
            fs.readFileSync(path.join(fixture.root, 'data/setup-state/active-attempt'), 'utf8').trim(),
            'fixture-attempt'
        )
    })

    it('retains recovery-required state when writer restoration cannot be verified', function () {
        const fixture = createLegacyInstall()
        roots.push(fixture.root)
        const result = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '1'
        ], { FAKE_PROBE_HEALTH_FAIL: '1', FAKE_WRITER_RESTORE_FAIL: '1' })

        assert.notStrictEqual(result.status, 0)
        assert.strictEqual(readManifest(fixture).checkpoint, 'failed')
        assert.match(result.stderr, /writer-restore/)
        assert.ok(fs.existsSync(path.join(fixture.root, 'data/setup-state/active-attempt')))
    })

    it('preserves managed provenance and ownership lineage byte-for-byte across rollback', function () {
        const fixture = createManagedInstall()
        roots.push(fixture.root)
        const marker = path.join(fixture.root, 'data/setup-state/managed-v1')
        const ownership = path.join(fixture.root, 'data/setup-state/compose-ownership.json')
        const beforeMarker = fs.readFileSync(marker)
        const beforeOwnership = fs.readFileSync(ownership)
        const beforeMarkerMode = fs.statSync(marker).mode & 0o777
        const beforeOwnershipMode = fs.statSync(ownership).mode & 0o777

        const failed = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '3'
        ], { FAKE_PROBE_HEALTH_FAIL: '1' })

        assert.notStrictEqual(failed.status, 0)
        assert.strictEqual(readManifest(fixture).checkpoint, 'rolled_back')
        const afterMarker = fs.readFileSync(marker)
        const afterOwnership = fs.readFileSync(ownership)
        assert.strictEqual(sha256(afterMarker), sha256(beforeMarker))
        assert.strictEqual(sha256(afterOwnership), sha256(beforeOwnership))
        assert.deepStrictEqual(afterMarker, beforeMarker)
        assert.deepStrictEqual(afterOwnership, beforeOwnership)
        assert.strictEqual(fs.statSync(marker).mode & 0o777, beforeMarkerMode)
        assert.strictEqual(fs.statSync(ownership).mode & 0o777, beforeOwnershipMode)
        assert.strictEqual(beforeMarkerMode, 0o600)
        assert.strictEqual(beforeOwnershipMode, 0o600)
        assert.strictEqual(fs.statSync(path.dirname(marker)).mode & 0o777, 0o700)

        const dryRun = runSetup(fixture, [
            '--dry-run', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1'
        ], { BILI_SETUP_ATTEMPT_ID: 'managed-dry-run-after-rollback' })
        assert.strictEqual(dryRun.status, 0, dryRun.stderr)
        const report = JSON.parse(dryRun.stdout)
        assert.strictEqual(report.mode, 'upgrade')
        assert.strictEqual(report.plannedDeliveryGuarantee, 'exactly-once')
        assert.deepStrictEqual(report.plannedFeatureInventory, [])
    })

    it('does not roll back after runtime_released and records same-epoch recovery', function () {
        const fixture = createLegacyInstall()
        roots.push(fixture.root)
        const result = runSetup(fixture, [
            '--upgrade',
            '--non-interactive',
            '--install-dir', fixture.root,
            '--image', 'fixture/target:1',
            '--health-timeout', '1'
        ], {
            FAKE_NORMAL_HEALTH_FAIL: '1'
        })

        assert.notStrictEqual(result.status, 0)
        assert.strictEqual(readManifest(fixture).checkpoint, 'runtime_released')
        const recovery = path.join(fixture.root, 'data/setup-state/fixture-attempt/RECOVER_SAME_RELEASE_EPOCH')
        assert.strictEqual(fs.readFileSync(recovery, 'utf8').trim(), 'release-fixture-attempt')
        assert.doesNotMatch(readCalls(fixture), /rollback-compose\.yml/)
    })

    it('recovers in the same epoch after legacy archive and all parent directories are fsynced', function () {
        const fixture = createLegacyInstall()
        roots.push(fixture.root)
        const first = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ], { BILI_SETUP_TEST_FAILPOINT: 'archive-after-parent-fsync' })

        assert.notStrictEqual(first.status, 0)
        assert.strictEqual(readManifest(fixture).checkpoint, 'runtime_ready')
        const attempt = path.join(fixture.root, 'data/setup-state/fixture-attempt')
        assert.ok(fs.existsSync(path.join(attempt, 'RECOVER_SAME_RELEASE_EPOCH')))
        assert.ok(fs.existsSync(path.join(attempt, 'retained-vault/archive/legacy/.env')))
        assert.ok(fs.existsSync(path.join(attempt, 'retained-vault/archive/legacy/config.json')))

        const resumed = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ])
        assert.strictEqual(resumed.status, 0, resumed.stderr)
        assert.strictEqual(readManifest(fixture).checkpoint, 'upgrade_complete')
    })

    it('fails closed before cutover when an unknown container writes a protected mount', function () {
        const fixture = createLegacyInstall()
        roots.push(fixture.root)
        const result = runSetup(fixture, [
            '--upgrade',
            '--non-interactive',
            '--install-dir', fixture.root,
            '--image', 'fixture/target:1'
        ], {
            FAKE_EXTERNAL_WRITER: '1'
        })

        assert.notStrictEqual(result.status, 0)
        assert.match(result.stderr, /unknown container writer/)
        assert.doesNotMatch(readCalls(fixture), /kill --signal/)
        assert.strictEqual(fs.readFileSync(path.join(fixture.stateDir, 'bot-old.running'), 'utf8').trim(), 'true')
    })

    it('fails closed before cutover when an unknown host process has a writable handle', function () {
        const fixture = createLegacyInstall()
        roots.push(fixture.root)
        const result = runSetup(fixture, [
            '--upgrade',
            '--non-interactive',
            '--install-dir', fixture.root,
            '--image', 'fixture/target:1'
        ], {
            BILI_SETUP_LSOF_BIN: fakeLsof,
            FAKE_HOST_WRITER: '1'
        })

        assert.notStrictEqual(result.status, 0)
        assert.match(result.stderr, /unknown host writer/)
        assert.doesNotMatch(readCalls(fixture), /kill --signal/)
        assert.strictEqual(fs.readFileSync(path.join(fixture.stateDir, 'bot-old.running'), 'utf8').trim(), 'true')
        assert.strictEqual(fs.existsSync(path.join(fixture.root, 'data/setup-state/active-attempt')), false)
    })

    it('fails closed before cutover on an unrecognized config entry', function () {
        const fixture = createLegacyInstall()
        roots.push(fixture.root)
        fs.writeFileSync(path.join(fixture.root, 'config/private-note.txt'), 'do not archive implicitly\n', { mode: 0o600 })
        const result = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1'
        ])

        assert.notStrictEqual(result.status, 0)
        assert.match(result.stderr, /unrecognized entry/)
        assert.strictEqual(fs.existsSync(path.join(fixture.root, 'data/setup-state')), false)
        assert.ok(fs.existsSync(path.join(fixture.root, 'config/private-note.txt')))
        assert.doesNotMatch(readCalls(fixture), /image tag|runtime-probe\.yml/)
    })

    it('writes forced_recovery_ready before killing legacy writers', function () {
        const fixture = createLegacyInstall()
        roots.push(fixture.root)
        const result = runSetup(fixture, [
            '--upgrade',
            '--non-interactive',
            '--force-stop',
            '--install-dir', fixture.root,
            '--image', 'fixture/target:1',
            '--health-timeout', '5'
        ], {
            FAKE_IGNORE_TERM: '1'
        })

        assert.strictEqual(result.status, 0, result.stderr)
        const cliCalls = fs.readFileSync(path.join(fixture.stateDir, 'cli-calls.log'), 'utf8')
        const forcedCheckpoint = cliCalls.indexOf('--status forced_recovery_ready')
        const killCall = readCalls(fixture).indexOf('kill --signal KILL')
        assert.ok(forcedCheckpoint >= 0, cliCalls)
        assert.ok(killCall >= 0, readCalls(fixture))
        assert.strictEqual(readManifest(fixture).checkpoint, 'upgrade_complete')
    })

    it('rolls back an interrupted pre-marker attempt before allowing a new attempt', function () {
        const fixture = createLegacyInstall()
        roots.push(fixture.root)
        const first = runSetup(fixture, [
            '--upgrade',
            '--non-interactive',
            '--install-dir', fixture.root,
            '--image', 'fixture/target:1',
            '--health-timeout', '5'
        ], {
            FAKE_CRASH_ON_RUNTIME_PROBE_UP: '1'
        })

        assert.notStrictEqual(first.status, 0)
        const attemptRoot = path.join(fixture.root, 'data/setup-state/fixture-attempt')
        assert.strictEqual(fs.readFileSync(path.join(attemptRoot, 'checkpoint'), 'utf8').trim(), 'probe_started')
        assert.strictEqual(fs.readFileSync(path.join(fixture.root, 'data/setup-state/active-attempt'), 'utf8').trim(), 'fixture-attempt')

        const second = runSetup(fixture, [
            '--upgrade',
            '--non-interactive',
            '--install-dir', fixture.root,
            '--image', 'fixture/unrelated-current-flag:9',
            '--health-timeout', '5'
        ])

        assert.strictEqual(second.status, 75, second.stderr)
        assert.match(second.stderr, /rolled back safely/)
        assert.ok(fs.existsSync(path.join(fixture.root, 'config/.env')))
        assert.ok(fs.existsSync(path.join(fixture.root, 'config/config.json')))
        assert.strictEqual(readManifest(fixture).checkpoint, 'rolled_back')
        assert.strictEqual(readManifest(fixture).cutover.cutoverKind, 'first-managed-adoption')
        assert.strictEqual(fs.existsSync(path.join(fixture.root, 'data/setup-state/active-attempt')), false)
        assert.deepStrictEqual(
            fs.readdirSync(path.join(fixture.root, 'data/setup-state')).filter(name => name !== 'active-attempt').sort(),
            ['.bili-publication-quarantine.fixture-attempt', '.setup-publication-restore.fixture-attempt', 'fixture-attempt']
        )
        assert.doesNotMatch(readCalls(fixture), /pull fixture\/unrelated-current-flag:9/)
    })

    it('retains the active attempt when the rollback_started checkpoint fails', function () {
        const fixture = createLegacyInstall()
        roots.push(fixture.root)
        const first = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ], { FAKE_CRASH_ON_RUNTIME_PROBE_UP: '1' })
        assert.notStrictEqual(first.status, 0)
        assert.ok(fs.existsSync(path.join(fixture.root, 'data/setup-state/active-attempt')))
        assert.strictEqual(readManifest(fixture).checkpoint, 'probe_started')

        const second = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ], { BILI_SETUP_TEST_FAILPOINT: 'checkpoint-return-rollback_started' })
        assert.notStrictEqual(second.status, 0)
        assert.ok(fs.existsSync(path.join(fixture.root, 'data/setup-state/active-attempt')))
        assert.strictEqual(readManifest(fixture).checkpoint, 'probe_started')
    })

    for (const unsafeKind of ['corrupt', 'symlink', '0644', 'hardlink']) {
        it(`fails closed and retains the active attempt for a ${unsafeKind} manifest`, function () {
            const fixture = createLegacyInstall()
            roots.push(fixture.root)
            fs.writeFileSync(path.join(fixture.root, 'config/.jwtSecret'), 'j'.repeat(64), { mode: 0o600 })
            const first = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], { BILI_SETUP_CLI_DRIVER: '', FAKE_CRASH_ON_RUNTIME_PROBE_UP: '1' })
            assert.notStrictEqual(first.status, 0)

            const active = path.join(fixture.root, 'data/setup-state/active-attempt')
            const manifest = path.join(fixture.root, 'data/setup-state/fixture-attempt/upgrade-manifest.json')
            if (unsafeKind === 'corrupt') fs.writeFileSync(manifest, '{not-json\n', { mode: 0o600 })
            if (unsafeKind === '0644') fs.chmodSync(manifest, 0o644)
            if (unsafeKind === 'symlink') {
                const saved = path.join(fixture.root, 'unsafe-manifest-target.json')
                fs.renameSync(manifest, saved)
                fs.symlinkSync(saved, manifest)
            }
            if (unsafeKind === 'hardlink') fs.linkSync(manifest, path.join(fixture.root, 'manifest-hardlink.json'))

            const resumed = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], { BILI_SETUP_CLI_DRIVER: '' })
            assert.notStrictEqual(resumed.status, 0)
            assert.match(resumed.stderr, /manifest is invalid or unsafe|MIGRATION_/)
            assert.strictEqual(fs.readFileSync(active, 'utf8').trim(), 'fixture-attempt')
        })
    }

    for (const jwtLength of [null, 63, 65]) {
        it(`fails the real legacy setup when JWT is ${jwtLength === null ? 'missing' : `${jwtLength} characters`}`, function () {
            const fixture = createLegacyInstall()
            roots.push(fixture.root)
            if (jwtLength !== null) fs.writeFileSync(path.join(fixture.root, 'config/.jwtSecret'), 'x'.repeat(jwtLength), { mode: 0o600 })
            const result = runSetup(fixture, [
                '--upgrade', '--non-interactive', '--install-dir', fixture.root,
                '--image', 'fixture/target:1', '--health-timeout', '5'
            ], { BILI_SETUP_CLI_DRIVER: '' })
            assert.notStrictEqual(result.status, 0)
            assert.match(result.stderr, /LEGACY_JWT_SECRET_EFFECTIVE_UNPROVABLE/)
            assert.strictEqual(readManifest(fixture).checkpoint, 'rolled_back')
        })
    }

    it('keeps resolver warnings through a real setup and actual checkpoint CLI chain', function () {
        const fixture = createLegacyInstall()
        roots.push(fixture.root)
        fs.writeFileSync(path.join(fixture.root, 'config/.jwtSecret'), 'j'.repeat(64), { mode: 0o600 })
        const legacyEnvPath = path.join(fixture.root, 'config/.env')
        fs.appendFileSync(legacyEnvPath, 'BILI_SERVER_PORT=10001\n')
        const result = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ], { BILI_SETUP_CLI_DRIVER: '' })
        assert.strictEqual(result.status, 0, result.stderr)
        const manifest = readManifest(fixture)
        assert.strictEqual(manifest.checkpoint, 'upgrade_complete')
        assert.strictEqual(manifest.cutover.cutoverKind, 'first-managed-adoption')
        assert.ok(manifest.cutover.warningCodes.includes('LEGACY_COERCION_APPLIED'))
        const dataRoot = fs.existsSync(path.join(fixture.root, 'relocated-data/setup-state')) ? path.join(fixture.root, 'relocated-data') : path.join(fixture.root, 'data')
        const manifestPath = path.join(dataRoot, 'setup-state/fixture-attempt/upgrade-manifest.json')
        const status = spawnSync(process.execPath, [
            path.join(repoRoot, 'src/cli/data-migrate.js'), 'status', '--manifest', manifestPath, '--json'
        ], { cwd: repoRoot, encoding: 'utf8' })
        assert.strictEqual(status.status, 0, status.stderr)
        assert.ok(JSON.parse(status.stdout).migration.warningCodes.includes('LEGACY_COERCION_APPLIED'))
    })

    it('resumes runtime_released in the same epoch without rerunning migration', function () {
        const fixture = createLegacyInstall()
        roots.push(fixture.root)
        const first = runSetup(fixture, [
            '--upgrade',
            '--non-interactive',
            '--install-dir', fixture.root,
            '--image', 'fixture/target:1',
            '--health-timeout', '5'
        ], {
            FAKE_CRASH_ON_RUNTIME_RELEASE_UP: '1'
        })

        assert.notStrictEqual(first.status, 0)
        const attemptRoot = path.join(fixture.root, 'data/setup-state/fixture-attempt')
        assert.strictEqual(fs.readFileSync(path.join(attemptRoot, 'checkpoint'), 'utf8').trim(), 'runtime_released')
        assert.strictEqual(readManifest(fixture).releaseEpoch, 'release-fixture-attempt')

        const second = runSetup(fixture, [
            '--upgrade',
            '--non-interactive',
            '--install-dir', fixture.root,
            '--image', 'fixture/unrelated-current-flag:9',
            '--health-timeout', '5'
        ])

        assert.strictEqual(second.status, 0, second.stderr)
        assert.strictEqual(readManifest(fixture).checkpoint, 'upgrade_complete')
        assert.strictEqual(readManifest(fixture).releaseEpoch, 'release-fixture-attempt')
        const cliCalls = fs.readFileSync(path.join(fixture.stateDir, 'cli-calls.log'), 'utf8')
        assert.doesNotMatch(cliCalls, /migrate-legacy/)
        assert.doesNotMatch(cliCalls, /data-migrate\.js apply/)
        assert.doesNotMatch(readCalls(fixture), /pull fixture\/unrelated-current-flag:9/)
        assert.strictEqual(fs.existsSync(path.join(fixture.root, 'data/setup-state/active-attempt')), false)
    })

    it('treats a completed active attempt marker as idempotent cleanup', function () {
        const fixture = createLegacyInstall()
        roots.push(fixture.root)
        const first = runSetup(fixture, [
            '--upgrade',
            '--non-interactive',
            '--install-dir', fixture.root,
            '--image', 'fixture/target:1',
            '--health-timeout', '5'
        ])
        assert.strictEqual(first.status, 0, first.stderr)

        const active = path.join(fixture.root, 'data/setup-state/active-attempt')
        const baselinePath = path.join(fixture.root, 'data/config-state/deployment-applied.json')
        const baselineBefore = fs.readFileSync(baselinePath)
        const baselineGeneration = readDeploymentBaseline(baselinePath).generation
        const baselineStatBefore = fs.statSync(baselinePath)
        fs.writeFileSync(active, 'fixture-attempt\n', { mode: 0o600 })
        const second = runSetup(fixture, [
            '--upgrade',
            '--non-interactive',
            '--install-dir', fixture.root,
            '--image', 'fixture/unrelated-current-flag:9',
            '--health-timeout', '5'
        ])

        assert.strictEqual(second.status, 0, second.stderr)
        assert.match(second.stderr, /already complete/)
        assert.strictEqual(fs.existsSync(active), false)
        assert.strictEqual(readManifest(fixture).checkpoint, 'upgrade_complete')
        assert.match(readCalls(fixture), /^exec /m)
        assert.doesNotMatch(readCalls(fixture), /pull fixture\/unrelated-current-flag:9/)
        assert.deepStrictEqual(fs.readFileSync(baselinePath), baselineBefore)
        assert.strictEqual(readDeploymentBaseline(baselinePath).generation, baselineGeneration)
        const baselineStatAfter = fs.statSync(baselinePath)
        assert.strictEqual(baselineStatAfter.ino, baselineStatBefore.ino)
        assert.strictEqual(baselineStatAfter.mtimeMs, baselineStatBefore.mtimeMs)
    })

    it('retains a completed attempt and its baseline when resumed normal health cannot be verified', function () {
        const fixture = createLegacyInstall()
        roots.push(fixture.root)
        const first = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/target:1', '--health-timeout', '5'
        ])
        assert.strictEqual(first.status, 0, first.stderr)

        const active = path.join(fixture.root, 'data/setup-state/active-attempt')
        const baselinePath = path.join(fixture.root, 'data/config-state/deployment-applied.json')
        const baselineBefore = fs.readFileSync(baselinePath)
        fs.writeFileSync(active, 'fixture-attempt\n', { mode: 0o600 })
        const resumed = runSetup(fixture, [
            '--upgrade', '--non-interactive', '--install-dir', fixture.root,
            '--image', 'fixture/unrelated-current-flag:9', '--health-timeout', '1'
        ], { FAKE_NORMAL_HEALTH_FAIL: '1' })

        assert.notStrictEqual(resumed.status, 0)
        assert.match(resumed.stderr, /committed release requires recovery in the same epoch/)
        assert.strictEqual(fs.readFileSync(active, 'utf8').trim(), 'fixture-attempt')
        assert.deepStrictEqual(fs.readFileSync(baselinePath), baselineBefore)
        assert.strictEqual(readManifest(fixture).checkpoint, 'upgrade_complete')
        assert.match(readCalls(fixture), /runtime-release\.yml/)
        assert.doesNotMatch(readCalls(fixture), /pull fixture\/unrelated-current-flag:9/)
    })
})
