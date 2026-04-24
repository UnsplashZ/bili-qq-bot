function targetIsCurrentGroup(plan, actor) {
    const targetGroupId = plan?.args?.groupId ? String(plan.args.groupId) : ''
    const currentGroupId = actor?.groupId ? String(actor.groupId) : ''
    return targetGroupId && currentGroupId && targetGroupId === currentGroupId
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

    return { allowed: false, reason: `unknown_permission:${plan.permission || 'empty'}` }
}

module.exports = {
    checkToolPermission
}
