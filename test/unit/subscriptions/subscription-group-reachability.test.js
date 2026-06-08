'use strict'

const assert = require('assert')

const config = require('../../../src/config')
const notifyModule = require('../../../src/services/subscription/updateChecker/modules/notify')
const videoDownloadService = require('../../../src/services/videoDownloadService')
const {
    canReceiveSubscriptionNotification,
    getSubscriptionNotificationReachability
} = require('../../../src/services/subscription/updateChecker/helpers/groupReachability')

function createSourceMap(groupIds) {
    const map = new Map()
    groupIds.forEach(gid => map.set(String(gid), new Set(['manual'])))
    return map
}

describe('subscription group reachability', function () {
    const originals = {
        groupConfigs: config.groupConfigs,
        enabledGroups: config.enabledGroups,
        isGroupEnabled: config.isGroupEnabled,
        hasDiskSpace: videoDownloadService._hasDiskSpace
    }

    beforeEach(function () {
        config.groupConfigs = {
            '1000': {
                isInGroup: false,
                videoDownloadEnabled: true
            }
        }
        config.enabledGroups = []
    })

    afterEach(function () {
        config.groupConfigs = originals.groupConfigs
        config.enabledGroups = originals.enabledGroups
        config.isGroupEnabled = originals.isGroupEnabled
        videoDownloadService._hasDiskSpace = originals.hasDiskSpace
    })

    it('退群时应判定为不可接收订阅推送', function () {
        const reachable = canReceiveSubscriptionNotification('1000')
        assert.strictEqual(reachable, false)
        assert.deepStrictEqual(getSubscriptionNotificationReachability('1000'), {
            ok: false,
            groupId: '1000',
            reason: 'not_in_group'
        })
    })

    it('关闭群功能时应分类为 group_disabled', function () {
        config.groupConfigs = {
            '1000': {
                isInGroup: true
            }
        }
        config.enabledGroups = ['2000']

        assert.deepStrictEqual(getSubscriptionNotificationReachability('1000'), {
            ok: false,
            groupId: '1000',
            reason: 'group_disabled'
        })
        assert.strictEqual(canReceiveSubscriptionNotification('1000'), false)
    })

    it('在群内且功能开启时应分类为 ok', function () {
        config.groupConfigs = {
            '1000': {
                isInGroup: true
            }
        }
        config.enabledGroups = ['1000']

        assert.deepStrictEqual(getSubscriptionNotificationReachability('1000'), {
            ok: true,
            groupId: '1000',
            reason: 'ok'
        })
    })

    it('视频扇出应跳过退群目标（即使下载开关为开）', async function () {
        videoDownloadService._hasDiskSpace = async () => {
            throw new Error('should_not_reach_disk_space_check')
        }

        await videoDownloadService.downloadAndSendToGroups(
            { readyState: 1 },
            ['1000'],
            'BV_TEST',
            { data: { duration: 60, pages: [{ duration: 60 }] } }
        )
    })

    it('图文推送应跳过退群目标', async function () {
        let sendCalled = false
        const fakeContext = {
            ws: { readyState: 1 },
            normalizeGroupSourceMap(groupTargets) {
                if (groupTargets instanceof Map) return groupTargets
                return createSourceMap(groupTargets)
            },
            getGroupIdsFromSourceMap(sourceMap) {
                return Array.from(sourceMap.keys())
            },
            resolveContentSubtype() {
                return 'video'
            },
            resolveAtAllCategory() {
                return 'video'
            },
            buildAtAllMetaForGroup() {
                return {}
            },
            async sendSubscriptionMessage() {
                sendCalled = true
            },
            mergeGroupSourceMap() {}
        }

        const result = await notifyModule.notifyGroupsWithImage.call(
            fakeContext,
            createSourceMap(['1000']),
            { status: 'success', type: 'video', data: { bvid: 'BV_TEST' } },
            'video',
            'https://www.bilibili.com/video/BV_TEST'
        )

        assert.strictEqual(sendCalled, false)
        assert.deepStrictEqual(result.successGroups, [])
        assert.deepStrictEqual(result.failedGroups, [])
        assert.deepStrictEqual(result.disabledSkippedGroups, [])
        assert.deepStrictEqual(result.ledgerSkippedGroups, ['1000'])
    })
})
