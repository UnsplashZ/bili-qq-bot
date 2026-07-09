#!/usr/bin/env node
'use strict'

const assert = require('assert')

const messageHandler = require('../../../src/handlers/messageHandler')

describe('messageHandler official dedup key', () => {
    beforeEach(() => {
        messageHandler._processedMessageIds.clear()
    })

    it('prefers official event id', () => {
        const key = messageHandler._buildMessageDedupKey({
            official: {
                eventId: 'event-1',
                msgId: 'msg-1',
                groupOpenId: 'group-openid'
            }
        }, 'group-openid', 'user-openid', 'msg-1')

        assert.equal(key, 'official:event:event-1')
        assert.equal(messageHandler._markMessageIfNew(key), true)
        assert.equal(messageHandler._markMessageIfNew(key), false)
    })

    it('falls back to official message id and sequence', () => {
        const key = messageHandler._buildMessageDedupKey({
            official: {
                msgId: 'msg-1',
                msgSeq: 2,
                groupOpenId: 'group-openid'
            }
        }, 'group-openid', 'user-openid', 'msg-1')

        assert.equal(key, 'official:message:group-openid:msg-1:2:user-openid')
    })

    it('skips NapCat emoji reaction action under Official provider', () => {
        const sent = []
        messageHandler.sendEmojiReaction({
            id: 'official',
            readyState: 1,
            capabilities: new Set(),
            send(payload) {
                sent.push(payload)
            }
        }, 'msg-1', '128076')

        assert.equal(sent.length, 0)
    })
})
