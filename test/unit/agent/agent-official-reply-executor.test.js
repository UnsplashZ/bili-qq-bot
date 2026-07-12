#!/usr/bin/env node
'use strict'

const assert = require('assert')

const { executeReply } = require('../../../src/agent/runtime/replyExecutor')

function makeReplyInput(ws) {
    return {
        ws,
        groupId: 'group-openid',
        userId: 'member-openid',
        selfId: 'bot-appid',
        sourceMessageId: 'msg-1',
        llmDecision: {
            decision: {
                confidence: 0.9,
                replyDraft: 'hello'
            }
        },
        policyDecision: {
            accepted: true,
            wouldSend: true,
            finalAction: 'reply',
            replyDraft: 'hello',
            messageChain: [{ type: 'text', data: { text: 'hello' } }]
        },
        traceContext: {}
    }
}

describe('agent Official reply executor', () => {
    it('sends basic text replies through Official provider', async () => {
        const sent = []
        const provider = {
            id: 'official',
            readyState: 1,
            async sendGroupMessage(groupId, message) {
                sent.push({ groupId, message })
                return { status: 'ok', retcode: 0 }
            }
        }

        const result = await executeReply(makeReplyInput(provider))

        assert.equal(result.executed, true)
        assert.equal(result.reason, 'sent')
        assert.equal(sent[0].groupId, 'group-openid')
        assert.equal(sent[0].message[0].data.text, 'hello')
    })

    it('does not mark Official reply as sent when provider send fails', async () => {
        const provider = {
            id: 'official',
            readyState: 1,
            async sendGroupMessage() {
                throw new Error('send_failed')
            }
        }

        const result = await executeReply(makeReplyInput(provider))

        assert.equal(result.executed, false)
        assert.equal(result.reason, 'send_failed')
        assert.match(result.error, /send_failed/)
    })
})
