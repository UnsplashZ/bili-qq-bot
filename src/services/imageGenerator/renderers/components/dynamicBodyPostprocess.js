function injectTopicNodeIfNeeded(nodes, topic, plainText) {
    if (!Array.isArray(nodes) || nodes.length === 0) return nodes
    if (!topic || !topic.name) return nodes

    const topicBase = `#${topic.name}`
    const topicFull = `${topicBase}#`
    const topicVariants = new Set([topicFull, topicBase, topic.name])
    const jumpUrl = topic.jump_url ||
        (topic.id ? `https://www.bilibili.com/v/topic/detail/?topic_id=${topic.id}` : '')

    if (nodes.some((node) => {
        if (node?.type !== 'RICH_TEXT_NODE_TYPE_TOPIC') return false
        const text = typeof node.text === 'string' ? node.text.trim() : ''
        const origText = typeof node.orig_text === 'string' ? node.orig_text.trim() : ''
        return topicVariants.has(text) || topicVariants.has(origText)
    })) {
        return nodes
    }

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

module.exports = {
    injectTopicNodeIfNeeded
}
