const { checkToolPermission } = require('./permissionGate')

function makeCheck(name, passed, reason = 'ok', detail = {}) {
    return {
        name,
        passed: Boolean(passed),
        reason,
        ...detail
    }
}

function isNumericId(value) {
    return /^\d+$/.test(String(value || '').trim())
}

function checkTargetUserRequired(plan) {
    const targetUserId = String(plan?.args?.targetUserId || plan?.args?.userId || '').trim()
    return makeCheck(
        'target_user_required',
        isNumericId(targetUserId),
        targetUserId ? 'ok' : 'invalid_target_user_id',
        targetUserId ? { targetUserId } : {}
    )
}

function checkMessageIdRequired(plan) {
    const messageId = String(plan?.args?.messageId || '').trim()
    return makeCheck(
        'message_id_required',
        Boolean(messageId),
        messageId ? 'ok' : 'missing_message_id',
        messageId ? { messageId } : {}
    )
}

function checkApprovalTargetRequired(plan) {
    const shortId = String(plan?.args?.shortId || '').trim()
    const replyMessageId = String(plan?.args?.replyMessageId || '').trim()
    return makeCheck(
        'approval_target_required',
        Boolean(shortId || replyMessageId),
        shortId || replyMessageId ? 'ok' : 'missing_approval_target',
        { shortId, replyMessageId }
    )
}

function checkBotAdminRequired(actor) {
    const qqRole = String(actor?.qqRole || '').trim()
    const passed = Boolean(actor?.isRoot || qqRole === 'admin' || qqRole === 'owner')
    return makeCheck(
        'bot_admin_required',
        passed,
        passed ? 'deferred_service_check' : 'qq_manager_permission_denied',
        { qqRole }
    )
}

function checkGetMsgVerifySender() {
    return makeCheck('get_msg_verify_sender', true, 'deferred_service_check')
}

function evaluateStaticGuardrail(tag, { plan, actor }) {
    if (tag === 'target_user_required') return checkTargetUserRequired(plan)
    if (tag === 'message_id_required') return checkMessageIdRequired(plan)
    if (tag === 'approval_target_required') return checkApprovalTargetRequired(plan)
    if (tag === 'bot_admin_required') return checkBotAdminRequired(actor)
    if (tag === 'get_msg_verify_sender') return checkGetMsgVerifySender()
    return makeCheck(tag, true, 'unknown_guardrail_deferred')
}

function evaluateToolGuardrails({ plan, actor }) {
    const checks = []

    const permission = checkToolPermission({ plan, actor })
    checks.push(makeCheck('permission', permission.allowed, permission.reason, {
        permission: plan?.permission || '',
        risk: plan?.risk || ''
    }))

    const staticChecks = Array.isArray(plan?.guardrails)
        ? plan.guardrails.map((tag) => evaluateStaticGuardrail(tag, { plan, actor }))
        : []
    checks.push(...staticChecks)

    const failed = checks.find((check) => !check.passed)
    return {
        allowed: !failed,
        reason: failed?.reason || 'allowed',
        permission,
        checks
    }
}

module.exports = {
    evaluateToolGuardrails
}
