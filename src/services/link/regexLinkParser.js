'use strict'

const { monitorRegex } = require('../../utils/regexMonitor')
const { createLink } = require('./structuredLinkParser')

const linkTypes = [
    { regex: /(BV[a-zA-Z0-9]{10})|(av[0-9]+)/, type: 'video', extractId: (match) => match[0] },
    { regex: /play\/ss([0-9]+)/, type: 'bangumi', extractId: (match) => match[1] },
    { regex: /(?:t\.bilibili\.com\/|m\.bilibili\.com\/dynamic\/)([0-9]+)/, type: 'dynamic', extractId: (match) => match[1] },
    { regex: /read\/cv([0-9]+)/, type: 'article', extractId: (match) => match[1] },
    { regex: /live.bilibili.com\/([0-9]+)/, type: 'live', extractId: (match) => match[1] },
    { regex: /opus\/([0-9]+)/, type: 'opus', extractId: (match) => match[1] },
    { regex: /bangumi\/play\/ep([0-9]+)/, type: 'ep', extractId: (match) => match[1] },
    { regex: /bangumi\/media\/md([0-9]+)/, type: 'media', extractId: (match) => match[1] },
    { regex: /(?:space\.bilibili\.com\/|(?:https?:\/\/)?[^/]*bilibili\.com\/space\/)([0-9]+)/, type: 'user', extractId: (match) => match[1] },
    { regex: /(?:medialist\/detail\/[mM][lL]|(?:^|\b)[mM][lL])([0-9]+)/, type: 'favorite_list', extractId: (match) => match[1] },
    { regex: /(?:audio\/[aA][uU]|(?:^|\b)[aA][uU])([0-9]+)/, type: 'audio', extractId: (match) => match[1] },
    { regex: /(?:audio\/[aA][mM]|(?:^|\b)[aA][mM])([0-9]+)/, type: 'audio_list', extractId: (match) => match[1] },
    { regex: /(?:read\/readlist\/[rR][lL]|(?:^|\b)[rR][lL])([0-9]+)/, type: 'article_list', extractId: (match) => match[1] }
]

function parseRegexToken(tokenInfo, groupId) {
    if (!tokenInfo?.normalizedToken) {
        return []
    }

    const questionMarkIndex = tokenInfo.normalizedToken.indexOf('?')
    const regexInput = questionMarkIndex !== -1
        ? tokenInfo.normalizedToken.substring(0, questionMarkIndex)
        : tokenInfo.normalizedToken

    const links = []
    for (const linkType of linkTypes) {
        const globalRegex = new RegExp(linkType.regex, 'g')
        const matches = monitorRegex(
            `${linkType.type}Regex`,
            globalRegex,
            regexInput,
            (regex, input) => Array.from(input.matchAll(regex))
        )

        for (const match of matches) {
            const id = linkType.extractId(match)
            links.push(createLink(linkType.type, id, groupId, match[0], {}, tokenInfo.normalizedToken))
        }
    }

    return links
}

module.exports = {
    parseRegexToken,
    linkTypes
}
