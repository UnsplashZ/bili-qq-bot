function includesPattern(text, pattern) {
    return pattern.test(String(text || ''))
}

function isLowInformation(text) {
    const normalized = String(text || '').replace(/\s+/g, '')
    if (normalized.length <= 2) return true
    if (/^(hi|hello|test|测试|在吗|有人吗)$/i.test(normalized)) return true
    return false
}

const managementTopicPattern = /订阅|配置|设置|开启|关闭|管理|权限|拉黑|黑名单|禁言|解禁|撤回|踢出?|群名片|全员禁言|精华|加群|好友申请|在线状态|输入状态|公告|头衔|申请/

function extractMessageTraits({ agentMessage, memoryObservation, actor }) {
    const text = agentMessage.normalizedText || ''
    const managementTopic = includesPattern(text, managementTopicPattern)
    const questionLike = includesPattern(text, /\?|？|吗|么|怎么|如何|为什么|谁|什么/)
    const tooShort = String(text).replace(/\s+/g, '').length <= 2
    const lowInformation = isLowInformation(text)
    const crowdedChat = Boolean(memoryObservation?.chatPace?.crowded)
    const privilegedActor = Boolean(actor?.canManageGroupConfig || actor?.canManageSubscriptions)

    return {
        mentionedBot: Boolean(agentMessage.mentionsSelf),
        aliasMatched: Boolean(agentMessage.aliasMatched),
        replyToBot: Boolean(agentMessage.replyToSelf),
        hasReply: Boolean(agentMessage.hasReply),
        questionLike,
        managementTopic,
        tooShort,
        lowInformation,
        possibleSpam: false,
        crowdedChat,
        cooldownActive: false,
        privilegedActor,
        chatPace: memoryObservation?.chatPace || null
    }
}

function summarizeTraitReasons(traits) {
    const reasons = []
    const penalties = []

    if (traits.mentionedBot) reasons.push('mentioned_bot')
    if (traits.aliasMatched) reasons.push('alias_matched')
    if (traits.replyToBot || traits.hasReply) reasons.push('reply_context')
    if (traits.managementTopic) reasons.push('bot_management_topic')
    if (traits.questionLike) reasons.push('question_like')
    if (traits.privilegedActor) reasons.push('privileged_actor')
    if (traits.crowdedChat) penalties.push('crowded_chat')
    if (traits.tooShort) penalties.push('too_short')
    if (traits.lowInformation) penalties.push('low_information')
    if (traits.possibleSpam) penalties.push('possible_spam')
    if (traits.cooldownActive) penalties.push('cooldown_active')

    return { reasons, penalties }
}

module.exports = {
    extractMessageTraits,
    summarizeTraitReasons
}
