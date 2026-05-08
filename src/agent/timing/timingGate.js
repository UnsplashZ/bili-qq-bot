const { recordTimingDecision } = require('./timingStateStore')
const { scoreSocialInterject } = require('../social/socialInterjectScorer')

function recentMessages(memoryObservation) {
    return Array.isArray(memoryObservation?.groupState?.recentMessages)
        ? memoryObservation.groupState.recentMessages
        : []
}

function directAddressed(agentMessage, traits = {}) {
    return Boolean(
        traits.mentionedBot ||
        traits.replyToBot ||
        traits.aliasMatched ||
        agentMessage?.mentionsSelf ||
        agentMessage?.replyToSelf ||
        agentMessage?.aliasMatched
    )
}

function messagesInWindow(messages, now, windowMs) {
    return messages.filter((message) => {
        const timestamp = Number(message?.timestamp || 0)
        return Number.isFinite(timestamp) && timestamp > 0 && now - timestamp <= windowMs
    })
}

function isRapidConversation({ memoryObservation, agentMessage, quietWindowMs }) {
    const now = Number(agentMessage?.timestamp || Date.now())
    const windowMessages = messagesInWindow(recentMessages(memoryObservation), now, Math.max(1000, quietWindowMs || 2500))
        .filter((message) => message.role !== 'assistant')
    if (memoryObservation?.chatPace?.crowded) return true
    if (windowMessages.length >= 3) return true
    const sameUserCount = windowMessages.filter((message) => String(message.userId || '') === String(agentMessage?.userId || '')).length
    return sameUserCount >= 2 && windowMessages.length >= 2
}

function isTwoPersonChat({ memoryObservation, agentMessage }) {
    const now = Number(agentMessage?.timestamp || Date.now())
    const windowMessages = messagesInWindow(recentMessages(memoryObservation), now, 45 * 1000)
        .filter((message) => message.role !== 'assistant')
    const users = [...new Set(windowMessages.map((message) => String(message.userId || '')).filter(Boolean))]
    if (users.length !== 2 || windowMessages.length < 4) return false
    const botMentioned = windowMessages.some((message) => message.mentionsSelf || message.aliasMatched || message.replyToSelf || message.replyTarget?.isBot)
    if (botMentioned) return false
    return users.includes(String(agentMessage?.userId || ''))
}

function socialPlanningAllowed(agentConfig, socialScore) {
    if (!agentConfig?.social?.enabled || agentConfig.social.mode === 'quiet') return false
    const planningMinScore = Number(agentConfig.social.planningMinScore ?? 0.3)
    const topicAffinityMinScore = Number(agentConfig.social.topicAffinityMinScore ?? 0.8)
    return Number(socialScore?.score || 0) >= planningMinScore || Number(socialScore?.topicAffinity || 0) >= topicAffinityMinScore
}

function hasOpenTopic(agentConfig, scoreResult, socialScore) {
    const score = Number(scoreResult?.score || 0)
    return Boolean(agentConfig?.social?.enabled && agentConfig.social.mode !== 'quiet' && (
        score >= 0.45 || socialPlanningAllowed(agentConfig, socialScore)
    ))
}

function makeDecision(timingAction, reason, waitMs = 0, signals = {}) {
    return {
        status: 'ok',
        timingAction,
        waitMs: Math.max(0, Math.trunc(Number(waitMs) || 0)),
        reason,
        signals: {
            directAddressed: false,
            rapidConversation: false,
            twoPersonChat: false,
            userLikelyStillTyping: false,
            topicOpenForBot: false,
            ...signals
        }
    }
}

function runTimingGate({ agentConfig, agentMessage, memoryObservation, scoreResult }) {
    const traits = scoreResult?.traits || {}
    const addressed = directAddressed(agentMessage, traits)
    if (agentConfig?.participation?.enabled === false) {
        if (addressed) {
            return makeDecision('continue', 'direct_addressed', 0, { directAddressed: true })
        }
        return makeDecision('listen', 'participation_disabled')
    }
    if (agentConfig?.participation?.timingGateEnabled === false) {
        return makeDecision('continue', 'timing_gate_disabled')
    }

    if (addressed) {
        return makeDecision('continue', 'direct_addressed', 0, { directAddressed: true })
    }

    const quietWindowMs = agentConfig?.timing?.quietWindowMs || 2500
    const rapidConversation = isRapidConversation({ memoryObservation, agentMessage, quietWindowMs })
    const twoPersonChat = isTwoPersonChat({ memoryObservation, agentMessage })
    const socialScore = scoreSocialInterject({
        agentConfig,
        agentMessage,
        memoryObservation,
        scoreResult
    })
    const topicOpenForBot = hasOpenTopic(agentConfig, scoreResult, socialScore)

    if (rapidConversation) {
        return makeDecision('wait', 'rapid_conversation', Math.min(agentConfig?.timing?.maxWaitMs || 12000, quietWindowMs), {
            rapidConversation: true,
            userLikelyStillTyping: true,
            topicOpenForBot
        })
    }

    if (twoPersonChat && !topicOpenForBot) {
        return makeDecision('listen', 'two_person_chat_without_bot', 0, {
            twoPersonChat: true
        })
    }

    if (!topicOpenForBot && Number(scoreResult?.score || 0) < 0.25) {
        return makeDecision('listen', 'low_relation_to_bot', 0, {
            topicOpenForBot: false,
            socialScore: socialScore.score,
            topicAffinity: socialScore.topicAffinity
        })
    }

    return makeDecision('continue', 'timing_allows_planning', 0, {
        rapidConversation,
        twoPersonChat,
        topicOpenForBot,
        socialScore: socialScore.score,
        topicAffinity: socialScore.topicAffinity
    })
}

function runAndRecordTimingGate(args) {
    const decision = runTimingGate(args)
    recordTimingDecision({
        groupId: args?.agentMessage?.groupId,
        decision,
        timestamp: args?.agentMessage?.timestamp || Date.now()
    })
    return decision
}

module.exports = {
    runTimingGate,
    runAndRecordTimingGate,
    directAddressed,
    isRapidConversation,
    isTwoPersonChat
}
