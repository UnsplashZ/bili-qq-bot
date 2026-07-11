'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { inventoryTree, diffInventories } = require('../../tools/runtime-data-safety')

describe('unit-test runtime data isolation', () => {
    it('redirects safely-loadable production singleton owners to one temporary runtime root', () => {
        const isolation = global.__BILI_TEST_RUNTIME_ISOLATION__
        assert.ok(isolation)
        assert.ok(fs.realpathSync(isolation.root).startsWith(fs.realpathSync(os.tmpdir())))
        for (const [name, filePath] of Object.entries(isolation.paths)) {
            const relative = path.relative(isolation.root, filePath)
            assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), `${name}: ${filePath}`)
        }

        const subscriptionManager = require('../../../src/services/subscription/subscriptionManager')
        const stateStore = require('../../../src/services/subscription/subscriptionStateStore')
        const deliveryStore = require('../../../src/services/subscription/subscriptionDeliveryStore')
        const cacheManager = require('../../../src/utils/cacheManager')
        const metaCache = require('../../../src/services/subscriptionUserMetaCacheService')
        assert.strictEqual(subscriptionManager.subFile, isolation.paths.subscriptions)
        assert.strictEqual(subscriptionManager.followersFile, isolation.paths.followers)
        assert.strictEqual(stateStore.stateFile, isolation.paths.subscriptionState)
        assert.strictEqual(deliveryStore.deliveryFile, isolation.paths.delivery)
        assert.strictEqual(cacheManager.cacheDir, isolation.paths.cache)
        assert.strictEqual(metaCache.cacheFile, isolation.paths.subscriptionUserMeta)
    })

    it('preloads a fail-closed fs barrier into Node children while allowing temporary writes', () => {
        const isolation = global.__BILI_TEST_RUNTIME_ISOLATION__
        const forbiddenBase = path.join(isolation.projectRoot, 'data', `.__runtime-barrier-${process.pid}`)
        const allowed = path.join(os.tmpdir(), `bili-runtime-barrier-allowed-${process.pid}`)
        const script = `
            const fs = require('fs');
            const forbidden = process.argv[1];
            const allowed = process.argv[2];
            const attempts = [
                () => fs.writeFileSync(forbidden + '-write', 'x'),
                () => fs.mkdirSync(forbidden + '-mkdir'),
                () => fs.openSync(forbidden + '-open', 'w'),
                () => fs.copyFileSync(__filename, forbidden + '-copy'),
                () => fs.createWriteStream(forbidden + '-stream')
            ];
            for (const attempt of attempts) {
                let blocked = false;
                try { attempt(); } catch (error) { blocked = error.code === 'TEST_REAL_RUNTIME_WRITE_BLOCKED'; }
                if (!blocked) process.exit(20);
            }
            fs.writeFileSync(allowed, 'allowed');
        `
        try {
            const child = spawnSync(process.execPath, ['-e', script, forbiddenBase, allowed], {
                cwd: isolation.projectRoot,
                env: process.env,
                encoding: 'utf8',
                timeout: 30000
            })
            assert.strictEqual(child.status, 0, child.stderr || child.stdout)
            assert.strictEqual(fs.readFileSync(allowed, 'utf8'), 'allowed')
            assert.strictEqual(fs.existsSync(`${forbiddenBase}-write`), false)
        } finally {
            fs.rmSync(allowed, { force: true })
        }
    })

    it('reports precise metadata inventory differences on an isolated fixture', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-runtime-canary-'))
        const filePath = path.join(root, 'state.json')
        try {
            fs.writeFileSync(filePath, '{}\n', { mode: 0o600 })
            const before = inventoryTree([root])
            fs.chmodSync(filePath, 0o640)
            const after = inventoryTree([root])
            const differences = diffInventories(before, after)
            assert.ok(differences.some((entry) => entry.path.endsWith(`${path.sep}state.json`)))
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })
})
