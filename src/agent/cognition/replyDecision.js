function decideReply({ scoreResult, agentConfig }) {
    const threshold = agentConfig.replyPolicy.minReplyScore
    const reasons = [...(scoreResult.reasons || [])]
    const penalties = [...(scoreResult.penalties || [])]

    if (agentConfig.observeOnly) {
        return {
            action: 'listen',
            score: scoreResult.score,
            reasons: [...reasons, 'observe_only_enabled'],
            penalties,
            wouldReply: scoreResult.score >= threshold,
            threshold
        }
    }

    if (scoreResult.score >= threshold) {
        return {
            action: 'reply',
            score: scoreResult.score,
            reasons,
            penalties,
            wouldReply: true,
            threshold
        }
    }

    return {
        action: 'listen',
        score: scoreResult.score,
        reasons,
        penalties,
        wouldReply: false,
        threshold
    }
}

module.exports = {
    decideReply
}
