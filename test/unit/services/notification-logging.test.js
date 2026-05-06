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
    const off = logger.onLog((entry) => logs.push(entry.message))

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
        assert.ok(logs.some(line => line.includes('INF SEND') && line.includes('[task:') && line.includes('download-start')))
        assert.ok(logs.some(line => line.includes('INF SEND') && line.includes('[task:') && line.includes('download-ok')))

        global.setInterval = () => ({ fake: true })
        global.clearInterval = () => {}
        videoDownloadService._cleanupTimer = null
        videoDownloadService.startCleanupScheduler()
        assert.ok(logs.some(line => line.includes('INF SEND') && line.includes('[svc:download]') && line.includes('cleanup-scheduler-started')))
        assert.ok(!logs.some(line => line.includes('[VideoDownload]')))
        assert.ok(!logs.some(line => line.includes('[NotificationService]')))
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
