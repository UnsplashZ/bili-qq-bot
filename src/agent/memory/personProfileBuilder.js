const personProfileStore = require('./personProfileStore')

async function maybeRefreshPersonProfile({ agentConfig, groupId, userId, longTermMemories = [], agentMessage } = {}) {
    if (agentConfig?.participation?.enabled === false) return { status: 'skipped', reason: 'participation_disabled' }
    if (agentConfig?.participation?.personProfileEnabled !== true) return { status: 'skipped', reason: 'person_profile_disabled' }
    if (!groupId || !userId) return { status: 'skipped', reason: 'missing_identity' }
    const result = await personProfileStore.buildAndStoreProfile({
        groupId,
        userId,
        memories: longTermMemories,
        sender: agentMessage?.sender || {}
    })
    return {
        status: result.stored ? 'ok' : 'skipped',
        reason: result.stored ? '' : 'profile_not_stored',
        stored: result.stored,
        skipped: result.skipped,
        profile: result.profile
    }
}

function compactProfile(profile) {
    if (!profile) return null
    return {
        userId: profile.userId,
        displayNames: profile.displayNames || [],
        preferences: profile.preferences || [],
        communicationStyle: profile.communicationStyle || [],
        boundaries: profile.boundaries || [],
        relationshipNotes: profile.relationshipNotes || [],
        confidence: profile.confidence || 0,
        updatedAt: profile.updatedAt || ''
    }
}

module.exports = {
    maybeRefreshPersonProfile,
    compactProfile
}
