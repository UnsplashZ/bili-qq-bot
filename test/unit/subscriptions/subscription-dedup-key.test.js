'use strict'

const assert = require('assert')

const { resolveDedupKey } = require('../../../src/services/subscription/updateChecker/helpers/dedupKey')

describe('subscription dedup key resolver', function () {
    it('视频应解析为 video:bvid', function () {
        const key = resolveDedupKey('video', {
            status: 'success',
            type: 'video',
            data: { bvid: 'BV1xx411c7mD' }
        })
        assert.strictEqual(key, 'video:BV1xx411c7mD')
    })

    it('专栏应解析为 article:cv{id}', function () {
        const key = resolveDedupKey('article', {
            status: 'success',
            type: 'article',
            data: { id: 123456 }
        })
        assert.strictEqual(key, 'article:cv123456')
    })

    it('动态应解析为 dynamic:id', function () {
        const key = resolveDedupKey('dynamic', {
            status: 'success',
            type: 'dynamic',
            data: { id_str: '9876543210' }
        })
        assert.strictEqual(key, 'dynamic:9876543210')
    })

    it('直播应解析为 live:id', function () {
        const key = resolveDedupKey('live', {
            status: 'success',
            type: 'live',
            id: '556677'
        })
        assert.strictEqual(key, 'live:556677')
    })

    it('番剧应解析为 bangumi:ep{id}', function () {
        const key = resolveDedupKey('bangumi', {
            status: 'success',
            type: 'bangumi',
            data: { new_ep: { id: 778899 } }
        })
        assert.strictEqual(key, 'bangumi:ep778899')
    })

    it('无法解析时应返回 null', function () {
        const key = resolveDedupKey('video', { status: 'success', type: 'video', data: {} })
        assert.strictEqual(key, null)
    })
})
