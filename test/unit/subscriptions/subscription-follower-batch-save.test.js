'use strict'

const assert = require('assert')

const subscriptionManager = require('../../../src/services/subscription/subscriptionManager')

describe('subscription follower batch save', function () {
    const originals = {
        cookieFollowings: subscriptionManager.cookieFollowings,
        saveFollowers: subscriptionManager._saveFollowers
    }

    afterEach(function () {
        subscriptionManager.cookieFollowings = originals.cookieFollowings
        subscriptionManager._saveFollowers = originals.saveFollowers
    })

    it('高频 updateCookieFollowerState 应批量写盘而非每次写盘', async function () {
        subscriptionManager.cookieFollowings = {
            acc1: [{ uid: '1001', uname: 'tester' }]
        }

        let saveCalls = 0
        subscriptionManager._saveFollowers = async () => {
            saveCalls += 1
        }

        for (let i = 0; i < 100; i += 1) {
            await subscriptionManager.updateCookieFollowerState('acc1', '1001', {
                lastDynamicId: String(i)
            })
        }

        await subscriptionManager.flushPendingFollowerSaves()
        assert.ok(saveCalls < 100, `expected batched writes, got ${saveCalls}`)
    })
})
