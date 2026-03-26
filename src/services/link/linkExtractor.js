'use strict'

const logger = require('../../utils/logger')
const { buildTokenInfo, parseStructuredToken } = require('./structuredLinkParser')
const { parseRegexToken } = require('./regexLinkParser')

const MAX_MESSAGE_LENGTH = 10000

function getScope(traceContext = null) {
    return traceContext?.scope || ''
}

function appendUniqueLink(links, link) {
    if (!link) {
        return
    }

    const duplicateLink = links.some((existingLink) =>
        existingLink.type === link.type
        && existingLink.cacheKey === link.cacheKey
        && existingLink.sourceToken === link.sourceToken
    )

    if (!duplicateLink) {
        links.push(link)
    }
}

function extractLinksFromMessage(rawMessage, groupId, traceContext = null) {
    const scope = getScope(traceContext)
    if (!rawMessage || typeof rawMessage !== 'string') {
        logger.logEvent('warn', 'LINK', scope, 'extract-skipped', {
            groupId,
            reason: 'invalid_message_type',
            valueType: typeof rawMessage
        })
        return []
    }

    const checkLength = Math.min(rawMessage.length, MAX_MESSAGE_LENGTH)
    const checkStr = rawMessage.substring(0, checkLength)
    const hasBilibiliDomain = checkStr.includes('bilibili.com')
        || checkStr.includes('b23.tv')
        || checkStr.includes('bilibili')
        || /\b(?:[mM][lL]|[aA][uU]|[aA][mM]|[rR][lL])\d+\b/.test(checkStr)

    if (!hasBilibiliDomain) {
        logger.logEvent('debug', 'LINK', scope, 'extract-skipped', {
            groupId,
            reason: 'domain_not_found'
        })
        return []
    }

    if (rawMessage.length > MAX_MESSAGE_LENGTH) {
        logger.logEvent('warn', 'LINK', scope, 'message-truncated', {
            groupId,
            originalLength: rawMessage.length,
            truncatedLength: MAX_MESSAGE_LENGTH
        })
        rawMessage = rawMessage.substring(0, MAX_MESSAGE_LENGTH)
    }

    const links = []
    const tokenInfos = rawMessage
        .split(/\s+/)
        .map((token) => buildTokenInfo(token))
        .filter(Boolean)

    for (const tokenInfo of tokenInfos) {
        const structuredResult = parseStructuredToken(tokenInfo, groupId)
        if (structuredResult.handled) {
            appendUniqueLink(links, structuredResult.link)
            continue
        }

        const regexLinks = parseRegexToken(tokenInfo, groupId)
        for (const link of regexLinks) {
            appendUniqueLink(links, link)
        }
    }

    logger.logEvent('info', 'LINK', scope, 'extract', {
        groupId,
        count: links.length
    })
    return links
}

module.exports = {
    extractLinksFromMessage,
    appendUniqueLink,
    buildTokenInfo
}
