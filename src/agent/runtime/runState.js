class AgentRunState {
    constructor({
        context,
        groupId,
        agentConfig,
        agentMessage,
        actor,
        memoryObservation,
        sessionContext,
        timingReentry = false
    }) {
        this.context = context
        this.groupId = groupId
        this.agentConfig = agentConfig
        this.agentMessage = agentMessage
        this.actor = actor
        this.memoryObservation = memoryObservation
        this.sessionContext = sessionContext
        this.timingReentry = timingReentry
    }

    actorSummary() {
        return {
            isRoot: this.actor.isRoot,
            isConfiguredGroupAdmin: this.actor.isConfiguredGroupAdmin,
            qqRole: this.actor.qqRole,
            canManageGroupConfig: this.actor.canManageGroupConfig,
            canManageSubscriptions: this.actor.canManageSubscriptions,
            canManageGlobalConfig: this.actor.canManageGlobalConfig
        }
    }

    baseResult(extra = {}) {
        return {
            skipped: false,
            message: this.agentMessage,
            session: this.sessionContext,
            topic: this.memoryObservation.topicSnapshot,
            timingReentry: this.timingReentry,
            ...extra
        }
    }

    createTimingReentry(overrides = {}) {
        return new AgentRunState({
            context: this.context,
            groupId: this.groupId,
            agentConfig: overrides.agentConfig || this.agentConfig,
            agentMessage: {
                ...this.agentMessage,
                timestamp: Date.now()
            },
            actor: this.actor,
            memoryObservation: this.memoryObservation,
            sessionContext: {
                ...this.sessionContext,
                timingReentry: true
            },
            timingReentry: true
        })
    }
}

module.exports = {
    AgentRunState
}
