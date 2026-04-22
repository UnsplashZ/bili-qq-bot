const assert = require('assert')

const biliApi = require('../../src/services/biliApi')
const serviceManager = require('../../src/services/ServiceManager')

describe('biliApi.searchUsers wiring', function () {
    const originalSendCommand = serviceManager.sendCommand

    afterEach(function () {
        serviceManager.sendCommand = originalSendCommand
    })

    it('should send user_search with page_size and group_id and preserve response shape', async function () {
        const expectedResponse = {
            status: 'success',
            type: 'user_search',
            data: {
                query: '测试UP',
                page: 1,
                page_size: 7,
                total: 1,
                candidates: [{ uid: '42', name: '测试UP官方' }]
            }
        }

        serviceManager.sendCommand = async (endpoint, payload) => {
            assert.strictEqual(endpoint, 'user_search')
            assert.deepStrictEqual(payload, {
                keyword: '测试UP',
                page: 1,
                page_size: 7,
                group_id: '1000'
            })
            return expectedResponse
        }

        const result = await biliApi.searchUsers('测试UP', '1000', { pageSize: 7 })

        assert.strictEqual(result, expectedResponse)
    })
})
