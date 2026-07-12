#!/usr/bin/env node
'use strict'

const assert = require('assert')

const { createQqProvider, normalizeProviderName } = require('../../../../src/providers/qq/providerFactory')
const qqRuntime = require('../../../../src/providers/qq/runtime')
const notificationService = require('../../../../src/services/notificationService')

describe('QQ provider selection and notification facade', () => {
    afterEach(() => {
        qqRuntime.clearCurrentProvider()
    })

    it('defaults to napcat and creates official on request', () => {
        assert.equal(normalizeProviderName('onebot'), 'napcat')
        assert.equal(normalizeProviderName('official'), 'official')
        assert.equal(createQqProvider({ provider: 'napcat' }).id, 'napcat')
    })

    it('routes official sends without converting base64 to NapCat file urls', async () => {
        const sent = []
        const provider = {
            id: 'official',
            readyState: 1,
            async sendGroupMessage(groupId, message, metadata) {
                sent.push({ groupId, message, metadata })
                return { status: 'ok', retcode: 0 }
            }
        }
        qqRuntime.setCurrentProvider(provider)

        await notificationService.runWithSendContext({
            official: {
                msg_id: 'incoming-msg',
                msg_seq: 5
            }
        }, () => notificationService.sendGroupMessage(null, 'group-openid', [
            { type: 'image', data: { file: 'base64://aGVsbG8=' } }
        ], 'test', false))

        assert.equal(sent[0].groupId, 'group-openid')
        assert.equal(sent[0].message[0].data.file, 'base64://aGVsbG8=')
        assert.equal(sent[0].metadata.msg_id, 'incoming-msg')
        assert.equal(sent[0].metadata.msg_seq, 5)
    })

    it('keeps NapCat send payload compatible', () => {
        const sent = []
        const ws = {
            readyState: 1,
            send(payload) {
                sent.push(JSON.parse(payload))
            },
            on() {}
        }

        notificationService.sendGroupMessage(ws, 123, [
            { type: 'text', data: { text: 'hello' } }
        ], 'test', false)
        notificationService.sendPrivateMessage(ws, 456, 'hi', 'test', false)

        assert.deepEqual(sent[0], {
            action: 'send_group_msg',
            params: {
                group_id: 123,
                message: [{ type: 'text', data: { text: 'hello' } }]
            }
        })
        assert.deepEqual(sent[1], {
            action: 'send_private_msg',
            params: {
                user_id: 456,
                message: [{ type: 'text', data: { text: 'hi' } }]
            }
        })
    })

    it('returns structured unsupported action failures under Official provider', async () => {
        const provider = createQqProvider({
            provider: 'official',
            config: {
                qqOfficialAppId: 'app',
                qqOfficialClientSecret: 'secret',
                qqOfficialTokenUrl: 'https://token.example.com',
                qqOfficialApiBase: 'https://api.example.com',
                qqOfficialAccountQpm: 100,
                qqOfficialGroupQpm: 100,
                qqOfficialQueueMaxSize: 10,
                qqOfficialMediaUploadMode: 'hybrid',
                qqOfficialUseShardedGateway: true,
                qqOfficialIntents: 33554432,
                napcatTempPath: '/tmp'
            },
            fetchImpl: async () => ({ ok: true, text: async () => '{}' })
        })

        const result = await provider.callAction('set_group_ban', { group_id: 'g' })

        assert.equal(result.status, 'failed')
        assert.equal(result.retcode, -1)
        assert.match(result.message, /unsupported_official_action:set_group_ban/)
    })
})
