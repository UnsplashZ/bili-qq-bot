const longTermStore = require('./longTermStore')

function compactText(value, limit = 240) {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    if (!text) return ''
    return text.length > limit ? `${text.slice(0, limit - 3)}...` : text
}

function buildTopicSummaryContent(topicSnapshot) {
    const keywords = Array.isArray(topicSnapshot?.keywords) ? topicSnapshot.keywords.slice(0, 8).join(' / ') : ''
    const participants = Array.isArray(topicSnapshot?.participants) ? topicSnapshot.participants.slice(0, 8).join(',') : ''
    const summary = compactText(topicSnapshot?.summary || keywords || 'general', 120)
    const parts = [`话题摘要：${summary}`]
    if (keywords) parts.push(`关键词：${keywords}`)
    if (participants) parts.push(`参与者：${participants}`)
    if (topicSnapshot?.messageCount) parts.push(`消息数：${topicSnapshot.messageCount}`)
    return parts.join('；')
}

function shouldStoreTopicSummary({ agentConfig, topic, now }) {
    const longTermConfig = agentConfig?.longTerm || {}
    if (longTermConfig.topicSummaryEnabled === false) return { ok: false, reason: 'disabled' }
    if (!topic?.topicId) return { ok: false, reason: 'missing_topic' }

    const minMessages = Math.max(2, Number(longTermConfig.topicSummaryMinMessages) || 6)
    if ((topic.messageCount || 0) < minMessages) return { ok: false, reason: 'message_count_below_threshold' }

    const minIntervalMs = Math.max(60 * 1000, Number(longTermConfig.topicSummaryMinIntervalMs) || 10 * 60 * 1000)
    if (topic.lastSummarizedAt && now - topic.lastSummarizedAt < minIntervalMs) {
        return { ok: false, reason: 'summary_interval_active' }
    }

    return { ok: true, reason: 'eligible' }
}

async function maybeStoreTopicSummary({ agentConfig, memoryObservation, sessionContext, agentMessage }) {
    const topic = memoryObservation?.topic
    const now = agentMessage?.timestamp || Date.now()
    const eligibility = shouldStoreTopicSummary({ agentConfig, topic, now })
    if (!eligibility.ok) {
        return { stored: 0, skipped: 0, reason: eligibility.reason }
    }

    const topicSnapshot = memoryObservation.topicSnapshot || topic
    const result = await longTermStore.storeTopicSummary({
        sessionContext,
        topicSnapshot,
        content: buildTopicSummaryContent(topicSnapshot),
        confidence: 0.55
    })

    if (result.stored > 0 && topic) {
        topic.lastSummarizedAt = now
    }

    return { ...result, reason: result.stored > 0 ? 'stored' : 'not_stored' }
}

module.exports = {
    buildTopicSummaryContent,
    shouldStoreTopicSummary,
    maybeStoreTopicSummary
}
