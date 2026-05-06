#!/usr/bin/env node
'use strict'

const assert = require('assert')

const logger = require('../../../src/utils/logger')
const updateChecker = require('../../../src/services/subscription/updateChecker')
const biliApi = require('../../../src/services/biliApi')
const subscriptionManager = require('../../../src/services/subscription/subscriptionManager')

const originals = {
    getUserDynamic: biliApi.getUserDynamic,
    getUserInfo: biliApi.getUserInfo,
    getBangumiInfo: biliApi.getBangumiInfo,
    notifyGroupsWithImageAndCache: updateChecker.notifyGroupsWithImageAndCache,
    updateUserSub: subscriptionManager.updateUserSub,
    updateBangumiSub: subscriptionManager.updateBangumiSub
}

function restore() {
    biliApi.getUserDynamic = originals.getUserDynamic
    biliApi.getUserInfo = originals.getUserInfo
    biliApi.getBangumiInfo = originals.getBangumiInfo
    updateChecker.notifyGroupsWithImageAndCache = originals.notifyGroupsWithImageAndCache
    subscriptionManager.updateUserSub = originals.updateUserSub
    subscriptionManager.updateBangumiSub = originals.updateBangumiSub
}

async function run() {
    const logs = []
    const off = logger.onLog((entry) => logs.push(entry.message))

    try {
        biliApi.getUserDynamic = async () => ({ status: 'error', message: 'fetch failed' })
        await updateChecker.checkUserDynamic({
            uid: '42',
            name: 'tester',
            groupIds: ['1000']
        })

        biliApi.getUserInfo = async () => ({
            status: 'success',
            data: { live_room: {} }
        })
        subscriptionManager.updateUserSub = async () => {}
        await updateChecker.checkUserLive({
            uid: '42',
            name: 'tester',
            groupIds: ['1000'],
            lastLiveStatus: 0
        })

        biliApi.getBangumiInfo = async () => ({
            status: 'success',
            data: { new_ep: { id: 2, index_show: '第 2 话' } }
        })
        updateChecker.notifyGroupsWithImageAndCache = async () => ({
            successGroups: [],
            failedGroups: ['1000']
        })
        subscriptionManager.updateBangumiSub = async () => {}
        await updateChecker.checkBangumi({
            seasonId: '21542',
            title: 'demo bangumi',
            groupIds: ['1000'],
            lastEpId: 1
        })

        assert.ok(logs.some(line => line.includes('WRN SUB') && line.includes('[sub:user:42]') && line.includes('dynamic-fetch-failed')))
        assert.ok(logs.some(line => line.includes('WRN SUB') && line.includes('[sub:user:42]') && line.includes('live-room-missing')))
        assert.ok(logs.some(line => line.includes('WRN SUB') && line.includes('[sub:bangumi:21542]') && line.includes('bangumi-state-advance-skipped')))
        assert.ok(!logs.some(line => line.includes('[UpdateChecker]')))
        console.log('✓ updateChecker manualChecks 会输出统一摘要日志')
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
