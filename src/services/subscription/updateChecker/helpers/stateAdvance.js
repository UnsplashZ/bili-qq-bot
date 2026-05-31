function decideAdvance(result) {
    const successGroups = Array.isArray(result?.successGroups)
        ? result.successGroups
        : []
    const failedGroups = Array.isArray(result?.failedGroups)
        ? result.failedGroups
        : []
    const dedupSkippedGroups = Array.isArray(result?.dedupSkippedGroups)
        ? result.dedupSkippedGroups
        : []

    if (successGroups.length > 0 || dedupSkippedGroups.length > 0) {
        return { action: 'advance', reason: 'has_success' }
    }

    if (failedGroups.length > 0) {
        return { action: 'retry', reason: 'no_success' }
    }

    return { action: 'skip', reason: 'no_targets' }
}

module.exports = {
    decideAdvance
}
