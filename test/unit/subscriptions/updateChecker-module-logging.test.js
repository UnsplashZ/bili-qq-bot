#!/usr/bin/env node
'use strict'

const assert = require('assert')

const logger = require('../../../src/utils/logger')
const updateChecker = require('../../../src/services/subscription/updateChecker')
const subscriptionManager = require('../../../src/services/subscription/subscriptionManager')
const biliApi = require('../../../src/services/biliApi')
const notificationHistory = require('../../../src/utils/notificationHistory')
const config = require('../../../src/config')

const originals = {
    historyHas: notificationHistory.has,
    getUserVideos: biliApi.getUserVideos,
    getLiveFeed: biliApi.getLiveFeed,
    getLiveRoomInfo: biliApi.getLiveRoomInfo,
    updateCookieFollowerState: subscriptionManager.updateCookieFollowerState,
    flushPendingFollowerSaves: subscriptionManager.flushPendingFollowerSaves,
    groupToAccountMap: subscriptionManager.groupToAccountMap,
    cookieFollowings: subscriptionManager.cookieFollowings,
    findTargetGroupsForUser: updateChecker.findTargetGroupsForUser,
    findTargetGroupSourceMapForUser: updateChecker.findTargetGroupSourceMapForUser,
    notifyGroupsWithImageAndCache: updateChecker.notifyGroupsWithImageAndCache,
    ws: updateChecker.ws,
    getGroupConfig: config.getGroupConfig,
    setTimeout: global.setTimeout
}

function restore() {
    notificationHistory.has = originals.historyHas
    biliApi.getUserVideos = originals.getUserVideos
    biliApi.getLiveFeed = originals.getLiveFeed
    biliApi.getLiveRoomInfo = originals.getLiveRoomInfo
    subscriptionManager.updateCookieFollowerState = originals.updateCookieFollowerState
    subscriptionManager.flushPendingFollowerSaves = originals.flushPendingFollowerSaves
    subscriptionManager.groupToAccountMap = originals.groupToAccountMap
    subscriptionManager.cookieFollowings = originals.cookieFollowings
    updateChecker.findTargetGroupsForUser = originals.findTargetGroupsForUser
    updateChecker.findTargetGroupSourceMapForUser = originals.findTargetGroupSourceMapForUser
    updateChecker.notifyGroupsWithImageAndCache = originals.notifyGroupsWithImageAndCache
    updateChecker.ws = originals.ws
    config.getGroupConfig = originals.getGroupConfig
    global.setTimeout = originals.setTimeout
}

async function run() {
    const logs = []
    const off = logger.onLog((entry) => logs.push(entry.message))

    try {
        config.getGroupConfig = () => 60
        updateChecker.ws = {}

        notificationHistory.has = () => true
        updateChecker.notifyGroups(new Map([['1000', new Set(['manual'])]]), 'demo', 'dup-text')

        await updateChecker.fetchWithGroupFallback(['1000'], async () => ({
            status: 'error',
            message: 'fetch failed'
        }), 'getUserVideos uid=42')

        biliApi.getUserVideos = async () => ({
            status: 'success',
            data: {
                videos: [{ bvid: 'BV1ZHiyBkExG', created: 123 }]
            }
        })
        await updateChecker.checkUserVideoUnified({
            uid: '42',
            name: 'tester',
            targetGroups: ['1000'],
            source: 'manual',
            manualSub: null,
            cookieFollower: null,
            targetGroupSourceMap: new Map([['1000', new Set(['manual'])]])
        }, false, { persistState: false })

        subscriptionManager.groupToAccountMap = { '1000': 'acc1' }
        subscriptionManager.cookieFollowings = { acc1: [{ mid: '42', lastLiveStatus: 0 }] }
        updateChecker.findTargetGroupSourceMapForUser = () => new Map([['1000', new Set(['cookieSync'])]])
        updateChecker.notifyGroupsWithImageAndCache = async () => ({
            successGroups: [],
            failedGroups: ['1000']
        })
        biliApi.getLiveFeed = async () => ({
            status: 'success',
            data: {
                list: [{ uid: '42', uname: 'tester', room_id: '1', live_status: 1 }]
            }
        })
        biliApi.getLiveRoomInfo = async () => ({
            status: 'success',
            data: { room_id: '1', live_status: 1 }
        })
        subscriptionManager.updateCookieFollowerState = async () => {}
        subscriptionManager.flushPendingFollowerSaves = async () => {}
        global.setTimeout = (fn) => {
            fn()
            return { fake: true }
        }
        await updateChecker.processLiveFeed('acc1', '1000')

        assert.ok(logs.some(line => line.includes('INF SUB') && line.includes('text-notification-dedup-skipped') && line.includes('groupId=1000')))
        assert.ok(logs.some(line => line.includes('WRN SUB') && line.includes('fetch-with-group-fallback-failed') && line.includes('contextLabel="getUserVideos uid=42"')))
        assert.ok(logs.some(line => line.includes('INF SUB') && line.includes('[sub:user:42]') && line.includes('video-anchor-initialized')))
        assert.ok(logs.some(line => line.includes('WRN SUB') && line.includes('feed-live-state-advance-skipped') && line.includes('uid=42')))
        assert.ok(!logs.some(line => line.includes('[UpdateChecker]')))
        console.log('✓ updateChecker 主模块会输出统一摘要日志')
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
