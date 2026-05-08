function isSocialAction(action) {
    return action === 'react'
}

function isAmbientAction(action) {
    return action === 'react'
}

function isSocialReplyAction(action, messageTraits = {}) {
    if (action !== 'reply') return false
    return !Boolean(messageTraits.mentionedBot || messageTraits.replyToBot || messageTraits.aliasMatched)
}

module.exports = {
    isSocialAction,
    isAmbientAction,
    isSocialReplyAction
}
