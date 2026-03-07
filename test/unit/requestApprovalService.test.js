#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')

const service = require(path.join(__dirname, '../../src/services/requestApprovalService'))
const config = require(path.join(__dirname, '../../src/config'))
const notificationService = require(path.join(__dirname, '../../src/services/notificationService'))

const originals = {
    getRootAdminQQ: config.getRootAdminQQ,
    isRootAdmin: config.isRootAdmin,
    callAction: notificationService.callAction,
    sendPrivateMessage: notificationService.sendPrivateMessage
}

function resetServiceState() {
    service.pendingByKey.clear()
    service.queue = []
    service.keyByNotifyMessageId.clear()
    service.inflightKeys.clear()
    service.recentlyHandled.clear()
}

async function run() {
    resetServiceState()

    const adminId = '10000'
    const actionCalls = []
    const infoMessages = []
    let notifyMessageId = 2000

    config.getRootAdminQQ = () => adminId
    config.isRootAdmin = (uid) => String(uid) === adminId

    notificationService.callAction = async (_ws, action, params) => {
        actionCalls.push({ action, params })

        if (action === 'send_private_msg') {
            notifyMessageId += 1
            return {
                status: 'ok',
                retcode: 0,
                data: { message_id: notifyMessageId }
            }
        }

        if (action === 'set_group_add_request' || action === 'set_friend_add_request') {
            return {
                status: 'ok',
                retcode: 0,
                data: {}
            }
        }

        return {
            status: 'failed',
            retcode: 1,
            message: 'unexpected action'
        }
    }

    notificationService.sendPrivateMessage = (_ws, _userId, message) => {
        const text = Array.isArray(message) ? message[0]?.data?.text || '' : String(message || '')
        infoMessages.push(text)
    }

    // 准备两条待审批：先 friend，再 group invite
    await service.handleRequestEvent({}, {
        post_type: 'request',
        request_type: 'friend',
        flag: 'flag_friend_1',
        user_id: '30001',
        comment: '你好'
    })

    await service.handleRequestEvent({}, {
        post_type: 'request',
        request_type: 'group',
        sub_type: 'invite',
        flag: 'flag_group_1',
        user_id: '30002',
        group_id: '90001',
        comment: '邀请你进群'
    })

    assert.strictEqual(service.pendingByKey.size, 2, '两条请求都应入队')

    // 无效引用回复不应触发审批
    const consumedInvalidReply = await service.tryHandleAdminDecision({}, {
        user_id: adminId,
        raw_message: '[CQ:reply,id=999999] 是',
        message: [{ type: 'reply', data: { id: '999999' } }, { type: 'text', data: { text: '是' } }]
    })
    assert.strictEqual(consumedInvalidReply, true, '无效引用会被消费并提示')
    const invalidReplyHandled = actionCalls.some(c =>
        c.action === 'set_group_add_request' || c.action === 'set_friend_add_request'
    )
    assert.strictEqual(invalidReplyHandled, false, '无效引用不应执行任何审批 action')

    // 引用第二条通知并回复“否” -> 必须精确命中 group invite
    const secondNotifyMessageId = String(notifyMessageId)
    const consumedByReply = await service.tryHandleAdminDecision({}, {
        user_id: adminId,
        raw_message: '[CQ:reply,id=' + secondNotifyMessageId + '] 否',
        message: [{ type: 'reply', data: { id: secondNotifyMessageId } }, { type: 'text', data: { text: '否' } }]
    })

    assert.strictEqual(consumedByReply, true, '审批消息应被消费')
    const rejectGroupCall = actionCalls.find(c =>
        c.action === 'set_group_add_request' &&
        c.params.flag === 'flag_group_1' &&
        c.params.sub_type === 'invite' &&
        c.params.approve === false
    )
    assert.ok(rejectGroupCall, '引用回复应精确拒绝 group invite 申请')
    assert.strictEqual(service.pendingByKey.size, 1, '处理后应剩余一条')

    // 不引用且不带编号回复“是” -> 不应触发审批消费（回到普通私聊链路）
    const consumedWithoutTarget = await service.tryHandleAdminDecision({}, {
        user_id: adminId,
        raw_message: '是',
        message: [{ type: 'text', data: { text: '是' } }]
    })
    assert.strictEqual(consumedWithoutTarget, false, '无引用无编号时不应消费审批消息')

    // 用编号审批 friend 申请（兜底路径）
    const pendingFriend = Array.from(service.pendingByKey.values()).find(item => item.flag === 'flag_friend_1')
    assert.ok(pendingFriend && pendingFriend.shortId, 'friend 待审批项应具备 shortId')
    const consumedByShortId = await service.tryHandleAdminDecision({}, {
        user_id: adminId,
        raw_message: `是 ${pendingFriend.shortId}`,
        message: [{ type: 'text', data: { text: `是 ${pendingFriend.shortId}` } }]
    })
    assert.strictEqual(consumedByShortId, true, '编号审批应被消费')

    const approveFriendCall = actionCalls.find(c =>
        c.action === 'set_friend_add_request' &&
        c.params.flag === 'flag_friend_1' &&
        c.params.approve === true
    )
    assert.ok(approveFriendCall, '应通过 shortId 同意剩余 friend 申请')
    assert.strictEqual(service.pendingByKey.size, 0, '所有请求应处理完毕')

    // 非审批文本不应被消费
    const ignored = await service.tryHandleAdminDecision({}, {
        user_id: adminId,
        raw_message: '收到',
        message: [{ type: 'text', data: { text: '收到' } }]
    })
    assert.strictEqual(ignored, false, '非是/否文本不应触发审批消费')

    console.log('✅ RequestApprovalService tests passed')
    if (infoMessages.length === 0) {
        console.log('ℹ️ no fallback private messages were needed')
    }
}

run()
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
    .finally(() => {
        resetServiceState()
        config.getRootAdminQQ = originals.getRootAdminQQ
        config.isRootAdmin = originals.isRootAdmin
        notificationService.callAction = originals.callAction
        notificationService.sendPrivateMessage = originals.sendPrivateMessage
    })
