'use strict'

const assert = require('assert')

const updateChecker = require('../../../src/services/subscription/updateChecker')
const deps = require('../../../src/services/subscription/updateChecker/adapters/deps')

describe('updateChecker follower flush boundary', function () {
    const originals = {
        cookieFollowings: deps.subscriptionManager.cookieFollowings,
        getDynamicFeed: deps.biliApi.getDynamicFeed,
        getDynamicInfo: deps.biliApi.getDynamicInfo,
        getLiveFeed: deps.biliApi.getLiveFeed,
        getLiveRoomInfo: deps.biliApi.getLiveRoomInfo,
        subscriptionStateStore: deps.subscriptionStateStore,
        updateCookieFollowerState: deps.subscriptionManager.updateCookieFollowerState,
        flushPendingFollowerSaves: deps.subscriptionManager.flushPendingFollowerSaves,
        findTargetGroupSourceMapForUser: updateChecker.findTargetGroupSourceMapForUser,
        getGroupIdsFromSourceMap: updateChecker.getGroupIdsFromSourceMap,
        notifyGroupsWithImageAndCache: updateChecker.notifyGroupsWithImageAndCache
    }

    afterEach(function () {
        deps.subscriptionManager.cookieFollowings = originals.cookieFollowings
        deps.biliApi.getDynamicFeed = originals.getDynamicFeed
        deps.biliApi.getDynamicInfo = originals.getDynamicInfo
        deps.biliApi.getLiveFeed = originals.getLiveFeed
        deps.biliApi.getLiveRoomInfo = originals.getLiveRoomInfo
        deps.subscriptionStateStore = originals.subscriptionStateStore
        deps.subscriptionManager.updateCookieFollowerState = originals.updateCookieFollowerState
        deps.subscriptionManager.flushPendingFollowerSaves = originals.flushPendingFollowerSaves
        updateChecker.findTargetGroupSourceMapForUser = originals.findTargetGroupSourceMapForUser
        updateChecker.getGroupIdsFromSourceMap = originals.getGroupIdsFromSourceMap
        updateChecker.notifyGroupsWithImageAndCache = originals.notifyGroupsWithImageAndCache
    })

    it('processDynamicFeed 有状态更新时应执行 flushPendingFollowerSaves', async function () {
        deps.subscriptionStateStore = null
        deps.subscriptionManager.cookieFollowings = {
            acc1: [{ uid: '123', uname: 'tester', lastDynamicId: '100' }]
        }
        deps.biliApi.getDynamicFeed = async () => ({
            status: 'success',
            data: {
                items: [{
                    id_str: '200',
                    modules: { module_author: { mid: '123', name: 'tester' } }
                }],
                has_more: false,
                offset: ''
            }
        })
        deps.biliApi.getDynamicInfo = async () => ({ status: 'success', type: 'dynamic', data: {} })

        updateChecker.findTargetGroupSourceMapForUser = () => new Map([['1000', new Set(['cookieSync'])]])
        updateChecker.getGroupIdsFromSourceMap = (sourceMap) => Array.from(sourceMap.keys())
        updateChecker.notifyGroupsWithImageAndCache = async () => ({
            successGroups: ['1000'],
            failedGroups: [],
            dedupKey: 'dynamic:200'
        })

        let updateCalls = 0
        let flushCalls = 0
        deps.subscriptionManager.updateCookieFollowerState = async () => { updateCalls += 1 }
        deps.subscriptionManager.flushPendingFollowerSaves = async () => { flushCalls += 1 }

        await updateChecker.processDynamicFeed('acc1', '1000', new Set(['1000']))

        assert.strictEqual(updateCalls > 0, true)
        assert.strictEqual(flushCalls, 1)
    })

    it('processLiveFeed 有状态更新时应执行 flushPendingFollowerSaves', async function () {
        deps.subscriptionStateStore = null
        deps.subscriptionManager.cookieFollowings = {
            acc1: [{ uid: '123', uname: 'tester', lastLiveStatus: 0 }]
        }
        deps.biliApi.getLiveFeed = async () => ({
            status: 'success',
            data: {
                list: [{
                    uid: '123',
                    uname: 'tester',
                    live_status: 1,
                    room_id: 9527
                }]
            }
        })
        deps.biliApi.getLiveRoomInfo = async () => ({ status: 'success', type: 'live', data: {} })

        updateChecker.findTargetGroupSourceMapForUser = () => new Map([['1000', new Set(['cookieSync'])]])
        updateChecker.getGroupIdsFromSourceMap = (sourceMap) => Array.from(sourceMap.keys())
        updateChecker.notifyGroupsWithImageAndCache = async () => ({
            successGroups: ['1000'],
            failedGroups: [],
            dedupKey: 'live:9527'
        })

        let updateCalls = 0
        let flushCalls = 0
        deps.subscriptionManager.updateCookieFollowerState = async () => { updateCalls += 1 }
        deps.subscriptionManager.flushPendingFollowerSaves = async () => { flushCalls += 1 }

        await updateChecker.processLiveFeed('acc1', '1000', new Set(['1000']))

        assert.strictEqual(updateCalls > 0, true)
        assert.strictEqual(flushCalls, 1)
    })
})
