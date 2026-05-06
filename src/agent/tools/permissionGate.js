function targetIsCurrentGroup(plan, actor) {
    const targetGroupId = plan?.args?.groupId ? String(plan.args.groupId) : ''
    const currentGroupId = actor?.groupId ? String(actor.groupId) : ''
    return targetGroupId && currentGroupId && targetGroupId === currentGroupId
}

function actorIsQqManager(actor) {
    return actor?.qqRole === 'admin' || actor?.qqRole === 'owner'
}

function checkToolPermission({ plan, actor }) {
    if (!plan) {
        return { allowed: false, reason: 'missing_tool_plan' }
    }
    if (!actor) {
        return { allowed: false, reason: 'missing_actor' }
    }

    if (plan.args?.scope === 'global') {
        return actor.isRoot
            ? { allowed: true, reason: 'root_global_allowed' }
            : { allowed: false, reason: 'global_tool_requires_root' }
    }

    if (plan.permission === 'manage_global_config') {
        return actor.canManageGlobalConfig
            ? { allowed: true, reason: 'global_config_allowed' }
            : { allowed: false, reason: 'global_config_permission_denied' }
    }

    if (plan.permission === 'manage_group_config') {
        if (actor.isRoot) return { allowed: true, reason: 'root_group_config_allowed' }
        if (!targetIsCurrentGroup(plan, actor)) {
            return { allowed: false, reason: 'cross_group_permission_denied' }
        }
        return actor.canManageGroupConfig
            ? { allowed: true, reason: 'group_config_allowed' }
            : { allowed: false, reason: 'group_config_permission_denied' }
    }

    if (plan.permission === 'manage_subscriptions') {
        if (actor.isRoot) return { allowed: true, reason: 'root_subscription_allowed' }
        if (!targetIsCurrentGroup(plan, actor)) {
            return { allowed: false, reason: 'cross_group_permission_denied' }
        }
        return actor.canManageSubscriptions
            ? { allowed: true, reason: 'subscription_allowed' }
            : { allowed: false, reason: 'subscription_permission_denied' }
    }

    if (plan.permission === 'manage_qq_account') {
        return actor.isRoot
            ? { allowed: true, reason: 'root_qq_account_allowed' }
            : { allowed: false, reason: 'qq_account_requires_root' }
    }

    if (['manage_qq_group', 'manage_qq_member', 'manage_qq_message', 'manage_qq_request'].includes(plan.permission)) {
        if (actor.isRoot) return { allowed: true, reason: 'root_qq_manage_allowed' }
        if (!targetIsCurrentGroup(plan, actor)) {
            return { allowed: false, reason: 'cross_group_permission_denied' }
        }
        return actorIsQqManager(actor)
            ? { allowed: true, reason: 'qq_manager_allowed' }
            : { allowed: false, reason: 'qq_manager_permission_denied' }
    }

    if (['read_group_config', 'read_subscriptions', 'read_bili', 'read_agent_memory', 'write_agent_memory', 'read_qq_group', 'use_browser'].includes(plan.permission)) {
        if (actor.isRoot) return { allowed: true, reason: 'root_read_allowed' }
        return targetIsCurrentGroup(plan, actor)
            ? { allowed: true, reason: 'current_group_read_allowed' }
            : { allowed: false, reason: 'cross_group_permission_denied' }
    }

    return { allowed: false, reason: `unknown_permission:${plan.permission || 'empty'}` }
}

module.exports = {
    checkToolPermission
}
