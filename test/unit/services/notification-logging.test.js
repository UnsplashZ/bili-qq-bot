#!/usr/bin/env node
'use strict'

const assert = require('assert')

const logger = require('../../../src/utils/logger')
const config = require('../../../src/config')
const biliApi = require('../../../src/services/biliApi')
const videoDownloadService = require('../../../src/services/videoDownloadService')

const originals = {
    groupConfigs: config.groupConfigs,
    videoDownloadEnabled: config.videoDownloadEnabled,
    videoDownloadResolution: config.videoDownloadResolution,
    videoDownloadMaxDuration: config.videoDownloadMaxDuration,
    downloadVideo: biliApi.downloadVideo,
    hasDiskSpace: videoDownloadService._hasDiskSpace,
    sendForwardMessage: videoDownloadService._sendForwardMessage,
    scheduleCleanup: videoDownloadService._scheduleCleanup,
    setInterval: global.setInterval,
    clearInterval: global.clearInterval
}

function restore() {
    config.groupConfigs = originals.groupConfigs
    config.videoDownloadEnabled = originals.videoDownloadEnabled
    config.videoDownloadResolution = originals.videoDownloadResolution
    config.videoDownloadMaxDuration = originals.videoDownloadMaxDuration
    biliApi.downloadVideo = originals.downloadVideo
    videoDownloadService._hasDiskSpace = originals.hasDiskSpace
    videoDownloadService._sendForwardMessage = originals.sendForwardMessage
    videoDownloadService._scheduleCleanup = originals.scheduleCleanup
    global.setInterval = originals.setInterval
    global.clearInterval = originals.clearInterval
    if (videoDownloadService._cleanupTimer) {
        videoDownloadService._cleanupTimer = null
    }
}

async function run() {
    const logs = []
    const off = logger.onLog((entry) => logs.push(entry))

    try {
        config.groupConfigs = { '1000': { videoDownloadEnabled: true } }
        config.videoDownloadEnabled = true
        config.videoDownloadResolution = '720p'
        config.videoDownloadMaxDuration = 600
        videoDownloadService._hasDiskSpace = async () => true
        videoDownloadService._sendForwardMessage = async () => true
        videoDownloadService._scheduleCleanup = () => {}
        biliApi.downloadVideo = async () => ({
            status: 'success',
            file_path: '/tmp/test.mp4',
            title: '测试视频',
            owner: 'up主',
            total_pages: 1
        })

        const result = await videoDownloadService.downloadAndSend({}, '1000', 'BV1ZHiyBkExG', {
            data: {
                title: '测试视频',
                owner: { name: 'up主' },
                duration: 120,
                pages: [{ duration: 120 }]
            }
        })

        assert.strictEqual(result.ok, true)
        assert.ok(logs.some(entry => entry.message.includes('INF SEND') && entry.message.includes('[task:') && entry.message.includes('download-start')))
        assert.ok(logs.some(entry => entry.message.includes('INF SEND') && entry.message.includes('[task:') && entry.message.includes('download-ok')))

        logs.length = 0
        biliApi.downloadVideo = async () => ({
            status: 'error',
            message: 'no_streams_available',
            errorType: 'unknown',
            failureKind: 'unknown',
            httpStatus: 200,
            retryable: false,
            endpoint: 'video_download',
            reason: 'empty_streams'
        })
        const failed = await videoDownloadService.downloadAndSend({}, '1000', 'BV1NoStream', {
            data: {
                title: '无可用流视频',
                owner: { name: 'up主' },
                duration: 120,
                pages: [{ duration: 120 }]
            }
        })

        assert.strictEqual(failed.ok, false)
        const failureLog = logs.find(entry => entry.channel === 'SEND' && entry.action === 'download-fail')
        assert.ok(failureLog, 'download failure should be logged')
        assert.strictEqual(failureLog.fields.error, 'no_streams_available')
        assert.strictEqual(failureLog.fields.errorType, 'unknown')
        assert.strictEqual(failureLog.fields.failureKind, 'unknown')
        assert.strictEqual(failureLog.fields.httpStatus, 200)
        assert.strictEqual(failureLog.fields.retryable, false)
        assert.strictEqual(failureLog.fields.reason, 'empty_streams')

        global.setInterval = () => ({ fake: true })
        global.clearInterval = () => {}
        videoDownloadService._cleanupTimer = null
        videoDownloadService.startCleanupScheduler()
        assert.ok(logs.some(entry => entry.message.includes('INF SEND') && entry.message.includes('[svc:download]') && entry.message.includes('cleanup-scheduler-started')))
        assert.ok(!logs.some(entry => entry.message.includes('[VideoDownload]')))
        assert.ok(!logs.some(entry => entry.message.includes('[NotificationService]')))
        console.log('✓ 视频下载发送链路会输出 task scope 摘要日志')
    } finally {
        off()
        restore()
    }
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
