const config = require('../../config')
const subscriptionService = require('../../services/subscriptionService')
const biliApi = require('../../services/biliApi')
const qqGroupAdminService = require('../../services/qqGroupAdminService')
const qqAccountService = require('../../services/qqAccountService')
const agentBrowserService = require('../../services/agentBrowserService')
const requestApprovalService = require('../../services/requestApprovalService')
const { normalizeAgentConfig, getEffectiveAgentConfigForGroup } = require('../config/agentConfig')
const longTermStore = require('../memory/longTermStore')

function normalizeBoolean(value) {
    if (typeof value === 'boolean') return value
    const normalized = String(value || '').trim().toLowerCase()
    if (['1', 'true', 'yes', 'on', '开', '开启', '启用'].includes(normalized)) return true
    if (['0', 'false', 'no', 'off', '关', '关闭', '禁用'].includes(normalized)) return false
    return null
}

function normalizeNumericId(value) {
    const normalized = String(value || '').trim()
    return /^\d+$/.test(normalized) ? normalized : ''
}

function normalizeGroupId(value, sessionContext) {
    const normalized = String(value || sessionContext?.groupId || '').trim()
    if (!normalized || normalized.startsWith('private_')) return ''
    return normalized
}

function ensureAgentGroupConfig(groupId) {
    const agentConfig = config.agent
    if (!agentConfig.groups || typeof agentConfig.groups !== 'object' || Array.isArray(agentConfig.groups)) {
        agentConfig.groups = {}
    }
    if (!agentConfig.groups[groupId] || typeof agentConfig.groups[groupId] !== 'object' || Array.isArray(agentConfig.groups[groupId])) {
        agentConfig.groups[groupId] = {}
    }
    return agentConfig.groups[groupId]
}

function setAgentGroupFlag(groupId, key, value) {
    const groupConfig = ensureAgentGroupConfig(groupId)
    groupConfig[key] = value
    config.save()
}

function ensureGroupBlacklist(groupId) {
    if (!config.groupConfigs[groupId]) config.groupConfigs[groupId] = {}
    if (!Array.isArray(config.groupConfigs[groupId].blacklistedQQs)) {
        config.groupConfigs[groupId].blacklistedQQs = []
    }
    return config.groupConfigs[groupId].blacklistedQQs
}

function normalizeAgentGroupFlagArgs(args, sessionContext) {
    const groupId = normalizeGroupId(args.groupId, sessionContext)
    const enabled = normalizeBoolean(args.enabled)
    if (!groupId) throw new Error('missing_group_id')
    if (enabled === null) throw new Error('invalid_enabled')
    return { groupId, enabled }
}

function normalizeGroupQueryArgs(args, sessionContext) {
    const groupId = normalizeGroupId(args.groupId, sessionContext)
    if (!groupId) throw new Error('missing_group_id')
    return { groupId }
}

function normalizeSubscriptionStatusArgs(args, sessionContext) {
    const groupId = normalizeGroupId(args.groupId, sessionContext)
    const uid = normalizeNumericId(args.uid || args.userId || args.mid)
    const seasonId = normalizeNumericId(args.seasonId || args.sid)
    if (!groupId) throw new Error('missing_group_id')
    if (!uid && !seasonId) throw new Error('missing_subscription_target')
    return uid ? { groupId, type: 'user', uid, seasonId: '' } : { groupId, type: 'bangumi', uid: '', seasonId }
}

function normalizeMemorySummaryArgs(args, sessionContext) {
    const groupId = normalizeGroupId(args.groupId, sessionContext)
    const query = compactText(args.query || args.topic || args.keyword || '', 80)
    const limit = Math.min(8, Math.max(1, Number(args.limit) || 5))
    if (!groupId) throw new Error('missing_group_id')
    return {
        groupId,
        query,
        limit,
        viewerUserId: String(sessionContext?.userId || '').trim()
    }
}

function normalizeMemoryLearnArgs(args, sessionContext) {
    const groupId = normalizeGroupId(args.groupId, sessionContext)
    const content = compactText(args.content || args.text || args.fact || '', 240)
    const scope = ['user', 'group', 'topic'].includes(args.scope) ? args.scope : 'group'
    const type = ['fact', 'preference', 'relation', 'episode', 'persona'].includes(args.type) ? args.type : 'fact'
    const confidence = Math.min(1, Math.max(0, Number(args.confidence) || 0.7))
    if (!groupId) throw new Error('missing_group_id')
    if (!content) throw new Error('missing_memory_content')
    return { groupId, content, scope, type, confidence }
}

function normalizeBiliUserLookupArgs(args, sessionContext) {
    const groupId = normalizeGroupId(args.groupId, sessionContext)
    const uid = normalizeNumericId(args.uid || args.userId || args.mid)
    const keyword = String(args.keyword || args.name || args.query || '').trim().slice(0, 80)
    if (!groupId) throw new Error('missing_group_id')
    if (!uid && !keyword) throw new Error('missing_uid_or_keyword')
    return uid ? { groupId, uid, keyword: '' } : { groupId, uid: '', keyword }
}

function normalizeBiliVideoLookupArgs(args, sessionContext) {
    const groupId = normalizeGroupId(args.groupId, sessionContext)
    const rawVideoId = String(args.bvid || args.bv || args.aid || args.av || args.id || '').trim()
    const matchedVideoId = rawVideoId.match(/BV[0-9A-Za-z]{8,20}/i)?.[0]
        || rawVideoId.match(/av\d{1,20}/i)?.[0]
        || rawVideoId
    const normalized = /^\d+$/.test(matchedVideoId)
        ? `av${matchedVideoId}`
        : matchedVideoId.replace(/^bv/i, 'BV').replace(/^AV/i, 'av')
    if (!groupId) throw new Error('missing_group_id')
    if (!/^BV[0-9A-Za-z]{8,20}$/i.test(normalized) && !/^av\d{1,20}$/i.test(normalized)) {
        throw new Error('invalid_video_id')
    }
    return { groupId, bvid: normalized }
}

function normalizeUserSubscriptionArgs(args, sessionContext) {
    const groupId = normalizeGroupId(args.groupId, sessionContext)
    const uid = normalizeNumericId(args.uid || args.userId)
    if (!groupId) throw new Error('missing_group_id')
    if (!uid) throw new Error('invalid_uid')
    return { groupId, uid }
}

function normalizeBangumiSubscriptionArgs(args, sessionContext) {
    const groupId = normalizeGroupId(args.groupId, sessionContext)
    const seasonId = normalizeNumericId(args.seasonId || args.sid)
    if (!groupId) throw new Error('missing_group_id')
    if (!seasonId) throw new Error('invalid_season_id')
    return { groupId, seasonId }
}

function normalizeBlacklistArgs(args, sessionContext) {
    const scope = ['group', 'global'].includes(args.scope) ? args.scope : 'group'
    const groupId = scope === 'group' ? normalizeGroupId(args.groupId, sessionContext) : ''
    const targetUserId = normalizeNumericId(args.targetUserId || args.userId || args.qq)
    if (scope === 'group' && !groupId) throw new Error('missing_group_id')
    if (!targetUserId) throw new Error('invalid_target_user_id')
    return { scope, groupId, targetUserId }
}

