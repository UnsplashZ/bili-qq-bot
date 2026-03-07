'use strict'

const assert = require('assert')

const service = require('../../src/services/subscriptionUserMetaCacheService')
const biliApi = require('../../src/services/biliApi')
const storageUtils = require('../../src/utils/storageUtils')

const DEFAULT_AVATAR_URL = 'https://i0.hdslb.com/bfs/face/member/noface.jpg'

describe('subscriptionUserMetaCacheService', () => {
    let originalGetUserInfo
    let originalWrite

    beforeEach(() => {
        originalGetUserInfo = biliApi.getUserInfo
        originalWrite = storageUtils.asyncWriteWithBackup

        service.records.clear()
        service._loaded = true
        service._inFlight.clear()
        service._comparedInProcess.clear()

        storageUtils.asyncWriteWithBackup = async () => {}
    })

    afterEach(() => {
        biliApi.getUserInfo = originalGetUserInfo
        storageUtils.asyncWriteWithBackup = originalWrite
        service.records.clear()
        service._inFlight.clear()
        service._comparedInProcess.clear()
        service._loaded = false
        service._loadingPromise = null
    })

    it('falls back to the default avatar and preserves official verify metadata', async () => {
        biliApi.getUserInfo = async () => ({
            status: 'success',
            data: {
                uid: '123',
                name: 'Test UP',
                face: '',
                official_verify: {
                    type: 0,
                    desc: '个人认证'
                }
            }
        })

        const [result] = await service.enrichSubscriptions([{ uid: '123', name: 'Test UP' }], '10001')

        assert.strictEqual(result.uid, '123')
        assert.strictEqual(result.name, 'Test UP')
        assert.strictEqual(result.face, DEFAULT_AVATAR_URL)
        assert.deepStrictEqual(result.officialVerify, { type: 0, desc: '个人认证' })
    })
})
