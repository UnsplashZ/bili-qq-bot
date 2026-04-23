'use strict'

function normalize(text) {
    return String(text || '').trim()
}

function isQuestionLike(text) {
    return /[?？]|为什么|怎么|如何|啥原因|是什么|要不要|能不能|可以吗|吗$|呢$/.test(text)
}

function isChatLike(text) {
    return /^(哈哈+|呵呵+|嗯+|哦+|好吧|行吧|确实|笑死|收到|ok|OK|好的)$/.test(text)
        || /^(哈哈+|呵呵+).*(确实|是啊|对啊)?$/.test(text)
}

function hasActionIntent(text) {
    return /关闭|打开|改掉|修改|改成|删除|删掉|清空|重置|处理|执行|设置|关了|开了|调一下|改一下/.test(text)
}

function isExplicitActionRequest(text) {
    return /(请你|帮我|麻烦你|你去|你来|请帮我).*(关闭|打开|修改|删除|清空|重置|设置|处理|执行)/.test(text)
}

function classifyResponseModeHint({ rawMessage, messageMeta = {}, triggerLevel = 'ambient' }) {
    const text = normalize(rawMessage)
    const source = messageMeta.source || 'group'

    if (isChatLike(text)) {
        return { mode: 'chat', reasons: ['chat_like'] }
    }

    if (hasActionIntent(text)) {
        if ((source === 'private' || triggerLevel === 'direct') && isExplicitActionRequest(text)) {
            return { mode: 'action_ready', reasons: ['explicit_action_request'] }
        }
        return { mode: 'confirm_needed', reasons: ['ambiguous_action'] }
    }

    if (isQuestionLike(text)) {
        return { mode: 'answer_only', reasons: ['question_like'] }
    }

    return { mode: 'answer_only', reasons: ['default_answer_only'] }
}

module.exports = {
    classifyResponseModeHint
}
