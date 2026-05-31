'use strict'

const assert = require('assert')

const subscriptionService = require('../../../src/services/subscriptionService')
const subscriptionManager = require('../../../src/services/subscription/subscriptionManager')
const updateChecker = require('../../../src/services/subscription/updateChecker')

describe('subscription check now dedup bypass', function () {
    const originals = {
        ensureSubscriptionsLoaded: subscriptionManager._ensureSubscriptionsLoaded,
        userSubs: subscriptionManager.userSubs,
        createGroupSourceMap: updateChecker.createGroupSourceMap,
        checkUserDynamic: updateChecker.checkUserDynamic,
        checkUserLive: updateChecker.checkUserLive,
        checkUserVideoUnified: updateChecker.checkUserVideoUnified,
        checkUserArticleUnified: updateChecker.checkUserArticleUnified
    }

    afterEach(function () {
        subscriptionManager._ensureSubscriptionsLoaded = originals.ensureSubscriptionsLoaded
        subscriptionManager.userSubs = originals.userSubs
        updateChecker.createGroupSourceMap = originals.createGroupSourceMap
        updateChecker.checkUserDynamic = originals.checkUserDynamic
        updateChecker.checkUserLive = originals.checkUserLive
        updateChecker.checkUserVideoUnified = originals.checkUserVideoUnified
        updateChecker.checkUserArticleUnified = originals.checkUserArticleUnified
    })

    it('checkSubscriptionNow 应向四条查询链路传递 disableDedup', async function () {
        const calls = {
            dynamic: null,
            live: null,
            video: null,
            article: null
        }

        subscriptionManager._ensureSubscriptionsLoaded = async () => {}
        subscriptionManager.userSubs = [{
            uid: '123',
            name: 'tester',
            groupIds: ['1000']
        }]

        updateChecker.createGroupSourceMap = (groupIds, sources) => {
            return new Map([[String(groupIds[0]), new Set(sources)]])
        }
        updateChecker.checkUserDynamic = async (...args) => {
            calls.dynamic = args
        }
        updateChecker.checkUserLive = async (...args) => {
            calls.live = args
        }
        updateChecker.checkUserVideoUnified = async (...args) => {
            calls.video = args
        }
        updateChecker.checkUserArticleUnified = async (...args) => {
            calls.article = args
        }

        const result = await subscriptionService.checkSubscriptionNow('123', '1000')
        assert.strictEqual(result, true)

        assert.ok(calls.dynamic)
        assert.ok(calls.live)
        assert.ok(calls.video)
        assert.ok(calls.article)

        assert.strictEqual(calls.dynamic[2], true)
        assert.strictEqual(calls.dynamic[3].disableDedup, true)

        assert.strictEqual(calls.live[2], true)
        assert.strictEqual(calls.live[3].persistState, false)
        assert.strictEqual(calls.live[3].disableDedup, true)

        assert.strictEqual(calls.video[1], true)
        assert.strictEqual(calls.video[2].persistState, false)
        assert.strictEqual(calls.video[2].disableDedup, true)

        assert.strictEqual(calls.article[1], true)
        assert.strictEqual(calls.article[2].persistState, false)
        assert.strictEqual(calls.article[2].disableDedup, true)
    })
})
