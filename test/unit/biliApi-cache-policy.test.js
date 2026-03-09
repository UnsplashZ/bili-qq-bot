'use strict'

const assert = require('assert')

const biliApi = require('../../src/services/biliApi')
const cacheManager = require('../../src/utils/cacheManager')
const serviceManager = require('../../src/services/ServiceManager')

describe('biliApi cache policy', function () {
    const originals = {
        cacheGet: cacheManager.get,
        cacheSet: cacheManager.set,
        sendCommand: serviceManager.sendCommand
    }

    afterEach(function () {
        cacheManager.get = originals.cacheGet
        cacheManager.set = originals.cacheSet
        serviceManager.sendCommand = originals.sendCommand
    })

    it('cached 策略允许直接命中缓存', async function () {
        let sendCalls = 0

        cacheManager.get = async () => ({
            status: 'success',
            data: { name: 'cached-user' }
        })
        cacheManager.set = async () => {
            throw new Error('should not write cache when cache hit')
        }
        serviceManager.sendCommand = async () => {
            sendCalls += 1
            return { status: 'success', data: { name: 'fresh-user' } }
        }

        const result = await biliApi.getUserInfo('123', '1000', 'cached')
        assert.deepStrictEqual(result, {
            status: 'success',
            data: { name: 'cached-user' }
        })
        assert.strictEqual(sendCalls, 0)
    })

    it('fresh 策略应绕过缓存读取并在成功后回写缓存', async function () {
        let cacheGetCalls = 0
        let sendCalls = 0
        let cacheSetPayload = null

        cacheManager.get = async () => {
            cacheGetCalls += 1
            return {
                status: 'success',
                data: { name: 'stale-user' }
            }
        }
        cacheManager.set = async (_key, data) => {
            cacheSetPayload = data
        }
        serviceManager.sendCommand = async () => {
            sendCalls += 1
            return {
                status: 'success',
                data: { name: 'fresh-user' }
            }
        }

        const result = await biliApi.getUserInfo('123', '1000', 'fresh')
        assert.deepStrictEqual(result, {
            status: 'success',
            data: { name: 'fresh-user' }
        })
        assert.strictEqual(cacheGetCalls, 0)
        assert.strictEqual(sendCalls, 1)
        assert.deepStrictEqual(cacheSetPayload, {
            status: 'success',
            data: { name: 'fresh-user' }
        })
    })
})