function normalizeTargetUserArgs(args, sessionContext) {
    const groupId = normalizeGroupId(args.groupId, sessionContext)
    const replyTargetUserId = sessionContext?.replyTarget?.userId || sessionContext?.agentMessage?.replyTarget?.userId || ''
    const targetUserId = normalizeNumericId(args.targetUserId || args.userId || args.qq || replyTargetUserId)
    if (!groupId) throw new Error('missing_group_id')
    if (!targetUserId) throw new Error('invalid_target_user_id')
    return { groupId, targetUserId }
}

function normalizeMuteArgs(args, sessionContext) {
    const base = normalizeTargetUserArgs(args, sessionContext)
    const duration = Math.trunc(Number(args.duration || args.durationSeconds || args.seconds || 600))
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('invalid_duration')
    return { ...base, duration: Math.min(duration, 24 * 60 * 60) }
}

function normalizeKickArgs(args, sessionContext) {
    const base = normalizeTargetUserArgs(args, sessionContext)
    return { ...base, rejectAddRequest: Boolean(normalizeBoolean(args.rejectAddRequest || args.reject_add_request) || false) }
}

function normalizeDeleteMessageArgs(args, sessionContext) {
    const groupId = normalizeGroupId(args.groupId, sessionContext)
    const replyMessageId = sessionContext?.replyTarget?.messageId || sessionContext?.agentMessage?.replyTarget?.messageId || ''
    const messageId = String(args.messageId || args.message_id || replyMessageId || '').trim()
    if (!groupId) throw new Error('missing_group_id')
    if (!messageId) throw new Error('missing_message_id')
    return { groupId, messageId }
}

function normalizeMemberSearchArgs(args, sessionContext) {
    const groupId = normalizeGroupId(args.groupId, sessionContext)
    const query = compactText(args.query || args.keyword || args.name || args.qq || '', 60)
    const limit = Math.max(1, Math.min(20, Math.trunc(Number(args.limit) || 8)))
    if (!groupId) throw new Error('missing_group_id')
    if (!query) throw new Error('missing_member_query')
    return { groupId, query, limit }
}

function normalizeSetCardArgs(args, sessionContext) {
    const base = normalizeTargetUserArgs(args, sessionContext)
    const hasCard = Object.prototype.hasOwnProperty.call(args, 'card')
        || Object.prototype.hasOwnProperty.call(args, 'name')
        || Object.prototype.hasOwnProperty.call(args, 'nickname')
    if (!hasCard) throw new Error('missing_member_card')
    const card = compactText(args.card ?? args.name ?? args.nickname ?? '', 60)
    return { ...base, card }
}

function normalizeQqGroupFlagArgs(args, sessionContext) {
    const groupId = normalizeGroupId(args.groupId, sessionContext)
    const enabled = normalizeBoolean(args.enabled)
    if (!groupId) throw new Error('missing_group_id')
    if (enabled === null) throw new Error('invalid_enabled')
    return { groupId, enabled }
}

function normalizeApprovalDecisionArgs(args, sessionContext) {
    const groupId = normalizeGroupId(args.groupId, sessionContext)
    const decisionText = String(args.decision || args.action || '').trim().toLowerCase()
    const decision = ['approve', '同意', 'yes', 'y'].includes(decisionText)
        ? 'approve'
        : (['reject', '拒绝', 'no', 'n'].includes(decisionText) ? 'reject' : '')
    const shortId = String(args.shortId || args.requestId || args.id || '').trim().toUpperCase()
    const replyMessageId = String(args.replyMessageId || args.messageId || '').trim()
    if (!groupId) throw new Error('missing_group_id')
    if (!decision) throw new Error('invalid_approval_decision')
    if (!shortId && !replyMessageId) throw new Error('missing_approval_target')
    return { groupId, decision, shortId, replyMessageId }
}

function normalizeFriendApprovalDecisionArgs(args) {
    const decisionText = String(args.decision || args.action || '').trim().toLowerCase()
    const decision = ['approve', '同意', 'yes', 'y'].includes(decisionText)
        ? 'approve'
        : (['reject', '拒绝', 'no', 'n'].includes(decisionText) ? 'reject' : '')
    const shortId = String(args.shortId || args.requestId || args.id || '').trim().toUpperCase()
    const replyMessageId = String(args.replyMessageId || args.messageId || '').trim()
    if (!decision) throw new Error('invalid_approval_decision')
    if (!shortId && !replyMessageId) throw new Error('missing_approval_target')
    return { decision, shortId, replyMessageId }
}

function normalizeCountGroupQueryArgs(args, sessionContext) {
    const groupId = normalizeGroupId(args.groupId, sessionContext)
    const count = Math.max(1, Math.min(100, Math.trunc(Number(args.count) || 50)))
    if (!groupId) throw new Error('missing_group_id')
    return { groupId, count }
}

function normalizeOnlineStatusArgs(args) {
    const preset = compactText(args.preset || args.statusName || args.name || '', 40).toLowerCase()
    const status = args.status
    const extStatus = args.extStatus ?? args.ext_status ?? 0
    const batteryStatus = args.batteryStatus ?? args.battery_status ?? 0
    if (!preset && status === undefined) throw new Error('missing_online_status')
    return { preset, status, extStatus, batteryStatus }
}

function normalizeInputStatusArgs(args, sessionContext) {
    const targetUserId = normalizeNumericId(args.targetUserId || args.userId || args.qq || sessionContext?.userId)
    const preset = compactText(args.preset || args.statusName || args.name || '', 40).toLowerCase()
    const eventType = args.eventType ?? args.event_type
    if (!targetUserId) throw new Error('invalid_target_user_id')
    if (!preset && eventType === undefined) throw new Error('missing_input_status')
    return { userId: targetUserId, preset, eventType }
}

function normalizeBrowserReadArgs(args, sessionContext) {
    const groupId = normalizeGroupId(args.groupId, sessionContext)
    const url = String(args.url || args.href || '').trim()
    const maxChars = Math.max(200, Math.min(8000, Math.trunc(Number(args.maxChars) || 3000)))
    if (!groupId) throw new Error('missing_group_id')
    if (!url) throw new Error('missing_url')
    return { groupId, url, maxChars }
}

function formatList(items, mapper, limit = 5) {
    const list = Array.isArray(items) ? items : []
    const selected = list.slice(0, limit).map(mapper).filter(Boolean)
    const suffix = list.length > limit ? ` 等 ${list.length} 项` : ''
    return selected.length > 0 ? `${selected.join('、')}${suffix}` : '无'
}

function compactText(value, limit = 80) {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    return text.length > limit ? `${text.slice(0, limit - 3)}...` : text
}

