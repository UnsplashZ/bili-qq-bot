#!/usr/bin/env node
'use strict'

const assert = require('assert')

const updateChecker = require('../../../src/services/subscription/updateChecker')
const subscriptionManager = require('../../../src/services/subscription/subscriptionManager')
const subscriptionStateStore = require('../../../src/services/subscription/subscriptionStateStore')
const subscriptionDeliveryStore = require('../../../src/services/subscription/subscriptionDeliveryStore')

function createDeferred() {
    let resolve
    let reject
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise
        reject = rejectPromise
    })
    return { promise, resolve, reject }
}

const original = {
    ensureSubscriptionsLoaded: subscriptionManager._ensureSubscriptionsLoaded,
    ensureFollowersLoaded: subscriptionManager._ensureFollowersLoaded,
    userSubs: subscriptionManager.userSubs,
    cookieFollowings: subscriptionManager.cookieFollowings,
    stateEnsureLoaded: subscriptionStateStore.ensureLoaded,
    stateInitializeFromLegacy: subscriptionStateStore.initializeFromLegacy,
    deliveryEnsureLoaded: subscriptionDeliveryStore.ensureLoaded,
    deliveryCleanupExpired: subscriptionDeliveryStore.cleanupExpired,
    checkAndRefreshCredential: updateChecker.checkAndRefreshCredential,
    warmupGroupAtAllCapabilities: updateChecker.warmupGroupAtAllCapabilities,
    refreshCookieFollowings: updateChecker.refreshCookieFollowings,
    checkAll: updateChecker.checkAll,
    setTimeout: global.setTimeout,
    setInterval: global.setInterval,
    clearTimeout: global.clearTimeout,
    clearInterval: global.clearInterval
}

function resetChecker() {
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
    updateChecker._subscriptionRuntimeStartRequestedAt = null
    updateChecker._subscriptionRuntimeReadyAt = null
    updateChecker._subscriptionRuntimeLastError = null
    updateChecker._subscriptionRuntimeLastErrorAt = null
}

function restore() {
    subscriptionManager._ensureSubscriptionsLoaded = original.ensureSubscriptionsLoaded
    subscriptionManager._ensureFollowersLoaded = original.ensureFollowersLoaded
    subscriptionManager.userSubs = original.userSubs
    subscriptionManager.cookieFollowings = original.cookieFollowings
    subscriptionStateStore.ensureLoaded = original.stateEnsureLoaded
    subscriptionStateStore.initializeFromLegacy = original.stateInitializeFromLegacy
    subscriptionDeliveryStore.ensureLoaded = original.deliveryEnsureLoaded
    subscriptionDeliveryStore.cleanupExpired = original.deliveryCleanupExpired
    updateChecker.checkAndRefreshCredential = original.checkAndRefreshCredential
    updateChecker.warmupGroupAtAllCapabilities = original.warmupGroupAtAllCapabilities
    updateChecker.refreshCookieFollowings = original.refreshCookieFollowings
    updateChecker.checkAll = original.checkAll
    global.setTimeout = original.setTimeout
    global.setInterval = original.setInterval
    global.clearTimeout = original.clearTimeout
    global.clearInterval = original.clearInterval
    resetChecker()
}

async function testStopCancelsPendingStoreInitialization() {
    resetChecker()

    const subscriptionsLoaded = createDeferred()
    let followersLoaded = 0
    let stateEnsureLoaded = 0
    let stateInitialized = 0
    let deliveryEnsureLoaded = 0
    let deliveryCleanup = 0
    let scheduledTimers = 0

    subscriptionManager._ensureSubscriptionsLoaded = async () => subscriptionsLoaded.promise
    subscriptionManager._ensureFollowersLoaded = async () => {
        followersLoaded += 1
    }
    subscriptionManager.userSubs = [{ uid: '123', groupIds: ['1000'], lastDynamicId: '1' }]
    subscriptionManager.cookieFollowings = {}
    subscriptionStateStore.ensureLoaded = async () => {
        stateEnsureLoaded += 1
    }
    subscriptionStateStore.initializeFromLegacy = async () => {
        stateInitialized += 1
        return { changed: true }
    }
    subscriptionDeliveryStore.ensureLoaded = async () => {
        deliveryEnsureLoaded += 1
    }
    subscriptionDeliveryStore.cleanupExpired = async () => {
        deliveryCleanup += 1
        return { removed: 0 }
    }
    updateChecker.checkAndRefreshCredential = async () => {}
    updateChecker.warmupGroupAtAllCapabilities = async () => {}
    global.setTimeout = () => {
        scheduledTimers += 1
        return { fakeTimeout: true }
    }
    global.setInterval = () => {
        scheduledTimers += 1
        return { fakeInterval: true }
    }
    global.clearTimeout = () => {}
    global.clearInterval = () => {}

    const startPromise = updateChecker.start(true)
    const pendingStatus = updateChecker.getStatus()
    assert.equal(pendingStatus.runtime.startupPending, true)
    assert.equal(pendingStatus.runtime.ready, false)

    const stopPromise = updateChecker.stop()
    subscriptionsLoaded.resolve()
    await startPromise
    await stopPromise

    const stoppedStatus = updateChecker.getStatus()
    assert.equal(followersLoaded, 0)
    assert.equal(stateEnsureLoaded, 0)
    assert.equal(stateInitialized, 0)
    assert.equal(deliveryEnsureLoaded, 0)
    assert.equal(deliveryCleanup, 0)
    assert.equal(scheduledTimers, 0)
    assert.equal(stoppedStatus.runtime.startupPending, false)
    assert.equal(stoppedStatus.runtime.ready, false)
    assert.equal(stoppedStatus.running, false)
}

async function testSuccessfulStartSchedulesTimersAndReportsReady() {
    resetChecker()

    let scheduledTimeouts = 0
    let scheduledIntervals = 0

    subscriptionManager._ensureSubscriptionsLoaded = async () => {}
    subscriptionManager._ensureFollowersLoaded = async () => {}
    subscriptionManager.userSubs = []
    subscriptionManager.cookieFollowings = {}
    subscriptionStateStore.ensureLoaded = async () => {}
    subscriptionStateStore.initializeFromLegacy = async () => ({ changed: false })
    subscriptionDeliveryStore.ensureLoaded = async () => {}
    subscriptionDeliveryStore.cleanupExpired = async () => ({ removed: 0 })
    updateChecker.checkAndRefreshCredential = async () => {}
    updateChecker.warmupGroupAtAllCapabilities = async () => {}
    updateChecker.refreshCookieFollowings = async () => {}
    updateChecker.checkAll = async () => {}
    global.setTimeout = () => {
        scheduledTimeouts += 1
        return { fakeTimeout: scheduledTimeouts }
    }
    global.setInterval = () => {
        scheduledIntervals += 1
        return { fakeInterval: scheduledIntervals }
    }
    global.clearTimeout = () => {}
    global.clearInterval = () => {}

    await updateChecker.start(true)

    const status = updateChecker.getStatus()
    assert.equal(status.runtime.ready, true)
    assert.equal(status.runtime.startState, 'ready')
    assert.equal(status.runtime.initialized, true)
    assert.equal(status.running, true)
    assert.equal(scheduledTimeouts, 2)
    assert.equal(scheduledIntervals, 3)
}

async function run() {
    try {
        await testStopCancelsPendingStoreInitialization()
        restore()
        await testSuccessfulStartSchedulesTimersAndReportsReady()
        console.log('PASS updateChecker lifecycle start/stop readiness')
    } finally {
        restore()
    }
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
