const notificationService = require('./notificationService')

const ROLE_LEVEL = {
    unknown: 0,
    member: 1,
    admin: 2,
    owner: 3
}

function normalizeId(value) {
    const normalized = String(value || '').trim()
    return /^\d+$/.test(normalized) ? normalized : ''
}

function normalizeGroupId(value) {
    const normalized = normalizeId(value)
    if (!normalized) throw new Error('missing_group_id')
    return normalized
}

function normalizeRole(role) {
    const normalized = String(role || 'unknown').trim().toLowerCase()
    return Object.prototype.hasOwnProperty.call(ROLE_LEVEL, normalized) ? normalized : 'unknown'
}

function roleLevel(role) {
    return ROLE_LEVEL[normalizeRole(role)] || 0
}

function isManagerRole(role) {
    return roleLevel(role) >= ROLE_LEVEL.admin
}

function ensureActionOk(response, action) {
    const retcode = response?.retcode
    if (response?.status === 'ok' && (retcode === 0 || retcode === undefined || retcode === null)) {
        return response
    }
    throw new Error(response?.wording || response?.message || `${action}_failed`)
}

function displayMember(member) {
    if (!member) return '未知成员'
    const name = member.card || member.nickname || member.userId || member.user_id || '未知成员'
    const userId = member.userId || member.user_id || ''
    return userId ? `${name}(${userId})` : name
}

function normalizeMember(data = {}) {
    return {
        groupId: String(data.group_id || data.groupId || ''),
        userId: String(data.user_id || data.userId || ''),
        nickname: String(data.nickname || ''),
        card: String(data.card || ''),
        role: normalizeRole(data.role),
        title: String(data.title || ''),
        shutUpTimestamp: Number(data.shut_up_timestamp || data.shutUpTimestamp || 0) || 0,
        raw: data
    }
}

function normalizeGroup(data = {}) {
    return {
        groupId: String(data.group_id || data.groupId || ''),
        groupName: String(data.group_name || data.groupName || ''),
        memberCount: Number(data.member_count || data.memberCount || 0) || 0,
        maxMemberCount: Number(data.max_member_count || data.maxMemberCount || 0) || 0,
        wholeBanEnabled: Boolean(Number(data.group_all_shut || data.groupAllShut || 0)),
        raw: data
    }
}

function normalizeMessage(data = {}) {
    const senderUserId = data?.sender?.user_id ?? data?.sender?.userId ?? data?.user_id
    return {
        messageId: String(data.message_id || data.messageId || ''),
        groupId: String(data.group_id || data.groupId || ''),
        userId: String(senderUserId || ''),
        raw: data
    }
}

function getWs(options = {}) {
    return options.ws || global.bot?.ws || null
}

function getSelfId(options = {}) {
    return normalizeId(options.selfId || global.bot?.selfId)
}

class QqGroupAdminService {
    async callAction(action, params, options = {}) {
        const response = await notificationService.callAction(getWs(options), action, params, 'QqGroupAdmin', options.timeoutMs || 10000)
        return ensureActionOk(response, action)
    }

    async getMemberInfo({ groupId, userId, noCache = true }, options = {}) {
        const safeGroupId = normalizeGroupId(groupId)
        const safeUserId = normalizeId(userId)
        if (!safeUserId) throw new Error('invalid_target_user_id')
        const response = await this.callAction('get_group_member_info', {
            group_id: safeGroupId,
            user_id: safeUserId,
            no_cache: Boolean(noCache)
        }, options)
        return normalizeMember(response.data || {})
    }

    async getGroupInfo({ groupId }, options = {}) {
        const response = await this.callAction('get_group_info', {
            group_id: normalizeGroupId(groupId)
        }, options)
        return normalizeGroup(response.data || {})
    }

    async getMessageInfo({ messageId }, options = {}) {
        const safeMessageId = String(messageId || '').trim()
        if (!safeMessageId) throw new Error('missing_message_id')
        const response = await this.callAction('get_msg', { message_id: safeMessageId }, options)
        return normalizeMessage(response.data || {})
    }

    async assertBotCanManage(groupId, options = {}) {
        const selfId = getSelfId(options)
        if (!selfId) throw new Error('bot_self_id_unavailable')
        const botMember = await this.getMemberInfo({ groupId, userId: selfId, noCache: true }, options)
        if (!isManagerRole(botMember.role)) {
            throw new Error('bot_not_group_admin')
        }
        return botMember
    }

    assertActorCanManageTarget({ actor, actorMember, botMember, targetMember, action = 'manage' }) {
        const actorIsRoot = Boolean(actor?.isRoot)
        const actorRole = normalizeRole(actorMember?.role || actor?.qqRole)
        const botRole = normalizeRole(botMember?.role)
        const targetRole = normalizeRole(targetMember?.role)
        if (!actorIsRoot && !isManagerRole(actorRole)) throw new Error('actor_not_group_admin')
        if (targetRole === 'owner') throw new Error('target_is_group_owner')
        if (roleLevel(botRole) <= roleLevel(targetRole)) {
            throw new Error('bot_role_not_higher_than_target')
        }
        if (!actorIsRoot && roleLevel(actorRole) <= roleLevel(targetRole)) {
            throw new Error('actor_role_not_higher_than_target')
        }
        if (action === 'kick' && String(actor?.userId || '') === String(targetMember?.userId || '')) {
            throw new Error('cannot_kick_self')
        }
    }

