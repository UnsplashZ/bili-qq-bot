'use strict'

const assert = require('assert')

const updateChecker = require('../../src/services/subscription/updateChecker')
const deps = require('../../src/services/subscription/updateChecker/adapters/deps')
const videoDownloadService = require('../../src/services/videoDownloadService')

describe('updateChecker unified state advance policy', function () {
    const originals = {
        getUserVideos: deps.biliApi.getUserVideos,
        getVideoInfo: deps.biliApi.getVideoInfo,
        getUserArticles: deps.biliApi.getUserArticles,
        getArticleInfo: deps.biliApi.getArticleInfo,
        normalizeGroupSourceMap: updateChecker.normalizeGroupSourceMap,
        getGroupIdsFromSourceMap: updateChecker.getGroupIdsFromSourceMap,
        notifyGroupsWithImageAndCache: updateChecker.notifyGroupsWithImageAndCache,
        updateVideoState: updateChecker.updateVideoState,
        updateArticleState: updateChecker.updateArticleState,
        downloadAndSendToGroups: videoDownloadService.downloadAndSendToGroups
    }

    afterEach(function () {
        deps.biliApi.getUserVideos = originals.getUserVideos
        deps.biliApi.getVideoInfo = originals.getVideoInfo
        deps.biliApi.getUserArticles = originals.getUserArticles
        deps.biliApi.getArticleInfo = originals.getArticleInfo
        updateChecker.normalizeGroupSourceMap = originals.normalizeGroupSourceMap
        updateChecker.getGroupIdsFromSourceMap = originals.getGroupIdsFromSourceMap
        updateChecker.notifyGroupsWithImageAndCache = originals.notifyGroupsWithImageAndCache
        updateChecker.updateVideoState = originals.updateVideoState
        updateChecker.updateArticleState = originals.updateArticleState
        videoDownloadService.downloadAndSendToGroups = originals.downloadAndSendToGroups
    })

    it('视频通知无成功群时不应推进 lastVideoId', async function () {
        deps.biliApi.getUserVideos = async () => ({
            status: 'success',
            data: {
                videos: [
                    { bvid: 'BV_NEW', created: 200 },
                    { bvid: 'BV_OLD', created: 100 }
                ]
            }
        })
        deps.biliApi.getVideoInfo = async () => ({
            status: 'success',
            data: { title: 'video title' }
        })
        updateChecker.normalizeGroupSourceMap = (groupTargets) => {
            if (groupTargets instanceof Map) return groupTargets
            const map = new Map()
            ;(groupTargets || []).forEach(gid => map.set(String(gid), new Set(['manual'])))
            return map
        }
        updateChecker.getGroupIdsFromSourceMap = (sourceMap) => Array.from(sourceMap.keys())
        updateChecker.notifyGroupsWithImageAndCache = async () => ({
            successGroups: [],
            failedGroups: ['1000'],
            dedupKey: 'video:BV_NEW'
        })
        videoDownloadService.downloadAndSendToGroups = async () => {}

        let advanced = false
        updateChecker.updateVideoState = async () => {
            advanced = true
        }

        await updateChecker.checkUserVideoUnified({
            uid: '123',
            name: 'tester',
            targetGroups: ['1000'],
            source: 'manual',
            manualSub: {
                lastVideoId: 'BV_OLD',
                lastVideoCreated: 100
            }
        })

        assert.strictEqual(advanced, false)
    })

    it('专栏通知无成功群时不应推进 lastArticleId', async function () {
        deps.biliApi.getUserArticles = async () => ({
            status: 'success',
            data: {
                articles: [
                    { id: 2, publish_time: 200 },
                    { id: 1, publish_time: 100 }
                ]
            }
        })
        deps.biliApi.getArticleInfo = async () => ({
            status: 'success',
            type: 'article',
            data: { id: 2, title: 'article title' }
        })
        updateChecker.normalizeGroupSourceMap = (groupTargets) => {
            if (groupTargets instanceof Map) return groupTargets
            const map = new Map()
            ;(groupTargets || []).forEach(gid => map.set(String(gid), new Set(['manual'])))
            return map
        }
        updateChecker.getGroupIdsFromSourceMap = (sourceMap) => Array.from(sourceMap.keys())
        updateChecker.notifyGroupsWithImageAndCache = async () => ({
            successGroups: [],
            failedGroups: ['1000'],
            dedupKey: 'article:cv2'
        })

        let advanced = false
        updateChecker.updateArticleState = async () => {
            advanced = true
        }

        await updateChecker.checkUserArticleUnified({
            uid: '123',
            name: 'tester',
            targetGroups: ['1000'],
            source: 'manual',
            manualSub: {
                lastArticleId: 'cv1',
                lastArticlePublishTime: 100
            }
        })

        assert.strictEqual(advanced, false)
    })

    it('视频检查应在首群上下文失败时回退到后续群上下文', async function () {
        const videoListCalls = []
        deps.biliApi.getUserVideos = async (_uid, groupId) => {
            videoListCalls.push(String(groupId))
            if (String(groupId) === 'g1') {
                return { status: 'error', message: 'credential invalid for g1' }
            }
            return {
                status: 'success',
                data: { videos: [{ bvid: 'BV_NEW', created: 200 }, { bvid: 'BV_OLD', created: 100 }] }
            }
        }
        deps.biliApi.getVideoInfo = async () => ({
            status: 'success',
            data: { title: 'video title' }
        })
        updateChecker.normalizeGroupSourceMap = (groupTargets) => {
            if (groupTargets instanceof Map) return groupTargets
            const map = new Map()
            ;(groupTargets || []).forEach(gid => map.set(String(gid), new Set(['manual'])))
            return map
        }
        updateChecker.getGroupIdsFromSourceMap = (sourceMap) => Array.from(sourceMap.keys())

        let notifyCalled = 0
        updateChecker.notifyGroupsWithImageAndCache = async () => {
            notifyCalled += 1
            return { successGroups: ['g2'], failedGroups: [], dedupKey: 'video:BV_NEW' }
        }
        videoDownloadService.downloadAndSendToGroups = async () => {}

        await updateChecker.checkUserVideoUnified({
            uid: '123',
            name: 'tester',
            targetGroups: ['g1', 'g2'],
            source: 'manual',
            manualSub: {
                lastVideoId: 'BV_OLD',
                lastVideoCreated: 100
            }
        })

        assert.deepStrictEqual(videoListCalls, ['g1', 'g2'])
        assert.strictEqual(notifyCalled, 1)
    })

    it('专栏检查应在首群上下文失败时回退到后续群上下文', async function () {
        const articleListCalls = []
        deps.biliApi.getUserArticles = async (_uid, groupId) => {
            articleListCalls.push(String(groupId))
            if (String(groupId) === 'g1') {
                return { status: 'error', message: 'credential invalid for g1' }
            }
            return {
                status: 'success',
                data: { articles: [{ id: 2, publish_time: 200 }, { id: 1, publish_time: 100 }] }
            }
        }
        deps.biliApi.getArticleInfo = async () => ({
            status: 'success',
            type: 'article',
            data: { id: 2, title: 'article title' }
        })
        updateChecker.normalizeGroupSourceMap = (groupTargets) => {
            if (groupTargets instanceof Map) return groupTargets
            const map = new Map()
            ;(groupTargets || []).forEach(gid => map.set(String(gid), new Set(['manual'])))
            return map
        }
        updateChecker.getGroupIdsFromSourceMap = (sourceMap) => Array.from(sourceMap.keys())

        let notifyCalled = 0
        updateChecker.notifyGroupsWithImageAndCache = async () => {
            notifyCalled += 1
            return { successGroups: ['g2'], failedGroups: [], dedupKey: 'article:cv2' }
        }

        await updateChecker.checkUserArticleUnified({
            uid: '123',
            name: 'tester',
            targetGroups: ['g1', 'g2'],
            source: 'manual',
            manualSub: {
                lastArticleId: 'cv1',
                lastArticlePublishTime: 100
            }
        })

        assert.deepStrictEqual(articleListCalls, ['g1', 'g2'])
        assert.strictEqual(notifyCalled, 1)
    })
})