function formatBiliUserInfo(info) {
    if (!info || info.status !== 'success' || !info.data) {
        return {
            message: `查询 B 站用户失败：${info?.message || 'unknown_error'}`,
            data: null
        }
    }
    const data = info.data
    const liveRoom = data.live_room && typeof data.live_room === 'object' ? data.live_room : {}
    const liveText = liveRoom.roomid || liveRoom.room_id
        ? `；直播间 ${liveRoom.roomid || liveRoom.room_id}${liveRoom.liveStatus || liveRoom.live_status ? '（可能正在直播）' : ''}`
        : ''
    return {
        message: [
            `B 站用户 ${data.name || data.uid || '未知'}（UID: ${data.uid || '-'}）`,
            `等级 ${data.level ?? '-'}`,
            `获赞 ${data.likes ?? '-'}`,
            `视频播放 ${data.archive_view ?? '-'}`,
            compactText(data.sign || '无签名', 60)
        ].join('；') + liveText,
        data: {
            uid: String(data.uid || ''),
            name: data.name || '',
            level: data.level ?? null,
            sign: data.sign || '',
            likes: data.likes ?? null,
            archiveView: data.archive_view ?? null,
            liveRoomId: liveRoom.roomid || liveRoom.room_id || null
        }
    }
}

function formatBiliVideoInfo(result) {
    if (!result || result.status !== 'success' || !result.data) {
        return {
            message: `查询 B 站视频失败：${result?.message || 'unknown_error'}`,
            data: null
        }
    }
    const data = result.data
    const owner = data.owner && typeof data.owner === 'object' ? data.owner : {}
    const stat = data.stat && typeof data.stat === 'object' ? data.stat : {}
    const view = data.view?.count ?? stat.view ?? null
    const like = data.like ?? stat.like ?? null
    const reply = data.reply ?? stat.reply ?? null
    const danmaku = data.danmaku ?? stat.danmaku ?? null
    return {
        message: [
            `B 站视频《${compactText(data.title || data.bvid || '未知视频', 50)}》`,
            `BV: ${data.bvid || '-'}`,
            `UP：${owner.name || '-'}${owner.mid ? `(UID:${owner.mid})` : ''}`,
            `播放 ${view ?? '-'}`,
            `点赞 ${like ?? '-'}`,
            `评论 ${reply ?? '-'}`,
            `弹幕 ${danmaku ?? '-'}`,
            `时长 ${data.duration ?? '-'} 秒`
        ].join('；'),
        data: {
            bvid: data.bvid || '',
            aid: data.aid ?? null,
            title: data.title || '',
            ownerName: owner.name || '',
            ownerUid: owner.mid ? String(owner.mid) : '',
            view,
            like,
            reply,
            danmaku,
            duration: data.duration ?? null,
            pubdate: data.pubdate ?? null,
            type: result.type || data.type || ''
        }
    }
}

function formatSubscriptionStatus(subscriptions, args) {
    const users = Array.isArray(subscriptions?.users) ? subscriptions.users : []
    const bangumis = Array.isArray(subscriptions?.bangumis) ? subscriptions.bangumis : []
    if (args.type === 'user') {
        const sub = users.find((item) => String(item.uid || '').trim() === args.uid)
        if (!sub) {
            return {
                message: `群 ${args.groupId} 未订阅 B 站用户 ${args.uid}。`,
                data: { groupId: args.groupId, type: args.type, uid: args.uid, subscribed: false }
            }
        }
        return {
            message: [
                `群 ${args.groupId} 已订阅 B 站用户 ${sub.name || sub.uid}（UID: ${sub.uid}）`,
                `最近动态 ${sub.lastDynamicId || '-'}`,
                `最近视频 ${sub.lastVideoId || '-'}`,
                `直播状态 ${sub.lastLiveStatus || '-'}`
            ].join('；'),
            data: {
                groupId: args.groupId,
                type: args.type,
                uid: String(sub.uid || ''),
                name: sub.name || '',
                subscribed: true,
                lastDynamicId: sub.lastDynamicId || null,
                lastVideoId: sub.lastVideoId || null,
                lastLiveStatus: sub.lastLiveStatus || null,
                sourceCount: Array.isArray(sub.sources) ? sub.sources.length : null
            }
        }
    }

    const sub = bangumis.find((item) => String(item.seasonId || '').trim() === args.seasonId)
    if (!sub) {
        return {
            message: `群 ${args.groupId} 未订阅番剧 ${args.seasonId}。`,
            data: { groupId: args.groupId, type: args.type, seasonId: args.seasonId, subscribed: false }
        }
    }
    return {
        message: [
            `群 ${args.groupId} 已订阅番剧 ${sub.title || sub.seasonId}（Season: ${sub.seasonId}）`,
            `最近剧集 ${sub.lastEpId || '-'}`
        ].join('；'),
        data: {
            groupId: args.groupId,
            type: args.type,
            seasonId: String(sub.seasonId || ''),
            title: sub.title || '',
            subscribed: true,
            lastEpId: sub.lastEpId || null
        }
    }
}

function formatMemorySummary(memories, args) {
    const visibleMemories = (Array.isArray(memories) ? memories : [])
        .filter((memory) => memory.scope !== 'user' || !memory.userId || memory.userId === args.viewerUserId)
    const query = args.query.toLowerCase()
    const filtered = query
        ? visibleMemories.filter((memory) => String(memory.content || '').toLowerCase().includes(query))
        : visibleMemories
    const selected = filtered.slice(0, args.limit)

    if (selected.length === 0) {
        return {
            message: args.query
                ? `当前群没有找到与「${args.query}」相关的可见 Agent 记忆。`
                : '当前群暂无可见 Agent 记忆。',
            data: {
                groupId: args.groupId,
                query: args.query,
                totalVisible: visibleMemories.length,
                memories: []
            }
        }
    }

    return {
        message: [
            args.query ? `与「${args.query}」相关的 Agent 记忆` : '当前群 Agent 记忆摘要',
            formatList(selected, (memory) => `${memory.type || 'fact'}:${compactText(memory.content, 36)}`, args.limit)
        ].join('：'),
        data: {
            groupId: args.groupId,
            query: args.query,
            totalVisible: visibleMemories.length,
            memories: selected.map((memory) => ({
                id: memory.id || '',
                scope: memory.scope || '',
                type: memory.type || '',
                content: memory.content || '',
                confidence: memory.confidence ?? null,
                updatedAt: memory.updatedAt || memory.createdAt || ''
            }))
        }
    }
}

function formatBiliUserSearch(result) {
    if (!result || result.status !== 'success' || !result.data) {
        return {
            message: `搜索 B 站用户失败：${result?.message || 'unknown_error'}`,
            data: null
        }
    }
    const candidates = Array.isArray(result.data.candidates) ? result.data.candidates : []
    return {
        message: [
            `搜索「${result.data.query || ''}」找到 ${result.data.total ?? candidates.length} 个候选`,
            formatList(candidates, (item) => `${item.name || item.uid}(UID:${item.uid})`, 5)
        ].join('：'),
        data: {
            query: result.data.query || '',
            total: result.data.total ?? candidates.length,
            candidates: candidates.slice(0, 5).map((item) => ({
                uid: String(item.uid || ''),
                name: item.name || '',
                sign: item.sign || '',
                fans: item.fans ?? null,
                videos: item.videos ?? null,
                isLive: Boolean(item.is_live),
                officialVerifyDesc: item.official_verify_desc || ''
            }))
        }
    }
}

