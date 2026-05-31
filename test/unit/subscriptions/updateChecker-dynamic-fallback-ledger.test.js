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

async function withFastTimers(fn) {
    const originalSetTimeout = global.setTimeout
    global.setTimeout = (cb, _ms, ...args) => {
        cb(...args)
        return 0
    }
    try {
        await fn()
    } finally {
        global.setTimeout = originalSetTimeout
    }
}

describe('updateChecker dynamic fallback delivery ledger', function () {
    const originals = {
        subscriptionStateStore: deps.subscriptionStateStore,
        subscriptionDeliveryStore: deps.subscriptionDeliveryStore,
        getUserDynamic: deps.biliApi.getUserDynamic,
        getDynamicFeed: deps.biliApi.getDynamicFeed,
        getDynamicInfo: deps.biliApi.getDynamicInfo,
        cookieFollowings: deps.subscriptionManager.cookieFollowings,
        groupToAccountMap: deps.subscriptionManager.groupToAccountMap,
        groupConfigs: JSON.parse(JSON.stringify(deps.config.groupConfigs || {})),
        notifyGroupsWithImageAndCache: updateChecker.notifyGroupsWithImageAndCache,
        notifyGroups: updateChecker.notifyGroups,
        processDynamicFeed: updateChecker.processDynamicFeed,
        processLiveFeed: updateChecker.processLiveFeed
    }

    afterEach(function () {
        deps.subscriptionStateStore = originals.subscriptionStateStore
        deps.subscriptionDeliveryStore = originals.subscriptionDeliveryStore
        deps.biliApi.getUserDynamic = originals.getUserDynamic
        deps.biliApi.getDynamicFeed = originals.getDynamicFeed
        deps.biliApi.getDynamicInfo = originals.getDynamicInfo
        deps.subscriptionManager.cookieFollowings = originals.cookieFollowings
        deps.subscriptionManager.groupToAccountMap = originals.groupToAccountMap
        const groupConfigs = deps.config.groupConfigs || {}
        for (const key of Object.keys(groupConfigs)) {
            delete groupConfigs[key]
        }
        Object.assign(groupConfigs, JSON.parse(JSON.stringify(originals.groupConfigs)))
        updateChecker.notifyGroupsWithImageAndCache = originals.notifyGroupsWithImageAndCache
        updateChecker.notifyGroups = originals.notifyGroups
        updateChecker.processDynamicFeed = originals.processDynamicFeed
        updateChecker.processLiveFeed = originals.processLiveFeed
    })

    it('feed 失败时不产生 dynamic 覆盖，manual fallback 可继续检查', async function () {
        deps.config.groupConfigs.A = {
            isInGroup: true,
            enableCookieSync: true
        }
        deps.subscriptionManager.groupToAccountMap = { A: 'acc' }
        deps.subscriptionManager.cookieFollowings = {
            acc: [{ uid: '123', name: 'tester' }]
        }
        updateChecker.processDynamicFeed = async () => ({
            ok: false,
            reason: 'dynamic_feed_fetch_failed',
            outcomes: []
        })
        updateChecker.processLiveFeed = async () => ({ ok: true, coveredUids: [] })

        const coverage = {
            dynamicUids: new Set(),
            dynamicOutcomes: new Map(),
            liveUids: new Set()
        }

        await withFastTimers(async () => {
            await updateChecker.checkFeedUpdate(coverage, new Set(['A']))
        })

        assert.strictEqual(coverage.dynamicUids.has('123'), false)
        assert.strictEqual(coverage.dynamicOutcomes.size, 0)
    })

    it('当前最新动态已到统一锚点时只重试台账缺失群', async function () {
        const notifiedTargets = []
        const recorded = []
        deps.subscriptionStateStore = {
            getUserState: async () => ({ lastDynamicId: '300' }),
            advanceDynamic: async () => {
                throw new Error('should not advance anchored retry')
            }
        }
        deps.subscriptionDeliveryStore = {
            getUndeliveredGroups: async (type, id, groups) => {
                assert.deepStrictEqual(type, ['A', 'B'])
                assert.strictEqual(id, 'dynamic')
                assert.strictEqual(groups, '300')
                return ['B']
            },
            recordDeliveredBatch: async (records) => {
                recorded.push(records)
            }
        }
        deps.biliApi.getUserDynamic = async () => ({
            status: 'success',
            data: {
                cards: [dynamicCard('300')]
            }
        })
        deps.biliApi.getDynamicInfo = async (id) => ({
            status: 'success',
            type: 'dynamic',
            data: { item: dynamicCard(id) }
        })
        updateChecker.notifyGroupsWithImageAndCache = async (targetGroupSourceMap) => {
            notifiedTargets.push(Array.from(targetGroupSourceMap.keys()))
            return { successGroups: ['B'], failedGroups: [], dedupKey: 'dynamic:300' }
        }

        await updateChecker.checkUserDynamic({
            uid: '123',
            name: 'tester',
            groupIds: ['A', 'B']
        }, ['A', 'B'])

        assert.deepStrictEqual(notifiedTargets, [['B']])
        assert.deepStrictEqual(recorded, [[{
            groupId: 'B',
            type: 'dynamic',
            contentId: '300',
            meta: { source: 'updateChecker' }
        }]])
    })

    it('legacy 锚点迁移后空台账不应把历史最新动态补发给所有群', async function () {
        const notifiedTargets = []
        deps.subscriptionStateStore = {
            getUserState: async () => ({
                uid: '123',
                dynamic: {
                    lastDynamicId: '300',
                    meta: { source: 'legacy' }
                }
            })
        }
        deps.subscriptionDeliveryStore = {
            getDeliveryCoverage: async (groups, type, contentId) => {
                assert.deepStrictEqual(groups, ['A', 'B'])
                assert.strictEqual(type, 'dynamic')
                assert.strictEqual(contentId, '300')
                return {
                    deliveredGroups: [],
                    undeliveredGroups: ['A', 'B'],
                    hasAnyRecord: false
                }
            },
            recordDeliveredBatch: async () => {
                throw new Error('empty legacy ledger must not be written')
            }
        }
        deps.biliApi.getUserDynamic = async () => ({
            status: 'success',
            data: {
                cards: [dynamicCard('300')]
            }
        })
        deps.biliApi.getDynamicInfo = async () => {
            throw new Error('should not fetch historical detail')
        }
        updateChecker.notifyGroupsWithImageAndCache = async (targetGroupSourceMap) => {
            notifiedTargets.push(Array.from(targetGroupSourceMap.keys()))
            return { successGroups: ['A', 'B'], failedGroups: [], dedupKey: 'dynamic:300' }
        }

        await updateChecker.checkUserDynamic({
            uid: '123',
            name: 'tester',
            groupIds: ['A', 'B']
        }, ['A', 'B'])

        assert.deepStrictEqual(notifiedTargets, [])
    })

    it('去重缓存命中应写入持久台账并允许推进锚点', async function () {
        const advanced = []
        const recorded = []
        deps.subscriptionStateStore = {
            getUserState: async () => ({ lastDynamicId: '200' }),
            advanceDynamic: async (_uid, dynamicId) => {
                advanced.push(dynamicId)
            }
        }
        deps.subscriptionDeliveryStore = {
            recordDeliveredBatch: async (records) => {
                recorded.push(...records)
                return { changed: records.length }
            }
        }
        deps.biliApi.getUserDynamic = async () => ({
            status: 'success',
            data: {
                cards: [dynamicCard('300')]
            }
        })
        deps.biliApi.getDynamicInfo = async (id) => ({
            status: 'success',
            type: 'dynamic',
            data: { item: dynamicCard(id) }
        })
        updateChecker.notifyGroupsWithImageAndCache = async () => ({
            successGroups: [],
            failedGroups: [],
            dedupSkippedGroups: ['A'],
            ledgerSkippedGroups: ['A'],
            dedupKey: 'dynamic:300'
        })

        await updateChecker.checkUserDynamic({
            uid: '123',
            name: 'tester',
            groupIds: ['A']
        }, ['A'])

        assert.deepStrictEqual(recorded.map(r => `${r.groupId}:${r.type}:${r.contentId}`), ['A:dynamic:300'])
        assert.deepStrictEqual(advanced, ['300'])
    })

    it('feed dynamic 统一锚点已推进后第二账号群可通过全 UID 台账缺口补发', async function () {
        const notifiedTargets = []
        const recorded = []

        deps.config.groupConfigs.A = {
            isInGroup: true,
            enableCookieSync: true
        }
        deps.config.groupConfigs.B = {
            isInGroup: true,
            enableCookieSync: true
        }
        deps.subscriptionManager.groupToAccountMap = {
            A: 'accA',
            B: 'accB'
        }
        deps.subscriptionManager.cookieFollowings = {
            accA: [{ uid: '123', uname: 'tester', lastDynamicId: '300' }],
            accB: [{ uid: '123', uname: 'tester', lastDynamicId: '100' }]
        }
        deps.subscriptionStateStore = {
            getUserState: async () => ({
                uid: '123',
                dynamic: {
                    lastDynamicId: '300',
                    meta: { source: 'updateChecker' }
                }
            }),
            advanceDynamic: async () => {
                throw new Error('anchored retry should not advance')
            }
        }
        deps.subscriptionDeliveryStore = {
            getDeliveryCoverage: async (groups, type, contentId) => {
                assert.deepStrictEqual([...groups].sort(), ['A', 'B'])
                assert.strictEqual(type, 'dynamic')
                assert.strictEqual(contentId, '300')
                return {
                    deliveredGroups: ['A'],
                    undeliveredGroups: ['B'],
                    hasAnyRecord: true
                }
            },
            recordDeliveredBatch: async (records) => {
                recorded.push(...records)
                return { changed: records.length }
            }
        }
        deps.biliApi.getDynamicFeed = async () => ({
            status: 'success',
            data: {
                items: [dynamicCard('300')],
                has_more: false,
                offset: 'end'
            }
        })
        deps.biliApi.getDynamicInfo = async (id) => ({
            status: 'success',
            type: 'dynamic',
            data: { item: dynamicCard(id) }
        })
        updateChecker.notifyGroupsWithImageAndCache = async (targetGroupSourceMap) => {
            notifiedTargets.push(Array.from(targetGroupSourceMap.keys()))
            return {
                successGroups: ['B'],
                failedGroups: [],
                dedupKey: 'dynamic:300'
            }
        }

        await updateChecker.processDynamicFeed('accB', 'B', new Set(['A', 'B']))

        assert.deepStrictEqual(notifiedTargets, [['B']])
        assert.deepStrictEqual(recorded.map(r => `${r.groupId}:${r.type}:${r.contentId}`), ['B:dynamic:300'])
    })

    it('manual dynamic 图片异常后 await 文本 fallback，成功后推进状态并写台账避免重复推', async function () {
        const state = { lastDynamicId: '200' }
        const records = []
        const advanced = []
        let imageAttempts = 0
        let fallbackAttempts = 0

        deps.subscriptionStateStore = {
            getUserState: async () => state,
            advanceDynamic: async (_uid, dynamicId) => {
                advanced.push(dynamicId)
                state.lastDynamicId = dynamicId
            }
        }
        deps.subscriptionDeliveryStore = {
            getDeliveryCoverage: async (groups, type, contentId) => {
                assert.deepStrictEqual(groups, ['A'])
                assert.strictEqual(type, 'dynamic')
                assert.strictEqual(contentId, '300')
                const deliveredGroups = records
                    .filter(record => record.type === type && record.contentId === contentId)
                    .map(record => record.groupId)
                return {
                    deliveredGroups,
                    undeliveredGroups: groups.filter(groupId => !deliveredGroups.includes(groupId)),
                    hasAnyRecord: deliveredGroups.length > 0
                }
            },
            recordDeliveredBatch: async (batch) => {
                records.push(...batch)
                return { changed: batch.length }
            }
        }
        deps.biliApi.getUserDynamic = async () => ({
            status: 'success',
            data: {
                cards: [dynamicCard('300')]
            }
        })
        deps.biliApi.getDynamicInfo = async (id) => ({
            status: 'success',
            type: 'dynamic',
            data: { item: dynamicCard(id) }
        })
        updateChecker.notifyGroupsWithImageAndCache = async () => {
            imageAttempts += 1
            throw new Error('render failed')
        }
        updateChecker.notifyGroups = async () => {
            fallbackAttempts += 1
            return {
                successGroups: ['A'],
                failedGroups: [],
                dedupKey: '300'
            }
        }

        const sub = {
            uid: '123',
            name: 'tester',
            groupIds: ['A']
        }

        await updateChecker.checkUserDynamic(sub, ['A'])
        await updateChecker.checkUserDynamic(sub, ['A'])

        assert.strictEqual(imageAttempts, 1)
        assert.strictEqual(fallbackAttempts, 1)
        assert.deepStrictEqual(advanced, ['300'])
        assert.deepStrictEqual(records.map(r => `${r.groupId}:${r.type}:${r.contentId}`), ['A:dynamic:300'])
    })
})
