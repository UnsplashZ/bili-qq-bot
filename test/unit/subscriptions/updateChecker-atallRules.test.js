'use strict'

const assert = require('assert')

const updateChecker = require('../../../src/services/subscription/updateChecker')
const notificationService = require('../../../src/services/notificationService')
const config = require('../../../src/config')

const originals = {
    queryGroupAtAllCapability: updateChecker.queryGroupAtAllCapability,
    callAction: notificationService.callAction,
    processMessageChain: notificationService.processMessageChain,
    ws: updateChecker.ws,
}

const originalGroupConfigs = JSON.parse(JSON.stringify(config.groupConfigs || {}))

function overwriteGroupConfigs(next) {
    const groupConfigs = config.groupConfigs || {}
    for (const key of Object.keys(groupConfigs)) {
        delete groupConfigs[key]
    }
    Object.assign(groupConfigs, next)
}

function restoreAll() {
    updateChecker.queryGroupAtAllCapability = originals.queryGroupAtAllCapability
    notificationService.callAction = originals.callAction
    notificationService.processMessageChain = originals.processMessageChain
    updateChecker.ws = originals.ws

    updateChecker.groupAtAllCapabilityCache.clear()
    updateChecker.groupAtAllCapabilityInFlight.clear()

    overwriteGroupConfigs(originalGroupConfigs)
}

function buildGroupConfig(rulesPatch = {}) {
    const rules = config.createDefaultSubscriptionAtAllRules()
    const merged = {
        ...rules,
        ...rulesPatch,
        sources: {
            ...rules.sources,
            ...(rulesPatch.sources || {})
        },
        categories: {
            ...rules.categories,
            ...(rulesPatch.categories || {})
        }
    }
    return {
        isInGroup: true,
        subscriptionAtAll: true,
        subscriptionAtAllRules: merged
    }
}

describe('UpdateChecker @all 细粒度规则', function () {
    beforeEach(function () {
        restoreAll()
        updateChecker.setWs({ readyState: 1 })
    })

    after(function () {
        restoreAll()
    })

    it('source 关闭时不应命中 @all', function () {
        overwriteGroupConfigs({
            '4000': buildGroupConfig({
                sources: { manual: false, cookieSync: true }
            })
        })

        const result = updateChecker.shouldAtAll('4000', {
            sources: ['manual'],
            category: 'video',
            actorUid: '123'
        })
        assert.strictEqual(result, false)
    })

    it('category 关闭时不应命中 @all', function () {
        overwriteGroupConfigs({
            '4001': buildGroupConfig({
                categories: { video: false }
            })
        })

        const result = updateChecker.shouldAtAll('4001', {
            sources: ['manual'],
            category: 'video',
            actorUid: '123'
        })
        assert.strictEqual(result, false)
    })

    it('manual UID 被关闭，但 cookieSync 命中时应允许 @all', function () {
        overwriteGroupConfigs({
            '4002': buildGroupConfig({
                manualDisabledIds: ['123'],
                cookieSyncDisabledIds: []
            })
        })

        const result = updateChecker.shouldAtAll('4002', {
            sources: ['manual', 'cookieSync'],
            category: 'dynamic',
            actorUid: '123'
        })
        assert.strictEqual(result, true)
    })

    it('source=both 且两侧 UID 都关闭时不应命中 @all', function () {
        overwriteGroupConfigs({
            '4003': buildGroupConfig({
                manualDisabledIds: ['123'],
                cookieSyncDisabledIds: ['123']
            })
        })

        const result = updateChecker.shouldAtAll('4003', {
            sources: ['manual', 'cookieSync'],
            category: 'dynamic',
            actorUid: '123'
        })
        assert.strictEqual(result, false)
    })

    it('sendSubscriptionMessage 在规则不命中时不拼接 @all', async function () {
        overwriteGroupConfigs({
            '5000': buildGroupConfig({
                categories: { video: false }
            })
        })

        const sentChains = []
        updateChecker.queryGroupAtAllCapability = async () => ({
            canAtAll: true,
            reason: 'ok',
            retcode: 0,
            expiresAt: Date.now() + 1000
        })
        notificationService.processMessageChain = (message) => message
        notificationService.callAction = async (_ws, action, params) => {
            assert.strictEqual(action, 'send_group_msg')
            sentChains.push(params.message)
            return { status: 'ok', retcode: 0 }
        }

        await updateChecker.sendSubscriptionMessage(
            '5000',
            [{ type: 'text', data: { text: 'hello' } }],
            { sources: ['manual'], category: 'video', actorUid: '123' }
        )

        assert.strictEqual(sentChains.length, 1)
        assert.strictEqual(sentChains[0][0].type, 'text')
    })

    it('sendSubscriptionMessage 在规则命中时拼接 @all', async function () {
        overwriteGroupConfigs({
            '5001': buildGroupConfig({})
        })

        const sentChains = []
        updateChecker.queryGroupAtAllCapability = async () => ({
            canAtAll: true,
            reason: 'ok',
            retcode: 0,
            expiresAt: Date.now() + 1000
        })
        notificationService.processMessageChain = (message) => message
        notificationService.callAction = async (_ws, action, params) => {
            assert.strictEqual(action, 'send_group_msg')
            sentChains.push(params.message)
            return { status: 'ok', retcode: 0 }
        }

        await updateChecker.sendSubscriptionMessage(
            '5001',
            [{ type: 'text', data: { text: 'hello' } }],
            { sources: ['manual'], category: 'video', actorUid: '123' }
        )

        assert.strictEqual(sentChains.length, 1)
        assert.strictEqual(sentChains[0][0].type, 'at')
        assert.strictEqual(String(sentChains[0][0].data.qq), 'all')
    })
})
