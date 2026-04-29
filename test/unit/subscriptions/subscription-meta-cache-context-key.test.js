'use strict'

const assert = require('assert')

const metaCache = require('../../../src/services/subscriptionUserMetaCacheService')

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

describe('subscription meta cache context key', function () {
    const originals = {
        ensureLoaded: metaCache.ensureLoaded,
        compareAndUpdate: metaCache._compareAndUpdate,
        inFlight: metaCache._inFlight,
        comparedInProcess: metaCache._comparedInProcess
    }

    afterEach(function () {
        metaCache.ensureLoaded = originals.ensureLoaded
        metaCache._compareAndUpdate = originals.compareAndUpdate
        metaCache._inFlight = originals.inFlight
        metaCache._comparedInProcess = originals.comparedInProcess
        metaCache._inFlight.clear()
        if (metaCache._comparedInProcess && typeof metaCache._comparedInProcess.clear === 'function') {
            metaCache._comparedInProcess.clear()
        }
    })

    it('同 uid 不同 groupId 并发时不应复用同一 in-flight promise', async function () {
        metaCache.ensureLoaded = async () => {}
        metaCache._inFlight = new Map()

        let compareCalls = 0
        metaCache._compareAndUpdate = async (_uid, groupId) => {
            compareCalls += 1
            await sleep(30)
            return { groupId }
        }

        const p1 = metaCache.enrichSubscription({ uid: '123' }, '1000')
        const p2 = metaCache.enrichSubscription({ uid: '123' }, '2000')

        const [r1, r2] = await Promise.all([p1, p2])
        assert.strictEqual(compareCalls, 2)
        assert.strictEqual(r1.groupId, '1000')
        assert.strictEqual(r2.groupId, '2000')
    })

    it('comparedInProcess 应支持过期清理', function () {
        const now = Date.now()
        metaCache._comparedInProcess = new Map([
            ['old', now - 7 * 60 * 60 * 1000],
            ['fresh', now - 1000]
        ])

        metaCache._cleanupComparedInProcess(now)
        assert.strictEqual(metaCache._comparedInProcess.has('old'), false)
        assert.strictEqual(metaCache._comparedInProcess.has('fresh'), true)
    })
})
