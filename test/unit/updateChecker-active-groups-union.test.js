'use strict'

const assert = require('assert')

const updateChecker = require('../../src/services/subscription/updateChecker')
const subscriptionManager = require('../../src/services/subscription/subscriptionManager')
const config = require('../../src/config')

const originals = {
    ensureSubscriptionsLoaded: subscriptionManager._ensureSubscriptionsLoaded,
    userSubs: subscriptionManager.userSubs,
    bangumiSubs: subscriptionManager.bangumiSubs,
    checkFeedUpdate: updateChecker.checkFeedUpdate,
    checkUserDynamic: updateChecker.checkUserDynamic,
    checkUserLive: updateChecker.checkUserLive,
    buildUserCheckList: updateChecker.buildUserCheckList,
    checkUserVideoUnified: updateChecker.checkUserVideoUnified,
    checkUserArticleUnified: updateChecker.checkUserArticleUnified,
    checkBangumi: updateChecker.checkBangumi,
    refreshMissingNames: updateChecker.refreshMissingNames
}

const originalGroupConfigs = JSON.parse(JSON.stringify(config.groupConfigs || {}))

function overwriteGroupConfigs(next) {
    const groupConfigs = config.groupConfigs || {}
    for (const key of Object.keys(groupConfigs)) {
        delete groupConfigs[key]
    }
    Object.assign(groupConfigs, next)
}

function restoreAll() {
    subscriptionManager._ensureSubscriptionsLoaded = originals.ensureSubscriptionsLoaded
    subscriptionManager.userSubs = originals.userSubs
    subscriptionManager.bangumiSubs = originals.bangumiSubs

    updateChecker.checkFeedUpdate = originals.checkFeedUpdate
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

describe('UpdateChecker active groups union', function () {
    beforeEach(function () {
        restoreAll()
    })

    after(function () {
        restoreAll()
    })

    it('groupConfigs 无记录时，仍应检查订阅群', async function () {
        overwriteGroupConfigs({})

        subscriptionManager._ensureSubscriptionsLoaded = async () => {}
        subscriptionManager.userSubs = [
            { uid: '123', name: 'tester', groupIds: ['1000'], lastDynamicId: '1', lastLiveStatus: 0 }
        ]
        subscriptionManager.bangumiSubs = []

        const dynamicCalls = []
        updateChecker.checkFeedUpdate = async () => {}
        updateChecker.checkUserDynamic = async (_sub, targetGroups) => {
            dynamicCalls.push([...(targetGroups || [])])
        }
        updateChecker.checkUserLive = async () => {}
        updateChecker.buildUserCheckList = () => []
        updateChecker.checkUserVideoUnified = async () => {}
        updateChecker.checkUserArticleUnified = async () => {}
        updateChecker.checkBangumi = async () => {}
        updateChecker.refreshMissingNames = async () => {}

        await withFastTimers(async () => {
            await updateChecker.checkAll()
        })

        assert.strictEqual(dynamicCalls.length, 1)
        assert.deepStrictEqual(dynamicCalls[0], ['1000'])
    })
})
