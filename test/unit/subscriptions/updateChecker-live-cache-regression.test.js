'use strict'

const assert = require('assert')

const updateChecker = require('../../../src/services/subscription/updateChecker')
const deps = require('../../../src/services/subscription/updateChecker/adapters/deps')

describe('updateChecker live stale-cache regression', function () {
    const originals = {
        getUserInfo: deps.biliApi.getUserInfo,
        getLiveRoomInfo: deps.biliApi.getLiveRoomInfo,
        updateUserSub: deps.subscriptionManager.updateUserSub,
        notifyGroupsWithImageAndCache: updateChecker.notifyGroupsWithImageAndCache
    }

    afterEach(function () {
        deps.biliApi.getUserInfo = originals.getUserInfo
        deps.biliApi.getLiveRoomInfo = originals.getLiveRoomInfo
        deps.subscriptionManager.updateUserSub = originals.updateUserSub
        updateChecker.notifyGroupsWithImageAndCache = originals.notifyGroupsWithImageAndCache
    })

    it('manual live check 应绕过旧 user_info 缓存', async function () {
        const getUserInfoCalls = []
        const updates = []
        let notified = 0

        deps.biliApi.getUserInfo = async (...args) => {
            getUserInfoCalls.push(args)
            return {
                status: 'success',
                data: {
                    live_room: {
                        liveStatus: 1,
                        roomid: 9527,
                        url: 'https://live.bilibili.com/9527'
                    }
                }
            }
        }
        deps.biliApi.getLiveRoomInfo = async () => ({
            status: 'success',
            type: 'live',
            data: {
                room_info: {
                    room_id: 9527,
                    live_status: 1
                }
            }
        })
        deps.subscriptionManager.updateUserSub = async (_uid, patch) => {
            updates.push(patch)
        }
        updateChecker.notifyGroupsWithImageAndCache = async () => {
            notified += 1
            return {
                successGroups: ['1000'],
                failedGroups: [],
                dedupKey: 'live:9527'
            }
        }

        await updateChecker.checkUserLive({
            uid: '108618052',
            name: '真实球迷汇',
            groupIds: ['1000'],
            lastLiveStatus: 0,
            roomId: '9527'
        }, ['1000'], false)

        assert.strictEqual(getUserInfoCalls.length, 1)
        assert.strictEqual(getUserInfoCalls[0][0], '108618052')
        assert.strictEqual(getUserInfoCalls[0][1], '1000')
        assert.strictEqual(getUserInfoCalls[0][2], 'fresh')
        assert.strictEqual(notified, 1)
        assert.deepStrictEqual(updates, [{ lastLiveStatus: 1 }])
    })
})
