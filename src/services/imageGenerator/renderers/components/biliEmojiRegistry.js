const EMOJI_TOKEN_RE = /(\[[^[\]\n]{1,32}\])/g

function normalizeEmojiText(text) {
    const normalized = String(text || '').trim()
    return normalized || ''
}

function isEmojiToken(text) {
    const rawText = normalizeEmojiText(text)
    if (!rawText) return false
    return /^\[[^[\]\n]{1,32}\]$/.test(rawText)
}

function splitEmojiTokens(text) {
    const rawText = String(text || '')
    if (!rawText) return []
    return rawText.split(EMOJI_TOKEN_RE)
}

function createEmojiRecordFromNode(node) {
    const emoji = node?.emoji || {}
    const rawText = normalizeEmojiText(emoji.text || node?.text || node?.orig_text)
    const iconUrl = String(emoji.icon_url || '').trim()
    if (!rawText || !iconUrl) return null

    return {
        rawText,
        iconUrl,
        emojiId: emoji.id ? String(emoji.id) : '',
        packageId: emoji.package_id ? String(emoji.package_id) : '',
        updatedAt: Date.now()
    }
}

function collectEmojiNodes(value, bucket = []) {
    if (!value) return bucket

    if (Array.isArray(value)) {
        for (const item of value) collectEmojiNodes(item, bucket)
        return bucket
    }

    if (typeof value !== 'object') return bucket

    if (value.type === 'RICH_TEXT_NODE_TYPE_EMOJI' && value.emoji?.icon_url) {
        bucket.push(value)
    }

    for (const child of Object.values(value)) {
        collectEmojiNodes(child, bucket)
    }

    return bucket
}

module.exports = {
    collectEmojiNodes,
    createEmojiRecordFromNode,
    isEmojiToken,
    normalizeEmojiText,
    splitEmojiTokens
}
