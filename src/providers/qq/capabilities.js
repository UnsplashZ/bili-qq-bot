const CAPABILITIES = {
    messageReceive: 'message.receive',
    groupMessageReceive: 'message.group.receive',
    c2cMessageReceive: 'message.c2c.receive',
    sendGroupText: 'message.group.send.text',
    sendPrivateText: 'message.private.send.text',
    sendGroupImage: 'message.group.send.image',
    sendPrivateImage: 'message.private.send.image',
    sendGroupVideo: 'message.group.send.video',
    sendPrivateVideo: 'message.private.send.video',
    deleteMessage: 'message.delete',
    emojiReaction: 'message.emoji_reaction',
    atAll: 'message.at_all',
    groupList: 'group.list',
    groupMemberInfo: 'group.member.info',
    groupMemberList: 'group.member.list',
    groupModeration: 'group.moderation',
    groupNotice: 'group.notice',
    groupEssence: 'group.essence',
    groupRequest: 'group.request',
    friendRequest: 'friend.request',
    accountStatus: 'account.status'
}

const NAPCAT_CAPABILITIES = new Set(Object.values(CAPABILITIES))

const OFFICIAL_CAPABILITIES = new Set([
    CAPABILITIES.messageReceive,
    CAPABILITIES.groupMessageReceive,
    CAPABILITIES.c2cMessageReceive,
    CAPABILITIES.sendGroupText,
    CAPABILITIES.sendPrivateText,
    CAPABILITIES.sendGroupImage,
    CAPABILITIES.sendPrivateImage,
    CAPABILITIES.sendGroupVideo,
    CAPABILITIES.sendPrivateVideo,
    CAPABILITIES.deleteMessage
])

function hasCapability(provider, capability) {
    if (!provider || !capability) return false
    if (typeof provider.hasCapability === 'function') {
        return provider.hasCapability(capability)
    }
    const capabilities = provider.capabilities
    if (capabilities instanceof Set) return capabilities.has(capability)
    if (Array.isArray(capabilities)) return capabilities.includes(capability)
    return false
}

function listCapabilities(provider) {
    const capabilities = provider?.capabilities
    if (capabilities instanceof Set) return Array.from(capabilities)
    if (Array.isArray(capabilities)) return [...capabilities]
    return []
}

module.exports = {
    CAPABILITIES,
    NAPCAT_CAPABILITIES,
    OFFICIAL_CAPABILITIES,
    hasCapability,
    listCapabilities
}
