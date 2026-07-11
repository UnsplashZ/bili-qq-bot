#!/usr/bin/env node
'use strict'

const assert = require('assert')

const OfficialMessageSender = require('../../../../src/providers/qq/official/messageSender')
const OfficialMediaUploader = require('../../../../src/providers/qq/official/mediaUploader')
const QpmRateLimiter = require('../../../../src/providers/qq/official/rateLimiter')
const MessageIdStore = require('../../../../src/providers/qq/official/messageIdStore')

describe('OfficialMessageSender', () => {
    it('sends group text and stores returned message ids', async () => {
        const calls = []
        const sender = new OfficialMessageSender({
            client: {
                async sendGroupMessage(groupOpenId, body) {
                    calls.push({ groupOpenId, body })
                    return { id: 'official-msg-1' }
                }
            },
            mediaUploader: {},
            rateLimiter: new QpmRateLimiter({ accountLimit: 100, groupLimit: 100 }),
            messageIdStore: new MessageIdStore()
        })

        const result = await sender.sendGroupMessage('group-openid', 'hello')
        assert.equal(calls[0].groupOpenId, 'group-openid')
        assert.equal(calls[0].body.msg_type, 0)
        assert.equal(calls[0].body.content, 'hello')
        assert.equal(result.status, 'ok')
        assert.equal(result.data.official_message_id, 'official-msg-1')
    })

    it('passes official passive reply metadata when provided', async () => {
        const calls = []
        const sender = new OfficialMessageSender({
            client: {
                async sendGroupMessage(groupOpenId, body) {
                    calls.push({ groupOpenId, body })
                    return { id: 'reply-msg' }
                }
            },
            mediaUploader: {},
            rateLimiter: new QpmRateLimiter({ accountLimit: 100, groupLimit: 100 }),
            messageIdStore: new MessageIdStore()
        })

        await sender.sendGroupMessage('group-openid', 'reply', {
            msgId: 'incoming-msg',
            msgSeq: 3
        })

        assert.equal(calls[0].body.msg_id, 'incoming-msg')
        assert.equal(calls[0].body.msg_seq, 3)
    })

    it('uploads base64 image then sends media message', async () => {
        const uploads = []
        const sends = []
        const client = {
            async uploadGroupMedia(groupOpenId, body) {
                uploads.push({ groupOpenId, body })
                return { file_info: 'file-info' }
            },
            async sendGroupMessage(groupOpenId, body) {
                sends.push({ groupOpenId, body })
                return { id: 'media-msg' }
            }
        }
        const sender = new OfficialMessageSender({
            client,
            mediaUploader: new OfficialMediaUploader({ client, mode: 'hybrid' }),
            rateLimiter: new QpmRateLimiter({ accountLimit: 100, groupLimit: 100 }),
            messageIdStore: new MessageIdStore()
        })

        await sender.sendGroupMessage('group-openid', [
            { type: 'image', data: { file: 'base64://aGVsbG8=' } }
        ])

        assert.equal(uploads[0].body.file_type, 1)
        assert.equal(uploads[0].body.file_data, 'aGVsbG8=')
        assert.equal(sends[0].body.msg_type, 7)
        assert.deepEqual(sends[0].body.media, { file_info: 'file-info' })
    })

    it('sends private text through c2c endpoint', async () => {
        const calls = []
        const sender = new OfficialMessageSender({
            client: {
                async sendC2CMessage(userOpenId, body) {
                    calls.push({ userOpenId, body })
                    return { id: 'dm-msg' }
                }
            },
            mediaUploader: {},
            rateLimiter: new QpmRateLimiter({ accountLimit: 100, groupLimit: 100 }),
            messageIdStore: new MessageIdStore()
        })

        const result = await sender.sendPrivateMessage('user-openid', 'hello dm')

        assert.equal(calls[0].userOpenId, 'user-openid')
        assert.equal(calls[0].body.content, 'hello dm')
        assert.equal(result.data.official_message_id, 'dm-msg')
    })

    it('combines mixed text and video chain into one media message with content', async () => {
        const uploads = []
        const sends = []
        const client = {
            async uploadGroupMedia(groupOpenId, body) {
                uploads.push({ groupOpenId, body })
                return { file_info: 'video-file-info' }
            },
            async sendGroupMessage(groupOpenId, body) {
                sends.push({ groupOpenId, body })
                return { id: `msg-${sends.length}` }
            }
        }
        const sender = new OfficialMessageSender({
            client,
            mediaUploader: new OfficialMediaUploader({ client, mode: 'url_only' }),
            rateLimiter: new QpmRateLimiter({ accountLimit: 100, groupLimit: 100 }),
            messageIdStore: new MessageIdStore()
        })

        await sender.sendGroupMessage('group-openid', [
            { type: 'text', data: { text: 'before' } },
            { type: 'video', data: { file: 'https://cdn.example.com/a.mp4' } }
        ])

        assert.equal(sends.length, 1)
        assert.equal(uploads[0].body.file_type, 2)
        assert.equal(uploads[0].body.url, 'https://cdn.example.com/a.mp4')
        assert.equal(sends[0].body.msg_type, 7)
        assert.equal(sends[0].body.content, 'before')
        assert.deepEqual(sends[0].body.media, { file_info: 'video-file-info' })
    })

    it('combines passive reply text and one image without extra msg_seq', async () => {
        const uploads = []
        const sends = []
        const client = {
            async uploadGroupMedia(groupOpenId, body) {
                uploads.push({ groupOpenId, body })
                return { file_info: 'image-file-info' }
            },
            async sendGroupMessage(groupOpenId, body) {
                sends.push({ groupOpenId, body })
                return { id: `msg-${sends.length}` }
            }
        }
        const sender = new OfficialMessageSender({
            client,
            mediaUploader: new OfficialMediaUploader({ client, mode: 'url_only' }),
            rateLimiter: new QpmRateLimiter({ accountLimit: 100, groupLimit: 100 }),
            messageIdStore: new MessageIdStore()
        })

        await sender.sendGroupMessage('group-openid', [
            { type: 'text', data: { text: 'before' } },
            { type: 'image', data: { file: 'https://cdn.example.com/a.png' } },
            { type: 'text', data: { text: 'after' } }
        ], {
            msgId: 'incoming-msg',
            msgSeq: 2
        })

        assert.equal(sends.length, 1)
        assert.equal(uploads[0].body.msg_id, 'incoming-msg')
        assert.equal(uploads[0].body.event_id, undefined)
        assert.equal(sends[0].body.msg_id, 'incoming-msg')
        assert.equal(sends[0].body.msg_seq, 2)
        assert.equal(sends[0].body.msg_type, 7)
        assert.equal(sends[0].body.content, 'beforeafter')
        assert.deepEqual(sends[0].body.media, { file_info: 'image-file-info' })
    })

    it('increments passive reply msg_seq across messages when multiple media must split', async () => {
        const uploads = []
        const sends = []
        const client = {
            async uploadGroupMedia(groupOpenId, body) {
                uploads.push({ groupOpenId, body })
                return { file_info: `image-file-info-${uploads.length}` }
            },
            async sendGroupMessage(groupOpenId, body) {
                sends.push({ groupOpenId, body })
                return { id: `msg-${sends.length}` }
            }
        }
        const sender = new OfficialMessageSender({
            client,
            mediaUploader: new OfficialMediaUploader({ client, mode: 'url_only' }),
            rateLimiter: new QpmRateLimiter({ accountLimit: 100, groupLimit: 100 }),
            messageIdStore: new MessageIdStore()
        })

        await sender.sendGroupMessage('group-openid', [
            { type: 'text', data: { text: 'before' } },
            { type: 'image', data: { file: 'https://cdn.example.com/a.png' } },
            { type: 'image', data: { file: 'https://cdn.example.com/b.png' } },
            { type: 'text', data: { text: 'after' } }
        ], {
            msgId: 'incoming-msg',
            msgSeq: 2
        })

        assert.equal(sends.length, 4)
        assert.equal(sends[0].body.msg_seq, 2)
        assert.equal(sends[1].body.msg_seq, 3)
        assert.equal(sends[2].body.msg_seq, 4)
        assert.equal(sends[3].body.msg_seq, 5)
        assert.equal(uploads.length, 2)
    })

    it('falls back to text when media upload fails and preserves combined content', async () => {
        const sends = []
        const sender = new OfficialMessageSender({
            client: {
                async sendGroupMessage(groupOpenId, body) {
                    sends.push({ groupOpenId, body })
                    return { id: 'fallback-msg' }
                }
            },
            mediaUploader: {
                async upload() {
                    throw new Error('upload_failed')
                }
            },
            rateLimiter: new QpmRateLimiter({ accountLimit: 100, groupLimit: 100 }),
            messageIdStore: new MessageIdStore(),
            logger: { logEvent() {}, getErrorMessage: (error) => error.message }
        })

        await sender.sendGroupMessage('group-openid', [
            { type: 'image', data: { file: 'base64://bad' } },
            { type: 'text', data: { text: 'https://www.bilibili.com/video/BV123' } }
        ])

        assert.equal(sends.length, 1)
        assert.equal(sends[0].body.msg_type, 0)
        assert.match(sends[0].body.content, /https:\/\/www\.bilibili\.com\/video\/BV123/)
        assert.match(sends[0].body.content, /图片发送失败/)
    })

    it('marks video media fallback failures separately from image fallback', async () => {
        const sends = []
        const sender = new OfficialMessageSender({
            client: {
                async sendGroupMessage(groupOpenId, body) {
                    sends.push({ groupOpenId, body })
                    return { id: 'fallback-video-msg' }
                }
            },
            mediaUploader: {
                async upload() {
                    throw new Error('video_upload_failed')
                }
            },
            rateLimiter: new QpmRateLimiter({ accountLimit: 100, groupLimit: 100 }),
            messageIdStore: new MessageIdStore(),
            logger: { logEvent() {}, getErrorMessage: (error) => error.message }
        })

        const result = await sender.sendGroupMessage('group-openid', [
            { type: 'video', data: { file: 'https://cdn.example.com/a.mp4' } }
        ])

        assert.equal(sends.length, 1)
        assert.equal(sends[0].body.msg_type, 0)
        assert.match(sends[0].body.content, /视频发送失败/)
        assert.equal(result.fallbackUsed, true)
        assert.equal(result.fallbackReason, 'video_media_send_failed')
    })

    it('recalls group and private messages through official delete endpoints', async () => {
        const calls = []
        const store = new MessageIdStore()
        const sender = new OfficialMessageSender({
            client: {
                async recallGroupMessage(groupOpenId, messageId) {
                    calls.push({ type: 'group', groupOpenId, messageId })
                    return {}
                },
                async recallC2CMessage(userOpenId, messageId) {
                    calls.push({ type: 'private', userOpenId, messageId })
                    return {}
                }
            },
            mediaUploader: {},
            rateLimiter: new QpmRateLimiter({ accountLimit: 100, groupLimit: 100 }),
            messageIdStore: store
        })
        store.record({
            internalMessageId: 'internal-group',
            officialMessageId: 'official-group',
            targetType: 'group',
            targetId: 'group-openid'
        })
        store.record({
            internalMessageId: 'internal-private',
            officialMessageId: 'official-private',
            targetType: 'private',
            targetId: 'user-openid'
        })

        await sender.recallMessage('internal-group')
        await sender.recallMessage('internal-private')

        assert.deepEqual(calls, [
            { type: 'group', groupOpenId: 'group-openid', messageId: 'official-group' },
            { type: 'private', userOpenId: 'user-openid', messageId: 'official-private' }
        ])
    })
})
