'use strict'

const assert = require('assert')

const updateChecker = require('../../../src/services/subscription/updateChecker')
const deps = require('../../../src/services/subscription/updateChecker/adapters/deps')

function dynamicCard(id) {
    return {
        id_str: String(id),
        modules: {
            module_author: {
                mid: '123',
                name: 'tester'
            },
            module_dynamic: {}
        }
    }
}

describe('updateChecker unified subscription state', function () {
    const originals = {
        subscriptionStateStore: deps.subscriptionStateStore,
        subscriptionDeliveryStore: deps.subscriptionDeliveryStore,
        getUserDynamic: deps.biliApi.getUserDynamic,
        getDynamicInfo: deps.biliApi.getDynamicInfo,
        updateUserSub: deps.subscriptionManager.updateUserSub,
        notifyGroupsWithImageAndCache: updateChecker.notifyGroupsWithImageAndCache
    }

    afterEach(function () {
        deps.subscriptionStateStore = originals.subscriptionStateStore
        deps.subscriptionDeliveryStore = originals.subscriptionDeliveryStore
        deps.biliApi.getUserDynamic = originals.getUserDynamic
        deps.biliApi.getDynamicInfo = originals.getDynamicInfo
        deps.subscriptionManager.updateUserSub = originals.updateUserSub
        updateChecker.notifyGroupsWithImageAndCache = originals.notifyGroupsWithImageAndCache
    })

    it('双来源旧 manual 动态锚点落后时不按旧锚点重推', async function () {
        deps.subscriptionStateStore = {
            getUserState: async () => ({ lastDynamicId: '300' }),
            advanceDynamic: async () => {
                throw new Error('should not advance')
            }
        }
        deps.subscriptionDeliveryStore = {
            getUndeliveredGroups: async () => []
        }
        deps.biliApi.getUserDynamic = async () => ({
            status: 'success',
            data: {
                cards: [dynamicCard('200'), dynamicCard('100')]
            }
        })
        deps.biliApi.getDynamicInfo = async () => {
            throw new Error('should not fetch detail')
        }
        deps.subscriptionManager.updateUserSub = async () => {
            throw new Error('should not write legacy manual state')
        }
        updateChecker.notifyGroupsWithImageAndCache = async () => {
            throw new Error('should not notify')
        }

        await updateChecker.checkUserDynamic({
            uid: '123',
            name: 'tester',
            groupIds: ['A'],
            lastDynamicId: '100'
        }, ['A'])
    })

    it('纯手动多候选动态只推最新一条并推进统一锚点到最新', async function () {
        const advanced = []
        const notified = []
        deps.subscriptionStateStore = {
            getUserState: async () => ({ lastDynamicId: '100' }),
            advanceDynamic: async (uid, patch) => {
                advanced.push({ uid, patch })
            }
        }
        deps.subscriptionDeliveryStore = {
            recordDeliveredBatch: async () => {}
        }
        deps.biliApi.getUserDynamic = async () => ({
            status: 'success',
            data: {
                cards: [dynamicCard('300'), dynamicCard('200'), dynamicCard('100')]
            }
        })
        deps.biliApi.getDynamicInfo = async (id) => ({
            status: 'success',
            type: 'dynamic',
            data: { item: dynamicCard(id) }
        })
        updateChecker.notifyGroupsWithImageAndCache = async (_targets, _info, _type, url) => {
            notified.push(url)
            return { successGroups: ['A'], failedGroups: [], dedupKey: 'dynamic:300' }
        }

        await updateChecker.checkUserDynamic({
            uid: '123',
            name: 'tester',
            groupIds: ['A']
        }, ['A'])

        assert.deepStrictEqual(notified, ['https://t.bilibili.com/300'])
        assert.strictEqual(advanced.length, 1)
        assert.strictEqual(advanced[0].uid, '123')
        assert.strictEqual(advanced[0].patch, '300')
    })

    it('取关后重关注不清空统一动态状态，也不按空旧字段初始化覆盖', async function () {
        const advanced = []
        deps.subscriptionStateStore = {
            getUserState: async () => ({ lastDynamicId: '300' }),
            advanceDynamic: async (uid, patch) => {
                advanced.push({ uid, patch })
            }
        }
        deps.subscriptionDeliveryStore = {
            getUndeliveredGroups: async () => []
        }
        deps.biliApi.getUserDynamic = async () => ({
            status: 'success',
            data: {
                cards: [dynamicCard('300')]
            }
        })
        updateChecker.notifyGroupsWithImageAndCache = async () => {
            throw new Error('should not notify')
        }

        await updateChecker.checkUserDynamic({
            uid: '123',
            name: 'tester',
            groupIds: ['A'],
            lastDynamicId: null
        }, ['A'])

        assert.deepStrictEqual(advanced, [])
    })
})
