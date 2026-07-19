#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')

const config = require('../../../src/config')
const biliApi = require('../../../src/services/biliApi')
const videoDownloadService = require('../../../src/services/videoDownloadService')
const { VideoDownloadService } = require('../../../src/services/videoDownloadService')

describe('videoDownloadService Official provider send path', () => {
    const originalBot = global.bot

    afterEach(() => {
        global.bot = originalBot
    })

    it('uses the bot-written local file path for Official media upload', async () => {
        const sent = []
        const provider = {
            id: 'official',
            readyState: 1,
            async sendGroupMessage(groupId, message) {
                sent.push({ groupId, message })
                return { status: 'ok', retcode: 0 }
            }
        }
        global.bot = {
            ws: null,
            provider
        }
        const filePath = path.join(process.cwd(), 'test/output/video-download-official.mp4')

        const ok = await videoDownloadService._sendForwardMessage(provider, 'group-openid', {
            title: 'Video',
            owner: 'Owner',
            file_path: filePath
        })

        assert.equal(ok, true)
        assert.equal(sent[0].groupId, 'group-openid')
        assert.equal(sent[0].message[1].type, 'video')
        assert.equal(sent[0].message[1].data.file, `file://${filePath}`)
    })

    it('does not report success when Official video send only used media fallback', async () => {
        const provider = {
            id: 'official',
            readyState: 1,
            async sendGroupMessage() {
                return {
                    status: 'ok',
                    retcode: 0,
                    fallbackUsed: true,
                    fallbackReason: 'video_media_send_failed'
                }
            }
        }
        global.bot = {
            ws: null,
            provider
        }

        const ok = await videoDownloadService._sendForwardMessage(provider, 'group-openid', {
            title: 'Video',
            owner: 'Owner',
            file_path: path.join(process.cwd(), 'test/output/video-download-official.mp4')
        })

        assert.equal(ok, false)
    })

    it('sends through a leased NapCat provider handle', async () => {
        const sent = []
        const provider = {
            id: 'napcat',
            readyState: 1,
            ws: {
                readyState: 1,
                send(payload) {
                    sent.push(JSON.parse(payload))
                }
            }
        }

        const ok = await videoDownloadService._sendForwardMessage(provider, '123', {
            title: 'Video',
            owner: 'Owner',
            file_path: path.join(process.cwd(), 'test/output/video-download-napcat.mp4')
        })

        assert.equal(ok, true)
        assert.equal(sent[0].action, 'send_group_msg')
        assert.equal(sent[0].params.message[1].type, 'video')
    })

    it('does not report success when the leased NapCat socket rejects the send', async () => {
        const provider = {
            id: 'napcat',
            readyState: 1,
            ws: {
                readyState: 1,
                send() {
                    throw new Error('socket write failed')
                }
            }
        }

        const ok = await videoDownloadService._sendForwardMessage(provider, '123', {
            title: 'Video',
            owner: 'Owner',
            file_path: path.join(process.cwd(), 'test/output/video-download-napcat.mp4')
        })

        assert.equal(ok, false)
    })

    it('keeps the downloaded file when video delivery fails', async () => {
        const service = new VideoDownloadService()
        const mutableConfig = config.__getMutableCompatStateForTests()
        const originalEnabled = mutableConfig.videoDownloadEnabled
        const originalDownloadVideo = biliApi.downloadVideo
        let cleanupSchedules = 0

        mutableConfig.videoDownloadEnabled = true
        biliApi.downloadVideo = async () => ({
            status: 'success',
            file_path: path.join(process.cwd(), 'test/output/video-download-retained.mp4'),
            title: 'Video',
            owner: 'Owner',
            total_pages: 1
        })
        service._hasDiskSpace = async () => true
        service._sendForwardMessage = async () => false
        service._scheduleCleanup = () => { cleanupSchedules += 1 }

        try {
            const result = await service._downloadAndSend({
                taskId: 'test-task',
                generation: 1,
                paths: service.currentPaths,
                abortSignal: null
            }, '123', 'BV1TEST', {
                data: {
                    duration: 60,
                    title: 'Video',
                    owner: { name: 'Owner' },
                    pages: [{ duration: 60 }]
                }
            })

            assert.equal(result.ok, false)
            assert.equal(result.reason, 'send_failed')
            assert.equal(cleanupSchedules, 0)
        } finally {
            mutableConfig.videoDownloadEnabled = originalEnabled
            biliApi.downloadVideo = originalDownloadVideo
            await service.cleanup()
        }
    })

    it('keeps a subscription download when every group delivery fails', async () => {
        const service = new VideoDownloadService()
        const mutableConfig = config.__getMutableCompatStateForTests()
        const originalEnabled = mutableConfig.videoDownloadEnabled
        const originalGroupConfigs = mutableConfig.groupConfigs
        const originalDownloadVideo = biliApi.downloadVideo
        let cleanupSchedules = 0

        mutableConfig.videoDownloadEnabled = true
        mutableConfig.groupConfigs = {
            ...(originalGroupConfigs || {}),
            123: { enabled: true, videoDownloadEnabled: true },
            456: { enabled: true, videoDownloadEnabled: true }
        }
        biliApi.downloadVideo = async () => ({
            status: 'success',
            file_path: path.join(process.cwd(), 'test/output/video-download-fanout-retained.mp4'),
            title: 'Video',
            owner: 'Owner',
            total_pages: 1
        })
        service._hasDiskSpace = async () => true
        service._sendForwardMessage = async () => false
        service._scheduleCleanup = () => { cleanupSchedules += 1 }

        try {
            const result = await service._downloadAndSendToGroups({
                taskId: 'test-fanout-task',
                generation: 1,
                paths: service.currentPaths,
                abortSignal: null
            }, ['123', '456'], 'BV1FANOUT', {
                data: {
                    duration: 60,
                    title: 'Video',
                    owner: { name: 'Owner' },
                    pages: [{ duration: 60 }]
                }
            })

            assert.equal(result.ok, false)
            assert.equal(result.sentGroups.length, 0)
            assert.equal(cleanupSchedules, 0)
        } finally {
            mutableConfig.videoDownloadEnabled = originalEnabled
            mutableConfig.groupConfigs = originalGroupConfigs
            biliApi.downloadVideo = originalDownloadVideo
            await service.cleanup()
        }
    })
})
