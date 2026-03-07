const { isEmojiToken, splitEmojiTokens } = require('./biliEmojiRegistry')

function escapeAttr(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
}

function renderEmojiImage(iconUrl, altText) {
    if (!iconUrl) return altText
    const safeAlt = escapeAttr(altText)
    return `<img class="emoji" src="${iconUrl}" alt="${safeAlt}" />`
}

function replaceEmojiTokensInText(text, emojiContext) {
    const parts = splitEmojiTokens(text)
    if (parts.length === 0) return text

    return parts.map(part => {
        if (!part || !isEmojiToken(part)) return part
        const matched = emojiContext?.lookupEmojiByText?.(part)
        if (!matched?.iconUrl) return part
        return renderEmojiImage(matched.iconUrl, part)
    }).join('')
}

function extractTagName(segment) {
    const matched = segment.match(/^<\s*\/?\s*([a-zA-Z0-9:-]+)/)
    return matched ? matched[1].toLowerCase() : ''
}

function replaceEmojiTokensInHtml(html, emojiContext) {
    if (!html || typeof html !== 'string') return ''

    const segments = html.split(/(<[^>]+>)/g)
    const blockedTagStack = []
    const blockedTagPattern = /^(script|style|textarea|pre|code|kbd|samp)$/

    return segments.map(segment => {
        if (!segment) return ''
        if (segment.startsWith('<')) {
            const tagName = extractTagName(segment)
            if (tagName && blockedTagPattern.test(tagName)) {
                if (/^<\s*\//.test(segment)) {
                    const lastIndex = blockedTagStack.lastIndexOf(tagName)
                    if (lastIndex >= 0) blockedTagStack.splice(lastIndex, 1)
                } else if (!/\/\s*>$/.test(segment)) {
                    blockedTagStack.push(tagName)
                }
            }
            return segment
        }

        if (blockedTagStack.length > 0) return segment
        return replaceEmojiTokensInText(segment, emojiContext)
    }).join('')
}

module.exports = {
    replaceEmojiTokensInHtml
}
