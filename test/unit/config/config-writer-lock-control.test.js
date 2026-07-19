'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { atomicWriteFile } = require('../../../src/config/configWriter')
const { ConfigControlServer, requestConfigControl, secureControlSocket, removeStaleControlSocket, defaultConfigControlSocketPath } = require('../../../src/config/configControl')
const { normalizePatchPath } = require('../../../src/config/schemaV1')
const { run } = require('../../../src/cli/config')
const { createDefaultConfig } = require('../../../src/config/schemaV1')
const { writeDeploymentBaseline, readDeploymentBaseline } = require('../../../src/config/deploymentBaseline')

describe('config writer and control socket', () => {
    it('preserves an external revision installed after claim validation but before no-replace publication', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-config-writer-final-cas-'))
        const configDir = path.join(root, 'config')
        const configPath = path.join(configDir, 'config.yaml')
        fs.mkdirSync(configDir, { mode: 0o700 })
        fs.writeFileSync(configPath, 'original\n', { mode: 0o600 })
        const expectedHash = crypto.createHash('sha256').update('original\n').digest('hex')
        try {
            await assert.rejects(
                atomicWriteFile(configPath, 'candidate\n', {
                    expectedHash,
                    helperEnv: { BILI_CONFIG_ATOMIC_TEST_EXTERNAL_REVISION: 'manual revision\n' }
                }),
                (error) => error.code === 'CONFIG_WRITE_ERROR' && error.reason === 'CONFIG_ATOMIC_TARGET_CHANGED'
            )
            assert.strictEqual(fs.readFileSync(configPath, 'utf8'), 'manual revision\n')
            assert.deepStrictEqual(fs.readdirSync(configDir).sort(), ['config.yaml'])
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it('applies the same no-replace CAS when a rollback restore races a manual revision', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-config-writer-rollback-cas-'))
        const configDir = path.join(root, 'config')
        const configPath = path.join(configDir, 'config.yaml')
        fs.mkdirSync(configDir, { mode: 0o700 })
        fs.writeFileSync(configPath, 'candidate\n', { mode: 0o600 })
        const expectedHash = crypto.createHash('sha256').update('candidate\n').digest('hex')
        try {
            await assert.rejects(
                atomicWriteFile(configPath, 'previous\n', {
                    expectedHash,
                    helperEnv: { BILI_CONFIG_ATOMIC_TEST_EXTERNAL_REVISION: 'manual during rollback\n' }
                }),
                (error) => error.code === 'CONFIG_WRITE_ERROR' && error.reason === 'CONFIG_ATOMIC_TARGET_CHANGED'
            )
            assert.strictEqual(fs.readFileSync(configPath, 'utf8'), 'manual during rollback\n')
            assert.deepStrictEqual(fs.readdirSync(configDir).sort(), ['config.yaml'])
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it('reconciles an attempt-private claim left by interruption before publication', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-config-writer-claim-recovery-'))
        const configDir = path.join(root, 'config')
        const configPath = path.join(configDir, 'config.yaml')
        fs.mkdirSync(configDir, { mode: 0o700 })
        fs.writeFileSync(configPath, 'original\n', { mode: 0o600 })
        const expectedHash = crypto.createHash('sha256').update('original\n').digest('hex')
        const claimPath = path.join(configDir, `.config.yaml.atomic-claim.${expectedHash}`)
        fs.renameSync(configPath, claimPath)
        try {
            await atomicWriteFile(configPath, 'candidate\n', { expectedHash })
            assert.strictEqual(fs.readFileSync(configPath, 'utf8'), 'candidate\n')
            assert.deepStrictEqual(fs.readdirSync(configDir).sort(), ['config.yaml'])
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it('reconciles the old-hash claim after a crash immediately following no-replace publication', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-config-writer-post-publish-'))
        const configDir = path.join(root, 'config')
        const configPath = path.join(configDir, 'config.yaml')
        fs.mkdirSync(configDir, { mode: 0o700 })
        fs.writeFileSync(configPath, 'original\n', { mode: 0o600 })
        const originalHash = crypto.createHash('sha256').update('original\n').digest('hex')
        const candidateHash = crypto.createHash('sha256').update('candidate\n').digest('hex')
        try {
            await assert.rejects(atomicWriteFile(configPath, 'candidate\n', {
                expectedHash: originalHash,
                helperEnv: { BILI_CONFIG_ATOMIC_TEST_CRASH_AFTER_PUBLISH: '1' }
            }))
            assert.strictEqual(fs.readFileSync(configPath, 'utf8'), 'candidate\n')
            assert.strictEqual(fs.statSync(configPath).nlink, 1)
            assert.ok(fs.readdirSync(configDir).some((entry) => entry.includes(`atomic-claim.${originalHash}`)))

            await atomicWriteFile(configPath, 'final\n', { expectedHash: candidateHash })
            assert.strictEqual(fs.readFileSync(configPath, 'utf8'), 'final\n')
            assert.strictEqual(fs.statSync(configPath).nlink, 1)
            assert.deepStrictEqual(fs.readdirSync(configDir).sort(), ['config.yaml'])
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it('fails closed on multiple or fingerprint-mismatched target claims', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-config-writer-claim-unsafe-'))
        const configDir = path.join(root, 'config')
        const configPath = path.join(configDir, 'config.yaml')
        fs.mkdirSync(configDir, { mode: 0o700 })
        fs.writeFileSync(configPath, 'original\n', { mode: 0o600 })
        const expectedHash = crypto.createHash('sha256').update('original\n').digest('hex')
        const first = path.join(configDir, `.config.yaml.atomic-claim.${'0'.repeat(64)}`)
        const second = path.join(configDir, `.config.yaml.atomic-claim.${'1'.repeat(64)}`)
        fs.writeFileSync(first, 'unknown-a\n', { mode: 0o600 })
        fs.writeFileSync(second, 'unknown-b\n', { mode: 0o600 })
        try {
            await assert.rejects(
                atomicWriteFile(configPath, 'candidate\n', { expectedHash }),
                (error) => error.code === 'CONFIG_WRITE_ERROR'
            )
            assert.strictEqual(fs.readFileSync(configPath, 'utf8'), 'original\n')
            assert.ok(fs.existsSync(first))
            assert.ok(fs.existsSync(second))
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it('recovers a state-style write without expectedHash after publish-before-claim-cleanup crash', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-config-writer-state-crash-'))
        const stateDir = path.join(root, 'state')
        const statePath = path.join(stateDir, 'last-good.yaml')
        fs.mkdirSync(stateDir, { mode: 0o700 })
        fs.writeFileSync(statePath, 'state-one\n', { mode: 0o600 })
        try {
            await assert.rejects(atomicWriteFile(statePath, 'state-two\n', {
                helperEnv: { BILI_CONFIG_ATOMIC_TEST_CRASH_AFTER_PUBLISH: '1' }
            }))
            assert.strictEqual(fs.readFileSync(statePath, 'utf8'), 'state-two\n')
            assert.strictEqual(fs.statSync(statePath).nlink, 1)
            await atomicWriteFile(statePath, 'state-three\n')
            assert.strictEqual(fs.readFileSync(statePath, 'utf8'), 'state-three\n')
            assert.deepStrictEqual(fs.readdirSync(stateDir).sort(), ['last-good.yaml'])
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it('preserves an external revision racing creation of an initially absent target', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-config-writer-absent-race-'))
        const configDir = path.join(root, 'config')
        const configPath = path.join(configDir, 'config.yaml')
        fs.mkdirSync(configDir, { mode: 0o700 })
        try {
            await assert.rejects(
                atomicWriteFile(configPath, 'candidate\n', {
                    helperEnv: { BILI_CONFIG_ATOMIC_TEST_EXTERNAL_REVISION: 'external first revision\n' }
                }),
                (error) => error.code === 'CONFIG_WRITE_ERROR' && error.reason === 'CONFIG_ATOMIC_TARGET_CHANGED'
            )
            assert.strictEqual(fs.readFileSync(configPath, 'utf8'), 'external first revision\n')
            assert.deepStrictEqual(fs.readdirSync(configDir).sort(), ['config.yaml'])
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it('aborts an fd-anchored write when the parent path is exchanged after READY', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-config-writer-swap-'))
        const configDir = path.join(root, 'config')
        const originalDir = path.join(root, 'config-original')
        const attackerDir = path.join(root, 'attacker')
        fs.mkdirSync(configDir, { mode: 0o700 })
        fs.mkdirSync(attackerDir, { mode: 0o700 })
        const configPath = path.join(configDir, 'config.yaml')
        try {
            await atomicWriteFile(configPath, 'before\n')
            await assert.rejects(
                atomicWriteFile(configPath, 'secret-candidate\n', {
                    beforeRename() {
                        fs.renameSync(configDir, originalDir)
                        fs.symlinkSync(attackerDir, configDir)
                    }
                }),
                (error) => error.code === 'CONFIG_WRITE_ERROR'
            )
            assert.strictEqual(fs.readFileSync(path.join(originalDir, 'config.yaml'), 'utf8'), 'before\n')
            assert.strictEqual(fs.existsSync(path.join(attackerDir, 'config.yaml')), false)
            assert.deepStrictEqual(fs.readdirSync(originalDir).sort(), ['config.yaml'])
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it('serves public online get/set and never falls back when the socket is unavailable', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-config-control-'))
        const socketPath = path.join(root, 'runtime/config-control.sock')
        const patches = []
        const service = {
            getPublicSnapshot: () => ({ dashboard: { jwtSecret: { configured: true } }, cache: { dataTtlSeconds: 10 } }),
            getStatus: () => ({ documentGeneration: 4 }),
            toPublicError: (error) => ({ code: error?.code || 'CONFIG_ERROR' }),
            async patch(operations, options) {
                patches.push({ operations, options })
                return { generation: 5, applied: ['cache.dataTtlSeconds'] }
            }
        }
        const server = new ConfigControlServer(service, { socketPath })
        try {
            await server.start()
            assert.strictEqual(fs.statSync(socketPath).mode & 0o777, 0o600)
            const secret = await requestConfigControl(socketPath, { action: 'get', path: ['dashboard', 'jwtSecret'] })
            assert.deepStrictEqual(secret.value, { configured: true })
            const result = await run(['set', 'cache.dataTtlSeconds', '22', '--expected-generation', '4', '--socket', socketPath])
            assert.strictEqual(result.result.generation, 5)
            assert.deepStrictEqual(patches[0].operations[0], { op: 'set', path: ['cache', 'dataTtlSeconds'], value: 22 })
            assert.strictEqual(patches[0].options.expectedGeneration, 4)
            await assert.rejects(
                run(['set', 'cache.dataTtlSeconds', '23', '--expected-generation', '5', '--socket', path.join(root, 'missing.sock')]),
                (error) => error.code === 'CONFIG_CONTROL_UNAVAILABLE'
            )
        } finally {
            await server.stop().catch(() => {})
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it('accepts unsupported socket chmod only inside a verified private directory', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bcc-'))
        const directory = path.join(root, 'runtime')
        const socketPath = path.join(directory, 'config-control.sock')
        fs.mkdirSync(directory, { mode: 0o700 })
        const server = require('net').createServer()
        await new Promise((resolve, reject) => {
            server.once('error', reject)
            server.listen(socketPath, resolve)
        })
        const fsPromises = {
            chmod: async () => { throw Object.assign(new Error('unsupported'), { code: 'EINVAL' }) },
            lstat: fs.promises.lstat.bind(fs.promises)
        }
        try {
            await secureControlSocket(socketPath, directory, fsPromises)
            fs.chmodSync(directory, 0o755)
            await assert.rejects(
                secureControlSocket(socketPath, directory, fsPromises),
                (error) => error.code === 'CONFIG_CONTROL_SOCKET_UNSAFE'
            )
        } finally {
            await new Promise((resolve) => server.close(resolve))
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it('removes an inactive bind-mount socket when socket lstat is unsupported', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bcs-'))
        const directory = path.join(root, 'runtime')
        const socketPath = path.join(directory, 'control.sock')
        fs.mkdirSync(directory, { mode: 0o700 })
        fs.writeFileSync(socketPath, '')
        const fsPromises = {
            lstat: async (target) => {
                if (target === socketPath) throw Object.assign(new Error('unsupported'), { code: 'ENOTSUP' })
                return fs.promises.lstat(target)
            },
            unlink: fs.promises.unlink.bind(fs.promises)
        }
        try {
            await removeStaleControlSocket(socketPath, directory, fsPromises)
            assert.strictEqual(fs.existsSync(socketPath), false)
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it('keeps host control state under data but uses tmpfs inside containers', () => {
        assert.strictEqual(
            defaultConfigControlSocketPath({ containerized: false, cwd: '/workspace' }),
            path.resolve('/workspace/data/runtime/config-control.sock')
        )
        assert.strictEqual(
            defaultConfigControlSocketPath({ containerized: true }),
            path.resolve('/tmp/bili-qq-bot/config-control.sock')
        )
    })

    it('accepts only segment arrays or strict RFC 6901 patch pointers', () => {
        assert.deepStrictEqual(normalizePatchPath(['groupConfigs', '123', 'admins']), ['groupConfigs', '123', 'admins'])
        assert.deepStrictEqual(normalizePatchPath('/groupConfigs/a~1b/value~0name'), ['groupConfigs', 'a/b', 'value~name'])
        for (const value of ['groupConfigs.123.admins', '/groupConfigs/~2bad', '/groupConfigs/trailing~']) {
            assert.throws(() => normalizePatchPath(value), (error) => error.code === 'CONFIG_PATCH_PATH_INVALID')
        }
    })

    it('reads the deployment baseline through the opened private fd during a path exchange', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-deployment-baseline-swap-'))
        const baselinePath = path.join(root, 'deployment-applied.json')
        const originalPath = path.join(root, 'deployment-original.json')
        const replacementPath = path.join(root, 'replacement.json')
        fs.chmodSync(root, 0o700)
        try {
            const written = writeDeploymentBaseline(baselinePath, createDefaultConfig(), { releaseEpoch: 'original' })
            fs.writeFileSync(replacementPath, `${JSON.stringify({ ...written, releaseEpoch: 'replacement' })}\n`, { mode: 0o600 })
            const read = readDeploymentBaseline(baselinePath, {
                beforeRead() {
                    fs.renameSync(baselinePath, originalPath)
                    fs.renameSync(replacementPath, baselinePath)
                }
            })
            assert.strictEqual(read.releaseEpoch, 'original')
            fs.chmodSync(baselinePath, 0o644)
            assert.throws(() => readDeploymentBaseline(baselinePath), (error) => error.code === 'DEPLOYMENT_BASELINE_FILE_UNSAFE')
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })
})
