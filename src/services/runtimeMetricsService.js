'use strict'

const METRIC_KEYS = [
    'linkParsing',
    'previewGeneration',
    'subscriptionPush',
    'videoDownload',
    'aiReply',
    'toolCall',
    'retryFailure'
]

function createMetric() {
    return {
        total: 0,
        success: 0,
        failed: 0,
        latest: '-',
        lastAt: null,
        avgMs: 0,
        _durationTotal: 0
    }
}

class RuntimeMetricsService {
    constructor() {
        this.reset()
    }

    reset() {
        this.metrics = METRIC_KEYS.reduce((result, key) => {
            result[key] = createMetric()
            return result
        }, {})
    }

    ensureMetric(key) {
        if (!this.metrics[key]) {
            this.metrics[key] = createMetric()
        }
        return this.metrics[key]
    }

    record(key, { ok = true, durationMs = 0, latest = '' } = {}) {
        const metric = this.ensureMetric(key)
        const safeDuration = Number(durationMs)
        const countedDuration = Number.isFinite(safeDuration) && safeDuration >= 0 ? safeDuration : 0

        metric.total += 1
        if (ok) {
            metric.success += 1
        } else {
            metric.failed += 1
        }
        metric.latest = latest || (ok ? '成功' : '失败')
        metric.lastAt = new Date().toISOString()
        metric._durationTotal += countedDuration
        metric.avgMs = metric.total > 0 ? Math.round(metric._durationTotal / metric.total) : 0

        if (!ok && key !== 'retryFailure') {
            this.record('retryFailure', {
                ok: false,
                durationMs: countedDuration,
                latest: latest || key
            })
        }

        return this.snapshotMetric(metric)
    }

    async track(key, fn, { latest = '' } = {}) {
        const startedAt = Date.now()
        try {
            const result = await fn()
            const ok = !(
                result === false
                || result?.ok === false
                || result?.status === 'failed'
                || result?.status === 'error'
            )
            this.record(key, {
                ok,
                durationMs: Date.now() - startedAt,
                latest: latest || result?.reason || result?.status || ''
            })
            return result
        } catch (error) {
            this.record(key, {
                ok: false,
                durationMs: Date.now() - startedAt,
                latest: error?.message || 'exception'
            })
            throw error
        }
    }

    snapshotMetric(metric) {
        return {
            total: metric.total,
            success: metric.success,
            failed: metric.failed,
            latest: metric.latest,
            lastAt: metric.lastAt,
            avgMs: metric.avgMs
        }
    }

    snapshot() {
        return METRIC_KEYS.reduce((result, key) => {
            result[key] = this.snapshotMetric(this.ensureMetric(key))
            return result
        }, {})
    }
}

module.exports = new RuntimeMetricsService()
module.exports.METRIC_KEYS = METRIC_KEYS
