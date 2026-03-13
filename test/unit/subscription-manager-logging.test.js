#!/usr/bin/env node
'use strict'

const assert = require('assert')

const logger = require('../../src/utils/logger')
const subscriptionManager = require('../../src/services/subscription/subscriptionManager')
const biliApi = require('../../src/services/biliApi')

const originals = {
    ensureDir: subscriptionManager._ensureDir,
    loadSubscriptions: subscriptionManager._loadSubscriptions,
    saveSubscriptions: subscriptionManager._saveSubscriptions,
    getUserInfo: biliApi.getUserInfo,
    getUserDynamic: biliApi.getUserDynamic,
    loaded: subscriptionManager._loaded,
    loadingPromise: subscriptionManager._loadingPromise,
    userSubs: subscriptionManager.userSubs,
    bangumiSubs: subscriptionManager.bangumiSubs
}

function restore() {
    subscriptionManager._ensureDir = originals.ensureDir
    subscriptionManager._loadSubscriptions = originals.loadSubscriptions
    subscriptionManager._saveSubscriptions = originals.saveSubscriptions
    biliApi.getUserInfo = originals.getUserInfo
    biliApi.getUserDynamic = originals.getUserDynamic
    subscriptionManager._loaded = originals.loaded
    subscriptionManager._loadingPromise = originals.loadingPromise
    subscriptionManager.userSubs = originals.userSubs
    subscriptionManager.bangumiSubs = originals.bangumiSubs
}

async function run() {
    const logs = []
    const off = logger.onLog((entry) => logs.push(entry.message))

    try {
        subscriptionManager._loaded = false
        subscriptionManager._loadingPromise = null
        subscriptionManager._ensureDir = async () => {}
        subscriptionManager._loadSubscriptions = async () => {
            throw new Error('load boom')
        }

        await assert.rejects(() => subscriptionManager._ensureSubscriptionsLoaded(), /load boom/)

        subscriptionManager._loaded = true
        subscriptionManager._saveSubscriptions = async () => {}
        subscriptionManager.userSubs = []
        subscriptionManager.bangumiSubs = []
        biliApi.getUserInfo = async () => ({
            status: 'success',
            data: { name: 'tester' }
        })
        biliApi.getUserDynamic = async () => ({
            status: 'success',
            data: { cards: [] }
        })

        await subscriptionManager.addUserSubscription('42', '1000')

        subscriptionManager.userSubs = [{
            uid: '42',
            name: 'tester',
            groupIds: ['1000']
        }]
        subscriptionManager.bangumiSubs = [{
            seasonId: '21542',
            title: 'demo bangumi',
            groupIds: ['1000']
        }]
        await subscriptionManager.removeGroupFromAllSubscriptions('1000')

        assert.ok(logs.some(line => line.includes('ERR SUB') && line.includes('[svc:sub-manager]') && line.includes('subscriptions-load-retryable-failed')))
        assert.ok(logs.some(line => line.includes('INF SUB') && line.includes('[svc:sub-manager]') && line.includes('user-sub-added') && line.includes('uid=42')))
        assert.ok(logs.some(line => line.includes('INF SUB') && line.includes('[svc:sub-manager]') && line.includes('group-removed-from-all-subscriptions') && line.includes('groupId=1000')))
        assert.ok(!logs.some(line => line.includes('[SubscriptionManager]')))
        console.log('✓ SubscriptionManager 会输出统一摘要日志')
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
