#!/usr/bin/env node
'use strict'

const assert = require('assert')

const { sendPrepared } = require('../../../src/services/link/linkSender')

describe('link sender Official provider path', () => {
    it('sends prepared preview card through Official provider without NapCat file conversion', async () => {
        const sent = []
        const provider = {
            id: 'official',
            readyState: 1,
            async sendGroupMessage(groupId, message) {
                sent.push({ groupId, message })
                return { status: 'ok', retcode: 0 }
            }
        }

        await sendPrepared(provider, 'group-openid', {
            status: 'card_ready',
            base64Image: 'aGVsbG8=',
            url: 'https://www.bilibili.com/video/BV1234567890'
        })

        assert.equal(sent[0].groupId, 'group-openid')
        assert.equal(sent[0].message[0].type, 'image')
        assert.equal(sent[0].message[0].data.file, 'base64://aGVsbG8=')
        assert.equal(sent[0].message[1].data.text, 'https://www.bilibili.com/video/BV1234567890')
    })
})
