import assert from 'node:assert/strict'
import { describe, it } from 'mocha'

import {
    DEFAULT_LOG_LIMIT,
    MAX_LOG_LIMIT,
    MIN_LOG_LIMIT,
    appendWithLimit,
    buildLogFilterKey,
    normalizeLogLimit,
} from '../../../dashboard/src/pages/logs/logLimits.js'

describe('dashboard logs limit helpers', function () {
    it('normalizes invalid and out-of-range limits', function () {
        assert.equal(normalizeLogLimit(undefined), DEFAULT_LOG_LIMIT)
        assert.equal(normalizeLogLimit('abc'), DEFAULT_LOG_LIMIT)
        assert.equal(normalizeLogLimit(10), MIN_LOG_LIMIT)
        assert.equal(normalizeLogLimit('500'), 500)
        assert.equal(normalizeLogLimit(9999), MAX_LOG_LIMIT)
    })

    it('appends entries while keeping only the newest records inside the limit', function () {
        const previous = Array.from({ length: 99 }, (_, index) => ({ id: index + 1 }))
        const result = appendWithLimit(
            previous,
            [{ id: 100 }, { id: 101 }],
            100
        )

        assert.equal(result.length, 100)
        assert.equal(result[0].id, 2)
        assert.equal(result[99].id, 101)
    })

    it('treats single pending entries and invalid previous values defensively', function () {
        const result = appendWithLimit(null, { id: 'pending' }, 100)
        assert.deepEqual(result, [{ id: 'pending' }])
    })

    it('builds a stable key for pending queue isolation', function () {
        const baseKey = buildLogFilterKey({
            level: 'INFO',
            channels: ['DASH', 'BOT'],
            keyword: '  reconnect  ',
            limit: '300',
        })

        assert.equal(
            baseKey,
            buildLogFilterKey({
                level: 'info',
                channels: ['BOT', 'DASH'],
                keyword: 'reconnect',
                limit: 300,
            })
        )

        assert.notEqual(
            baseKey,
            buildLogFilterKey({
                level: 'info',
                channels: ['BOT', 'DASH'],
                keyword: 'reconnect',
                limit: 500,
            })
        )
    })
})
