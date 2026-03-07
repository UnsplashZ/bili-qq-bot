const {
    collectEmojiNodes,
    createEmojiRecordFromNode,
    normalizeEmojiText
} = require('./biliEmojiRegistry')
const { getDefaultEmojiIndexProvider } = require('./emojiIndexProvider')

class RenderEmojiContext {
    constructor(provider = null) {
        this.provider = provider
        this.localIndex = new Map()
    }

    registerEmojiNode(node) {
        const record = createEmojiRecordFromNode(node)
        if (!record) return null
        this.localIndex.set(record.rawText, record)
        return record
    }

    registerFromData(data) {
        const nodes = collectEmojiNodes(data)
        for (const node of nodes) this.registerEmojiNode(node)
    }

    lookupEmojiByText(text) {
        const rawText = normalizeEmojiText(text)
        if (!rawText) return null
        return this.localIndex.get(rawText) || this.provider?.lookupEmojiByText?.(rawText) || null
    }
}

async function createRenderEmojiContext({ provider = getDefaultEmojiIndexProvider(), seedData = null } = {}) {
    const context = new RenderEmojiContext(provider)
    if (seedData) context.registerFromData(seedData)

    try {
        provider?.refreshInBackground?.()
    } catch (_) {
        // Provider failures must not break card rendering.
    }

    return context
}

module.exports = {
    RenderEmojiContext,
    createRenderEmojiContext
}
