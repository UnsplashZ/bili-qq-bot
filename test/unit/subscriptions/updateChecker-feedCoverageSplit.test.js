'use strict'

const assert = require('assert')

const updateChecker = require('../../../src/services/subscription/updateChecker')
const subscriptionManager = require('../../../src/services/subscription/subscriptionManager')
const config = require('../../../src/config')

const originals = {
    ensureSubscriptionsLoaded: subscriptionManager._ensureSubscriptionsLoaded,
    userSubs: subscriptionManager.userSubs,
    bangumiSubs: subscriptionManager.bangumiSubs,
    cookieFollowings: subscriptionManager.cookieFollowings,
    groupToAccountMap: subscriptionManager.groupToAccountMap,
    checkFeedUpdate: updateChecker.checkFeedUpdate,
    processDynamicFeed: updateChecker.processDynamicFeed,
    processLiveFeed: updateChecker.processLiveFeed,
    findTargetGroupsForUser: updateChecker.findTargetGroupsForUser,
    checkUserDynamic: updateChecker.checkUserDynamic,
    checkUserLive: updateChecker.checkUserLive,
    buildUserCheckList: updateChecker.buildUserCheckList,
    checkUserVideoUnified: updateChecker.checkUserVideoUnified,
    checkUserArticleUnified: updateChecker.checkUserArticleUnified,
    checkBangumi: updateChecker.checkBangumi,
    refreshMissingNames: updateChecker.refreshMissingNames,
}

const originalGroupConfigs = JSON.parse(JSON.stringify(config.groupConfigs || {}))

function overwriteGroupConfigs(next) {
    const groupConfigs = config.__getMutableCompatStateForTests().groupConfigs || {}
    for (const key of Object.keys(groupConfigs)) {
        delete groupConfigs[key]
    }
    Object.assign(groupConfigs, next)
}

function restoreAll() {
    subscriptionManager._ensureSubscriptionsLoaded = originals.ensureSubscriptionsLoaded
    subscriptionManager.userSubs = originals.userSubs
    subscriptionManager.bangumiSubs = originals.bangumiSubs
    subscriptionManager.cookieFollowings = originals.cookieFollowings
    subscriptionManager.groupToAccountMap = originals.groupToAccountMap

    updateChecker.checkFeedUpdate = originals.checkFeedUpdate
    updateChecker.processDynamicFeed = originals.processDynamicFeed
    updateChecker.processLiveFeed = originals.processLiveFeed
    updateChecker.findTargetGroupsForUser = originals.findTargetGroupsForUser
    updateChecker.checkUserDynamic = originals.checkUserDynamic
    updateChecker.checkUserLive = originals.checkUserLive
    updateChecker.buildUserCheckList = originals.buildUserCheckList
    updateChecker.checkUserVideoUnified = originals.checkUserVideoUnified
    updateChecker.checkUserArticleUnified = originals.checkUserArticleUnified
    updateChecker.checkBangumi = originals.checkBangumi
    updateChecker.refreshMissingNames = originals.refreshMissingNames

    overwriteGroupConfigs(originalGroupConfigs)
}

async function withFastTimers(fn) {
    const originalSetTimeout = global.setTimeout
    global.setTimeout = (cb, _ms, ...args) => {
        cb(...args)
        return 0
    }
    try {
        await fn()
    } finally {
        global.setTimeout = originalSetTimeout
    }
}

