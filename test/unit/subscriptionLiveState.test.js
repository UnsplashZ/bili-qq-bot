'use strict'

const assert = require('assert')

const { resolveLiveState } = require('../../src/services/subscription/updateChecker/helpers/liveState')

describe('resolveLiveState', () => {
    it('treats explicit live status as online', () => {
        const result = resolveLiveState({
            liveRoom: {
                liveStatus: 1,
                roomid: 321
            }
        })

        assert.deepStrictEqual(result, {
            status: 'online',
            roomId: '321',
            roomUrl: 'https://live.bilibili.com/321'
        })
    })

    it('keeps state unknown when room confirmation fails', () => {
        const result = resolveLiveState({
            liveRoom: {},
            cachedRoomId: '654',
            roomInfo: {
                status: 'error',
                message: 'timeout'
            }
        })

        assert.deepStrictEqual(result, {
            status: 'unknown',
            roomId: '654',
            roomUrl: 'https://live.bilibili.com/654'
        })
    })

    it('treats confirmed room info as offline', () => {
        const result = resolveLiveState({
            liveRoom: {
                roomid: 777
            },
            roomInfo: {
                status: 'success',
                data: {
                    room_info: {
                        room_id: 777,
                        live_status: 0
                    }
                }
            }
        })

        assert.deepStrictEqual(result, {
            status: 'offline',
            roomId: '777',
            roomUrl: 'https://live.bilibili.com/777'
        })
    })
})
