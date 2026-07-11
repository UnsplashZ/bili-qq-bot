'use strict'

const assert = require('assert')

const updateChecker = require('../../../src/services/subscription/updateChecker')
const deps = require('../../../src/services/subscription/updateChecker/adapters/deps')

describe('updateChecker bangumi disabled group state advance', function () {
    const originals = {
        getBangumiInfo: deps.biliApi.getBangumiInfo,
        updateBangumiSub: deps.subscriptionManager.updateBangumiSub,
        notifyGroupsWithImageAndCache: updateChecker.notifyGroupsWithImageAndCache,
        notifyGroups: updateChecker.notifyGroups,
        getDeliveryCoverage: deps.subscriptionDeliveryStore.getDeliveryCoverage,
        recordDeliveredBatch: deps.subscriptionDeliveryStore.recordDeliveredBatch
    }

    let delivered

    beforeEach(function () {
        delivered = new Set()
        deps.subscriptionDeliveryStore.getDeliveryCoverage = async (groupIds, type, contentId) => {
            const deliveredGroups = groupIds.filter(groupId => delivered.has(`${groupId}:${type}:${contentId}:main`))
            return {
                deliveredGroups,
                undeliveredGroups: groupIds.filter(groupId => !deliveredGroups.includes(groupId)),
                hasAnyRecord: deliveredGroups.length > 0
            }
        }
        deps.subscriptionDeliveryStore.recordDeliveredBatch = async (records) => {
            for (const record of records) {
                delivered.add(`${record.groupId}:${record.type}:${record.contentId}:${record.deliveryPart || 'main'}`)
            }
            return { changed: records.length }
        }
    })

    afterEach(function () {
        deps.biliApi.getBangumiInfo = originals.getBangumiInfo
        deps.subscriptionManager.updateBangumiSub = originals.updateBangumiSub
        updateChecker.notifyGroupsWithImageAndCache = originals.notifyGroupsWithImageAndCache
        updateChecker.notifyGroups = originals.notifyGroups
        deps.subscriptionDeliveryStore.getDeliveryCoverage = originals.getDeliveryCoverage
        deps.subscriptionDeliveryStore.recordDeliveredBatch = originals.recordDeliveredBatch
    })

    it('目标群全部关闭时应推进 lastEpId 且不要求番剧 per-group ledger', async function () {
        const notifyCalls = []
        const updates = []
        deps.biliApi.getBangumiInfo = async () => ({
            status: 'success',
            data: {
                new_ep: {
                    id: 2,
                    index_show: '第 2 话'
                }
            }
        })
        updateChecker.notifyGroupsWithImageAndCache = async (targetGroupSourceMap) => {
            notifyCalls.push(Array.from(targetGroupSourceMap.keys()))
            return {
                successGroups: [],
                failedGroups: [],
                disabledSkippedGroups: ['1000'],
                ledgerSkippedGroups: ['1000'],
                dedupKey: 'bangumi:ep2'
            }
        }
        deps.subscriptionManager.updateBangumiSub = async (seasonId, patch) => {
            updates.push({ seasonId, patch })
        }

        await updateChecker.checkBangumi({
            seasonId: '21542',
            title: 'demo bangumi',
            groupIds: ['1000'],
            lastEpId: 1
        }, ['1000'])

        assert.deepStrictEqual(notifyCalls, [['1000']])
        assert.deepStrictEqual(updates, [{
            seasonId: '21542',
            patch: { lastEpId: 2 }
        }])
    })

    it('开启群真实失败时仍不应推进番剧 lastEpId', async function () {
        const updates = []
        deps.biliApi.getBangumiInfo = async () => ({
            status: 'success',
            data: {
                new_ep: {
                    id: 2,
                    index_show: '第 2 话'
                }
            }
        })
        updateChecker.notifyGroupsWithImageAndCache = async () => ({
            successGroups: [],
            failedGroups: ['1000'],
            disabledSkippedGroups: [],
            dedupKey: 'bangumi:ep2'
        })
        deps.subscriptionManager.updateBangumiSub = async (seasonId, patch) => {
            updates.push({ seasonId, patch })
        }

        await updateChecker.checkBangumi({
            seasonId: '21542',
            title: 'demo bangumi',
            groupIds: ['1000'],
            lastEpId: 1
        }, ['1000'])

        assert.deepStrictEqual(updates, [])
    })

    it('awaits managed text fallback, records main/fallback parts, and skips already delivered targets', async function () {
        let fallbackResolve
        const fallbackResult = new Promise(resolve => { fallbackResolve = resolve })
        const updates = []
        let imageCalls = 0
        let fallbackCalls = 0
        deps.biliApi.getBangumiInfo = async () => ({
            status: 'success',
            data: { new_ep: { id: 2, index_show: '第 2 话' } }
        })
        updateChecker.notifyGroupsWithImageAndCache = async () => {
            imageCalls += 1
            throw new Error('render failed')
        }
        updateChecker.notifyGroups = async () => {
            fallbackCalls += 1
            return fallbackResult
        }
        deps.subscriptionManager.updateBangumiSub = async (seasonId, patch) => {
            updates.push({ seasonId, patch })
        }

        const firstCheck = updateChecker.checkBangumi({
            seasonId: '21542',
            title: 'demo bangumi',
            groupIds: ['1000'],
            lastEpId: 1
        }, ['1000'])
        await new Promise(resolve => setImmediate(resolve))
        assert.equal(updateChecker.operationRegistry.getResourceCounts().activeOperations, 1)
        assert.deepStrictEqual(updates, [])

        fallbackResolve({
            successGroups: ['1000'],
            failedGroups: [],
            disabledSkippedGroups: [],
            dedupSkippedGroups: []
        })
        await firstCheck
        assert.equal(updateChecker.operationRegistry.getResourceCounts().activeOperations, 0)
        assert.ok(delivered.has('1000:bangumi:2:main'))
        assert.ok(delivered.has('1000:bangumi:2:fallback-text'))
        assert.equal(updates.length, 1)

        await updateChecker.checkBangumi({
            seasonId: '21542',
            title: 'demo bangumi',
            groupIds: ['1000'],
            lastEpId: 1
        }, ['1000'])
        assert.equal(imageCalls, 1)
        assert.equal(fallbackCalls, 1)
    })
})
