const { injectTopicNodeIfNeeded } = require('./dynamicBodyPostprocess')
const { normalizePlainText } = require('./textUtils')

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

function resolvePlainTextContent(text) {
    const normalizedText = normalizePlainText(text)
    return {
        text: normalizedText,
        richTextNodes: normalizeContentNodes(null, normalizedText),
        source: normalizedText ? 'plain_text' : 'empty'
    }
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

function normalizeForAddressCompare(text) {
    return normalizePlainText(text)
        .replace(/https?:\/\/\S+/gi, '')
        .replace(/www\.\S+/gi, '')
        .replace(/\s+/g, '')
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

function cloneRichTextNodes(nodes) {
    if (!Array.isArray(nodes)) return []
    return nodes.map(node => {
        if (!node || typeof node !== 'object') return node
        return { ...node }
    })
}

function isTextNode(node) {
    return !node || !node.type || node.type === 'RICH_TEXT_NODE_TYPE_TEXT'
}

function isWhitespaceTextNode(node) {
    return isTextNode(node) && /^\s*$/.test(String(node?.text || ''))
}

function collectBorrowedNodeTypes(nodes) {
    if (!Array.isArray(nodes) || nodes.length === 0) return []
    return [...new Set(nodes
        .map(node => node?.type)
        .filter(type => type && type !== 'RICH_TEXT_NODE_TYPE_TEXT'))]
}

function semanticNodeKey(node) {
    if (!node?.type || node.type === 'RICH_TEXT_NODE_TYPE_TEXT') return ''
    const text = typeof node.text === 'string' ? node.text : ''
    const jumpUrl = typeof node.jump_url === 'string' ? node.jump_url : ''
    return `${node.type}::${text}::${jumpUrl}`
}

function collectSemanticNodeCounts(nodes) {
    const counts = new Map()
    if (!Array.isArray(nodes)) return counts

    for (const node of nodes) {
        const key = semanticNodeKey(node)
        if (!key) continue
        counts.set(key, (counts.get(key) || 0) + 1)
    }

    return counts
}

function collectAddedSemanticNodeTypes(beforeNodes, afterNodes) {
    const beforeCounts = collectSemanticNodeCounts(beforeNodes)
    const addedTypes = []

    if (!Array.isArray(afterNodes)) return addedTypes

    for (const node of afterNodes) {
        const key = semanticNodeKey(node)
        if (!key) continue
        const remaining = beforeCounts.get(key) || 0
        if (remaining > 0) {
            beforeCounts.set(key, remaining - 1)
            continue
        }
        addedTypes.push(node.type)
    }

    return [...new Set(addedTypes)]
}

function isStrictSemanticSuperset(candidateNodes, currentNodes) {
    const candidateCounts = collectSemanticNodeCounts(candidateNodes)
    const currentCounts = collectSemanticNodeCounts(currentNodes)
    let hasMore = false

    for (const [key, currentCount] of currentCounts.entries()) {
        const candidateCount = candidateCounts.get(key) || 0
        if (candidateCount < currentCount) return false
        if (candidateCount > currentCount) hasMore = true
    }

    for (const [key, candidateCount] of candidateCounts.entries()) {
        if ((currentCounts.get(key) || 0) < candidateCount) hasMore = true
    }

    return hasMore
}

function nodesToPlainText(nodes) {
    if (!Array.isArray(nodes) || nodes.length === 0) return ''
    return nodes
        .map(node => (node && typeof node.text === 'string') ? node.text : '')
        .join('')
}

function splitLeadingTopicPrefix(nodes) {
    const cloned = cloneRichTextNodes(nodes)
    if (cloned.length === 0) return { prefixNodes: [], remainingNodes: [] }

    const prefixNodes = []
    let index = 0
    let sawTopic = false

    while (index < cloned.length) {
        const node = cloned[index]
        if (node?.type === 'RICH_TEXT_NODE_TYPE_TOPIC') {
            prefixNodes.push(node)
            sawTopic = true
            index += 1
            continue
        }
        if (isWhitespaceTextNode(node) && (sawTopic || prefixNodes.length > 0)) {
            prefixNodes.push(node)
            index += 1
            continue
        }
        break
    }

    if (!sawTopic) {
        return {
            prefixNodes: [],
            remainingNodes: cloned
        }
    }

    return {
        prefixNodes,
        remainingNodes: cloned.slice(index)
    }
}

function splitTrailingEmojiSuffix(nodes) {
    const cloned = cloneRichTextNodes(nodes)
    if (cloned.length === 0) return { remainingNodes: [], suffixNodes: [] }

    const suffixNodes = []
    let index = cloned.length - 1
    let sawEmoji = false

    while (index >= 0) {
        const node = cloned[index]
        if (node?.type === 'RICH_TEXT_NODE_TYPE_EMOJI') {
            suffixNodes.unshift(node)
            sawEmoji = true
            index -= 1
            continue
        }
        if (isWhitespaceTextNode(node) && (sawEmoji || suffixNodes.length > 0)) {
            suffixNodes.unshift(node)
            index -= 1
            continue
        }
        break
    }

    if (!sawEmoji) {
        return {
            remainingNodes: cloned,
            suffixNodes: []
        }
    }

    return {
        remainingNodes: cloned.slice(0, index + 1),
        suffixNodes
    }
}

function textSkeletonWithoutRichLinks(nodes) {
    if (!Array.isArray(nodes) || nodes.length === 0) return ''
    return nodes
        .map(node => {
            if (!node || typeof node !== 'object') return ''
            if (hasRichLinkNodes([node])) return ''
            return typeof node.text === 'string' ? node.text : ''
        })
        .join('')
}

function hasPrimarySemanticNodes(nodes) {
    return Array.isArray(nodes) && nodes.some(node => node?.type && node.type !== 'RICH_TEXT_NODE_TYPE_TEXT')
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

function createTextNode(text) {
    return {
        type: 'RICH_TEXT_NODE_TYPE_TEXT',
        text,
        orig_text: text
    }
}

function projectNodesOntoPrimaryText(primaryText, secondaryNodes) {
    if (!Array.isArray(secondaryNodes)) return null

    const safeText = typeof primaryText === 'string' ? primaryText : ''
    const semanticNodes = cloneRichTextNodes(secondaryNodes).filter(node => !isTextNode(node))

    if (semanticNodes.length === 0) {
        return normalizeContentNodes(null, safeText)
    }

    const projectedNodes = []
    let cursor = 0

    for (const node of semanticNodes) {
        const needle = typeof node?.text === 'string' ? node.text : ''
        if (!needle) return null

        const index = safeText.indexOf(needle, cursor)
        if (index < 0) return null

        const textBefore = safeText.slice(cursor, index)
        if (textBefore) projectedNodes.push(createTextNode(textBefore))

        projectedNodes.push(node)
        cursor = index + needle.length
    }

    const textAfter = safeText.slice(cursor)
    if (textAfter) projectedNodes.push(createTextNode(textAfter))

    return normalizeContentNodes(projectedNodes, safeText)
}

function dedupeDecorativeNodes(segmentNodes, existingNodes) {
    if (!Array.isArray(segmentNodes) || segmentNodes.length === 0) return []

    const existingCounts = collectSemanticNodeCounts(existingNodes)
    const nextSegment = []
    let hasInsertedSemanticNode = false
    let pendingText = ''

    for (const node of segmentNodes) {
        if (isTextNode(node)) {
            pendingText += typeof node?.text === 'string' ? node.text : ''
            continue
        }

        const key = semanticNodeKey(node)
        const existingCount = existingCounts.get(key) || 0
        if (existingCount > 0) {
            existingCounts.set(key, existingCount - 1)
            pendingText = ''
            continue
        }

        if (pendingText && hasInsertedSemanticNode) {
            nextSegment.push(createTextNode(pendingText))
            pendingText = ''
        }

        if (pendingText && !hasInsertedSemanticNode) {
            nextSegment.push(createTextNode(pendingText))
            pendingText = ''
        }

        nextSegment.push({ ...node })
        hasInsertedSemanticNode = true
    }

    if (pendingText && hasInsertedSemanticNode) {
        nextSegment.push(createTextNode(pendingText))
    }

    return nextSegment
}

function prependDecorativeNodes(baseNodes, prefixNodes) {
    const dedupedPrefix = dedupeDecorativeNodes(prefixNodes, baseNodes)
    if (dedupedPrefix.length === 0) return cloneRichTextNodes(baseNodes)
    return [
        ...dedupedPrefix,
        ...cloneRichTextNodes(baseNodes)
    ]
}

function appendDecorativeNodes(baseNodes, suffixNodes) {
    const dedupedSuffix = dedupeDecorativeNodes(suffixNodes, baseNodes)
    if (dedupedSuffix.length === 0) return cloneRichTextNodes(baseNodes)
    return [
        ...cloneRichTextNodes(baseNodes),
        ...dedupedSuffix
    ]
}

function chooseRicherProjectedNodes(currentNodes, projectedNodes) {
    if (!Array.isArray(projectedNodes) || projectedNodes.length === 0) return null
    if (!Array.isArray(currentNodes) || currentNodes.length === 0) return projectedNodes
    if (!hasPrimarySemanticNodes(currentNodes)) return projectedNodes
    return isStrictSemanticSuperset(projectedNodes, currentNodes) ? projectedNodes : null
}

function createMergeState(text, nodes, source) {
    return {
        text,
        workingNodes: normalizeContentNodes(cloneRichTextNodes(nodes), text),
        source,
        mergeModes: [],
        borrowedNodeTypes: []
    }
}

function recordMerge(state, mode, nextNodes, nextSource = state.source) {
    const normalizedNodes = normalizeContentNodes(cloneRichTextNodes(nextNodes), state.text)
    const addedTypes = collectAddedSemanticNodeTypes(state.workingNodes, normalizedNodes)
    state.workingNodes = normalizedNodes
    state.source = nextSource
    state.mergeModes.push(mode)
    state.borrowedNodeTypes = [...new Set([
        ...state.borrowedNodeTypes,
        ...addedTypes
    ])]
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
    let mergeMode = 'none'
    let mergeModes = []
    let borrowedNodeTypes = []
    const summary = dynamicModule.major?.opus?.summary || {}
    const summaryText = summary.text || ''
    const summaryNodes = summary.rich_text_nodes

    if (dynamicModule.desc) {
        text = dynamicModule.desc.text || ''
        richTextNodes = dynamicModule.desc.rich_text_nodes
        source = 'desc'
    }

    if (!normalizePlainText(text) && dynamicModule.major?.opus?.summary) {
        text = summaryText
        richTextNodes = summaryNodes
        source = 'opus_summary'
        mergeMode = 'replace_full'
    }

    const canInspectSummary =
        source === 'desc' &&
        normalizePlainText(text) &&
        Array.isArray(summaryNodes) &&
        summaryNodes.length > 0

    if (canInspectSummary) {
        const baseNodes = normalizeContentNodes(cloneRichTextNodes(richTextNodes), text)
        const state = createMergeState(text, baseNodes, source)
        const { prefixNodes, remainingNodes: summaryWithoutPrefix } = splitLeadingTopicPrefix(summaryNodes)
        const { remainingNodes: summaryCoreNodes, suffixNodes } = splitTrailingEmojiSuffix(summaryWithoutPrefix)

        if (
            looksLikeAddressLabelButMissingValue(text) &&
            hasRichLinkNodes(summaryNodes)
        ) {
            const descSkeleton = normalizeForAddressCompare(text)
            const summarySkeleton = normalizeForAddressCompare(textSkeletonWithoutRichLinks(summaryWithoutPrefix))

            if (descSkeleton && summarySkeleton && descSkeleton === summarySkeleton) {
                state.text = summaryText
                recordMerge(state, 'summary_link_recovery', summaryNodes, 'opus_summary_preferred')
            }
        }

        if (state.mergeModes.length === 0 && canBorrowSummaryNodes(text, summaryText)) {
            const projectedNodes =
                projectNodesOntoPrimaryText(text, summaryNodes) ||
                buildNodesFromSummary(text, summaryNodes)

            const richerNodes = chooseRicherProjectedNodes(state.workingNodes, projectedNodes)
            if (richerNodes) {
                recordMerge(state, 'equivalent_borrow', richerNodes, 'desc_with_summary_nodes')
            }
        }

        if (state.mergeModes.length === 0 || state.mergeModes[state.mergeModes.length - 1] !== 'summary_link_recovery') {
            const projectedCoreNodes = projectNodesOntoPrimaryText(text, summaryCoreNodes)

            if (prefixNodes.length > 0 && projectedCoreNodes) {
                const richerCoreNodes = chooseRicherProjectedNodes(state.workingNodes, projectedCoreNodes) || state.workingNodes
                const prefixedNodes = prependDecorativeNodes(richerCoreNodes, prefixNodes)
                if (collectAddedSemanticNodeTypes(state.workingNodes, prefixedNodes).length > 0) {
                    recordMerge(state, 'summary_topic_prefix', prefixedNodes, state.source)
                }
            }

            if (suffixNodes.length > 0 && projectedCoreNodes) {
                const richerCoreNodes = chooseRicherProjectedNodes(state.workingNodes, projectedCoreNodes) || state.workingNodes
                const suffixedNodes = appendDecorativeNodes(richerCoreNodes, suffixNodes)
                if (collectAddedSemanticNodeTypes(state.workingNodes, suffixedNodes).length > 0) {
                    recordMerge(state, 'summary_suffix_borrow', suffixedNodes, state.source)
                }
            }
        }

        text = state.text
        richTextNodes = state.workingNodes
        source = state.source
        mergeModes = state.mergeModes
        mergeMode = state.mergeModes[state.mergeModes.length - 1] || 'none'
        borrowedNodeTypes = state.borrowedNodeTypes
    } else if (mergeMode !== 'none') {
        mergeModes = [mergeMode]
    }

    richTextNodes = injectTopicNodeIfNeeded(richTextNodes, dynamicModule.topic, text)
    const finalText = stripImagePlaceholders(text, hasImages)

    return {
        text: finalText,
        richTextNodes: normalizeContentNodes(normalizeRichTextNodes(richTextNodes, hasImages), finalText),
        title: dynamicModule.major?.opus?.title || '',
        source,
        mergeMode,
        mergeModes,
        borrowedNodeTypes
    }
}

module.exports = {
    collectDynamicImages,
    normalizeContentNodes,
    normalizePlainText,
    stripImagePlaceholders,
    normalizeRichTextNodes,
    canBorrowSummaryNodes,
    buildNodesFromSummary,
    injectTopicNodeIfNeeded,
    resolvePlainTextContent,
    resolveDynamicContent
}
