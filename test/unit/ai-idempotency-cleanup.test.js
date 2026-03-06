#!/usr/bin/env node
'use strict'

const assert = require('assert')
const aiIdempotency = require('../../src/services/ai/idempotency')

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

async function testPeriodicCleanupRemovesExpiredEntriesWithoutOverflow() {
    const original = {
        ttlMs: aiIdempotency.ttlMs,
        maxEntries: aiIdempotency.maxEntries,
        cleanupIntervalMs: aiIdempotency.cleanupIntervalMs,
        lastCleanupAt: aiIdempotency.lastCleanupAt
    }

    aiIdempotency.reset()
    aiIdempotency.ttlMs = 5
    aiIdempotency.maxEntries = 1000
    aiIdempotency.cleanupIntervalMs = 1
    aiIdempotency.lastCleanupAt = 0

    aiIdempotency.markIfNew('old-key')
    await sleep(10)
    aiIdempotency.markIfNew('new-key')

    assert.strictEqual(aiIdempotency.cache.has('old-key'), false, '应在正常请求路径清理过期键')
    assert.strictEqual(aiIdempotency.cache.has('new-key'), true)

    aiIdempotency.reset()
    aiIdempotency.ttlMs = original.ttlMs
    aiIdempotency.maxEntries = original.maxEntries
    aiIdempotency.cleanupIntervalMs = original.cleanupIntervalMs
    aiIdempotency.lastCleanupAt = original.lastCleanupAt

    console.log('✓ 幂等缓存会在非溢出场景定期清理过期数据')
}

testPeriodicCleanupRemovesExpiredEntriesWithoutOverflow()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
