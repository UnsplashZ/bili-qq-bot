#!/usr/bin/env node
'use strict'

const assert = require('assert')

const config = require('../../../src/config')
const messageHandler = require('../../../src/handlers/messageHandler')
const { mapOfficialEvent } = require('../../../src/providers/qq/official/eventMapper')
const imageGenerator = require('../../../src/services/imageGenerator')
const linkService = require('../../../src/services/link')

function makeOfficialMessage(rawMessage, messageId) {
    return {
        post_type: 'message',
        message_type: 'group',
        self_id: 'bot-appid',
        group_id: 'group-openid',
        user_id: 'member-openid',
        message_id: messageId,
        raw_message: rawMessage,
        message: [{ type: 'text', data: { text: rawMessage } }],
        sender: { user_id: 'member-openid', nickname: 'Alice', role: 'member' },
        official: {
            eventId: `event-${messageId}`,
            msgId: messageId,
            msgSeq: 1,
            groupOpenId: 'group-openid',
            memberOpenId: 'member-openid'
        }
    }
}

describe('messageHandler Official command flow', () => {
    const originals = {
        qqProvider: config.qqProvider,
        qqOfficialRootOpenids: config.qqOfficialRootOpenids,
        groupConfigs: config.groupConfigs,
        enabledGroups: config.enabledGroups,
        save: config.save
    }

    beforeEach(() => {
        messageHandler._processedMessageIds.clear()
        config.__getMutableCompatStateForTests().qqProvider = 'official'
        config.__getMutableCompatStateForTests().qqOfficialRootOpenids = ['member-openid']
        config.__getMutableCompatStateForTests().groupConfigs = {
            'group-openid': {
                admins: ['member-openid'],
                blacklistedQQs: []
            }
        }
        config.__getMutableCompatStateForTests().enabledGroups = []
        config.save = () => {}
    })

    afterEach(() => {
        config.__getMutableCompatStateForTests().qqProvider = originals.qqProvider
        config.__getMutableCompatStateForTests().qqOfficialRootOpenids = originals.qqOfficialRootOpenids
        config.__getMutableCompatStateForTests().groupConfigs = originals.groupConfigs
        config.__getMutableCompatStateForTests().enabledGroups = originals.enabledGroups
        config.save = originals.save
        messageHandler._processedMessageIds.clear()
    })

    it('runs settings and subscription commands through the Official provider send facade', async () => {
        const sent = []
        const provider = {
            id: 'official',
            readyState: 1,
            async sendGroupMessage(groupId, message, metadata) {
                sent.push({ groupId, message, metadata })
                return { status: 'ok', retcode: 0 }
            }
        }

        await messageHandler.handleMessage(provider, makeOfficialMessage('/设置 功能 开', 'msg-1'))
        await messageHandler.handleMessage(provider, makeOfficialMessage('/订阅用户 abc', 'msg-2'))
        await messageHandler.handleMessage(provider, makeOfficialMessage('/取消订阅用户 nobody', 'msg-3'))
        await messageHandler.handleMessage(provider, makeOfficialMessage('/查询订阅 nobody', 'msg-4'))

        const rendered = sent.map((item) => item.message?.[0]?.data?.text || '').join('\n')
        assert.ok(rendered.includes('已开启群 group-openid 的Bot权限。'))
        assert.ok(rendered.includes('使用方法: /订阅用户 <uid>'))
        assert.ok(rendered.includes('未在本群找到用户名为 "nobody" 的订阅'))
        assert.equal(sent.every((item) => item.groupId === 'group-openid'), true)
        assert.equal(sent[0].metadata.msg_id, 'msg-1')
        assert.equal(sent[0].metadata.event_id, 'event-msg-1')
    })

    it('runs the help menu command through the Official provider send facade', async () => {
        const originalGenerateHelpCard = imageGenerator.generateHelpCard
        imageGenerator.generateHelpCard = async () => 'SEVMUA=='
        const sent = []
        const provider = {
            id: 'official',
            readyState: 1,
            async sendGroupMessage(groupId, message, metadata) {
                sent.push({ groupId, message, metadata })
                return { status: 'ok', retcode: 0 }
            }
        }

        try {
            await messageHandler.handleMessage(provider, makeOfficialMessage('/菜单', 'msg-menu'))
            await new Promise(resolve => setImmediate(resolve))
        } finally {
            imageGenerator.generateHelpCard = originalGenerateHelpCard
        }

        assert.equal(sent[0].groupId, 'group-openid')
        assert.equal(sent[0].message[0].type, 'image')
        assert.equal(sent[0].message[0].data.file, 'base64://SEVMUA==')
        assert.equal(sent[0].metadata.msg_id, 'msg-menu')
    })

    it('accepts GROUP_AT commands and authorizes root by user_openid alias', async () => {
        config.__getMutableCompatStateForTests().qqOfficialRootOpenids = ['user-openid']
        config.__getMutableCompatStateForTests().groupConfigs = {
            'group-openid': {
                admins: [],
                blacklistedQQs: []
            }
        }
        const sent = []
        const provider = {
            id: 'official',
            readyState: 1,
            async sendGroupMessage(groupId, message, metadata) {
                sent.push({ groupId, message, metadata })
                return { status: 'ok', retcode: 0 }
            }
        }

        const mapped = mapOfficialEvent({
            id: 'event-at-command',
            t: 'GROUP_AT_MESSAGE_CREATE',
            d: {
                id: 'msg-at',
                group_openid: 'group-openid',
                content: '<@bot-appid> /设置 功能 开',
                msg_seq: 7,
                author: {
                    user_openid: 'user-openid',
                    member_openid: 'member-openid',
                    member_name: 'Alice',
                    role: 'member'
                }
            }
        }, { selfId: 'bot-appid' })

        await messageHandler.handleMessage(provider, mapped)

        assert.equal(mapped.raw_message, '/设置 功能 开')
        assert.ok(sent[0].message[0].data.text.includes('已开启群 group-openid 的Bot权限。'))
        assert.equal(sent[0].metadata.msg_id, 'msg-at')
        assert.equal(sent[0].metadata.msg_seq, 7)
    })

    it('routes Official inbound Bilibili links into the link pipeline', async () => {
        const originalHandleIncomingMessageLinks = linkService.handleIncomingMessageLinks
        const originalIsCached = linkService.isCached
        const handled = []
        linkService.isCached = () => false
        linkService.handleIncomingMessageLinks = async (args) => {
            handled.push(args)
            return { results: [], successCount: 1, failureCount: 0 }
        }
        const provider = {
            id: 'official',
            readyState: 1,
            async sendGroupMessage() {
                throw new Error('send should not be called by this test')
            }
        }

        try {
            await messageHandler.handleMessage(provider, makeOfficialMessage(
                'https://www.bilibili.com/video/BV1xx411c7mD',
                'msg-link'
            ))
        } finally {
            linkService.handleIncomingMessageLinks = originalHandleIncomingMessageLinks
            linkService.isCached = originalIsCached
        }

        assert.equal(handled.length, 1)
        assert.equal(handled[0].ws, provider)
        assert.equal(handled[0].groupId, 'group-openid')
        assert.equal(handled[0].messageId, 'msg-link')
        assert.equal(handled[0].descriptors[0].type, 'video')
        assert.equal(handled[0].descriptors[0].id, 'BV1xx411c7mD')
    })
})
