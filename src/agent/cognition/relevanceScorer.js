const { extractMessageTraits, summarizeTraitReasons } = require('./messageTraits')

function clampScore(value) {
    return Math.min(1, Math.max(0, Number(value) || 0))
}

function scoreTraits(traits) {
    let score = 0

    if (traits.mentionedBot) score += 0.45
    if (traits.aliasMatched) score += 0.25
    if (traits.replyToBot) score += 0.65
    else if (traits.hasReply) score += 0.12
    if (traits.managementTopic) score += 0.18
    if (traits.questionLike) score += 0.08
    if (traits.privilegedActor) score += 0.04
    if (traits.crowdedChat) score -= 0.18
    if (traits.tooShort) score -= 0.1

    return clampScore(score)
}

function scoreMessage({ agentMessage, memoryObservation, actor }) {
    const traits = extractMessageTraits({ agentMessage, memoryObservation, actor })
    const { reasons, penalties } = summarizeTraitReasons(traits)

    return {
        score: scoreTraits(traits),
        reasons,
        penalties,
        traits,
        components: {
            ...traits,
            chatPace: memoryObservation?.chatPace || null
        }
    }
}

module.exports = {
    scoreMessage,
    scoreTraits,
    clampScore
}