describe('UpdateChecker feed coverage split', function () {
    beforeEach(function () {
        restoreAll()
    })

    after(function () {
        restoreAll()
    })

    it('提交 dynamic 覆盖：dynamic 成功且 live 失败', async function () {
        overwriteGroupConfigs({
            '1000': {
                isInGroup: true,
                enableCookieSync: true,
            },
        })

        subscriptionManager.groupToAccountMap = {
            '1000': 'acc1',
        }
        subscriptionManager.cookieFollowings = {
            acc1: [{ mid: 'u1' }],
        }

        updateChecker.findTargetGroupsForUser = () => ['1000']
        updateChecker.processDynamicFeed = async () => ({ ok: true })
        updateChecker.processLiveFeed = async () => {
            throw new Error('live failed')
        }

        const coverage = { dynamicUids: new Set(), liveUids: new Set() }

        await withFastTimers(async () => {
            await originals.checkFeedUpdate.call(updateChecker, coverage, new Set(['1000']))
        })

        assert.strictEqual(coverage.dynamicUids.has('u1'), true)
        assert.strictEqual(coverage.liveUids.has('u1'), false)
    })

    it('提交 live 覆盖：dynamic 失败且 live 成功', async function () {
        overwriteGroupConfigs({
            '1000': {
                isInGroup: true,
                enableCookieSync: true,
            },
        })

        subscriptionManager.groupToAccountMap = {
            '1000': 'acc1',
        }
        subscriptionManager.cookieFollowings = {
            acc1: [{ mid: 'u1' }],
        }

        updateChecker.findTargetGroupsForUser = () => ['1000']
        updateChecker.processDynamicFeed = async () => {
            throw new Error('dynamic failed')
        }
        updateChecker.processLiveFeed = async () => ({ ok: true, coveredUids: ['u1'] })

        const coverage = { dynamicUids: new Set(), liveUids: new Set() }

        await withFastTimers(async () => {
            await originals.checkFeedUpdate.call(updateChecker, coverage, new Set(['1000']))
        })

        assert.strictEqual(coverage.dynamicUids.has('u1'), false)
        assert.strictEqual(coverage.liveUids.has('u1'), true)
    })

    it('不提交 dynamic 覆盖：dynamic 返回 ok=false 且不抛错', async function () {
        overwriteGroupConfigs({
            '1000': {
                isInGroup: true,
                enableCookieSync: true,
            },
        })

        subscriptionManager.groupToAccountMap = {
            '1000': 'acc1',
        }
        subscriptionManager.cookieFollowings = {
            acc1: [{ mid: 'u1' }],
        }

        updateChecker.findTargetGroupsForUser = () => ['1000']
        updateChecker.processDynamicFeed = async () => ({ ok: false, reason: 'dynamic_feed_fetch_failed' })
        updateChecker.processLiveFeed = async () => ({ ok: true, coveredUids: ['u1'] })

        const coverage = { dynamicUids: new Set(), liveUids: new Set() }

        await withFastTimers(async () => {
            await originals.checkFeedUpdate.call(updateChecker, coverage, new Set(['1000']))
        })

        assert.strictEqual(coverage.dynamicUids.has('u1'), false)
        assert.strictEqual(coverage.liveUids.has('u1'), true)
    })

    it('不提交 live 覆盖：live 返回 ok=false 且不抛错', async function () {
        overwriteGroupConfigs({
            '1000': {
                isInGroup: true,
                enableCookieSync: true,
            },
        })

        subscriptionManager.groupToAccountMap = {
            '1000': 'acc1',
        }
        subscriptionManager.cookieFollowings = {
            acc1: [{ mid: 'u1' }],
        }

        updateChecker.findTargetGroupsForUser = () => ['1000']
        updateChecker.processDynamicFeed = async () => ({ ok: true })
        updateChecker.processLiveFeed = async () => ({ ok: false, reason: 'live_feed_fetch_failed' })

        const coverage = { dynamicUids: new Set(), liveUids: new Set() }

        await withFastTimers(async () => {
            await originals.checkFeedUpdate.call(updateChecker, coverage, new Set(['1000']))
        })

        assert.strictEqual(coverage.dynamicUids.has('u1'), true)
        assert.strictEqual(coverage.liveUids.has('u1'), false)
    })

    it('不提交 live 覆盖：live 成功但未声明实际覆盖 UID', async function () {
        overwriteGroupConfigs({
            '1000': {
                isInGroup: true,
                enableCookieSync: true,
            },
        })

        subscriptionManager.groupToAccountMap = {
            '1000': 'acc1',
        }
        subscriptionManager.cookieFollowings = {
            acc1: [{ mid: 'u1' }],
        }

        updateChecker.findTargetGroupsForUser = () => ['1000']
        updateChecker.processDynamicFeed = async () => ({ ok: true })
        updateChecker.processLiveFeed = async () => ({ ok: true })

        const coverage = { dynamicUids: new Set(), liveUids: new Set() }

        await withFastTimers(async () => {
            await originals.checkFeedUpdate.call(updateChecker, coverage, new Set(['1000']))
        })

        assert.strictEqual(coverage.dynamicUids.has('u1'), true)
        assert.strictEqual(coverage.liveUids.has('u1'), false)
    })

    async function runCheckAllCase({
        userSubs,
        dynamicCovered,
        liveCovered,
        expectedDynamicCalled,
        expectedLiveCalled,
    }) {
        overwriteGroupConfigs({
            '1000': {
                isInGroup: true,
            },
        })

        subscriptionManager._ensureSubscriptionsLoaded = async () => {}
        subscriptionManager.userSubs = userSubs.map(sub => ({ ...sub }))
        subscriptionManager.bangumiSubs = []

        const dynamicCalled = []
        const liveCalled = []

        updateChecker.checkFeedUpdate = async (coverage) => {
            for (const uid of dynamicCovered) coverage.dynamicUids.add(String(uid))
            for (const uid of liveCovered) coverage.liveUids.add(String(uid))
        }

        updateChecker.checkUserDynamic = async (sub) => {
            dynamicCalled.push(String(sub.uid))
        }

        updateChecker.checkUserLive = async (sub) => {
            liveCalled.push(String(sub.uid))
        }

        updateChecker.buildUserCheckList = () => []
        updateChecker.checkUserVideoUnified = async () => {}
        updateChecker.checkUserArticleUnified = async () => {}
        updateChecker.checkBangumi = async () => {}
        updateChecker.refreshMissingNames = async () => {}

        await withFastTimers(async () => {
            await updateChecker.checkAll()
        })

        assert.deepStrictEqual(dynamicCalled, expectedDynamicCalled)
        assert.deepStrictEqual(liveCalled, expectedLiveCalled)
    }

    it('checkAll: dynamic 覆盖时仅跳过 dynamic fallback', async function () {
        await runCheckAllCase({
            userSubs: [{ uid: 'u1', name: 'U1', groupIds: ['1000'] }],
            dynamicCovered: ['u1'],
            liveCovered: [],
            expectedDynamicCalled: [],
            expectedLiveCalled: ['u1'],
        })
    })

    it('checkAll: live 覆盖时仅跳过 live fallback', async function () {
        await runCheckAllCase({
            userSubs: [{ uid: 'u1', name: 'U1', groupIds: ['1000'] }],
            dynamicCovered: [],
            liveCovered: ['u1'],
            expectedDynamicCalled: ['u1'],
            expectedLiveCalled: [],
        })
    })

    it('checkAll: 多 UID 混合覆盖', async function () {
        await runCheckAllCase({
            userSubs: [
                { uid: 'u1', name: 'U1', groupIds: ['1000'] },
                { uid: 'u2', name: 'U2', groupIds: ['1000'] },
            ],
            dynamicCovered: ['u1'],
            liveCovered: ['u2'],
            expectedDynamicCalled: ['u2'],
            expectedLiveCalled: ['u1'],
        })
    })
})
