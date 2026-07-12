#!/usr/bin/env node
'use strict'

const assert = require('assert')

const { mapOfficialEvent } = require('../../../../src/providers/qq/official/eventMapper')

describe('Official event mapper', () => {
    it('maps group message events to OneBot-ish payloads', () => {
        const payload = mapOfficialEvent({
            id: 'event-1',
            t: 'GROUP_AT_MESSAGE_CREATE',
            d: {
                id: 'msg-1',
                group_openid: 'group-openid',
                content: '<@bot-appid> /菜单',
                author: {
                    member_openid: 'member-openid',
                    member_name: 'Alice',
                    role: 'member'
                }
            }
        }, { selfId: 'bot-appid' })

        assert.equal(payload.post_type, 'message')
        assert.equal(payload.message_type, 'group')
        assert.equal(payload.group_id, 'group-openid')
        assert.equal(payload.user_id, 'member-openid')
        assert.equal(payload.message_id, 'msg-1')
        assert.equal(payload.raw_message, '/菜单')
        assert.equal(payload.message[0].type, 'at')
        assert.equal(payload.message[1].data.text, '/菜单')
        assert.equal(payload.official.eventId, 'event-1')
        assert.equal(payload.official.groupOpenId, 'group-openid')
        assert.equal(payload.official.memberOpenId, 'member-openid')
        assert.equal(payload.official.userOpenId, '')
        assert.equal(payload.sender.role, 'member')
    })

    it('maps c2c messages and reachability events', () => {
        const c2c = mapOfficialEvent({
            id: 'event-2',
            t: 'C2C_MESSAGE_CREATE',
            d: {
                id: 'dm-1',
                content: 'hello',
                author: { user_openid: 'user-openid' }
            }
        }, { selfId: 'bot-appid' })
        assert.equal(c2c.message_type, 'private')
        assert.equal(c2c.user_id, 'user-openid')

        const rejected = mapOfficialEvent({
            id: 'event-3',
            t: 'GROUP_MSG_REJECT',
            d: { group_openid: 'group-openid' }
        })
        assert.equal(rejected.post_type, 'notice')
        assert.equal(rejected.notice_type, 'group_reachability')
        assert.equal(rejected.reachable, false)
    })

    it('maps full group messages without requiring an at mention', () => {
        const payload = mapOfficialEvent({
            id: 'event-full',
            t: 'GROUP_MESSAGE_CREATE',
            d: {
                id: 'msg-full',
                group_openid: 'group-openid',
                content: 'https://www.bilibili.com/video/BV1234567890',
                author: {
                    user_openid: 'user-openid',
                    member_openid: 'member-openid',
                    member_name: 'Alice'
                }
            }
        }, { selfId: 'bot-appid' })

        assert.equal(payload.post_type, 'message')
        assert.equal(payload.message_type, 'group')
        assert.equal(payload.raw_message, 'https://www.bilibili.com/video/BV1234567890')
        assert.equal(payload.message[0].type, 'text')
        assert.equal(payload.official.eventType, 'GROUP_MESSAGE_CREATE')
        assert.equal(payload.official.userOpenId, 'user-openid')
    })

    it('maps robot group membership and receive reachability events', () => {
        const joined = mapOfficialEvent({
            id: 'event-join',
            t: 'GROUP_ADD_ROBOT',
            d: { group_openid: 'group-openid' }
        }, { selfId: 'bot-appid' })
        assert.equal(joined.post_type, 'notice')
        assert.equal(joined.notice_type, 'group_increase')
        assert.equal(joined.sub_type, 'approve')
        assert.equal(joined.group_id, 'group-openid')

        const left = mapOfficialEvent({
            id: 'event-left',
            t: 'GROUP_DEL_ROBOT',
            d: { group_openid: 'group-openid' }
        }, { selfId: 'bot-appid' })
        assert.equal(left.notice_type, 'group_decrease')
        assert.equal(left.sub_type, 'kick_me')

        const receive = mapOfficialEvent({
            id: 'event-receive',
            t: 'GROUP_MSG_RECEIVE',
            d: { group_openid: 'group-openid' }
        }, { selfId: 'bot-appid' })
        assert.equal(receive.notice_type, 'group_reachability')
        assert.equal(receive.reachable, true)
        assert.equal(receive.reason, 'GROUP_MSG_RECEIVE')
    })
})
