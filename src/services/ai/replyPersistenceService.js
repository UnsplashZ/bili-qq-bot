'use strict'

async function persistAssistantReply({
    contextKey,
    groupId,
    reply,
    addMessageToContext,
    addMemory,
    botSelfId,
    log
}) {
    addMessageToContext(contextKey, 'assistant', reply, null, 'AI助手', {
        speakerId: String(botSelfId || 'assistant'),
        speakerName: 'AI助手',
        mentionIds: [],
        isAtBot: false,
        source: String(groupId || '').startsWith('private_') ? 'private' : 'group'
    })

    Promise.resolve(addMemory(contextKey, reply, 'assistant')).catch((error) => {
        log('error', 'assistant-memory-save-failed', {
            error: String(error?.message || error || '')
        })
    })
}

module.exports = {
    persistAssistantReply
}
