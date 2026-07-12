#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')

const videoDownloadService = require('../../../src/services/videoDownloadService')

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
})
