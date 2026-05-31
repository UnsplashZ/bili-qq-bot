'use strict'

const assert = require('assert')
const fs = require('fs').promises
const os = require('os')
const path = require('path')

const {
    SubscriptionDeliveryStore,
    DEFAULT_RETENTION_MS
} = require('../../../src/services/subscription/subscriptionDeliveryStore')

describe('subscription delivery store', function () {
    afterEach(async function () {
        if (this.tmpDir) {
            await fs.rm(this.tmpDir, { recursive: true, force: true })
            this.tmpDir = null
        }
    })

    async function createStore(testContext, options = {}) {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sub-delivery-store-'))
        testContext.tmpDir = tmpDir
        return new SubscriptionDeliveryStore({ dataDir: tmpDir, ...options })
    }

    it('按 groupId:type:contentId 记录 A/B 群投递并可 reload', async function () {
        const store = await createStore(this, { now: () => 1000 })

        await store.recordDelivered({ groupId: 'A', type: 'dynamic', contentId: 'd1' })

        assert.strictEqual(await store.hasDelivered('A', 'dynamic', 'd1'), true)
        assert.strictEqual(await store.hasDelivered('B', 'dynamic', 'd1'), false)
        assert.deepStrictEqual(await store.getUndeliveredGroups(['A', 'B'], 'dynamic', 'd1'), ['B'])
        assert.deepStrictEqual(await store.getDeliveryCoverage(['A', 'B'], 'dynamic', 'd1'), {
            deliveredGroups: ['A'],
            undeliveredGroups: ['B'],
            hasAnyRecord: true
        })
        assert.deepStrictEqual(await store.getDeliveryCoverage(['A', 'B'], 'dynamic', 'd2'), {
            deliveredGroups: [],
            undeliveredGroups: ['A', 'B'],
            hasAnyRecord: false
        })

        const raw = JSON.parse(await fs.readFile(path.join(this.tmpDir, 'subscription_delivery.json'), 'utf8'))
        assert.strictEqual(raw.schemaVersion, 1)
        assert.ok(raw.records['A:dynamic:d1'])

        const reloaded = new SubscriptionDeliveryStore({ dataDir: this.tmpDir })
        await reloaded.reload()
        assert.strictEqual(await reloaded.hasDelivered('A', 'dynamic', 'd1'), true)
        assert.strictEqual(await reloaded.hasDelivered('B', 'dynamic', 'd1'), false)
    })

    it('并发 recordDelivered 与 batch 写入串行化且不丢记录', async function () {
        const store = await createStore(this, { now: () => 2000 })
        const records = []

        for (let index = 0; index < 20; index += 1) {
            records.push({ groupId: `G${index}`, type: 'video', contentId: 'BV1' })
        }

        await Promise.all([
            ...records.slice(0, 10).map(record => store.recordDelivered(record)),
            store.recordDeliveredBatch(records.slice(10))
        ])

        const snapshot = store.getSnapshot()
        assert.strictEqual(Object.keys(snapshot.records).length, 20)

        for (const record of records) {
            assert.strictEqual(await store.hasDelivered(record.groupId, record.type, record.contentId), true)
        }

        const reloaded = new SubscriptionDeliveryStore({ dataDir: this.tmpDir })
        await reloaded.reload()
        assert.strictEqual(Object.keys(reloaded.getSnapshot().records).length, 20)
    })

    it('cleanupExpired 默认保留 30 天内记录', async function () {
        const now = 1_000_000_000
        const store = await createStore(this, { now: () => now })

        await store.recordDeliveredBatch([
            {
                groupId: 'old',
                type: 'article',
                contentId: 'cv1',
                deliveredAt: now - DEFAULT_RETENTION_MS - 1
            },
            {
                groupId: 'fresh',
                type: 'article',
                contentId: 'cv1',
                deliveredAt: now - DEFAULT_RETENTION_MS + 1
            }
        ])

        const result = await store.cleanupExpired(now)

        assert.strictEqual(result.removed, 1)
        assert.strictEqual(await store.hasDelivered('old', 'article', 'cv1'), false)
        assert.strictEqual(await store.hasDelivered('fresh', 'article', 'cv1'), true)
    })
})
