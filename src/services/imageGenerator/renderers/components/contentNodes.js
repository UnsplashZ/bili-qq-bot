function normalizePlainText(text) {
    if (!text) return ''
    return String(text)
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\u200b/g, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

function normalizeContentNodes(nodes, fallbackText = '') {
    if (Array.isArray(nodes) && nodes.length > 0) return nodes

    const normalizedText = normalizePlainText(fallbackText)
    if (!normalizedText) return []

    return [{
        type: 'RICH_TEXT_NODE_TYPE_TEXT',
        text: normalizedText,
        orig_text: normalizedText
    }]
}

function stripImagePlaceholders(text, hasImages) {
    const normalized = normalizePlainText(text)
    if (!normalized) return ''
    if (!hasImages) return normalized
    return normalized
        .replace(/\s*\[图片\]\s*/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

function normalizeRichTextNodes(nodes, hasImages) {
    if (!Array.isArray(nodes) || nodes.length === 0 || !hasImages) return nodes
    return nodes.map(node => {
        if (!node || typeof node !== 'object' || typeof node.text !== 'string') return node
        const cleanedText = node.text.replace(/\[图片\]/g, '')

        if (cleanedText === node.text) return node

        const nextNode = { ...node, text: cleanedText }
        if (typeof node.orig_text === 'string') {
            nextNode.orig_text = node.orig_text.replace(/\[图片\]/g, '')
        }
        return nextNode
    })
}

function normalizeForNodeCompare(text) {
    return normalizePlainText(text)
        .replace(/\[[^\]]+\]/g, '')
        .replace(/\s+/g, '')
}

function canBorrowSummaryNodes(descText, summaryText) {
    const normalizedDesc = normalizeForNodeCompare(descText)
    const normalizedSummary = normalizeForNodeCompare(summaryText)
    if (!normalizedDesc || !normalizedSummary) return false
    return normalizedDesc === normalizedSummary
}

function hasRichLinkNodes(nodes) {
    if (!Array.isArray(nodes) || nodes.length === 0) return false
    const richTypes = new Set([
        'RICH_TEXT_NODE_TYPE_WEB',
        'RICH_TEXT_NODE_TYPE_URL',
        'RICH_TEXT_NODE_TYPE_BV',
        'RICH_TEXT_NODE_TYPE_VOTE',
        'RICH_TEXT_NODE_TYPE_LOTTERY'
    ])
    return nodes.some(node => richTypes.has(node?.type))
}

function looksLikeAddressLabelButMissingValue(text) {
    const normalized = normalizePlainText(text)
    if (!normalized) return false
    const hasAddressLabel = /直播间地址[:：]|下载(?:游戏|地址)?[:：]/.test(normalized)
    const hasUrl = /https?:\/\/|www\./i.test(normalized)
    return hasAddressLabel && !hasUrl
}

function buildNodesFromSummary(descText, summaryNodes) {
    if (!Array.isArray(summaryNodes)) return summaryNodes
    const copied = summaryNodes.map(node => {
        if (!node || typeof node !== 'object') return node
        return { ...node }
    })

    const textNodeIndexes = []
    copied.forEach((node, index) => {
        if (node?.type === 'RICH_TEXT_NODE_TYPE_TEXT') textNodeIndexes.push(index)
    })

    if (textNodeIndexes.length !== 1) return null

    const textNodeIndex = textNodeIndexes[0]
    const target = copied[textNodeIndex] || {}
    copied[textNodeIndex] = {
        ...target,
        text: descText,
        orig_text: descText
    }

    return copied
}

function injectTopicNodeIfNeeded(nodes, topic, plainText) {
    if (!Array.isArray(nodes) || nodes.length === 0) return nodes
    if (!topic || !topic.name) return nodes
    if (nodes.some(node => node?.type === 'RICH_TEXT_NODE_TYPE_TOPIC')) return nodes

    const topicBase = `#${topic.name}`
    const topicFull = `${topicBase}#`
    const jumpUrl = topic.jump_url ||
        (topic.id ? `https://www.bilibili.com/v/topic/detail/?topic_id=${topic.id}` : '')

    const nextNodes = []
    let inserted = false

    for (const node of nodes) {
        if (
            inserted ||
            !node ||
            node.type !== 'RICH_TEXT_NODE_TYPE_TEXT' ||
            typeof node.text !== 'string'
        ) {
            nextNodes.push(node)
            continue
        }

        let matched = ''
        let startIndex = node.text.indexOf(topicFull)
        if (startIndex >= 0) {
            matched = topicFull
        } else {
            startIndex = node.text.indexOf(topicBase)
            if (startIndex >= 0) matched = topicBase
        }

        if (startIndex < 0 || !matched) {
            nextNodes.push(node)
            continue
        }

        const beforeText = node.text.slice(0, startIndex)
        const afterText = node.text.slice(startIndex + matched.length)

        if (beforeText) {
            nextNodes.push({
                ...node,
                text: beforeText,
                orig_text: beforeText
            })
        }

        nextNodes.push({
            type: 'RICH_TEXT_NODE_TYPE_TOPIC',
            text: matched,
            orig_text: matched,
            jump_url: jumpUrl
        })

        if (afterText) {
            nextNodes.push({
                ...node,
                text: afterText,
                orig_text: afterText
            })
        }

        inserted = true
    }

    if (inserted) return nextNodes

    if (typeof plainText === 'string' && (plainText.includes(topicBase) || plainText.includes(topicFull))) {
        return nodes
    }

    return [
        {
            type: 'RICH_TEXT_NODE_TYPE_TOPIC',
            text: topic.name,
            orig_text: topic.name,
            jump_url: jumpUrl
        },
        {
            type: 'RICH_TEXT_NODE_TYPE_TEXT',
            text: '\n',
            orig_text: '\n'
        },
        ...nodes
    ]
}

function toSafeNumber(value) {
    const num = Number(value)
    return Number.isFinite(num) ? num : 0
}

function normalizeDynamicImageItem(item) {
    if (!item || typeof item !== 'object') return null
    const url = item.url || item.src || ''
    if (!url) return null
    return {
        url,
        width: toSafeNumber(item.width),
        height: toSafeNumber(item.height),
        liveUrl: item.live_url || item.liveUrl || ''
    }
}

function collectDynamicImages(dynamicModule) {
    if (dynamicModule.major?.draw?.items) {
        return dynamicModule.major.draw.items
            .map(normalizeDynamicImageItem)
            .filter(Boolean)
    }
    if (dynamicModule.major?.opus?.pics) {
        return dynamicModule.major.opus.pics
            .map(normalizeDynamicImageItem)
            .filter(Boolean)
    }
    return []
}

function resolveDynamicContent(dynamicModule, hasImages) {
    let text = ''
    let richTextNodes = null
    let source = 'empty'
    const summary = dynamicModule.major?.opus?.summary || {}
    const summaryText = summary.text || ''
    const summaryNodes = summary.rich_text_nodes

    if (dynamicModule.desc) {
        text = dynamicModule.desc.text || ''
        richTextNodes = dynamicModule.desc.rich_text_nodes
        source = 'desc'
    }

    const shouldPreferSummary =
        source === 'desc' &&
        normalizePlainText(summaryText) &&
        hasRichLinkNodes(summaryNodes) &&
        (
            looksLikeAddressLabelButMissingValue(text) ||
            ((!Array.isArray(richTextNodes) || richTextNodes.length === 0) && normalizePlainText(text))
        )

    if (shouldPreferSummary) {
        text = summaryText
        richTextNodes = summaryNodes
        source = 'opus_summary_preferred'
    }

    if (
        source === 'desc' &&
        normalizePlainText(text) &&
        (!Array.isArray(richTextNodes) || richTextNodes.length === 0) &&
        dynamicModule.major?.opus?.summary
    ) {
        if (
            Array.isArray(summaryNodes) &&
            summaryNodes.length > 0 &&
            summaryNodes.some(node => node?.type && node.type !== 'RICH_TEXT_NODE_TYPE_TEXT') &&
            canBorrowSummaryNodes(text, summaryText)
        ) {
            const borrowedNodes = buildNodesFromSummary(text, summaryNodes)
            if (Array.isArray(borrowedNodes) && borrowedNodes.length > 0) {
                richTextNodes = borrowedNodes
                source = 'desc_with_summary_nodes'
            }
        }
    }

    if (!normalizePlainText(text) && dynamicModule.major?.opus?.summary) {
        text = summaryText
        richTextNodes = summaryNodes
        source = 'opus_summary'
    }

    richTextNodes = injectTopicNodeIfNeeded(richTextNodes, dynamicModule.topic, text)
    const finalText = stripImagePlaceholders(text, hasImages)

    return {
        text: finalText,
        richTextNodes: normalizeContentNodes(normalizeRichTextNodes(richTextNodes, hasImages), finalText),
        title: dynamicModule.major?.opus?.title || '',
        source
    }
}

module.exports = {
    collectDynamicImages,
    normalizeContentNodes,
    normalizePlainText,
    resolveDynamicContent
}
