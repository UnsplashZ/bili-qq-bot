'use strict'

const assert = require('assert')

const updateChecker = require('../../../src/services/subscription/updateChecker')
const deps = require('../../../src/services/subscription/updateChecker/adapters/deps')

describe('updateChecker manual/feed state advance policy', function () {
    const originals = {
        getUserInfo: deps.biliApi.getUserInfo,
        getLiveRoomInfo: deps.biliApi.getLiveRoomInfo,
        getLiveFeed: deps.biliApi.getLiveFeed,
        getDynamicFeed: deps.biliApi.getDynamicFeed,
        getDynamicInfo: deps.biliApi.getDynamicInfo,
        updateUserSub: deps.subscriptionManager.updateUserSub,
        updateCookieFollowerState: deps.subscriptionManager.updateCookieFollowerState,
        subscriptionStateStore: deps.subscriptionStateStore,
        subscriptionDeliveryStore: deps.subscriptionDeliveryStore,
        cookieFollowings: deps.subscriptionManager.cookieFollowings,
        userSubs: deps.subscriptionManager.userSubs,
        groupToAccountMap: deps.subscriptionManager.groupToAccountMap,
        groupConfigs: JSON.parse(JSON.stringify(deps.config.groupConfigs || {})),
        notifyGroupsWithImageAndCache: updateChecker.notifyGroupsWithImageAndCache,
        findTargetGroupSourceMapForUser: updateChecker.findTargetGroupSourceMapForUser,
        getGroupIdsFromSourceMap: updateChecker.getGroupIdsFromSourceMap
    }

    afterEach(function () {
        deps.biliApi.getUserInfo = originals.getUserInfo
        deps.biliApi.getLiveRoomInfo = originals.getLiveRoomInfo
        deps.biliApi.getLiveFeed = originals.getLiveFeed
        deps.biliApi.getDynamicFeed = originals.getDynamicFeed
        deps.biliApi.getDynamicInfo = originals.getDynamicInfo
        deps.subscriptionManager.updateUserSub = originals.updateUserSub
        deps.subscriptionManager.updateCookieFollowerState = originals.updateCookieFollowerState
        deps.subscriptionStateStore = originals.subscriptionStateStore
        deps.subscriptionDeliveryStore = originals.subscriptionDeliveryStore
        deps.subscriptionManager.cookieFollowings = originals.cookieFollowings
        deps.subscriptionManager.userSubs = originals.userSubs
        deps.subscriptionManager.groupToAccountMap = originals.groupToAccountMap
        const groupConfigs = deps.config.groupConfigs || {}
        for (const key of Object.keys(groupConfigs)) {
            delete groupConfigs[key]
        }
        Object.assign(groupConfigs, JSON.parse(JSON.stringify(originals.groupConfigs)))
        updateChecker.notifyGroupsWithImageAndCache = originals.notifyGroupsWithImageAndCache
        updateChecker.findTargetGroupSourceMapForUser = originals.findTargetGroupSourceMapForUser
        updateChecker.getGroupIdsFromSourceMap = originals.getGroupIdsFromSourceMap
    })

    it('manual live 通知无成功群时不应推进 lastLiveStatus', async function () {
        deps.subscriptionStateStore = null
        deps.biliApi.getUserInfo = async () => ({
            status: 'success',
            data: {
                live_room: {
                    liveStatus: 1,
                    roomid: 9527,
                    url: 'https://live.bilibili.com/9527'
                }
            }
        })
        deps.biliApi.getLiveRoomInfo = async () => ({
            status: 'success',
            type: 'live',
            data: {}
        })
        updateChecker.findTargetGroupSourceMapForUser = () => {
            const map = new Map()
            map.set('1000', new Set(['manual']))
            return map
        }
        updateChecker.notifyGroupsWithImageAndCache = async () => ({
            successGroups: [],
            failedGroups: ['1000'],
            dedupKey: 'live:9527'
        })

        const updates = []
        deps.subscriptionManager.updateUserSub = async (_uid, patch) => {
            updates.push(patch)
        }

        await updateChecker.checkUserLive({
            uid: '123',
            name: 'tester',
            roomId: 9527,
            lastLiveStatus: 0,
            groupIds: ['1000']
        }, ['1000'], false)

        const touchedLiveStatus = updates.some(p => Object.prototype.hasOwnProperty.call(p, 'lastLiveStatus'))
        assert.strictEqual(touchedLiveStatus, false)
    })

    it('feed dynamic 通知无成功群时不应推进 lastDynamicId', async function () {
        deps.subscriptionStateStore = null
        deps.subscriptionManager.cookieFollowings = {
            acc1: [
                {
                    uid: '123',
                    uname: 'tester',
                    lastDynamicId: '100'
                }
            ]
        }
        deps.biliApi.getDynamicFeed = async () => ({
            status: 'success',
            data: {
                items: [
                    {
                        id_str: '200',
                        modules: {
                            module_author: {
                                mid: '123',
                                name: 'tester'
                            }
                        }
                    }
                ],
                has_more: false,
                offset: 'next'
            }
        })
        deps.biliApi.getDynamicInfo = async () => ({
            status: 'success',
            type: 'dynamic',
            data: {}
        })
        updateChecker.findTargetGroupSourceMapForUser = () => {
            const map = new Map()
            map.set('1000', new Set(['cookieSync']))
            return map
        }
        updateChecker.getGroupIdsFromSourceMap = (sourceMap) => Array.from(sourceMap.keys())
        updateChecker.notifyGroupsWithImageAndCache = async () => ({
            successGroups: [],
            failedGroups: ['1000'],
            dedupKey: 'dynamic:200'
        })

        const updates = []
        deps.subscriptionManager.updateCookieFollowerState = async (_acc, _uid, patch) => {
            updates.push(patch)
        }

        await updateChecker.processDynamicFeed('acc1', '1000', new Set(['1000']))

        const touchedDynamicId = updates.some(p => Object.prototype.hasOwnProperty.call(p, 'lastDynamicId'))
        assert.strictEqual(touchedDynamicId, false)
    })

    it('feed live 在 cookie 已在线但 manual 未在线时仍应补发并推进 manual lastLiveStatus', async function () {
        deps.subscriptionStateStore = null
        deps.subscriptionManager.cookieFollowings = {
            acc1: [
                {
                    uid: '123',
                    uname: 'tester',
                    roomId: 9527,
                    lastLiveStatus: 1
                }
            ]
        }
        deps.subscriptionManager.userSubs = [
            {
                uid: '123',
                name: 'tester',
                groupIds: ['1000'],
                roomId: 9527,
                lastLiveStatus: 0
            }
        ]
        deps.subscriptionManager.groupToAccountMap = {
            '1000': 'acc1'
        }
        deps.biliApi.getLiveFeed = async () => ({
            status: 'success',
            data: {
                list: [
                    {
                        uid: '123',
                        uname: 'tester',
                        room_id: 9527,
                        live_status: 1
                    }
                ]
            }
        })
        deps.biliApi.getLiveRoomInfo = async () => ({
            status: 'success',
            type: 'live',
            data: {}
        })

        const notifyCalls = []
        updateChecker.notifyGroupsWithImageAndCache = async (_targetGroupSourceMap, _info, _type, _url, text) => {
            notifyCalls.push(text)
            return {
                successGroups: ['1000'],
                failedGroups: [],
                dedupKey: 'live:9527'
            }
        }

        const manualUpdates = []
        deps.subscriptionManager.updateUserSub = async (_uid, patch) => {
            manualUpdates.push(patch)
        }
        deps.subscriptionManager.updateCookieFollowerState = async () => {}

        await updateChecker.processLiveFeed('acc1', '1000', new Set(['1000']))

        assert.deepStrictEqual(notifyCalls, ['tester 开播了！'])
        assert.deepStrictEqual(manualUpdates, [{ lastLiveStatus: 1 }])
    })

    it('feed live 确认下播时应同步复位 manual lastLiveStatus', async function () {
        deps.subscriptionStateStore = null
        deps.subscriptionManager.cookieFollowings = {
            acc1: [
                {
                    uid: '123',
                    uname: 'tester',
                    roomId: 9527,
                    lastLiveStatus: 1
                }
            ]
        }
        deps.subscriptionManager.userSubs = [
            {
                uid: '123',
                name: 'tester',
                groupIds: ['1000'],
                roomId: 9527,
                lastLiveStatus: 1
            }
        ]
        deps.biliApi.getLiveFeed = async () => ({
            status: 'success',
            data: {
                list: []
            }
        })
        deps.biliApi.getLiveRoomInfo = async () => ({
            status: 'success',
            type: 'live',
            data: {
                room_info: {
                    live_status: 0,
                    room_id: 9527
                }
            }
        })

        const manualUpdates = []
        deps.subscriptionManager.updateUserSub = async (_uid, patch) => {
            manualUpdates.push(patch)
        }
        deps.subscriptionManager.updateCookieFollowerState = async () => {}

        await updateChecker.processLiveFeed('acc1', '1000', new Set(['1000']))

        assert.deepStrictEqual(manualUpdates, [{ lastLiveStatus: 0 }])
    })

    it('feed live 仅看到 UID 但未形成可靠 manual 处理结果时不应覆盖 manual fallback', async function () {
        deps.subscriptionStateStore = null
        deps.subscriptionManager.cookieFollowings = {
            acc1: [
                {
                    uid: '123',
                    uname: 'tester',
                    roomId: 9527,
                    lastLiveStatus: 0
                }
            ]
        }
        deps.subscriptionManager.userSubs = [
            {
                uid: '123',
                name: 'tester',
                groupIds: ['1000'],
                roomId: 9527,
                lastLiveStatus: 0
            }
        ]
        deps.subscriptionManager.groupToAccountMap = {
            '1000': 'acc1'
        }
        deps.biliApi.getLiveFeed = async () => ({
            status: 'success',
            data: {
                list: [
                    {
                        uid: '123',
                        uname: 'tester',
                        room_id: 9527,
                        live_status: 0
                    }
                ]
            }
        })

        const result = await updateChecker.processLiveFeed('acc1', '1000', new Set(['1000']))

        assert.deepStrictEqual(result.coveredUids || [], [])
    })

    it('manual live 已在线但存在台账缺口时只补发缺失群并写入 live 台账', async function () {
        deps.subscriptionStateStore = {
            getUserState: async () => ({
                uid: '123',
                live: {
                    lastStatus: 1,
                    roomId: '9527',
                    meta: { source: 'updateChecker' }
                }
            })
        }
        const deliveryRecords = []
        deps.subscriptionDeliveryStore = {
            getUndeliveredGroups: async () => ['1001'],
            recordDeliveredBatch: async (records) => {
                deliveryRecords.push(...records)
                return { changed: records.length }
            }
        }
        deps.biliApi.getUserInfo = async () => ({
            status: 'success',
            data: {
                live_room: {
                    liveStatus: 1,
                    roomid: 9527,
                    url: 'https://live.bilibili.com/9527'
                }
            }
        })
        deps.biliApi.getLiveRoomInfo = async () => ({
            status: 'success',
            type: 'live',
            data: {}
        })

        const notifyTargets = []
        updateChecker.notifyGroupsWithImageAndCache = async (targetGroupSourceMap) => {
            notifyTargets.push(Array.from(targetGroupSourceMap.keys()))
            return {
                successGroups: ['1001'],
                failedGroups: [],
                dedupKey: 'live:9527'
            }
        }

        await updateChecker.checkUserLive({
            uid: '123',
            name: 'tester',
            roomId: 9527,
            lastLiveStatus: 1,
            groupIds: ['1000', '1001']
        }, ['1000', '1001'], false)

        assert.deepStrictEqual(notifyTargets, [['1001']])
        assert.deepStrictEqual(deliveryRecords.map(r => `${r.groupId}:${r.type}:${r.contentId}`), ['1001:live:9527'])
    })

    it('feed live 已在线但 manual 群台账补发失败时不应覆盖 manual fallback', async function () {
        deps.subscriptionStateStore = {
            getUserState: async () => ({
                uid: '123',
                live: {
                    lastStatus: 1,
                    roomId: '9527',
                    meta: { source: 'updateChecker' }
                }
            })
        }
        deps.subscriptionDeliveryStore = {
            getUndeliveredGroups: async () => ['1000'],
            recordDeliveredBatch: async () => ({ changed: 0 })
        }
        deps.subscriptionManager.cookieFollowings = {
            acc1: [
                {
                    uid: '123',
                    uname: 'tester',
                    roomId: 9527,
                    lastLiveStatus: 1
                }
            ]
        }
        deps.subscriptionManager.userSubs = [
            {
                uid: '123',
                name: 'tester',
                groupIds: ['1000'],
                roomId: 9527,
                lastLiveStatus: 1
            }
        ]
        deps.subscriptionManager.groupToAccountMap = {
            '1000': 'acc1'
        }
        deps.biliApi.getLiveFeed = async () => ({
            status: 'success',
            data: {
                list: [
                    {
                        uid: '123',
                        uname: 'tester',
                        room_id: 9527,
                        live_status: 1
                    }
                ]
            }
        })
        deps.biliApi.getLiveRoomInfo = async () => ({
            status: 'success',
            type: 'live',
            data: {}
        })
        updateChecker.findTargetGroupSourceMapForUser = () => {
            const map = new Map()
            map.set('1000', new Set(['manual']))
            return map
        }
        updateChecker.notifyGroupsWithImageAndCache = async () => ({
            successGroups: [],
            failedGroups: ['1000'],
            dedupKey: 'live:9527'
        })

        const result = await updateChecker.processLiveFeed('acc1', '1000', new Set(['1000']))

        assert.deepStrictEqual(result.coveredUids || [], [])
    })

    it('feed live 统一锚点已在线后第二账号群可通过全 UID 台账缺口补发', async function () {
        const notifiedTargets = []
        const deliveryRecords = []

        deps.config.groupConfigs.A = {
            isInGroup: true,
            enableCookieSync: true
        }
        deps.config.groupConfigs.B = {
            isInGroup: true,
            enableCookieSync: true
        }
        deps.subscriptionManager.groupToAccountMap = {
            A: 'accA',
            B: 'accB'
        }
        deps.subscriptionManager.cookieFollowings = {
            accA: [
                {
                    uid: '123',
                    uname: 'tester',
                    roomId: 9527,
                    lastLiveStatus: 1
                }
            ],
            accB: [
                {
                    uid: '123',
                    uname: 'tester',
                    roomId: 9527,
                    lastLiveStatus: 0
                }
            ]
        }
        deps.subscriptionManager.userSubs = []
        deps.subscriptionStateStore = {
            getUserState: async () => ({
                uid: '123',
                live: {
                    lastStatus: 1,
                    roomId: '9527',
                    meta: { source: 'updateChecker' }
                }
            }),
            advanceLive: async () => {}
        }
        deps.subscriptionDeliveryStore = {
            getDeliveryCoverage: async (groups, type, contentId) => {
                assert.deepStrictEqual([...groups].sort(), ['A', 'B'])
                assert.strictEqual(type, 'live')
                assert.strictEqual(contentId, '9527')
                return {
                    deliveredGroups: ['A'],
                    undeliveredGroups: ['B'],
                    hasAnyRecord: true
                }
            },
            recordDeliveredBatch: async (records) => {
                deliveryRecords.push(...records)
                return { changed: records.length }
            }
        }
        deps.biliApi.getLiveFeed = async () => ({
            status: 'success',
            data: {
                list: [
                    {
                        uid: '123',
                        uname: 'tester',
                        room_id: 9527,
                        live_status: 1
                    }
                ]
            }
        })
        deps.biliApi.getLiveRoomInfo = async () => ({
            status: 'success',
            type: 'live',
            data: {}
        })
        updateChecker.notifyGroupsWithImageAndCache = async (targetGroupSourceMap) => {
            notifiedTargets.push(Array.from(targetGroupSourceMap.keys()))
            return {
                successGroups: ['B'],
                failedGroups: [],
                dedupKey: 'live:9527'
            }
        }

        await updateChecker.processLiveFeed('accB', 'B', new Set(['A', 'B']))

        assert.deepStrictEqual(notifiedTargets, [['B']])
        assert.deepStrictEqual(deliveryRecords.map(r => `${r.groupId}:${r.type}:${r.contentId}`), ['B:live:9527'])
    })

    it('manual live force 且 persistState=false 时不应推进 live 统一状态', async function () {
        const advanced = []
        deps.subscriptionStateStore = {
            getUserState: async () => ({
                uid: '123',
                live: {
                    lastStatus: 0,
                    roomId: null,
                    meta: {}
                }
            }),
            advanceLive: async (_uid, liveState) => {
                advanced.push(liveState)
            }
        }
        deps.biliApi.getUserInfo = async () => ({
            status: 'success',
            data: {
                live_room: {
                    liveStatus: 1,
                    roomid: 9527,
                    url: 'https://live.bilibili.com/9527'
                }
            }
        })
        deps.biliApi.getLiveRoomInfo = async () => ({
            status: 'success',
            type: 'live',
            data: {}
        })
        updateChecker.notifyGroupsWithImageAndCache = async () => ({
            successGroups: ['1000'],
            failedGroups: [],
            dedupKey: 'live:9527'
        })

        await updateChecker.checkUserLive({
            uid: '123',
            name: 'tester',
            roomId: null,
            lastLiveStatus: 0,
            groupIds: ['1000']
        }, ['1000'], true, {
            persistState: false,
            disableDedup: true
        })

        assert.deepStrictEqual(advanced, [])
    })
})