function formatMemberInfo(member) {
    const muteText = member.shutUpTimestamp > Math.floor(Date.now() / 1000)
        ? `禁言至 ${new Date(member.shutUpTimestamp * 1000).toLocaleString('zh-CN', { hour12: false })}`
        : '未禁言'
    return {
        message: `成员 ${member.card || member.nickname || member.userId}（${member.userId}）：角色 ${member.role}，${muteText}。`,
        data: member
    }
}

function formatGroupInfo(group) {
    return {
        message: `群 ${group.groupName || group.groupId}（${group.groupId}）：成员 ${group.memberCount}/${group.maxMemberCount || '-'}，全员禁言${group.wholeBanEnabled ? '开启' : '关闭'}。`,
        data: group
    }
}

function formatMuteList(members, args) {
    const list = Array.isArray(members) ? members : []
    if (list.length === 0) return { message: `群 ${args.groupId} 当前没有成员处于禁言列表。`, data: { groupId: args.groupId, members: [] } }
    return {
        message: [
            `群 ${args.groupId} 禁言成员 ${list.length} 个`,
            formatList(list, (member) => `${member.card || member.nickname || member.userId}(${member.userId}) 解禁时间:${member.shutUpTimestamp || '-'}`, 8)
        ].join('：'),
        data: { groupId: args.groupId, members: list }
    }
}

function formatEssenceMessages(items, args) {
    const list = Array.isArray(items) ? items : []
    if (list.length === 0) return { message: `群 ${args.groupId} 暂无精华消息。`, data: { groupId: args.groupId, items: [] } }
    return {
        message: [
            `群 ${args.groupId} 精华消息 ${list.length} 条`,
            formatList(list, (item) => `${item.message_id || item.messageId}:${compactText(item.content || item.sender_nick || '', 30)}`, 8)
        ].join('：'),
        data: { groupId: args.groupId, items: list }
    }
}

function formatGroupNotices(items, args) {
    const list = Array.isArray(items) ? items : []
    if (list.length === 0) return { message: `群 ${args.groupId} 暂无群公告。`, data: { groupId: args.groupId, items: [] } }
    return {
        message: [
            `群 ${args.groupId} 群公告 ${list.length} 条`,
            formatList(list, (item) => `${item.notice_id || '-'}:${compactText(item.message?.text || item.message || '', 30)}`, 8)
        ].join('：'),
        data: { groupId: args.groupId, items: list }
    }
}

function formatSystemMessages(result, args, label) {
    const invitedRequests = Array.isArray(result?.invitedRequests) ? result.invitedRequests : []
    const joinRequests = Array.isArray(result?.joinRequests) ? result.joinRequests : []
    const total = invitedRequests.length + joinRequests.length
    if (total === 0) return { message: `群 ${args.groupId} 没有${label}。`, data: { groupId: args.groupId, invitedRequests, joinRequests } }
    return {
        message: [
            `群 ${args.groupId} ${label} ${total} 条`,
            formatList([...joinRequests, ...invitedRequests], (item) => `${item.requestId || '-'}:${item.userId || item.requesterNick || item.invitorUin}${item.message ? `「${compactText(item.message, 20)}」` : ''}`, 8)
        ].join('：'),
        data: { groupId: args.groupId, invitedRequests, joinRequests }
    }
}

function formatAtAllRemain(data, args) {
    return {
        message: `群 ${args.groupId} @全体：${data?.can_at_all ? '可用' : '不可用'}，群剩余 ${data?.remain_at_all_count_for_group ?? '-'}，账号剩余 ${data?.remain_at_all_count_for_uin ?? '-'}。`,
        data: { groupId: args.groupId, ...data }
    }
}

function formatPendingApprovals(result, groupId) {
    const items = (Array.isArray(result?.items) ? result.items : [])
        .filter((item) => !groupId || String(item.groupId || '') === String(groupId))
    if (items.length === 0) {
        return { message: `当前群 ${groupId} 没有待处理加群申请。`, data: { groupId, pendingCount: 0, items: [] } }
    }
    return {
        message: [
            `当前群 ${groupId} 待处理申请 ${items.length} 个`,
            formatList(items, (item) => `${item.shortId}:${item.userId}${item.comment ? `「${compactText(item.comment, 20)}」` : ''}`, 5)
        ].join('：'),
        data: { groupId, pendingCount: items.length, items }
    }
}

function formatFriendApprovals(result) {
    const items = (Array.isArray(result?.items) ? result.items : [])
        .filter((item) => item.requestType === 'friend')
    if (items.length === 0) return { message: '当前没有待处理好友申请。', data: { pendingCount: 0, items: [] } }
    return {
        message: [
            `待处理好友申请 ${items.length} 个`,
            formatList(items, (item) => `${item.shortId}:${item.userId}${item.comment ? `「${compactText(item.comment, 20)}」` : ''}`, 8)
        ].join('：'),
        data: { pendingCount: items.length, items }
    }
}

function formatMemberSearchResults(members, args) {
    const list = Array.isArray(members) ? members : []
    if (list.length === 0) {
        return {
            message: `群 ${args.groupId} 未找到匹配「${args.query}」的成员。`,
            data: { groupId: args.groupId, query: args.query, members: [] }
        }
    }
    return {
        message: [
            `群 ${args.groupId} 找到 ${list.length} 个成员`,
            formatList(list, (member) => `${member.card || member.nickname || member.userId}(${member.userId}, ${member.role})`, args.limit)
        ].join('：'),
        data: {
            groupId: args.groupId,
            query: args.query,
            members: list.map((member) => ({
                userId: member.userId,
                nickname: member.nickname,
                card: member.card,
                role: member.role,
                shutUpTimestamp: member.shutUpTimestamp
            }))
        }
    }
}

function findPendingApprovalTarget({ shortId, replyMessageId, groupId }) {
    const pending = requestApprovalService.listPendingApprovals()
    const normalizedShortId = String(shortId || '').trim().toUpperCase()
    const normalizedReplyMessageId = String(replyMessageId || '').trim()
    const target = (Array.isArray(pending.items) ? pending.items : []).find((item) => (
        (normalizedShortId && String(item.shortId || '').toUpperCase() === normalizedShortId) ||
        (normalizedReplyMessageId && String(item.notifyMessageId || '') === normalizedReplyMessageId)
    ))
    if (!target) throw new Error('approval_target_not_found')
    if (String(target.groupId || '') !== String(groupId || '')) throw new Error('approval_cross_group_denied')
    return target
}

