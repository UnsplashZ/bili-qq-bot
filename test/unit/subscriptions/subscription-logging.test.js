#!/usr/bin/env node
'use strict'

const assert = require('assert')

const logger = require('../../../src/utils/logger')
const config = require('../../../src/config')
const updateChecker = require('../../../src/services/subscription/updateChecker')
const subscriptionManager = require('../../../src/services/subscription/subscriptionManager')
const subscriptionStateStore = require('../../../src/services/subscription/subscriptionStateStore')
const subscriptionDeliveryStore = require('../../../src/services/subscription/subscriptionDeliveryStore')

const originals = {
    groupConfigs: config.groupConfigs,
    ensureSubscriptionsLoaded: subscriptionManager._ensureSubscriptionsLoaded,
    flushPendingFollowerSaves: subscriptionManager.flushPendingFollowerSaves,
    ensureFollowersLoaded: subscriptionManager._ensureFollowersLoaded,
    userSubs: subscriptionManager.userSubs,
    bangumiSubs: subscriptionManager.bangumiSubs,
    groupToAccountMap: subscriptionManager.groupToAccountMap,
    stateEnsureLoaded: subscriptionStateStore.ensureLoaded,
    stateInitializeFromLegacy: subscriptionStateStore.initializeFromLegacy,
    deliveryEnsureLoaded: subscriptionDeliveryStore.ensureLoaded,
    deliveryCleanupExpired: subscriptionDeliveryStore.cleanupExpired,
    checkFeedUpdate: updateChecker.checkFeedUpdate,
    buildUserCheckList: updateChecker.buildUserCheckList,
    checkUserDynamic: updateChecker.checkUserDynamic,
    checkUserVideoUnified: updateChecker.checkUserVideoUnified,
    checkUserArticleUnified: updateChecker.checkUserArticleUnified,
    checkUserLive: updateChecker.checkUserLive,
    checkBangumi: updateChecker.checkBangumi,
    refreshMissingNames: updateChecker.refreshMissingNames,
    setTimeout: global.setTimeout,
    setInterval: global.setInterval,
    clearInterval: global.clearInterval
}

function restore() {
    config.groupConfigs = originals.groupConfigs
    subscriptionManager._ensureSubscriptionsLoaded = originals.ensureSubscriptionsLoaded
    subscriptionManager.flushPendingFollowerSaves = originals.flushPendingFollowerSaves
    subscriptionManager._ensureFollowersLoaded = originals.ensureFollowersLoaded
    subscriptionManager.userSubs = originals.userSubs
    subscriptionManager.bangumiSubs = originals.bangumiSubs
    subscriptionManager.groupToAccountMap = originals.groupToAccountMap
    subscriptionStateStore.ensureLoaded = originals.stateEnsureLoaded
    subscriptionStateStore.initializeFromLegacy = originals.stateInitializeFromLegacy
    subscriptionDeliveryStore.ensureLoaded = originals.deliveryEnsureLoaded
    subscriptionDeliveryStore.cleanupExpired = originals.deliveryCleanupExpired
    updateChecker.checkFeedUpdate = originals.checkFeedUpdate
    updateChecker.buildUserCheckList = originals.buildUserCheckList
    updateChecker.checkUserDynamic = originals.checkUserDynamic
    updateChecker.checkUserVideoUnified = originals.checkUserVideoUnified
    updateChecker.checkUserArticleUnified = originals.checkUserArticleUnified
    updateChecker.checkUserLive = originals.checkUserLive
    updateChecker.checkBangumi = originals.checkBangumi
    updateChecker.refreshMissingNames = originals.refreshMissingNames
    global.setTimeout = originals.setTimeout
    global.setInterval = originals.setInterval
    global.clearInterval = originals.clearInterval
    updateChecker._checkAllInFlight = false
    updateChecker.initTimer = null
    updateChecker.timer = null
    updateChecker.initSyncTimer = null
    updateChecker.syncTimer = null
    updateChecker.credentialRefreshTimer = null
    updateChecker._startToken = null
    updateChecker._subscriptionRuntimeInitialized = false
    updateChecker._subscriptionRuntimeInitializing = null
    updateChecker._subscriptionRuntimeStartPromise = null
    updateChecker._subscriptionRuntimeStartState = 'stopped'
    updateChecker._subscriptionRuntimeLastError = null
    updateChecker._subscriptionRuntimeLastErrorAt = null
}

async function run() {
    const logs = []
    const off = logger.onLog((entry) => logs.push(entry.message))

    try {
        global.setTimeout = () => ({ fakeTimeout: true })
        global.setInterval = () => ({ fakeInterval: true })
        global.clearInterval = () => {}
        config.groupConfigs = { '1000': { isInGroup: true } }
        subscriptionManager._ensureSubscriptionsLoaded = async () => {}
        subscriptionManager._ensureFollowersLoaded = async () => {}
        subscriptionManager.flushPendingFollowerSaves = async () => {}
        subscriptionManager.userSubs = [{
            uid: '123',
            name: 'tester',
            groupIds: ['1000']
        }]
        subscriptionManager.bangumiSubs = []
        subscriptionManager.groupToAccountMap = {}
        subscriptionStateStore.ensureLoaded = async () => {}
        subscriptionStateStore.initializeFromLegacy = async () => ({ changed: false })
        subscriptionDeliveryStore.ensureLoaded = async () => {}
        subscriptionDeliveryStore.cleanupExpired = async () => ({ removed: 0 })

        updateChecker.checkFeedUpdate = async () => {}
        updateChecker.buildUserCheckList = () => ([{
            uid: '123',
            name: 'tester',
            targetGroups: ['1000'],
            source: 'manual',
            targetGroupSourceMap: new Map([['1000', new Set(['manual'])]])
        }])
        updateChecker.checkUserDynamic = async () => {}
        updateChecker.checkUserVideoUnified = async () => {}
        updateChecker.checkUserArticleUnified = async () => {}
        updateChecker.checkUserLive = async () => {}
        updateChecker.checkBangumi = async () => {}
        updateChecker.refreshMissingNames = async () => {}

        updateChecker.start(true)
        updateChecker.stop()
        global.setTimeout = (fn) => {
            fn()
            return { fakeTimeout: true }
        }
        await updateChecker.checkAll()

        assert.ok(logs.some(line => line.includes('INF SUB') && line.includes('[svc:lifecycle]') && line.includes('checker-started')))
        assert.ok(logs.some(line => line.includes('INF SUB') && line.includes('[svc:lifecycle]') && line.includes('checker-stopped')))
        assert.ok(logs.some(line => line.includes('INF SUB') && line.includes('[poll:') && line.includes('cycle-start')))
        assert.ok(logs.some(line => line.includes('INF SUB') && line.includes('[sub:user:123]') && line.includes('dynamic-check')))
        assert.ok(logs.some(line => line.includes('INF SUB') && line.includes('[sub:user:123]') && line.includes('video-check')))
        assert.ok(!logs.some(line => line.includes('[UpdateChecker]')))
        console.log('✓ updateChecker 会输出 poll/sub scope 摘要日志')
    } finally {
        off()
        restore()
    }
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
