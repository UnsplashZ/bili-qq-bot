'use strict'

const assert = require('assert')
const runtimeMetricsService = require('../../../src/services/runtimeMetricsService')

describe('runtimeMetricsService', () => {
    beforeEach(() => {
        runtimeMetricsService.reset()
    })

    it('records totals, success counts, latest text, and average duration', () => {
        runtimeMetricsService.record('linkParsing', {
            ok: true,
            durationMs: 12,
            latest: '解析 1 个'
        })
        runtimeMetricsService.record('linkParsing', {
            ok: true,
            durationMs: 18,
            latest: '解析 2 个'
        })

        const snapshot = runtimeMetricsService.snapshot()
        assert.strictEqual(snapshot.linkParsing.total, 2)
        assert.strictEqual(snapshot.linkParsing.success, 2)
        assert.strictEqual(snapshot.linkParsing.failed, 0)
        assert.strictEqual(snapshot.linkParsing.avgMs, 15)
        assert.strictEqual(snapshot.linkParsing.latest, '解析 2 个')
        assert.ok(snapshot.linkParsing.lastAt)
    })

    it('mirrors failed operations into retryFailure', () => {
        runtimeMetricsService.record('videoDownload', {
            ok: false,
            durationMs: 30,
            latest: 'download_failed'
        })

        const snapshot = runtimeMetricsService.snapshot()
        assert.strictEqual(snapshot.videoDownload.failed, 1)
        assert.strictEqual(snapshot.retryFailure.total, 1)
        assert.strictEqual(snapshot.retryFailure.failed, 1)
        assert.strictEqual(snapshot.retryFailure.latest, 'download_failed')
    })

    it('tracks async failures and rethrows them', async () => {
        await assert.rejects(
            runtimeMetricsService.track('previewGeneration', async () => {
                throw new Error('render_failed')
            }),
            /render_failed/
        )

        const snapshot = runtimeMetricsService.snapshot()
        assert.strictEqual(snapshot.previewGeneration.total, 1)
        assert.strictEqual(snapshot.previewGeneration.failed, 1)
        assert.strictEqual(snapshot.retryFailure.total, 1)
    })
})
