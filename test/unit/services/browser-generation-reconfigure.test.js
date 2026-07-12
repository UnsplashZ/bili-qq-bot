'use strict'

const assert = require('assert')
const browserModule = require('../../../src/services/imageGenerator/core/browser')
const { BrowserManager } = browserModule

describe('BrowserManager generation leases', () => {
    it('refuses to close an active generation and switches after leases drain', async () => {
        let closed = 0
        const manager = new BrowserManager({ startMonitors: false, executablePath: '/old/chrome' })
        manager.browser = {
            async close() { closed += 1 },
            on() {}
        }
        const lease = manager.acquireGenerationLease()
        await assert.rejects(
            manager.reconfigure({ executablePath: '/new/chrome', timeoutMs: 20 }),
            (error) => error.code === 'BROWSER_GENERATION_DRAIN_TIMEOUT'
        )
        assert.strictEqual(closed, 0)
        assert.strictEqual(manager.executablePath, '/old/chrome')

        lease.release()
        const result = await manager.reconfigure({ executablePath: '/new/chrome', timeoutMs: 100 })
        assert.strictEqual(result.changed, true)
        assert.strictEqual(result.generation, 2)
        assert.strictEqual(closed, 1)
        assert.strictEqual(manager.executablePath, '/new/chrome')
        await manager.cleanup()
        const counts = manager.getResourceCounts()
        assert.strictEqual(counts.browser, 0)
        assert.strictEqual(counts.pages, 0)
        assert.strictEqual(counts.generationLeases, 0)
        assert.strictEqual(counts.cleanupTimer, 0)
        assert.strictEqual(counts.idleTimer, 0)
    })

    it('releases the generation lease when page initialization fails', async () => {
        let pageClosed = 0
        const manager = new BrowserManager({ startMonitors: false })
        manager.browser = {
            async newPage() {
                return {
                    async setUserAgent() { throw new Error('page setup failed') },
                    async close() { pageClosed += 1 }
                }
            },
            async close() {},
            on() {}
        }

        await assert.rejects(() => manager.createPage(), /page setup failed/)
        assert.equal(pageClosed, 1)
        assert.equal(manager.getResourceCounts().generationLeases, 0)
        await manager.cleanup()
    })

    it('releases the generation lease when browser launch fails', async () => {
        const manager = new BrowserManager({
            startMonitors: false,
            launchBrowser: async () => { throw new Error('launch failed') }
        })

        await assert.rejects(() => manager.createPage(), /launch failed/)
        assert.equal(manager.getResourceCounts().generationLeases, 0)
        assert.equal(manager.getResourceCounts().leaseWaiters, 0)
        await manager.cleanup()
    })
})
