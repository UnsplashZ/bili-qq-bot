'use strict'

const assert = require('assert')
const fsp = require('fs').promises
const os = require('os')
const path = require('path')
const { ConfigService } = require('../../../src/config/configService')

async function waitFor(predicate, timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        if (await predicate()) return
        await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error('Timed out waiting for condition')
}

describe('ConfigService watcher', () => {
    let root
    let configDir
    let configPath
    let service

    beforeEach(async () => {
        root = await fsp.mkdtemp(path.join(os.tmpdir(), 'bili-config-watcher-'))
        configDir = path.join(root, 'config')
        configPath = path.join(configDir, 'config.yaml')
        service = new ConfigService({
            configDir,
            stateDir: path.join(root, 'data', 'config-state'),
            debounceMs: 20,
            unlinkGraceMs: 40
        })
        await service.initialize({ createIfMissing: true })
        await service.start({ watch: true })
    })

    afterEach(async () => {
        await service.stop()
        await fsp.rm(root, { recursive: true, force: true })
    })

    it('applies valid external edits, rejects invalid edits and keeps last-good active', async () => {
        const original = await fsp.readFile(configPath, 'utf8')
        const valid = original.replace('checkIntervalSeconds: 60', 'checkIntervalSeconds: 95')
        await fsp.writeFile(configPath, valid, { mode: 0o600 })
        await waitFor(() => service.get('subscriptionCheckInterval') === 95)
        assert.strictEqual(service.getStatus().documentGeneration, 2)

        await fsp.writeFile(configPath, 'version: 1\nqq: [invalid]\n', { mode: 0o600 })
        await waitFor(() => service.getStatus().lastFailedReloadAt !== null)
        assert.strictEqual(service.get('subscriptionCheckInterval'), 95)
        assert.strictEqual(service.getStatus().documentGeneration, 2)
        assert.ok(service.getStatus().rejected)
    })

    it('suppresses its own committed hash and does not double-increment generation', async () => {
        await service.patch([{ op: 'set', path: ['cache', 'dataTtlSeconds'], value: 25 }], { expectedGeneration: 1 })
        assert.strictEqual(service.getStatus().documentGeneration, 2)
        await new Promise((resolve) => setTimeout(resolve, 200))
        assert.strictEqual(service.getStatus().documentGeneration, 2)
        assert.strictEqual(service.get('dataCacheTTL'), 25)
    })

    it('rejects a valid manual edit when config.yaml permissions become unsafe', async () => {
        const source = await fsp.readFile(configPath, 'utf8')
        const beforeFailure = service.getStatus().lastFailedReloadAt
        await fsp.chmod(configPath, 0o644)
        await fsp.writeFile(configPath, source.replace('checkIntervalSeconds: 60', 'checkIntervalSeconds: 88'))
        await waitFor(() => service.getStatus().lastFailedReloadAt !== beforeFailure)
        assert.strictEqual(service.get('subscriptionCheckInterval'), 60)
        assert.strictEqual(service.getStatus().documentGeneration, 1)
        assert.strictEqual((await fsp.stat(configPath)).mode & 0o777, 0o644)
        await fsp.chmod(configPath, 0o600)
    })

    it('survives an unlink grace window without reverting to defaults', async () => {
        const source = await fsp.readFile(configPath, 'utf8')
        await fsp.unlink(configPath)
        await new Promise((resolve) => setTimeout(resolve, 15))
        await fsp.writeFile(configPath, source.replace('checkIntervalSeconds: 60', 'checkIntervalSeconds: 70'), { mode: 0o600 })
        await waitFor(() => service.get('subscriptionCheckInterval') === 70)
        assert.strictEqual(service.getStatus().effectiveGeneration, 2)
    })
})
