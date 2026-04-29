'use strict'

const assert = require('assert')

const settingsCommand = require('../../../src/commands/settings')
const config = require('../../../src/config')
const subscriptionService = require('../../../src/services/subscriptionService')

describe('settings subscription interval validation', function () {
    const originals = {
        isGroupAdmin: config.isGroupAdmin,
        isRootAdmin: config.isRootAdmin,
        updateCheckInterval: subscriptionService.updateCheckInterval,
        sendGroupMessage: settingsCommand.sendGroupMessage
    }

    afterEach(function () {
        config.isGroupAdmin = originals.isGroupAdmin
        config.isRootAdmin = originals.isRootAdmin
        subscriptionService.updateCheckInterval = originals.updateCheckInterval
        settingsCommand.sendGroupMessage = originals.sendGroupMessage
    })

    it('应拒绝 0 和负数轮询值，且不触发更新', async function () {
        config.isGroupAdmin = () => true
        config.isRootAdmin = () => true

        let updateCalled = 0
        subscriptionService.updateCheckInterval = () => {
            updateCalled += 1
        }

        const replies = []
        settingsCommand.sendGroupMessage = (_ws, _groupId, messageChain) => {
            replies.push(messageChain?.[0]?.data?.text || '')
        }

        await settingsCommand.handle({
            ws: {},
            groupId: '1000',
            userId: '42',
            rawMessage: '/设置 轮询 0'
        })
        await settingsCommand.handle({
            ws: {},
            groupId: '1000',
            userId: '42',
            rawMessage: '/设置 轮询 -1'
        })

        assert.strictEqual(updateCalled, 0)
        assert.ok(replies.every(text => text.includes('请输入有效的正整数秒数')))
    })
})