function findPendingFriendApprovalTarget({ shortId, replyMessageId }) {
    const pending = requestApprovalService.listPendingApprovals()
    const normalizedShortId = String(shortId || '').trim().toUpperCase()
    const normalizedReplyMessageId = String(replyMessageId || '').trim()
    const target = (Array.isArray(pending.items) ? pending.items : []).find((item) => (
        (normalizedShortId && String(item.shortId || '').toUpperCase() === normalizedShortId) ||
        (normalizedReplyMessageId && String(item.notifyMessageId || '') === normalizedReplyMessageId)
    ))
    if (!target) throw new Error('approval_target_not_found')
    if (target.requestType !== 'friend') throw new Error('approval_target_not_friend')
    return target
}

const toolDefinitions = {
    'bili.user_lookup': {
        name: 'bili.user_lookup',
        description: '按 UID 查询 B 站用户信息，或按关键词搜索 B 站用户候选。',
        risk: 'low',
        permission: 'read_bili',
        normalizeArgs: normalizeBiliUserLookupArgs,
        summarize: (args) => args.uid
            ? `查询 B 站用户 ${args.uid}`
            : `搜索 B 站用户「${args.keyword}」`,
        execute: async (args) => {
            if (args.uid) {
                const info = await biliApi.getUserInfo(args.uid, args.groupId)
                return formatBiliUserInfo(info)
            }
            const result = await biliApi.searchUsers(args.keyword, args.groupId, { pageSize: 5 })
            return formatBiliUserSearch(result)
        }
    },
    'bili.video_lookup': {
        name: 'bili.video_lookup',
        description: '按 BV/av 号查询 B 站视频基础信息。',
        risk: 'low',
        permission: 'read_bili',
        normalizeArgs: normalizeBiliVideoLookupArgs,
        summarize: (args) => `查询 B 站视频 ${args.bvid}`,
        execute: async (args) => {
            const result = await biliApi.getVideoInfo(args.bvid, args.groupId)
            return formatBiliVideoInfo(result)
        }
    },
    'bili.subscription_status': {
        name: 'bili.subscription_status',
        description: '查询当前群是否已订阅指定 B 站用户或番剧。',
        risk: 'low',
        permission: 'read_subscriptions',
        normalizeArgs: normalizeSubscriptionStatusArgs,
        summarize: (args) => args.type === 'user'
            ? `查询群 ${args.groupId} 是否订阅用户 ${args.uid}`
            : `查询群 ${args.groupId} 是否订阅番剧 ${args.seasonId}`,
        execute: async (args) => {
            const subscriptions = await subscriptionService.getSubscriptionsByGroup(args.groupId)
            return formatSubscriptionStatus(subscriptions, args)
        }
    },
    'agent.get_group_config': {
        name: 'agent.get_group_config',
        description: '查询当前群的新 Agent 配置状态。',
        risk: 'low',
        permission: 'read_group_config',
        normalizeArgs: normalizeGroupQueryArgs,
        summarize: (args) => `查询群 ${args.groupId} 的 Agent 配置`,
        execute: async (args) => {
            const baseConfig = normalizeAgentConfig()
            const effective = getEffectiveAgentConfigForGroup(args.groupId, baseConfig)
            return {
                message: [
                    `群 ${args.groupId} Agent 配置：`,
                    `入口${effective.enabled ? '开启' : '关闭'}`,
                    `发言${effective.sendEnabled ? '开启' : '关闭'}`,
                    `观察模式${effective.observeOnly ? '开启' : '关闭'}`,
                    `模式 ${effective.decisionMode}`,
                    `冷却 ${effective.replyPolicy?.cooldownMs ?? '-'}ms`
                ].join('；'),
                data: {
                    groupId: args.groupId,
                    enabled: effective.enabled,
                    sendEnabled: effective.sendEnabled,
                    observeOnly: effective.observeOnly,
                    decisionMode: effective.decisionMode,
                    cooldownMs: effective.replyPolicy?.cooldownMs ?? null,
                    minReplyScore: effective.replyPolicy?.minReplyScore ?? null,
                    toolsEnabled: Boolean(effective.tools?.enabled)
                }
            }
        }
    },
    'agent.get_memory_summary': {
        name: 'agent.get_memory_summary',
        description: '查询当前群可见的 Agent 长期记忆摘要。',
        risk: 'low',
        permission: 'read_agent_memory',
        normalizeArgs: normalizeMemorySummaryArgs,
        summarize: (args) => args.query
            ? `查询群 ${args.groupId} 与「${args.query}」相关的 Agent 记忆`
            : `查询群 ${args.groupId} 的 Agent 记忆摘要`,
        execute: async (args) => {
            const memories = await longTermStore.listMemories({ groupId: args.groupId, limit: 50 })
            return formatMemorySummary(memories, args)
        }
    },
    'agent.learn_memory': {
        name: 'agent.learn_memory',
        description: '把明确、稳定、非敏感的事实写入当前群 Agent 长期记忆。',
        risk: 'low',
        permission: 'write_agent_memory',
        normalizeArgs: normalizeMemoryLearnArgs,
        summarize: (args) => `学习群 ${args.groupId} 记忆：${compactText(args.content, 40)}`,
        execute: async (args, context) => {
            const result = await longTermStore.storeMemoryHints({
                hints: [{
                    scope: args.scope,
                    type: args.type,
                    content: args.content,
                    confidence: args.confidence
                }],
                sessionContext: {
                    groupId: args.groupId,
                    userId: context?.userId || '',
                    topicId: context?.agentMessage?.topicId || '',
                    traceScope: context?.traceScope || ''
                },
                agentMessage: context?.agentMessage,
                decision: { action: 'tool_plan' }
            })
            return {
                message: result.stored > 0 ? `已学习：${compactText(args.content, 80)}` : `没有写入记忆：${result.error || '内容可能为空或敏感'}`,
                data: result
            }
        }
    },
    'browser.read_url': {
        name: 'browser.read_url',
        description: '受限读取公开 http/https 网页文本；会拒绝 localhost、内网地址和带凭证 URL。',
        risk: 'medium',
        permission: 'use_browser',
        normalizeArgs: normalizeBrowserReadArgs,
        summarize: (args) => `读取网页 ${args.url}`,
        execute: async (args, context) => agentBrowserService.readUrl(args, context)
    },
    'qq.get_group_info': {
        name: 'qq.get_group_info',
        description: '查询当前 QQ 群基础状态和全员禁言状态。',
        risk: 'low',
        permission: 'read_qq_group',
        normalizeArgs: normalizeGroupQueryArgs,
        summarize: (args) => `查询 QQ 群 ${args.groupId} 状态`,
        execute: async (args, context) => formatGroupInfo(await qqGroupAdminService.getGroupInfo(args, context))
    },
    'qq.get_group_mute_list': {
        name: 'qq.get_group_mute_list',
        description: '查询当前 QQ 群禁言成员列表。',
        risk: 'low',
        permission: 'read_qq_group',
        normalizeArgs: normalizeGroupQueryArgs,
        summarize: (args) => `查询群 ${args.groupId} 禁言列表`,
        execute: async (args, context) => formatMuteList(await qqGroupAdminService.getGroupMuteList(args, context), args)
    },
    'qq.get_essence_messages': {
        name: 'qq.get_essence_messages',
        description: '查询当前 QQ 群精华消息列表。',
        risk: 'low',
        permission: 'read_qq_group',
        normalizeArgs: normalizeGroupQueryArgs,
        summarize: (args) => `查询群 ${args.groupId} 精华消息`,
        execute: async (args, context) => formatEssenceMessages(await qqGroupAdminService.getEssenceMessages(args, context), args)
    },
    'qq.get_group_notices': {
        name: 'qq.get_group_notices',
        description: '查询当前 QQ 群公告列表。',
        risk: 'low',
        permission: 'read_qq_group',
        normalizeArgs: normalizeGroupQueryArgs,
        summarize: (args) => `查询群 ${args.groupId} 公告`,
        execute: async (args, context) => formatGroupNotices(await qqGroupAdminService.getGroupNotices(args, context), args)
    },
    'qq.get_group_system_messages': {
        name: 'qq.get_group_system_messages',
        description: '查询当前 QQ 群系统申请消息，作为运行期审批缓存的补充。',
        risk: 'low',
        permission: 'read_qq_group',
        normalizeArgs: normalizeCountGroupQueryArgs,
        summarize: (args) => `查询群 ${args.groupId} 系统消息`,
        execute: async (args, context) => formatSystemMessages(await qqGroupAdminService.getGroupSystemMessages(args, context), args, '系统消息')
    },
    'qq.get_group_ignored_notifies': {
        name: 'qq.get_group_ignored_notifies',
        description: '查询当前 QQ 群被过滤/忽略的系统申请消息。',
        risk: 'low',
        permission: 'read_qq_group',
        normalizeArgs: normalizeGroupQueryArgs,
        summarize: (args) => `查询群 ${args.groupId} 被忽略系统消息`,
        execute: async (args, context) => formatSystemMessages(await qqGroupAdminService.getGroupIgnoredNotifies(args, context), args, '被忽略系统消息')
    },
    'qq.get_at_all_remain': {
        name: 'qq.get_at_all_remain',
        description: '查询当前 QQ 群 @全体剩余次数。',
        risk: 'low',
        permission: 'read_qq_group',
        normalizeArgs: normalizeGroupQueryArgs,
        summarize: (args) => `查询群 ${args.groupId} @全体剩余次数`,
        execute: async (args, context) => formatAtAllRemain(await qqGroupAdminService.getAtAllRemain(args, context), args)
    },
    'qq.get_member_info': {
        name: 'qq.get_member_info',
        description: '查询当前 QQ 群成员角色、群名片和禁言状态。',
        risk: 'low',
        permission: 'read_qq_group',
        normalizeArgs: normalizeTargetUserArgs,
        summarize: (args) => `查询群 ${args.groupId} 成员 ${args.targetUserId}`,
        execute: async (args, context) => formatMemberInfo(await qqGroupAdminService.getMemberInfo({
            groupId: args.groupId,
            userId: args.targetUserId,
            noCache: true
        }, context))
    },
    'qq.search_members': {
        name: 'qq.search_members',
        description: '按 QQ 号、昵称或群名片搜索当前 QQ 群成员候选；用于管理动作前定位人员。',
        risk: 'low',
        permission: 'read_qq_group',
        normalizeArgs: normalizeMemberSearchArgs,
        summarize: (args) => `搜索群 ${args.groupId} 成员「${args.query}」`,
        execute: async (args, context) => formatMemberSearchResults(await qqGroupAdminService.searchMembers(args, context), args)
    },
    'qq.mute_member': {
        name: 'qq.mute_member',
        description: '禁言当前 QQ 群指定成员，最长 24 小时。',
        risk: 'high',
        permission: 'manage_qq_member',
        normalizeArgs: normalizeMuteArgs,
        summarize: (args) => `禁言群 ${args.groupId} 成员 ${args.targetUserId} ${args.duration} 秒`,
        execute: async (args, context) => qqGroupAdminService.muteMember(args, context)
    },
    'qq.unmute_member': {
        name: 'qq.unmute_member',
        description: '解除当前 QQ 群指定成员禁言。',
        risk: 'medium',
        permission: 'manage_qq_member',
        normalizeArgs: normalizeTargetUserArgs,
        summarize: (args) => `解除群 ${args.groupId} 成员 ${args.targetUserId} 禁言`,
        execute: async (args, context) => qqGroupAdminService.unmuteMember(args, context)
    },
    'qq.kick_member': {
        name: 'qq.kick_member',
        description: '将当前 QQ 群指定成员移出群聊。',
        risk: 'high',
        permission: 'manage_qq_member',
        normalizeArgs: normalizeKickArgs,
        summarize: (args) => `踢出群 ${args.groupId} 成员 ${args.targetUserId}`,
        execute: async (args, context) => qqGroupAdminService.kickMember(args, context)
    },
    'qq.set_member_card': {
        name: 'qq.set_member_card',
        description: '设置或清空当前 QQ 群指定成员的群名片。',
        risk: 'medium',
        permission: 'manage_qq_member',
        normalizeArgs: normalizeSetCardArgs,
        summarize: (args) => `设置群 ${args.groupId} 成员 ${args.targetUserId} 群名片为「${args.card || '空'}」`,
        execute: async (args, context) => qqGroupAdminService.setMemberCard(args, context)
    },
    'qq.set_whole_ban': {
        name: 'qq.set_whole_ban',
        description: '开启或关闭当前 QQ 群全员禁言。',
        risk: 'high',
        permission: 'manage_qq_group',
        normalizeArgs: normalizeQqGroupFlagArgs,
        summarize: (args) => `${args.enabled ? '开启' : '关闭'}群 ${args.groupId} 全员禁言`,
        execute: async (args, context) => qqGroupAdminService.setWholeBan(args, context)
    },
    'qq.delete_message': {
        name: 'qq.delete_message',
        description: '撤回当前 QQ 群中的指定消息；优先用于回复某条消息后要求撤回。',
        risk: 'medium',
        permission: 'manage_qq_message',
        normalizeArgs: normalizeDeleteMessageArgs,
        summarize: (args) => `撤回群 ${args.groupId} 消息 ${args.messageId}`,
        execute: async (args, context) => qqGroupAdminService.deleteMessage(args, context)
    },
    'qq.set_essence_message': {
        name: 'qq.set_essence_message',
        description: '将当前 QQ 群指定消息设置为精华消息；优先用于回复某条消息后设置。',
        risk: 'medium',
        permission: 'manage_qq_message',
        normalizeArgs: normalizeDeleteMessageArgs,
        summarize: (args) => `设置群 ${args.groupId} 消息 ${args.messageId} 为精华`,
        execute: async (args, context) => qqGroupAdminService.setEssenceMessage(args, context)
    },
    'qq.delete_essence_message': {
        name: 'qq.delete_essence_message',
        description: '将当前 QQ 群指定消息移出精华消息；优先用于回复某条消息后移出。',
        risk: 'medium',
        permission: 'manage_qq_message',
        normalizeArgs: normalizeDeleteMessageArgs,
        summarize: (args) => `移出群 ${args.groupId} 精华消息 ${args.messageId}`,
        execute: async (args, context) => qqGroupAdminService.deleteEssenceMessage(args, context)
    },
    'qq.list_pending_requests': {
        name: 'qq.list_pending_requests',
        description: '查询当前群待处理的加群申请。',
        risk: 'low',
        permission: 'manage_qq_request',
        normalizeArgs: normalizeGroupQueryArgs,
        summarize: (args) => `查询群 ${args.groupId} 待处理加群申请`,
        execute: async (args) => formatPendingApprovals(requestApprovalService.listPendingApprovals(), args.groupId)
    },
    'qq.handle_group_request': {
        name: 'qq.handle_group_request',
        description: '同意或拒绝当前群待处理的加群申请。',
        risk: 'high',
        permission: 'manage_qq_request',
        normalizeArgs: normalizeApprovalDecisionArgs,
        summarize: (args) => `${args.decision === 'approve' ? '同意' : '拒绝'}群 ${args.groupId} 加群申请 ${args.shortId || args.replyMessageId}`,
        execute: async (args, context) => {
            findPendingApprovalTarget({
                shortId: args.shortId,
                replyMessageId: args.replyMessageId,
                groupId: args.groupId
            })
            const result = await requestApprovalService.handleExactApprovalDecision(context?.ws, {
                decision: args.decision,
                shortId: args.shortId,
                replyMessageId: args.replyMessageId
            })
            if (!result.ok) throw new Error(result.error || result.status || 'approval_failed')
            return {
                message: `已${args.decision === 'approve' ? '同意' : '拒绝'}申请 ${result.shortId || args.shortId}。剩余待处理 ${result.pendingCount} 个。`,
                data: result
            }
        }
    },
    'qq.list_friend_requests': {
        name: 'qq.list_friend_requests',
        description: '查询待处理好友申请。',
        risk: 'low',
        permission: 'manage_qq_account',
        normalizeArgs: () => ({}),
        summarize: () => '查询待处理好友申请',
        execute: async () => formatFriendApprovals(requestApprovalService.listPendingApprovals())
    },
    'qq.handle_friend_request': {
        name: 'qq.handle_friend_request',
        description: '同意或拒绝待处理好友申请。',
        risk: 'high',
        permission: 'manage_qq_account',
        normalizeArgs: normalizeFriendApprovalDecisionArgs,
        summarize: (args) => `${args.decision === 'approve' ? '同意' : '拒绝'}好友申请 ${args.shortId || args.replyMessageId}`,
        execute: async (args, context) => {
            findPendingFriendApprovalTarget({
                shortId: args.shortId,
                replyMessageId: args.replyMessageId
            })
            const result = await requestApprovalService.handleExactApprovalDecision(context?.ws, {
                decision: args.decision,
                shortId: args.shortId,
                replyMessageId: args.replyMessageId
            })
            if (!result.ok) throw new Error(result.error || result.status || 'approval_failed')
            return {
                message: `已${args.decision === 'approve' ? '同意' : '拒绝'}好友申请 ${result.shortId || args.shortId}。剩余待处理 ${result.pendingCount} 个。`,
                data: result
            }
        }
    },
    'qq.set_online_status': {
        name: 'qq.set_online_status',
        description: '设置 Bot QQ 账号在线状态。',
        risk: 'medium',
        permission: 'manage_qq_account',
        normalizeArgs: normalizeOnlineStatusArgs,
        summarize: (args) => `设置 QQ 在线状态 ${args.preset || args.status}`,
        execute: async (args, context) => qqAccountService.setOnlineStatus(args, context)
    },
    'qq.set_input_status': {
        name: 'qq.set_input_status',
        description: '向指定 QQ 用户设置输入/说话状态。',
        risk: 'low',
        permission: 'manage_qq_account',
        normalizeArgs: normalizeInputStatusArgs,
        summarize: (args) => `向 ${args.userId} 设置输入状态 ${args.preset || args.eventType}`,
        execute: async (args, context) => qqAccountService.setInputStatus(args, context)
    },
    'agent.set_group_enabled': {
        name: 'agent.set_group_enabled',
        description: '开启或关闭指定群的新 Agent 观察入口。',
        risk: 'medium',
        permission: 'manage_group_config',
        normalizeArgs: normalizeAgentGroupFlagArgs,
        summarize: (args) => `${args.enabled ? '开启' : '关闭'}群 ${args.groupId} 的 Agent 入口`,
        execute: async (args) => {
            setAgentGroupFlag(args.groupId, 'enabled', args.enabled)
            return { message: `已${args.enabled ? '开启' : '关闭'}群 ${args.groupId} 的 Agent 入口。` }
        }
    },
    'agent.set_send_enabled': {
        name: 'agent.set_send_enabled',
        description: '开启或关闭指定群的 Agent 主动发言。',
        risk: 'medium',
        permission: 'manage_group_config',
        normalizeArgs: normalizeAgentGroupFlagArgs,
        summarize: (args) => `${args.enabled ? '开启' : '关闭'}群 ${args.groupId} 的 Agent 发言`,
        execute: async (args) => {
            setAgentGroupFlag(args.groupId, 'sendEnabled', args.enabled)
            return { message: `已${args.enabled ? '开启' : '关闭'}群 ${args.groupId} 的 Agent 发言。` }
        }
    },
    'agent.set_observe_only': {
        name: 'agent.set_observe_only',
        description: '设置指定群 Agent 是否仅观察不发言。',
        risk: 'medium',
        permission: 'manage_group_config',
        normalizeArgs: normalizeAgentGroupFlagArgs,
        summarize: (args) => `${args.enabled ? '设置' : '取消'}群 ${args.groupId} 的 Agent 仅观察模式`,
        execute: async (args) => {
            setAgentGroupFlag(args.groupId, 'observeOnly', args.enabled)
            return { message: `已${args.enabled ? '设置' : '取消'}群 ${args.groupId} 的 Agent 仅观察模式。` }
        }
    },
    'bot.set_group_enabled': {
        name: 'bot.set_group_enabled',
        description: '开启或关闭指定群的 Bot 原有功能。',
        risk: 'high',
        permission: 'manage_group_config',
        normalizeArgs: normalizeAgentGroupFlagArgs,
        summarize: (args) => `${args.enabled ? '开启' : '关闭'}群 ${args.groupId} 的 Bot 功能`,
        execute: async (args) => {
            if (args.enabled) {
                config.enableGroup(args.groupId)
            } else {
                config.disableGroup(args.groupId)
            }
            return { message: `已${args.enabled ? '开启' : '关闭'}群 ${args.groupId} 的 Bot 功能。` }
        }
    },
    'blacklist.add_user': {
        name: 'blacklist.add_user',
        description: '添加 QQ 用户到本群或全局黑名单。',
        risk: 'high',
        permission: 'manage_group_config',
        normalizeArgs: normalizeBlacklistArgs,
        summarize: (args) => `将 ${args.targetUserId} 加入${args.scope === 'global' ? '全局' : `群 ${args.groupId}`}黑名单`,
        execute: async (args) => {
            const list = args.scope === 'global' ? config.blacklistedQQs : ensureGroupBlacklist(args.groupId)
            if (!list.includes(args.targetUserId)) {
                list.push(args.targetUserId)
                config.save()
            }
            return { message: `已将 ${args.targetUserId} 加入${args.scope === 'global' ? '全局' : '本群'}黑名单。` }
        }
    },
    'blacklist.remove_user': {
        name: 'blacklist.remove_user',
        description: '从本群或全局黑名单移除 QQ 用户。',
        risk: 'medium',
        permission: 'manage_group_config',
        normalizeArgs: normalizeBlacklistArgs,
        summarize: (args) => `将 ${args.targetUserId} 移出${args.scope === 'global' ? '全局' : `群 ${args.groupId}`}黑名单`,
        execute: async (args) => {
            const list = args.scope === 'global' ? config.blacklistedQQs : ensureGroupBlacklist(args.groupId)
            const index = list.indexOf(args.targetUserId)
            if (index >= 0) {
                list.splice(index, 1)
                config.save()
            }
            return { message: `已将 ${args.targetUserId} 移出${args.scope === 'global' ? '全局' : '本群'}黑名单。` }
        }
    },
    'subscription.list': {
        name: 'subscription.list',
        description: '查询当前群的 B 站用户和番剧订阅列表。',
        risk: 'low',
        permission: 'read_subscriptions',
        normalizeArgs: normalizeGroupQueryArgs,
        summarize: (args) => `查询群 ${args.groupId} 的订阅列表`,
        execute: async (args) => {
            const subscriptions = await subscriptionService.getSubscriptionsByGroup(args.groupId)
            const users = Array.isArray(subscriptions.users) ? subscriptions.users : []
            const bangumis = Array.isArray(subscriptions.bangumis) ? subscriptions.bangumis : []
            return {
                message: [
                    `群 ${args.groupId} 当前订阅：`,
                    `用户 ${users.length} 个（${formatList(users, (item) => `${item.name || item.uid}(${item.uid})`)}）`,
                    `番剧 ${bangumis.length} 个（${formatList(bangumis, (item) => `${item.title || item.seasonId}(${item.seasonId})`)}）`
                ].join('；'),
                data: {
                    groupId: args.groupId,
                    users: users.map((item) => ({ uid: String(item.uid || ''), name: item.name || '' })),
                    bangumis: bangumis.map((item) => ({ seasonId: String(item.seasonId || ''), title: item.title || '' }))
                }
            }
        }
    },
    'subscription.add_user': {
        name: 'subscription.add_user',
        description: '为指定群订阅 B 站用户动态和直播。',
        risk: 'medium',
        permission: 'manage_subscriptions',
        normalizeArgs: normalizeUserSubscriptionArgs,
        summarize: (args) => `为群 ${args.groupId} 订阅 B 站用户 ${args.uid}`,
        execute: async (args) => {
            const name = await subscriptionService.addUserSubscription(args.uid, args.groupId)
            return { message: `成功订阅用户 ${name}（UID: ${args.uid}）。` }
        }
    },
    'subscription.remove_user': {
        name: 'subscription.remove_user',
        description: '取消指定群的 B 站用户订阅。',
        risk: 'medium',
        permission: 'manage_subscriptions',
        normalizeArgs: normalizeUserSubscriptionArgs,
        summarize: (args) => `取消群 ${args.groupId} 的 B 站用户 ${args.uid} 订阅`,
        execute: async (args) => {
            const removed = await subscriptionService.removeUserSubscription(args.uid, args.groupId)
            return { message: removed ? `已取消订阅用户 ${args.uid}。` : `未找到用户 ${args.uid} 的订阅。` }
        }
    },
    'subscription.add_bangumi': {
        name: 'subscription.add_bangumi',
        description: '为指定群订阅 B 站番剧更新。',
        risk: 'medium',
        permission: 'manage_subscriptions',
        normalizeArgs: normalizeBangumiSubscriptionArgs,
        summarize: (args) => `为群 ${args.groupId} 订阅番剧 ${args.seasonId}`,
        execute: async (args) => {
            const title = await subscriptionService.addBangumiSubscription(args.seasonId, args.groupId)
            return { message: `成功订阅番剧 ${title}（Season: ${args.seasonId}）。` }
        }
    },
    'subscription.remove_bangumi': {
        name: 'subscription.remove_bangumi',
        description: '取消指定群的 B 站番剧订阅。',
        risk: 'medium',
        permission: 'manage_subscriptions',
        normalizeArgs: normalizeBangumiSubscriptionArgs,
        summarize: (args) => `取消群 ${args.groupId} 的番剧 ${args.seasonId} 订阅`,
        execute: async (args) => {
            const removed = await subscriptionService.removeBangumiSubscription(args.seasonId, args.groupId)
            return { message: removed ? `已取消订阅番剧 ${args.seasonId}。` : `未找到番剧 ${args.seasonId} 的订阅。` }
        }
    }
}

