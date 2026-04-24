const config = require('../../config')
const subscriptionService = require('../../services/subscriptionService')

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

const toolDefinitions = {
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
