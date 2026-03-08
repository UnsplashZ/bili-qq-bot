'use strict'

const assert = require('assert')

const updateChecker = require('../../src/services/subscription/updateChecker')
const deps = require('../../src/services/subscription/updateChecker/adapters/deps')

describe('updateChecker manual/feed state advance policy', function () {
    const originals = {
        getUserInfo: deps.biliApi.getUserInfo,
        getLiveRoomInfo: deps.biliApi.getLiveRoomInfo,
        getDynamicFeed: deps.biliApi.getDynamicFeed,
        getDynamicInfo: deps.biliApi.getDynamicInfo,
        updateUserSub: deps.subscriptionManager.updateUserSub,
        updateCookieFollowerState: deps.subscriptionManager.updateCookieFollowerState,
        cookieFollowings: deps.subscriptionManager.cookieFollowings,
        notifyGroupsWithImageAndCache: updateChecker.notifyGroupsWithImageAndCache,
        findTargetGroupSourceMapForUser: updateChecker.findTargetGroupSourceMapForUser,
        getGroupIdsFromSourceMap: updateChecker.getGroupIdsFromSourceMap
    }

    afterEach(function () {
        deps.biliApi.getUserInfo = originals.getUserInfo
        deps.biliApi.getLiveRoomInfo = originals.getLiveRoomInfo
        deps.biliApi.getDynamicFeed = originals.getDynamicFeed
        deps.biliApi.getDynamicInfo = originals.getDynamicInfo
        deps.subscriptionManager.updateUserSub = originals.updateUserSub
        deps.subscriptionManager.updateCookieFollowerState = originals.updateCookieFollowerState
        deps.subscriptionManager.cookieFollowings = originals.cookieFollowings
        updateChecker.notifyGroupsWithImageAndCache = originals.notifyGroupsWithImageAndCache
        updateChecker.findTargetGroupSourceMapForUser = originals.findTargetGroupSourceMapForUser
        updateChecker.getGroupIdsFromSourceMap = originals.getGroupIdsFromSourceMap
    })

    it('manual live 通知无成功群时不应推进 lastLiveStatus', async function () {
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
})