    async buildModerationContext({ groupId, targetUserId, actor }, options = {}) {
        const safeGroupId = normalizeGroupId(groupId)
        const safeTargetUserId = normalizeId(targetUserId)
        if (!safeTargetUserId) throw new Error('invalid_target_user_id')
        const selfId = getSelfId(options)
        if (selfId && safeTargetUserId === selfId) throw new Error('cannot_manage_bot_self')
        const [botMember, actorMember, targetMember] = await Promise.all([
            this.assertBotCanManage(safeGroupId, options),
            actor?.isRoot
                ? Promise.resolve({ userId: String(actor.userId || ''), role: 'owner', nickname: 'Root' })
                : this.getMemberInfo({ groupId: safeGroupId, userId: actor?.userId, noCache: true }, options),
            this.getMemberInfo({ groupId: safeGroupId, userId: safeTargetUserId, noCache: true }, options)
        ])
        return { groupId: safeGroupId, targetUserId: safeTargetUserId, botMember, actorMember, targetMember }
    }

    async muteMember({ groupId, targetUserId, duration }, options = {}) {
        const seconds = Math.max(1, Math.min(24 * 60 * 60, Math.trunc(Number(duration) || 0)))
        const context = await this.buildModerationContext({ groupId, targetUserId, actor: options.actor }, options)
        this.assertActorCanManageTarget({ actor: options.actor, actorMember: context.actorMember, botMember: context.botMember, targetMember: context.targetMember, action: 'mute' })
        await this.callAction('set_group_ban', {
            group_id: context.groupId,
            user_id: context.targetUserId,
            duration: seconds
        }, options)
        return {
            message: `已禁言 ${displayMember(context.targetMember)} ${seconds} 秒。`,
            data: { groupId: context.groupId, targetUserId: context.targetUserId, duration: seconds }
        }
    }

    async unmuteMember({ groupId, targetUserId }, options = {}) {
        const context = await this.buildModerationContext({ groupId, targetUserId, actor: options.actor }, options)
        this.assertActorCanManageTarget({ actor: options.actor, actorMember: context.actorMember, botMember: context.botMember, targetMember: context.targetMember, action: 'unmute' })
        await this.callAction('set_group_ban', {
            group_id: context.groupId,
            user_id: context.targetUserId,
            duration: 0
        }, options)
        return {
            message: `已解除 ${displayMember(context.targetMember)} 的禁言。`,
            data: { groupId: context.groupId, targetUserId: context.targetUserId, duration: 0 }
        }
    }

    async kickMember({ groupId, targetUserId, rejectAddRequest = false }, options = {}) {
        const context = await this.buildModerationContext({ groupId, targetUserId, actor: options.actor }, options)
        this.assertActorCanManageTarget({ actor: options.actor, actorMember: context.actorMember, botMember: context.botMember, targetMember: context.targetMember, action: 'kick' })
        await this.callAction('set_group_kick', {
            group_id: context.groupId,
            user_id: context.targetUserId,
            reject_add_request: Boolean(rejectAddRequest)
        }, options)
        return {
            message: `已将 ${displayMember(context.targetMember)} 移出本群。`,
            data: { groupId: context.groupId, targetUserId: context.targetUserId, rejectAddRequest: Boolean(rejectAddRequest) }
        }
    }

    async deleteMessage({ messageId }, options = {}) {
        const safeMessageId = String(messageId || '').trim()
        if (!safeMessageId) throw new Error('missing_message_id')
        const groupId = options.groupId ? normalizeGroupId(options.groupId) : ''
        if (groupId) {
            const selfId = getSelfId(options)
            const messageInfo = await this.getMessageInfo({ messageId: safeMessageId }, options)
            if (!messageInfo.groupId) throw new Error('message_group_unavailable')
            if (messageInfo.groupId !== groupId) throw new Error('message_cross_group_denied')
            const resolvedTargetUserId = normalizeId(messageInfo.userId)
            if (!resolvedTargetUserId) throw new Error('message_sender_unavailable')
            if (resolvedTargetUserId && resolvedTargetUserId !== selfId) {
                const context = await this.buildModerationContext({ groupId, targetUserId: resolvedTargetUserId, actor: options.actor }, options)
                this.assertActorCanManageTarget({ actor: options.actor, actorMember: context.actorMember, botMember: context.botMember, targetMember: context.targetMember, action: 'delete_message' })
            } else {
                await this.assertBotCanManage(groupId, options)
            }
        }
        await this.callAction('delete_msg', { message_id: safeMessageId }, options)
        return {
            message: `已撤回消息 ${safeMessageId}。`,
            data: { messageId: safeMessageId }
        }
    }
}

module.exports = new QqGroupAdminService()
module.exports._private = {
    normalizeRole,
    roleLevel,
    isManagerRole,
    normalizeMember,
    normalizeGroup,
    normalizeMessage
}
