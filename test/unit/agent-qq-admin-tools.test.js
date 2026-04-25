#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')

const config = require(path.join(__dirname, '../../src/config'))
const notificationService = require(path.join(__dirname, '../../src/services/notificationService'))
const requestApprovalService = require(path.join(__dirname, '../../src/services/requestApprovalService'))
const qqGroupAdminService = require(path.join(__dirname, '../../src/services/qqGroupAdminService'))
const toolRegistry = require(path.join(__dirname, '../../src/agent/tools/registry'))
const { checkToolPermission } = require(path.join(__dirname, '../../src/agent/tools/permissionGate'))

const originals = {
    callAction: notificationService.callAction,
    rootAdmin: config.getRootAdminQQ
}

function restore() {
    notificationService.callAction = originals.callAction
    config.getRootAdminQQ = originals.rootAdmin
    requestApprovalService.pendingByKey.clear()
    requestApprovalService.queue = []
    requestApprovalService.keyByNotifyMessageId.clear()
    requestApprovalService.keyByShortId.clear()
    requestApprovalService.inflightKeys.clear()
}

function makeWs() {
    return { readyState: 1, send() {} }
}

async function run() {
    const calls = []
    let botRole = 'admin'
    notificationService.callAction = async (_ws, action, params) => {
        calls.push({ action, params })
        if (action === 'send_private_msg') {
            return { status: 'ok', retcode: 0, data: { message_id: 'notify-1' } }
        }
        if (action === 'get_group_member_info') {
            const userId = String(params.user_id)
            const roles = {
                999: botRole,
                42: 'admin',
                43: 'member',
                100: 'owner',
                123: 'member'
            }
            return {
                status: 'ok',
                retcode: 0,
                data: {
                    group_id: Number(params.group_id),
                    user_id: Number(params.user_id),
                    nickname: `U${userId}`,
                    role: roles[userId] || 'member',
                    shut_up_timestamp: 0
                }
            }
        }
        if (action === 'get_msg') {
            const messageId = String(params.message_id)
            const senderUserId = messageId === 'msg-to-delete' ? 123 : 100
            return {
                status: 'ok',
                retcode: 0,
                data: {
                    group_id: 1000,
                    message_id: params.message_id,
                    user_id: senderUserId,
                    sender: { user_id: senderUserId }
                }
            }
        }
        if (action === 'set_group_ban' || action === 'set_group_kick' || action === 'delete_msg' || action === 'set_group_add_request') {
            return { status: 'ok', retcode: 0, data: {} }
        }
        throw new Error(`unexpected action: ${action}`)
    }

    const memberActor = { userId: '43', groupId: '1000', isRoot: false, qqRole: 'member' }
    const adminActor = { userId: '42', groupId: '1000', isRoot: false, qqRole: 'admin' }
    const mutePlan = toolRegistry.normalizeToolIntent({
        name: 'qq.mute_member',
        arguments: { groupId: '1000', targetUserId: '123', duration: 60 }
    }, { groupId: '1000' })
    assert.strictEqual(checkToolPermission({ plan: mutePlan, actor: memberActor }).allowed, false)
    assert.strictEqual(checkToolPermission({ plan: mutePlan, actor: adminActor }).allowed, true)

    botRole = 'member'
    await assert.rejects(() => qqGroupAdminService.muteMember({
        groupId: '1000',
        targetUserId: '123',
        duration: 60
    }, {
        ws: makeWs(),
        selfId: '999',
        actor: adminActor
    }), /bot_not_group_admin/)

    botRole = 'admin'
    await assert.rejects(() => qqGroupAdminService.kickMember({
        groupId: '1000',
        targetUserId: '100'
    }, {
        ws: makeWs(),
        selfId: '999',
        actor: adminActor
    }), /target_is_group_owner/)

    await assert.rejects(() => qqGroupAdminService.muteMember({
        groupId: '1000',
        targetUserId: '42',
        duration: 60
    }, {
        ws: makeWs(),
        selfId: '999',
        actor: { userId: '100', groupId: '1000', isRoot: false, qqRole: 'owner' }
    }), /bot_role_not_higher_than_target/)

    const deletePlan = toolRegistry.normalizeToolIntent({
        name: 'qq.delete_message',
        arguments: { targetUserId: '100' }
    }, {
        groupId: '1000',
        replyTarget: { messageId: 'msg-to-delete', userId: '123' }
    })
    assert.strictEqual(deletePlan.args.messageId, 'msg-to-delete')
    assert.strictEqual(deletePlan.args.targetUserId, undefined)
    const deleteResult = await toolRegistry.executeToolPlan(deletePlan, {
        ws: makeWs(),
        selfId: '999',
        groupId: '1000',
        actor: adminActor
    })
    assert.ok(deleteResult.message.includes('已撤回'))
    assert.ok(calls.some(call => call.action === 'delete_msg' && call.params.message_id === 'msg-to-delete'))

    await assert.rejects(() => qqGroupAdminService.deleteMessage({
        messageId: 'owner-message'
    }, {
        ws: makeWs(),
        selfId: '999',
        groupId: '1000',
        actor: adminActor
    }), /target_is_group_owner/)

    config.getRootAdminQQ = () => '42'
    await requestApprovalService.handleRequestEvent(makeWs(), {
        post_type: 'request',
        request_type: 'group',
        sub_type: 'add',
        flag: 'flag-1',
        user_id: '321',
        group_id: '1000',
        comment: '申请入群'
    })
    const pending = requestApprovalService.listPendingApprovals()
    assert.strictEqual(pending.pendingCount, 1)
    const listPlan = toolRegistry.normalizeToolIntent({
        name: 'qq.list_pending_requests',
        arguments: { groupId: '1000' }
    }, { groupId: '1000' })
    const listResult = await toolRegistry.executeToolPlan(listPlan, { ws: makeWs(), actor: adminActor })
    assert.ok(listResult.message.includes('待处理申请 1 个'))

    const crossGroupApprovePlan = toolRegistry.normalizeToolIntent({
        name: 'qq.handle_group_request',
        arguments: { groupId: '2000', decision: 'approve', shortId: pending.items[0].shortId }
    }, { groupId: '2000' })
    await assert.rejects(
        () => toolRegistry.executeToolPlan(crossGroupApprovePlan, { ws: makeWs(), actor: { ...adminActor, groupId: '2000' } }),
        /approval_cross_group_denied/
    )

    const approvePlan = toolRegistry.normalizeToolIntent({
        name: 'qq.handle_group_request',
        arguments: { groupId: '1000', decision: 'approve', shortId: pending.items[0].shortId }
    }, { groupId: '1000' })
    const approveResult = await toolRegistry.executeToolPlan(approvePlan, { ws: makeWs(), actor: adminActor })
    assert.ok(approveResult.message.includes('已同意申请'))
    assert.ok(calls.some(call => call.action === 'set_group_add_request' && call.params.approve === true))

    console.log('✓ QQ 群管理工具权限与审批链路正常')
}

run()
    .then(() => {
        restore()
        process.exit(0)
    })
    .catch((error) => {
        restore()
        console.error(error)
        process.exit(1)
    })
