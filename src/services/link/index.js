'use strict'

const notificationService = require('../notificationService')
const { extractLinksFromMessage } = require('./linkExtractor')
const linkCacheService = require('./linkCacheService')
const { processLinkDescriptors } = require('./linkPipeline')
const { normalizeIncomingMessage } = require('./messageLinkNormalizer')
const { shortLinkRegex, expandShortUrl } = require('./shortLinkExpander')

async function defaultSendGroupMessage(ws, groupId, messageChain, userId = null) {
    if (typeof groupId === 'string' && groupId.startsWith('private_')) {
        const realUserId = groupId.replace('private_', '')
        await notificationService.sendPrivateMessage(ws, realUserId, messageChain, 'LinkHandler', true)
        return
    }

    if (groupId) {
        await notificationService.sendGroupMessage(ws, groupId, messageChain, 'LinkHandler', true)
        return
    }

    if (userId) {
        await notificationService.sendPrivateMessage(ws, userId, messageChain, 'LinkHandler', true)
    }
}

async function defaultSendGroupMessageWithFallback(ws, groupId, base64Image, url, userId = null) {
    return defaultSendGroupMessage(ws, groupId, [
        { type: 'image', data: { file: `base64://${base64Image}` } },
        { type: 'text', data: { text: `${url}` } }
    ], userId)
}

function cacheResolvedText(text, groupId, traceContext = null) {
    if (!text || !groupId) {
        return {
            addedCount: 0,
            cacheKeys: []
        }
    }

    const links = extractLinksFromMessage(text, groupId, traceContext)
    const cacheKeys = []

    for (const descriptor of links) {
        const cacheKey = linkCacheService.markProcessedDescriptor(descriptor)
        if (cacheKey) {
            cacheKeys.push(cacheKey)
        }
    }

    return {
        addedCount: cacheKeys.length,
        cacheKeys
    }
}

async function expandShortLinks(rawMessage) {
    let preparedRawMessage = typeof rawMessage === 'string' ? rawMessage : String(rawMessage || '')
    if (!preparedRawMessage) {
        return preparedRawMessage
    }

    if (shortLinkRegex.test(preparedRawMessage)) {
        const match = preparedRawMessage.match(shortLinkRegex)
        if (match) {
            const expanded = await expandShortUrl(match[0])
            if (expanded) {
                preparedRawMessage += ` ${expanded}`
            }
        }
    }

    return preparedRawMessage
}

async function prepareIncomingMessageLinks({ rawMessage, messageSegments = [], groupId = null, traceContext = null } = {}) {
    let preparedRawMessage = typeof rawMessage === 'string' ? rawMessage : String(rawMessage || '')

    const normalized = normalizeIncomingMessage({
        rawMessage: preparedRawMessage,
        messageSegments,
        traceContext
    })
    preparedRawMessage = normalized.rawMessage
    preparedRawMessage = await expandShortLinks(preparedRawMessage)

    const safeRawMessage = preparedRawMessage.replace(/\[CQ:[^\]]+\]/g, '')
    const descriptors = extractLinksFromMessage(safeRawMessage, groupId, traceContext)

    return {
        rawMessage: preparedRawMessage,
        safeRawMessage,
        descriptors
    }
}

async function handleIncomingMessageLinks({
    ws,
    groupId,
    userId,
    descriptors,
    traceContext = null,
    messageId = null,
    sendGroupMessage = defaultSendGroupMessage,
    sendGroupMessageWithFallback = defaultSendGroupMessageWithFallback
} = {}) {
    const result = await processLinkDescriptors(descriptors, {
        ws,
        groupId,
        userId,
        traceContext,
        messageId,
        scope: traceContext?.scope || ''
    }, {
        logContext: {
            scope: traceContext?.scope || '',
            messageId: messageId || '',
            groupId,
            userId
        },
        sendGroupMessage,
        sendGroupMessageWithFallback
    })

    return result
}

module.exports = {
    cacheResolvedText,
    expandShortLinks,
    prepareIncomingMessageLinks,
    handleIncomingMessageLinks,
    extractLinksFromMessage,
    expandShortUrl,
    shortLinkRegex,
    isCached: linkCacheService.isCached.bind(linkCacheService),
    markProcessed: linkCacheService.markProcessed.bind(linkCacheService),
    markProcessedDescriptor: linkCacheService.markProcessedDescriptor.bind(linkCacheService),
    cleanupExpired: linkCacheService.cleanupExpired.bind(linkCacheService),
    processLinkDescriptors,
    __resetCacheForTests: linkCacheService.__resetForTests.bind(linkCacheService),
    __setCacheTimeForTests: linkCacheService.__setCacheTimeForTests.bind(linkCacheService)
}
