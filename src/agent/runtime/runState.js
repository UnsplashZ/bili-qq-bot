class AgentRunState {
    constructor({
        context,
        groupId,
        agentConfig,
        agentMessage,
        actor,
        memoryObservation,
        sessionContext
    }) {
        this.context = context
        this.groupId = groupId
        this.agentConfig = agentConfig
        this.agentMessage = agentMessage
        this.actor = actor
        this.memoryObservation = memoryObservation
        this.sessionContext = sessionContext
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
            ...extra
        }
    }
}

module.exports = {
    AgentRunState
}
