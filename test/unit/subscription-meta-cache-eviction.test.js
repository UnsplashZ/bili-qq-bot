'use strict'

const assert = require('assert')

const metaCache = require('../../src/services/subscriptionUserMetaCacheService')

describe('subscription meta cache eviction policy', function () {
    const originals = {
        records: metaCache.records,
        retentionMs: metaCache.recordRetentionMs,
        maxRecords: metaCache.maxRecords
    }

    afterEach(function () {
        metaCache.records = originals.records
        metaCache.recordRetentionMs = originals.retentionMs
        metaCache.maxRecords = originals.maxRecords
        metaCache.records.clear()
    })

    it('应清理超出保留时长的陈旧记录', function () {
        const now = Date.now()
        metaCache.records = new Map([
            ['old', {
                uid: 'old',
                name: 'old',
                face: '',
                officialVerify: null,
                lastComparedAt: now - 10_000,
                lastChangedAt: 0,
                nextRetryAt: 0,
                failCount: 0
            }],
            ['fresh', {
                uid: 'fresh',
                name: 'fresh',
                face: '',
                officialVerify: null,
                lastComparedAt: now - 100,
                lastChangedAt: 0,
                nextRetryAt: 0,
                failCount: 0
            }]
        ])
        metaCache.recordRetentionMs = 1_000

        metaCache._cleanupStaleRecords(now)
        assert.strictEqual(metaCache.records.has('old'), false)
        assert.strictEqual(metaCache.records.has('fresh'), true)
    })

    it('应在超过上限时裁剪为最近活跃记录', function () {
        const now = Date.now()
        metaCache.records = new Map([
            ['u1', { uid: 'u1', name: '1', face: '', officialVerify: null, lastComparedAt: now - 3000, lastChangedAt: 0, nextRetryAt: 0, failCount: 0 }],
            ['u2', { uid: 'u2', name: '2', face: '', officialVerify: null, lastComparedAt: now - 2000, lastChangedAt: 0, nextRetryAt: 0, failCount: 0 }],
            ['u3', { uid: 'u3', name: '3', face: '', officialVerify: null, lastComparedAt: now - 1000, lastChangedAt: 0, nextRetryAt: 0, failCount: 0 }]
        ])
        metaCache.recordRetentionMs = 100_000
        metaCache.maxRecords = 2

        metaCache._cleanupStaleRecords(now)
        assert.strictEqual(metaCache.records.size, 2)
        assert.strictEqual(metaCache.records.has('u1'), false)
        assert.strictEqual(metaCache.records.has('u2'), true)
        assert.strictEqual(metaCache.records.has('u3'), true)
    })
})
