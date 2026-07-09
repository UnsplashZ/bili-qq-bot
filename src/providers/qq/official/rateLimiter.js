const { redactString } = require('../../../utils/redactSensitive')

class QpmRateLimiter {
    constructor(options = {}) {
        this.accountLimit = Math.max(1, Number(options.accountLimit || 30))
        this.groupLimit = Math.max(1, Number(options.groupLimit || 20))
        this.windowMs = Math.max(1000, Number(options.windowMs || 60000))
        this.maxQueueSize = Math.max(1, Number(options.maxQueueSize || 300))
        this.now = options.now || Date.now
        this.setTimer = options.setTimer || setTimeout
        this.clearTimer = options.clearTimer || clearTimeout
        this.accountHits = []
        this.groupHits = new Map()
        this.accountBlockedUntil = 0
        this.groupBlockedUntil = new Map()
        this.queue = []
        this.timer = null
        this.stopped = false
        this.maxRetries = Math.max(0, Number(options.maxRetries ?? 1))
        this.maxFailureRecords = Math.max(1, Number(options.maxFailureRecords || 20))
        this.failures = []
        this.lastRetryAfterMs = 0
        this.lastFailureAt = 0
    }

    prune(bucket, now = this.now()) {
        while (bucket.length > 0 && now - bucket[0] >= this.windowMs) {
            bucket.shift()
        }
    }

    getGroupBucket(groupId) {
        const key = String(groupId || '')
        if (!this.groupHits.has(key)) this.groupHits.set(key, [])
        return this.groupHits.get(key)
    }

    getWaitMs(groupId, now = this.now()) {
        this.prune(this.accountHits, now)
        const groupBucket = groupId ? this.getGroupBucket(groupId) : null
        if (groupBucket) this.prune(groupBucket, now)

        const waits = []
        if (this.accountBlockedUntil > now) {
            waits.push(this.accountBlockedUntil - now)
        }
        if (groupId) {
            const groupBlockedUntil = this.groupBlockedUntil.get(String(groupId || '')) || 0
            if (groupBlockedUntil > now) {
                waits.push(groupBlockedUntil - now)
            }
        }
        if (this.accountHits.length >= this.accountLimit) {
            waits.push(this.windowMs - (now - this.accountHits[0]))
        }
        if (groupBucket && groupBucket.length >= this.groupLimit) {
            waits.push(this.windowMs - (now - groupBucket[0]))
        }
        return waits.length > 0 ? Math.max(1, ...waits) : 0
    }

    mark(groupId, now = this.now()) {
        this.accountHits.push(now)
        if (groupId) {
            this.getGroupBucket(groupId).push(now)
        }
    }

    async schedule(task, options = {}) {
        if (this.stopped) throw new Error('rate_limiter_stopped')
        if (typeof task !== 'function') throw new Error('rate_limiter_task_required')
        if (this.queue.length >= this.maxQueueSize) throw new Error('rate_limiter_queue_full')

        return new Promise((resolve, reject) => {
            this.queue.push({
                task,
                groupId: options.groupId || '',
                attempts: 0,
                maxRetries: Math.max(0, Number(options.maxRetries ?? this.maxRetries)),
                resolve,
                reject
            })
            this.process()
        })
    }

    applyRetryAfter(retryAfterMs, groupId = '') {
        const delay = Math.max(0, Number(retryAfterMs) || 0)
        if (delay <= 0) return
        this.lastRetryAfterMs = delay
        const now = this.now()
        const blockedUntil = now + delay
        this.accountBlockedUntil = Math.max(this.accountBlockedUntil, blockedUntil)
        if (groupId) {
            const key = String(groupId || '')
            this.groupBlockedUntil.set(key, Math.max(this.groupBlockedUntil.get(key) || 0, blockedUntil))
        }
    }

    shouldRetry(item, error) {
        if (!item || item.attempts >= item.maxRetries) return false
        if (error?.retryAfterMs > 0) return true
        return Boolean(error?.retryable)
    }

    recordFailure(error, item = {}) {
        this.lastFailureAt = this.now()
        this.failures.push({
            at: this.lastFailureAt,
            groupId: item.groupId || '',
            attempt: item.attempts || 0,
            message: redactString(String(error?.message || error || '')).slice(0, 200),
            category: error?.category || '',
            httpStatus: error?.httpStatus || 0,
            qqCode: error?.qqCode ?? null,
            retryable: Boolean(error?.retryable || error?.retryAfterMs > 0),
            retryAfterMs: Math.max(0, Number(error?.retryAfterMs || 0))
        })
        while (this.failures.length > this.maxFailureRecords) {
            this.failures.shift()
        }
    }

    process() {
        if (this.stopped || this.timer || this.queue.length === 0) return

        const next = this.queue[0]
        const waitMs = this.getWaitMs(next.groupId)
        if (waitMs > 0) {
            this.timer = this.setTimer(() => {
                this.timer = null
                this.process()
            }, waitMs)
            if (typeof this.timer?.unref === 'function') this.timer.unref()
            return
        }

        this.queue.shift()
        this.mark(next.groupId)
        Promise.resolve()
            .then(() => next.task())
            .then(next.resolve, (error) => {
                this.recordFailure(error, next)
                if (error?.retryAfterMs > 0) {
                    this.applyRetryAfter(error.retryAfterMs, next.groupId)
                }
                if (this.shouldRetry(next, error)) {
                    next.attempts += 1
                    this.queue.unshift(next)
                    return
                }
                next.reject(error)
            })
            .finally(() => this.process())
    }

    stop() {
        this.stopped = true
        if (this.timer) {
            this.clearTimer(this.timer)
            this.timer = null
        }
        for (const item of this.queue.splice(0)) {
            item.reject(new Error('rate_limiter_stopped'))
        }
    }

    getStatus() {
        return {
            accountLimit: this.accountLimit,
            groupLimit: this.groupLimit,
            windowMs: this.windowMs,
            queueSize: this.queue.length,
            stopped: this.stopped,
            maxRetries: this.maxRetries,
            lastRetryAfterMs: this.lastRetryAfterMs,
            lastFailureAt: this.lastFailureAt,
            accountBlockedUntil: this.accountBlockedUntil,
            recentFailures: this.failures.slice(-10)
        }
    }
}

module.exports = QpmRateLimiter
