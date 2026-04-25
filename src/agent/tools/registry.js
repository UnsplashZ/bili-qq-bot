const config = require('../../config')
const subscriptionService = require('../../services/subscriptionService')
const biliApi = require('../../services/biliApi')
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

async function executeToolPlan(plan) {
    const definition = getToolDefinition(plan?.name)
    if (!definition) throw new Error(`unknown_tool:${plan?.name || 'empty'}`)
    return definition.execute(plan.args || {})
}

module.exports = {
    getToolDefinition,
    listToolDefinitions,
    normalizeToolIntent,
    executeToolPlan
}
