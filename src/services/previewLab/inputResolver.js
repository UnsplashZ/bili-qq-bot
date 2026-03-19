const linkHandler = require('../../handlers/linkHandler')

async function expandPreviewInput(input, deps = {}) {
    const resolver = deps.linkHandler || linkHandler
    let rawInput = String(input || '').trim()
    if (!rawInput) {
        return rawInput
    }

    if (resolver.shortLinkRegex && resolver.shortLinkRegex.test(rawInput)) {
        const match = rawInput.match(resolver.shortLinkRegex)
        if (match && match[0]) {
            try {
                const expanded = await resolver.expandUrl(match[0])
                if (expanded) {
                    rawInput += ` ${expanded}`
                }
            } catch (_error) {
                // Ignore short-link expansion failures and continue with original input.
            }
        }
    }

    return rawInput.replace(/\[CQ:[^\]]+\]/g, '')
}

async function resolvePreviewInput(input, options = {}, deps = {}) {
    const resolver = deps.linkHandler || linkHandler
    const normalizedInput = await expandPreviewInput(input, deps)
    const links = resolver.extractLinks(normalizedInput, options.groupId || null)

    if (!Array.isArray(links) || links.length === 0) {
        throw new Error('未识别到可处理的 B 站链接')
    }

    return {
        input: String(input || ''),
        normalizedInput,
        resolvedLink: links[0],
        skippedLinks: links.slice(1)
    }
}

module.exports = {
    resolvePreviewInput
}
