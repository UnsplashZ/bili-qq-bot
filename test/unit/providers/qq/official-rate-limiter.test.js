#!/usr/bin/env node
'use strict'

const assert = require('assert')

const QpmRateLimiter = require('../../../../src/providers/qq/official/rateLimiter')

describe('QpmRateLimiter', () => {
    it('queues by account and group limits and releases on timer', async () => {
        let now = 0
        const timers = []
        const limiter = new QpmRateLimiter({
            accountLimit: 1,
            groupLimit: 1,
            windowMs: 1000,
            now: () => now,
            setTimer: (fn, delay) => {
                timers.push({ fn, delay })
                return { id: timers.length }
            },
            clearTimer: () => {}
        })
        const order = []
        const first = limiter.schedule(async () => {
            order.push('first')
        }, { groupId: 'g' })
        const second = limiter.schedule(async () => {
            order.push('second')
        }, { groupId: 'g' })

        await first
        assert.deepEqual(order, ['first'])
        assert.equal(timers.length, 1)
        assert.ok(timers[0].delay > 0)

        now = 1000
        timers[0].fn()
        await second
        assert.deepEqual(order, ['first', 'second'])
    })

    it('records failures and retries retryable tasks once', async () => {
        const limiter = new QpmRateLimiter({
            accountLimit: 100,
            groupLimit: 100,
            maxRetries: 1
        })
        let attempts = 0

        const result = await limiter.schedule(async () => {
            attempts += 1
            if (attempts === 1) {
                const error = new Error('rate limited')
                error.retryable = true
                error.retryAfterMs = 25
                error.httpStatus = 429
                error.category = 'rate_limited'
                throw error
            }
            return 'ok'
        }, { groupId: 'g' })

        assert.equal(result, 'ok')
        assert.equal(attempts, 2)
        const status = limiter.getStatus()
        assert.equal(status.lastRetryAfterMs, 25)
        assert.equal(status.recentFailures.length, 1)
        assert.equal(status.recentFailures[0].httpStatus, 429)
        limiter.stop()
    })

    it('redacts sensitive values in recorded failure messages', async () => {
        const limiter = new QpmRateLimiter({
            accountLimit: 100,
            groupLimit: 100,
            maxRetries: 0
        })

        await assert.rejects(
            limiter.schedule(async () => {
                throw new Error('request failed authorization=QQBot secret-token-value client_secret=very-secret')
            }, { groupId: 'g' })
        )

        const status = limiter.getStatus()
        assert.equal(status.recentFailures.length, 1)
        assert.match(status.recentFailures[0].message, /\[REDACTED\]/)
        assert.doesNotMatch(status.recentFailures[0].message, /secret-token-value|very-secret/)
        limiter.stop()
    })

    it('honors retry-after as a real queue blocker before retrying', async () => {
        let now = 0
        const timers = []
        const limiter = new QpmRateLimiter({
            accountLimit: 100,
            groupLimit: 100,
            maxRetries: 1,
            now: () => now,
            setTimer: (fn, delay) => {
                timers.push({ fn, delay })
                return { id: timers.length }
            },
            clearTimer: () => {}
        })
        let attempts = 0
        const scheduled = limiter.schedule(async () => {
            attempts += 1
            if (attempts === 1) {
                const error = new Error('rate limited')
                error.retryable = true
                error.retryAfterMs = 500
                error.httpStatus = 429
                throw error
            }
            return 'ok'
        }, { groupId: 'g' })

        await new Promise(resolve => setImmediate(resolve))
        assert.equal(attempts, 1)
        assert.equal(timers.length, 1)
        assert.equal(timers[0].delay, 500)

        now = 499
        timers[0].fn()
        await new Promise(resolve => setImmediate(resolve))
        assert.equal(attempts, 1)
        assert.equal(timers.length, 2)
        assert.equal(timers[1].delay, 1)

        now = 500
        timers[1].fn()
        assert.equal(await scheduled, 'ok')
        assert.equal(attempts, 2)
        limiter.stop()
    })
})
