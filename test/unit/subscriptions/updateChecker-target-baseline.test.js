'use strict'

const assert = require('assert')

const updateChecker = require('../../../src/services/subscription/updateChecker')
const deps = require('../../../src/services/subscription/updateChecker/adapters/deps')

function sourceMap(groups) {
    return new Map(groups.map(groupId => [groupId, new Set(['manual'])]))
}

function baselineFor(contentType) {
    if (contentType === 'dynamic') {
        return { baselineSource: 'new_target', baselineId: '300', active: true }
    }
    if (contentType === 'video') {
        return { baselineSource: 'new_target', baselineId: 'BV300', baselineTime: 3000, active: true }
    }
    if (contentType === 'article') {
        return { baselineSource: 'new_target', baselineId: 'cv300', baselineTime: 3000, active: true }
    }
    return { baselineSource: 'new_target', baselineStatus: 1, baselineRoomId: '9000', active: true }
}

function contentFor(contentType, newer = false) {
    if (contentType === 'dynamic') {
        return { contentId: newer ? '301' : '300', contentTime: null }
    }
    if (contentType === 'video') {
        return { contentId: newer ? 'BV301' : 'BV300', contentTime: newer ? 4000 : 3000 }
    }
    if (contentType === 'article') {
        return { contentId: newer ? 'cv301' : 'cv300', contentTime: newer ? 4000 : 3000 }
    }
    return { contentId: '9000', contentTime: null }
}

describe('updateChecker target baseline ledger filter', function () {
    const originals = {
        subscriptionStateStore: deps.subscriptionStateStore,
        subscriptionDeliveryStore: deps.subscriptionDeliveryStore
    }

    afterEach(function () {
        deps.subscriptionStateStore = originals.subscriptionStateStore
        deps.subscriptionDeliveryStore = originals.subscriptionDeliveryStore
    })

    function installStateStore(contentType, targetBaseline) {
        deps.subscriptionStateStore = {
            getUserState: () => ({
                uid: '123',
                targets: {
                    A: {
                        [contentType]: { baselineSource: 'existing_target', active: true }
                    },
                    B: {
                        [contentType]: targetBaseline
                    }
                }
            }),
            getTargetBaseline: (state, groupId, type) => state.targets?.[groupId]?.[type] || null
        }
    }

    it('new_target baseline 阻止旧 dynamic/video/article/live 台账补发', async function () {
        for (const contentType of ['dynamic', 'video', 'article', 'live']) {
            installStateStore(contentType, baselineFor(contentType))
            deps.subscriptionDeliveryStore = {
                getDeliveryCoverage: async () => ({
                    deliveredGroups: ['A'],
                    undeliveredGroups: ['B'],
                    hasAnyRecord: true
                })
            }
            const content = contentFor(contentType)
            const result = await updateChecker.getUndeliveredGroupSourceMap({
                uid: '123',
                contentType,
                contentId: content.contentId,
                contentTime: content.contentTime,
                targetGroupSourceMap: sourceMap(['A', 'B'])
            })

            assert.deepStrictEqual(Array.from(result.keys()), [], contentType)
        }
    })

    it('new_target baseline 允许 baseline 后的新内容 partial retry', async function () {
        for (const contentType of ['dynamic', 'video', 'article']) {
            installStateStore(contentType, baselineFor(contentType))
            deps.subscriptionDeliveryStore = {
                getDeliveryCoverage: async () => ({
                    deliveredGroups: ['A'],
                    undeliveredGroups: ['B'],
                    hasAnyRecord: true
                })
            }
            const content = contentFor(contentType, true)
            const result = await updateChecker.getUndeliveredGroupSourceMap({
                uid: '123',
                contentType,
                contentId: content.contentId,
                contentTime: content.contentTime,
                targetGroupSourceMap: sourceMap(['A', 'B'])
            })

            assert.deepStrictEqual(Array.from(result.keys()), ['B'], contentType)
        }
    })

    it('new_target video/article 缺少可比较时间戳时不应按不同 ID 补发', async function () {
        for (const contentType of ['video', 'article']) {
            installStateStore(contentType, {
                ...baselineFor(contentType),
                baselineTime: null
            })
            deps.subscriptionDeliveryStore = {
                getDeliveryCoverage: async () => ({
                    deliveredGroups: ['A'],
                    undeliveredGroups: ['B'],
                    hasAnyRecord: true
                })
            }
            const result = await updateChecker.getUndeliveredGroupSourceMap({
                uid: '123',
                contentType,
                contentId: contentType === 'video' ? 'BV_OLDER_OR_UNKNOWN' : 'cvOlderOrUnknown',
                contentTime: null,
                targetGroupSourceMap: sourceMap(['A', 'B'])
            })

            assert.deepStrictEqual(Array.from(result.keys()), [], contentType)
        }
    })

    it('existing_target 历史台账补偿可穿透 baseline', async function () {
        for (const contentType of ['dynamic', 'video', 'article', 'live']) {
            installStateStore(contentType, {
                ...baselineFor(contentType),
                baselineSource: 'existing_target'
            })
            deps.subscriptionDeliveryStore = {
                getDeliveryCoverage: async () => ({
                    deliveredGroups: ['A'],
                    undeliveredGroups: ['B'],
                    hasAnyRecord: true
                })
            }
            const content = contentFor(contentType)
            const result = await updateChecker.getUndeliveredGroupSourceMap({
                uid: '123',
                contentType,
                contentId: content.contentId,
                contentTime: content.contentTime,
                targetGroupSourceMap: sourceMap(['A', 'B'])
            })

            assert.deepStrictEqual(Array.from(result.keys()), ['B'], contentType)
        }
    })

    it('删除期间产生的内容在重新添加为 new_target 后不应被台账补发', async function () {
        deps.subscriptionStateStore = {
            getUserState: () => ({
                uid: '123',
                targets: {
                    A: {
                        dynamic: { baselineSource: 'existing_target', active: true }
                    },
                    B: {
                        dynamic: { baselineSource: 'new_target', baselineId: '223456', active: true }
                    }
                }
            }),
            getTargetBaseline: (state, groupId, type) => state.targets?.[groupId]?.[type] || null
        }
        deps.subscriptionDeliveryStore = {
            getDeliveryCoverage: async () => ({
                deliveredGroups: ['A'],
                undeliveredGroups: ['B'],
                hasAnyRecord: true
            })
        }

        const result = await updateChecker.getUndeliveredGroupSourceMap({
            uid: '123',
            contentType: 'dynamic',
            contentId: '200000',
            targetGroupSourceMap: sourceMap(['A', 'B'])
        })

        assert.deepStrictEqual(Array.from(result.keys()), [])
    })
})
