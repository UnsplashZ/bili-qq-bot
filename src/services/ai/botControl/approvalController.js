'use strict'

const { resolveScopedGroupId } = require('./subscriptionController')

function normalizeValue(value) {
    return String(value || '').trim()
}

function isRootPrivateGroupId(groupId) {
    return typeof groupId === 'string' && groupId.startsWith('private_')
}

function assertRootPrivateScope(groupId, operation) {
    if (!isRootPrivateGroupId(groupId)) {
        throw new Error(`Bot-control ${operation} is limited to Root private scope`)
    }
}

function normalizeApprovalDecision(input = {}) {
    const operation = normalizeValue(input.operation || input.decision).toLowerCase()

    if (operation === 'approve' || operation === 'reject') {
        return operation
    }

    throw new Error(`Unsupported approval write operation: ${operation || '<empty>'}`)
}

function normalizeApprovalShortId(input = {}) {
    const shortId = normalizeValue(input.shortId || input.requestId || input.reqId).toUpperCase()

    if (!shortId) {
        return ''
    }

    if (!/^REQ-[A-Z0-9]+(?:-\d+)?$/i.test(shortId)) {
        throw new Error('Approval write requires an exact REQ-* shortId')
    }

    return shortId
}

function normalizeReplyMessageId(input = {}) {
    return normalizeValue(input.replyMessageId || input.replyToMessageId || input.notifyMessageId || input.messageId)
}

function buildApprovalReadSnapshot({ groupId, input = {} } = {}) {
    const scopedGroupId = resolveScopedGroupId(groupId, input, 'read')
    assertRootPrivateScope(scopedGroupId, 'read')

    return {
        action: 'approval.read',
        groupId: scopedGroupId,
        input: {
            operation: 'list'
        }
    }
}

function buildApprovalWriteSnapshot({ groupId, input = {} } = {}) {
    const scopedGroupId = resolveScopedGroupId(groupId, input, 'write')
    assertRootPrivateScope(scopedGroupId, 'write')

    const shortId = normalizeApprovalShortId(input)
    const replyMessageId = normalizeReplyMessageId(input)

    if (!shortId && !replyMessageId) {
        throw new Error('Approval write requires an exact target via replyMessageId or REQ-* shortId')
    }

    return {
        action: 'approval.write',
        groupId: scopedGroupId,
        input: {
            operation: normalizeApprovalDecision(input),
            shortId,
            replyMessageId
        }
    }
}

class ApprovalController {
    constructor({ requestApprovalService }) {
        this.requestApprovalService = requestApprovalService
    }

    read({ action, groupId, input }) {
        const snapshot = buildApprovalReadSnapshot({ groupId, input })
        const result = this.requestApprovalService.listPendingApprovals()

        return {
            ok: true,
            action,
            namespace: 'approval',
            operation: 'read',
            scope: 'root_private',
            groupId: snapshot.groupId,
            mutation: false,
            data: {
                operation: 'list',
                counts: {
                    pending: result.pendingCount
                },
                items: result.items
            }
        }
    }

    async write({ action, groupId, input, context }) {
        const snapshot = buildApprovalWriteSnapshot({ groupId, input })
        const result = await this.requestApprovalService.handleExactApprovalDecision(context?.ws || input?.ws || null, {
            decision: snapshot.input.operation,
            shortId: snapshot.input.shortId,
            replyMessageId: snapshot.input.replyMessageId
        })

        const statusMessages = {
            missing_target: '审批操作需要精确目标，请提供 REQ-* 编号或回复审批通知消息。',
            invalid_reply: '引用的审批消息不存在、已过期或已处理。',
            invalid_short_id: `编号无效或已失效：${snapshot.input.shortId || '未知编号'}`,
            target_conflict: '回复目标与 REQ-* 编号不一致，请只保留一个精确目标。',
            inflight: '该审批正在处理中，请稍后重试。',
            failed: result.error || result.actionResult?.wording || '审批执行失败'
        }

        return {
            ok: result.ok,
            action,
            namespace: 'approval',
            operation: 'write',
            scope: 'root_private',
            groupId: snapshot.groupId,
            mutation: result.mutation === true,
            data: {
                operation: snapshot.input.operation,
                status: result.status,
                resolveMode: result.resolveMode || (snapshot.input.replyMessageId ? 'reply' : 'short_id'),
                shortId: result.shortId || snapshot.input.shortId || result.target?.shortId || '',
                replyMessageId: result.replyMessageId || snapshot.input.replyMessageId || '',
                pendingCount: Number(result.pendingCount || 0),
                target: result.target || null,
                message: statusMessages[result.status] || '',
                wording: result.actionResult?.wording || ''
            }
        }
    }
}

module.exports = {
    ApprovalController,
    buildApprovalReadSnapshot,
    buildApprovalWriteSnapshot,
    isRootPrivateGroupId
}
