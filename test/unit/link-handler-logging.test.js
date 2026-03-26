'use strict'

const assert = require('assert')

const logger = require('../../src/utils/logger')
const linkHandler = require('../../src/handlers/linkHandler')
const biliApi = require('../../src/services/biliApi')
const imageGenerator = require('../../src/services/imageGenerator')
const cacheManager = require('../../src/utils/cacheManager')
const notificationService = require('../../src/services/notificationService')
const config = require('../../src/config')

const originals = {
    getVideoInfo: biliApi.getVideoInfo,
    getBangumiInfo: biliApi.getBangumiInfo,
    generatePreviewCard: imageGenerator.generatePreviewCard,
    downloadAndSend: null,
    cacheGet: cacheManager.get,
    cacheSet: cacheManager.set,
    sendGroupMessage: linkHandler.sendGroupMessage,
    sendGroupMessageWithFallback: linkHandler.sendGroupMessageWithFallback,
    notificationSendGroup: notificationService.sendGroupMessage,
    notificationSendPrivate: notificationService.sendPrivateMessage,
    getGroupConfig: config.getGroupConfig
}

function restore() {
    biliApi.getVideoInfo = originals.getVideoInfo
    biliApi.getBangumiInfo = originals.getBangumiInfo
    imageGenerator.generatePreviewCard = originals.generatePreviewCard
    cacheManager.get = originals.cacheGet
    cacheManager.set = originals.cacheSet
    linkHandler.sendGroupMessage = originals.sendGroupMessage
    linkHandler.sendGroupMessageWithFallback = originals.sendGroupMessageWithFallback
    notificationService.sendGroupMessage = originals.notificationSendGroup
    notificationService.sendPrivateMessage = originals.notificationSendPrivate
    config.getGroupConfig = originals.getGroupConfig
}

describe('linkHandler logging summary', function () {
    it('输出 extract/fetch-start/card-ready/fallback-text/item-failed 摘要日志', async function () {
        const logs = []
        const off = logger.onLog((entry) => logs.push(entry.message))

        try {
            cacheManager.get = async () => null
            cacheManager.set = async () => {}
            config.getGroupConfig = () => null

            const fakeDownloadService = require('../../src/services/videoDownloadService')
            originals.downloadAndSend = fakeDownloadService.downloadAndSend
            fakeDownloadService.downloadAndSend = async () => {}

            const links = linkHandler.extractLinks('https://www.bilibili.com/video/BV1ZHiyBkExG/', '1000', { scope: 'msg:1000:2:555' })
            assert.ok(links.some(link => link.type === 'video'))

            biliApi.getVideoInfo = async () => ({ status: 'success', data: { title: 'test' } })
            imageGenerator.generatePreviewCard = async () => 'ZmFrZQ=='
            linkHandler.sendGroupMessageWithFallback = async () => {}
            linkHandler.sendGroupMessage = async () => {}
            notificationService.sendPrivateMessage = async () => {}

            await linkHandler.processSingleLink({
                type: 'video',
                id: 'BV1ZHiyBkExG',
                cacheKey: 'video|BV1ZHiyBkExG|1000',
                match: 'https://www.bilibili.com/video/BV1ZHiyBkExG/'
            }, {}, '1000', '2', { scope: 'msg:1000:2:555' })

            imageGenerator.generatePreviewCard = async () => { throw new Error('render failed') }
            await linkHandler.processSingleLink({
                type: 'video',
                id: 'BV1ZHiyBkExG',
                cacheKey: 'video|BV1ZHiyBkExG|1000',
                match: 'https://www.bilibili.com/video/BV1ZHiyBkExG/'
            }, {}, '1000', '2', { scope: 'msg:1000:2:555' })

            biliApi.getVideoInfo = async () => ({ status: 'error', message: 'fetch failed' })
            await linkHandler.processSingleLink({
                type: 'video',
                id: 'BV1fetchfail',
                cacheKey: 'video|BV1fetchfail|1000',
                match: 'https://www.bilibili.com/video/BV1fetchfail/'
            }, {}, '1000', '2', { scope: 'msg:1000:2:555' })

            biliApi.getBangumiInfo = async () => ({ status: 'success', data: { title: 'bangumi' } })
            imageGenerator.generatePreviewCard = async () => 'ZmFrZQ=='
            await linkHandler.processSingleLink({
                type: 'bangumi',
                id: '21542',
                cacheKey: 'bangumi|21542|1000',
                match: 'https://www.bilibili.com/bangumi/play/ss21542'
            }, {}, '1000', '2', { scope: 'msg:1000:2:555' })

            assert.ok(logs.some(line => line.includes('INF LINK') && line.includes('[msg:1000:2:555]') && line.includes('extract')))
            assert.ok(logs.some(line => line.includes('INF LINK') && line.includes('[msg:1000:2:555]') && line.includes('fetch-start')))
            assert.ok(logs.some(line => line.includes('INF LINK') && line.includes('[msg:1000:2:555]') && line.includes('card-ready')))
            assert.ok(logs.some(line => line.includes('WRN LINK') && line.includes('[msg:1000:2:555]') && line.includes('fallback-text')))
            assert.ok(logs.some(line => line.includes('ERR LINK') && line.includes('[msg:1000:2:555]') && line.includes('item-failed') && line.includes('reason=fetch_failed')))
            assert.ok(!logs.some(line => line.includes('[LinkHandler]')))
        } finally {
            const fakeDownloadService = require('../../src/services/videoDownloadService')
            if (originals.downloadAndSend) fakeDownloadService.downloadAndSend = originals.downloadAndSend
            off()
            restore()
        }
    })
})
