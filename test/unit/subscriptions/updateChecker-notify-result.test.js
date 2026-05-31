'use strict'

const assert = require('assert')

const notifyModule = require('../../../src/services/subscription/updateChecker/modules/notify')
const deps = require('../../../src/services/subscription/updateChecker/adapters/deps')

const linkDomainPath = require.resolve('../../../src/services/link')

function createSourceMap(groupIds) {
    const map = new Map()
    groupIds.forEach(gid => map.set(String(gid), new Set(['manual'])))
    return map
}

describe('updateChecker notify result', function () {
    const originalLinkDomainModule = require.cache[linkDomainPath]
    const originalNotificationHas = deps.notificationHistory.has
    const originalNotificationAdd = deps.notificationHistory.add
    const originalIsGroupEnabled = deps.config.isGroupEnabled
    const originalGetGroupConfig = deps.config.getGroupConfig
    const originalGroupConfigs = deps.config.groupConfigs
    const originalPreviewLayoutConfig = deps.config.previewLayoutConfig
    const originalConfigSave = deps.config.save
    const originalIsNightMode = deps.imageGenerator.isNightMode
    const originalGeneratePreviewCard = deps.imageGenerator.generatePreviewCard

    afterEach(function () {
        if (originalLinkDomainModule) {
            require.cache[linkDomainPath] = originalLinkDomainModule
        } else {
            delete require.cache[linkDomainPath]
        }
        deps.notificationHistory.has = originalNotificationHas
        deps.notificationHistory.add = originalNotificationAdd
        deps.config.isGroupEnabled = originalIsGroupEnabled
        deps.config.getGroupConfig = originalGetGroupConfig
        deps.config.groupConfigs = originalGroupConfigs
        deps.config.save = () => {}
        deps.config.previewLayoutConfig = originalPreviewLayoutConfig
        deps.config.save = originalConfigSave
        deps.imageGenerator.isNightMode = originalIsNightMode
        deps.imageGenerator.generatePreviewCard = originalGeneratePreviewCard
    })

    it('notifyGroupsWithImageAndCache 应返回结构化结果且仅缓存成功群', async function () {
        const cached = []
        require.cache[linkDomainPath] = {
            id: linkDomainPath,
            filename: linkDomainPath,
            loaded: true,
            exports: {
                cacheResolvedText(url, groupId) {
                    cached.push({ url, groupId: String(groupId) })
                    return {
                        addedCount: 1,
                        cacheKeys: [`video|BV_TEST|${String(groupId)}`]
                    }
                }
            }
        }

        const fakeContext = {
            normalizeGroupSourceMap(groupTargets) {
                if (groupTargets instanceof Map) return groupTargets
                return createSourceMap(groupTargets)
            },
            getGroupIdsFromSourceMap(groupSourceMap) {
                return Array.from(groupSourceMap.keys())
            },
            async notifyGroupsWithImage() {
                return {
                    successGroups: ['1000'],
                    failedGroups: ['2000'],
                    dedupKey: 'video:BV_TEST'
                }
            }
        }

        const result = await notifyModule.notifyGroupsWithImageAndCache.call(
            fakeContext,
            ['1000', '2000'],
            { data: { bvid: 'BV_TEST' } },
            'video',
            'https://www.bilibili.com/video/BV_TEST',
            'test'
        )

        assert.deepStrictEqual(
            Object.keys(result).sort(),
            ['dedupKey', 'failedGroups', 'successGroups'].sort()
        )
        assert.deepStrictEqual(result.successGroups, ['1000'])
        assert.deepStrictEqual(result.failedGroups, ['2000'])
        assert.strictEqual(result.dedupKey, 'video:BV_TEST')

        assert.deepStrictEqual(cached, [
            { url: 'https://www.bilibili.com/video/BV_TEST', groupId: '1000' }
        ])
    })

    it('disableDedup=true 时应跳过去重拦截且不写入去重历史', async function () {
        let hasCalled = 0
        let addCalled = 0
        const sentGroups = []

        deps.notificationHistory.has = () => {
            hasCalled += 1
            return true
        }
        deps.notificationHistory.add = () => {
            addCalled += 1
        }
        deps.config.groupConfigs = { '1000': {} }
        deps.config.isGroupEnabled = () => true
        deps.config.getGroupConfig = (_gid, key) => {
            if (key === 'showId') return false
            if (key === 'linkCacheTimeout') return 5
            if (key === 'labelConfig') return {}
            return undefined
        }
        deps.imageGenerator.isNightMode = () => false
        deps.imageGenerator.generatePreviewCard = async () => 'FAKE_BASE64'

        const fakeContext = {
            ws: {},
            normalizeGroupSourceMap(groupTargets) {
                if (groupTargets instanceof Map) return groupTargets
                return createSourceMap(groupTargets)
            },
            getGroupIdsFromSourceMap(groupSourceMap) {
                return Array.from(groupSourceMap.keys())
            },
            resolveContentSubtype(type) {
                return type
            },
            resolveAtAllCategory(type) {
                return type
            },
            buildAtAllMetaForGroup() {
                return {}
            },
            async sendSubscriptionMessage(groupId) {
                sentGroups.push(String(groupId))
            }
        }

        const result = await notifyModule.notifyGroupsWithImage.call(
            fakeContext,
            ['1000'],
            { data: { bvid: 'BV_TEST' } },
            'video',
            'https://www.bilibili.com/video/BV_TEST',
            'test',
            { disableDedup: true }
        )

        assert.deepStrictEqual(result.successGroups, ['1000'])
        assert.deepStrictEqual(result.failedGroups, [])
        assert.strictEqual(hasCalled, 0)
        assert.strictEqual(addCalled, 0)
        assert.deepStrictEqual(sentGroups, ['1000'])
    })

    it('订阅图片批处理应按 preview layout signature 拆分不同群组覆盖', async function () {
        const generatedFor = []
        const sentGroups = []

        deps.config.save = () => {}
        deps.config.previewLayoutConfig = {
            version: 1,
            groups: {
                '2000': {
                    video: {
                        elements: {
                            cover: {
                                layout: {
                                    height: 400
                                }
                            }
                        }
                    }
                }
            }
        }
        deps.config.groupConfigs = { '1000': {}, '2000': {} }
        deps.config.isGroupEnabled = () => true
        deps.config.getGroupConfig = (_gid, key) => {
            if (key === 'showId') return true
            if (key === 'linkCacheTimeout') return 5
            if (key === 'labelConfig') return {}
            return undefined
        }
        deps.imageGenerator.isNightMode = () => false
        deps.imageGenerator.generatePreviewCard = async (_data, _type, groupId) => {
            generatedFor.push(String(groupId))
            return `FAKE_${groupId}`
        }

        const fakeContext = {
            ws: {},
            normalizeGroupSourceMap(groupTargets) {
                if (groupTargets instanceof Map) return groupTargets
                return createSourceMap(groupTargets)
            },
            getGroupIdsFromSourceMap(groupSourceMap) {
                return Array.from(groupSourceMap.keys())
            },
            resolveContentSubtype(type) {
                return type
            },
            resolveAtAllCategory(type) {
                return type
            },
            buildAtAllMetaForGroup() {
                return {}
            },
            async sendSubscriptionMessage(groupId) {
                sentGroups.push(String(groupId))
            }
        }

        const result = await notifyModule.notifyGroupsWithImage.call(
            fakeContext,
            ['1000', '2000'],
            { data: { bvid: 'BV_TEST' } },
            'video',
            'https://www.bilibili.com/video/BV_TEST',
            'test',
            { disableDedup: true }
        )

        assert.deepStrictEqual(generatedFor.sort(), ['1000', '2000'])
        assert.deepStrictEqual(result.successGroups.sort(), ['1000', '2000'])
        assert.deepStrictEqual(sentGroups.sort(), ['1000', '2000'])
    })

    it('effective layout 完全一致时订阅图片批处理仍可复用同一张图', async function () {
        const generatedFor = []
        const sentGroups = []

        deps.config.save = () => {}
        deps.config.previewLayoutConfig = {
            version: 1,
            global: {
                video: {
                    elements: {
                        cover: {
                            layout: {
                                height: 400
                            }
                        }
                    }
                }
            }
        }
        deps.config.groupConfigs = { '1000': {}, '2000': {} }
        deps.config.isGroupEnabled = () => true
        deps.config.getGroupConfig = (_gid, key) => {
            if (key === 'showId') return true
            if (key === 'linkCacheTimeout') return 5
            if (key === 'labelConfig') return {}
            return undefined
        }
        deps.imageGenerator.isNightMode = () => false
        deps.imageGenerator.generatePreviewCard = async (_data, _type, groupId) => {
            generatedFor.push(String(groupId))
            return `FAKE_${groupId}`
        }

        const fakeContext = {
            ws: {},
            normalizeGroupSourceMap(groupTargets) {
                if (groupTargets instanceof Map) return groupTargets
                return createSourceMap(groupTargets)
            },
            getGroupIdsFromSourceMap(groupSourceMap) {
                return Array.from(groupSourceMap.keys())
            },
            resolveContentSubtype(type) {
                return type
            },
            resolveAtAllCategory(type) {
                return type
            },
            buildAtAllMetaForGroup() {
                return {}
            },
            async sendSubscriptionMessage(groupId) {
                sentGroups.push(String(groupId))
            }
        }

        const result = await notifyModule.notifyGroupsWithImage.call(
            fakeContext,
            ['1000', '2000'],
            { data: { bvid: 'BV_TEST' } },
            'video',
            'https://www.bilibili.com/video/BV_TEST',
            'test',
            { disableDedup: true }
        )

        assert.deepStrictEqual(generatedFor, ['1000'])
        assert.deepStrictEqual(result.successGroups.sort(), ['1000', '2000'])
        assert.deepStrictEqual(sentGroups.sort(), ['1000', '2000'])
    })
})
