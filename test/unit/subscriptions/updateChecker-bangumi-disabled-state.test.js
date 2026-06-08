'use strict'

const assert = require('assert')

const updateChecker = require('../../../src/services/subscription/updateChecker')
const deps = require('../../../src/services/subscription/updateChecker/adapters/deps')

describe('updateChecker bangumi disabled group state advance', function () {
    const originals = {
        getBangumiInfo: deps.biliApi.getBangumiInfo,
        updateBangumiSub: deps.subscriptionManager.updateBangumiSub,
        notifyGroupsWithImageAndCache: updateChecker.notifyGroupsWithImageAndCache
    }

    afterEach(function () {
        deps.biliApi.getBangumiInfo = originals.getBangumiInfo
        deps.subscriptionManager.updateBangumiSub = originals.updateBangumiSub
        updateChecker.notifyGroupsWithImageAndCache = originals.notifyGroupsWithImageAndCache
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
})
