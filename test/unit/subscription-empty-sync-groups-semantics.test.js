'use strict'

const assert = require('assert')

const settingsCommand = require('../../src/commands/settings')
const subscriptionCommand = require('../../src/commands/subscription')
const imageGenerator = require('../../src/services/imageGenerator')
const subscriptionService = require('../../src/services/subscriptionService')
const config = require('../../src/config')

const targeting = require('../../src/services/subscription/updateChecker/modules/targeting')
const deps = require('../../src/services/subscription/updateChecker/adapters/deps')

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitFor(predicate, timeoutMs = 600, intervalMs = 20) {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
        if (predicate()) return true
        await sleep(intervalMs)
    }
    return false
}

describe('subscription empty sync groups semantics', function () {
    const originals = {
        settings: {
            isGroupAdmin: config.isGroupAdmin,
            isRootAdmin: config.isRootAdmin,
            setGroupConfig: config.setGroupConfig,
            getGroupConfig: config.getGroupConfig,
            refreshCookieFollowings: subscriptionService.refreshCookieFollowings,
            sendGroupMessage: settingsCommand.sendGroupMessage
        },
        subscription: {
            getGroupConfig: config.getGroupConfig,
            refreshCookieFollowings: subscriptionService.refreshCookieFollowings,
            getSubscriptionsByGroup: subscriptionService.getSubscriptionsByGroup,
            reloadSubscriptions: subscriptionService.reloadSubscriptions,
            getFollowingsForGroup: subscriptionService.getFollowingsForGroup,
            generateSubscriptionList: imageGenerator.generateSubscriptionList,
            sendGroupMessage: subscriptionCommand.sendGroupMessage
        },
        targeting: {
            groupToAccountMap: deps.subscriptionManager.groupToAccountMap,
            userSubs: deps.subscriptionManager.userSubs,
            getGroupConfig: deps.config.getGroupConfig
        }
    }

    afterEach(function () {
        config.isGroupAdmin = originals.settings.isGroupAdmin
        config.isRootAdmin = originals.settings.isRootAdmin
        config.setGroupConfig = originals.settings.setGroupConfig
        config.getGroupConfig = originals.settings.getGroupConfig
        subscriptionService.refreshCookieFollowings = originals.settings.refreshCookieFollowings
        settingsCommand.sendGroupMessage = originals.settings.sendGroupMessage

        subscriptionService.getSubscriptionsByGroup = originals.subscription.getSubscriptionsByGroup
        subscriptionService.reloadSubscriptions = originals.subscription.reloadSubscriptions
        subscriptionService.getFollowingsForGroup = originals.subscription.getFollowingsForGroup
        imageGenerator.generateSubscriptionList = originals.subscription.generateSubscriptionList
        subscriptionCommand.sendGroupMessage = originals.subscription.sendGroupMessage
        subscriptionCommand.groupListCmdCd.clear()

        deps.subscriptionManager.groupToAccountMap = originals.targeting.groupToAccountMap
        deps.subscriptionManager.userSubs = originals.targeting.userSubs
        deps.config.getGroupConfig = originals.targeting.getGroupConfig
    })

    it('targeting: 开启同步且空分组时应不过滤 follower', function () {
        deps.subscriptionManager.groupToAccountMap = { '1000': 'acc1' }
        deps.subscriptionManager.userSubs = []
        deps.config.getGroupConfig = (_gid, key) => {
            if (key === 'enableCookieSync') return true
            if (key === 'cookieSyncGroupNames') return []
            return null
        }

        const sourceMap = targeting.findTargetGroupSourceMapForUser('acc1', {
            uid: '123',
            name: 'tester',
            biliGroups: []
        }, new Set(['1000']))

        assert.deepStrictEqual(Array.from(sourceMap.keys()), ['1000'])
    })

    it('设置命令: 开启关注同步且空分组时应提示全量同步', async function () {
        config.isGroupAdmin = () => true
        config.isRootAdmin = () => true
        config.setGroupConfig = () => {}
        config.getGroupConfig = (_gid, key) => {
            if (key === 'cookieSyncGroupNames') return []
            return null
        }
        subscriptionService.refreshCookieFollowings = async () => {}

        const replies = []
        settingsCommand.sendGroupMessage = (_ws, _groupId, messageChain) => {
            replies.push(messageChain?.[0]?.data?.text || '')
        }

        await settingsCommand.handle({
            ws: {},
            groupId: '1000',
            userId: '42',
            rawMessage: '/设置 关注同步 开'
        })

        assert.ok(replies.some(text => text.includes('全部分组')))
    })

    it('订阅列表: 开启同步且空分组时应展示全部关注', async function () {
        config.getGroupConfig = (_gid, key) => {
            if (key === 'showId') return false
            if (key === 'enableCookieSync') return true
            if (key === 'cookieSyncGroupNames') return []
            return null
        }

        subscriptionService.refreshCookieFollowings = async () => {}
        subscriptionService.getSubscriptionsByGroup = async () => ({ users: [], bangumis: [] })
        subscriptionService.reloadSubscriptions = async () => {}
        subscriptionService.getFollowingsForGroup = async () => ([
            { uid: '1', name: 'u1', biliGroups: ['游戏'] },
            { uid: '2', name: 'u2', biliGroups: ['科技'] }
        ])

        let capturedData = null
        imageGenerator.generateSubscriptionList = async (data) => {
            capturedData = data
            return 'ZmFrZQ=='
        }

        subscriptionCommand.sendGroupMessage = () => {}

        await subscriptionCommand.handle({
            ws: {},
            groupId: 'g-sync-empty',
            userId: '42',
            rawMessage: '/订阅列表'
        })

        const ready = await waitFor(() => capturedData !== null)
        assert.strictEqual(ready, true)
        assert.ok(Array.isArray(capturedData.accountFollows))
        assert.strictEqual(capturedData.accountFollows.length, 2)
        assert.strictEqual(capturedData.accountFollowsTitle, '关注列表 - 全部分组')
    })
})
