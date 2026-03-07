'use strict'

const assert = require('assert')

const subscriptionService = require('../../src/services/subscriptionService')
const subscriptionManager = require('../../src/services/subscription/subscriptionManager')

describe('subscriptionService cookieFollowings setter compatibility', function () {
    const originals = {
        cookieFollowings: subscriptionManager.cookieFollowings,
        replaceCookieFollowingsMap: subscriptionManager.replaceCookieFollowingsMap
    }

    afterEach(function () {
        subscriptionManager.cookieFollowings = originals.cookieFollowings
        subscriptionManager.replaceCookieFollowingsMap = originals.replaceCookieFollowingsMap
    })

    it('直接赋值 cookieFollowings 对象时应兼容为整体替换', function () {
        const nextFollowings = {
            acc1: [{ uid: '123', name: 'tester' }]
        }
        let called = 0
        subscriptionManager.replaceCookieFollowingsMap = async (input) => {
            called += 1
            subscriptionManager.cookieFollowings = input
        }

        subscriptionService.cookieFollowings = nextFollowings
        assert.strictEqual(called, 1)
        assert.deepStrictEqual(subscriptionManager.cookieFollowings, nextFollowings)
    })
})
