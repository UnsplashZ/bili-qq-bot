'use strict'

const assert = require('assert')

const { decideAdvance } = require('../../../src/services/subscription/updateChecker/helpers/stateAdvance')

describe('subscription state advance policy', function () {
    it('全失败时应重试且不推进', function () {
        const result = decideAdvance({
            successGroups: [],
            failedGroups: ['1000']
        })

        assert.strictEqual(result.action, 'retry')
        assert.strictEqual(result.reason, 'no_success')
    })

    it('存在成功群时应推进', function () {
        const result = decideAdvance({
            successGroups: ['1000'],
            failedGroups: ['2000']
        })

        assert.strictEqual(result.action, 'advance')
        assert.strictEqual(result.reason, 'has_covered_target')
    })

    it('只有关闭群静默消费时应推进', function () {
        const result = decideAdvance({
            successGroups: [],
            failedGroups: [],
            disabledSkippedGroups: ['1000']
        })

        assert.strictEqual(result.action, 'advance')
        assert.strictEqual(result.reason, 'has_covered_target')
    })

    it('只有普通 ledger skip 时不应推进', function () {
        const result = decideAdvance({
            successGroups: [],
            failedGroups: [],
            ledgerSkippedGroups: ['1000']
        })

        assert.strictEqual(result.action, 'skip')
        assert.strictEqual(result.reason, 'no_targets')
    })

    it('无目标群时应跳过推进', function () {
        const result = decideAdvance({
            successGroups: [],
            failedGroups: []
        })

        assert.strictEqual(result.action, 'skip')
        assert.strictEqual(result.reason, 'no_targets')
    })
})
