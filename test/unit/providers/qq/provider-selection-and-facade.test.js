#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { EventEmitter } = require('events')

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

    it('routes NapCat provider handles through their WebSocket', () => {
        const sent = []
        const provider = {
            id: 'napcat',
            ws: {
                readyState: 1,
                send(payload) {
                    sent.push(JSON.parse(payload))
                }
            }
        }

        const groupResult = notificationService.sendGroupMessage(provider, 123, 'group', 'test', false)
        const privateResult = notificationService.sendPrivateMessage(provider, 456, 'private', 'test', false)

        assert.equal(groupResult.ok, true)
        assert.equal(privateResult.ok, true)
        assert.equal(sent[0].action, 'send_group_msg')
        assert.equal(sent[1].action, 'send_private_msg')
    })

    it('propagates NapCat send failures when fallback is disabled', () => {
        const provider = {
            id: 'napcat',
            ws: {
                readyState: 1,
                send() {
                    throw new Error('socket write failed')
                }
            }
        }

        assert.throws(
            () => notificationService.sendGroupMessage(provider, 123, 'group', 'test', false),
            /socket write failed/
        )
        assert.throws(
            () => notificationService.sendPrivateMessage(provider, 456, 'private', 'test', false),
            /socket write failed/
        )
    })

    it('reports NapCat fallback use instead of false success', () => {
        let sends = 0
        const provider = {
            id: 'napcat',
            ws: {
                readyState: 1,
                send() {
                    sends += 1
                    if (sends === 1) throw new Error('primary failed')
                }
            }
        }

        const result = notificationService.sendGroupMessage(provider, 123, 'group', 'test', true)

        assert.equal(sends, 2)
        assert.equal(result.ok, false)
        assert.equal(result.fallbackUsed, true)
    })

    it('settles broadcast failures for both providers', async () => {
        const napcatResults = await notificationService.notifyGroups({
            id: 'napcat',
            ws: {
                readyState: 1,
                send() {
                    throw new Error('napcat failed')
                }
            }
        }, [123], 'group', 'test')
        const officialResults = await notificationService.notifyGroups({
            id: 'official',
            async sendGroupMessage() {
                throw new Error('official failed')
            }
        }, ['group-openid'], 'group', 'test')

        assert.equal(napcatResults[0].status, 'rejected')
        assert.equal(officialResults[0].status, 'rejected')
    })

    it('routes OneBot actions through a NapCat provider handle', async () => {
        const ws = new EventEmitter()
        ws.readyState = 1
        ws.send = (raw, callback) => {
            const payload = JSON.parse(raw)
            callback?.(null)
            process.nextTick(() => ws.emit('message', JSON.stringify({
                status: 'ok',
                retcode: 0,
                echo: payload.echo,
                data: { user_id: 123 }
            })))
        }

        const response = await notificationService.callAction({ id: 'napcat', ws }, 'get_login_info')

        assert.equal(response.status, 'ok')
        assert.equal(response.data.user_id, 123)
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
