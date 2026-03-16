'use strict'

const assert = require('assert')

const biliApi = require('../../src/services/biliApi')
const serviceManager = require('../../src/services/ServiceManager')
const cacheManager = require('../../src/utils/cacheManager')

describe('biliApi new resource endpoints', function () {
    const originalSendCommand = serviceManager.sendCommand
    const originalCacheGet = cacheManager.get
    const originalCacheSet = cacheManager.set

    afterEach(function () {
        serviceManager.sendCommand = originalSendCommand
        cacheManager.get = originalCacheGet
        cacheManager.set = originalCacheSet
    })

    it('favorite_list 应调用对应 RPC', async function () {
        let call = null
        cacheManager.get = async () => null
        cacheManager.set = async () => {}
        serviceManager.sendCommand = async (endpoint, payload) => {
            call = { endpoint, payload }
            return { status: 'success', data: {} }
        }

        await biliApi.getFavoriteListInfo('123', '10001', 'video')
        assert.deepStrictEqual(call, {
            endpoint: 'favorite_list',
            payload: { media_id: '123', favorite_type: 'video', group_id: '10001' }
        })
    })

    it('channel_series 应携带 uid、series_id 与类型', async function () {
        let call = null
        cacheManager.get = async () => null
        cacheManager.set = async () => {}
        serviceManager.sendCommand = async (endpoint, payload) => {
            call = { endpoint, payload }
            return { status: 'success', data: {} }
        }

        await biliApi.getChannelSeriesInfo('42', '84', 'season', '10001')
        assert.deepStrictEqual(call, {
            endpoint: 'channel_series',
            payload: { uid: '42', series_id: '84', series_type: 'season', group_id: '10001' }
        })
    })

    it('note 与 cheese_video 应走新增 RPC', async function () {
        const calls = []
        cacheManager.get = async () => null
        cacheManager.set = async () => {}
        serviceManager.sendCommand = async (endpoint, payload) => {
            calls.push({ endpoint, payload })
            return { status: 'success', data: {} }
        }

        await biliApi.getNoteInfo('13579', '10001')
        await biliApi.getCheeseVideoInfo('24680', null, '10001')

        assert.deepStrictEqual(calls, [
            { endpoint: 'note', payload: { cvid: '13579', group_id: '10001' } },
            { endpoint: 'cheese_video', payload: { ep_id: '24680', season_id: null, group_id: '10001' } }
        ])
    })
})