function getToolDefinition(name) {
    return toolDefinitions[String(name || '').trim()] || null
}

function listToolDefinitions() {
    return Object.values(toolDefinitions).map((tool) => ({
        name: tool.name,
        description: tool.description,
        risk: tool.risk,
        permission: tool.permission
    }))
}

function normalizeToolIntent(toolIntent, sessionContext) {
    if (!toolIntent || typeof toolIntent !== 'object' || Array.isArray(toolIntent)) {
        throw new Error('missing_tool_intent')
    }
    const name = String(toolIntent.name || toolIntent.tool || toolIntent.toolName || '').trim()
    const definition = getToolDefinition(name)
    if (!definition) throw new Error(`unknown_tool:${name || 'empty'}`)

    const rawArgs = toolIntent.arguments || toolIntent.args || toolIntent.params || {}
    if (!rawArgs || typeof rawArgs !== 'object' || Array.isArray(rawArgs)) {
        throw new Error('tool_arguments_not_object')
    }

    const args = definition.normalizeArgs(rawArgs, sessionContext)
    return {
        id: `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: definition.name,
        args,
        risk: definition.risk,
        permission: definition.permission,
        summary: definition.summarize(args)
    }
}

async function executeToolPlan(plan, context = {}) {
    const definition = getToolDefinition(plan?.name)
    if (!definition) throw new Error(`unknown_tool:${plan?.name || 'empty'}`)
    return definition.execute(plan.args || {}, context)
}

module.exports = {
    getToolDefinition,
    listToolDefinitions,
    normalizeToolIntent,
    executeToolPlan
}
