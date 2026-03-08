'use strict'

const assert = require('assert')

const updateChecker = require('../../src/services/subscription/updateChecker')
const subscriptionManager = require('../../src/services/subscription/subscriptionManager')

const originals = {
    userSubs: subscriptionManager.userSubs,
    cookieFollowings: subscriptionManager.cookieFollowings,
    findTargetGroupSourceMapForUser: updateChecker.findTargetGroupSourceMapForUser,
}

function restoreAll() {
    subscriptionManager.userSubs = originals.userSubs
    subscriptionManager.cookieFollowings = originals.cookieFollowings
    updateChecker.findTargetGroupSourceMapForUser = originals.findTargetGroupSourceMapForUser
}

describe('UpdateChecker buildUserCheckList UID merge', function () {
    beforeEach(function () {
        restoreAll()
    })

    after(function () {
        restoreAll()
    })

    it('手动订阅 UID(数字) 与 Cookie UID(字符串) 应合并为同一用户', function () {
        subscriptionManager.userSubs = [
            {
                uid: 12345,
                name: 'ManualUser',
                groupIds: ['1000']
            }
        ]

        subscriptionManager.cookieFollowings = {
            acc1: [
                {
                    mid: '12345',
                    name: 'CookieUser'
                }
            ]
        }

        updateChecker.findTargetGroupSourceMapForUser = () => {
            const map = new Map()
            map.set('1000', new Set(['cookieSync']))
            return map
        }

        const users = updateChecker.buildUserCheckList(new Set(['1000']))
        assert.strictEqual(users.length, 1)

        const merged = users[0]
        assert.strictEqual(merged.uid, '12345')
        assert.strictEqual(merged.source, 'both')

        const groupSources = merged.targetGroupSourceMap.get('1000')
        assert.ok(groupSources instanceof Set)
        assert.deepStrictEqual(Array.from(groupSources).sort(), ['cookieSync', 'manual'])
    })
})
