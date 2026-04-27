function compactText(value, limit = 240) {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    return text.length > limit ? `${text.slice(0, limit - 3)}...` : text
}

function extractFirstHttpUrl(text) {
    const match = String(text || '').match(/https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/)
    if (!match) return ''
    return match[0].replace(/[),.;，。！？、]+$/g, '')
}

function isPrivateIPv4(hostname) {
    const parts = String(hostname || '').split('.').map(Number)
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
    const [first, second] = parts
    return first === 10 ||
        first === 127 ||
        (first === 169 && second === 254) ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168) ||
        first === 0
}

function isPrivateIPv6(hostname) {
    const value = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase()
    return value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:')
}

function isSafePublicHttpUrl(rawUrl) {
    try {
        const url = new URL(String(rawUrl || '').trim())
        if (!['http:', 'https:'].includes(url.protocol)) return false
        if (url.username || url.password) return false
        const hostname = url.hostname.toLowerCase()
        if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) return false
        if (isPrivateIPv4(hostname) || isPrivateIPv6(hostname)) return false
        return true
    } catch (_) {
        return false
    }
}

function hasReadIntent(text) {
    return /总结|概括|摘要|说了些啥|说了什么|讲了啥|讲了什么|读一下|读取|看一下|看看|内容|分析|回答/.test(String(text || ''))
}

function hasScreenshotIntent(text) {
    return /截图|截个图|截屏|截一下|页面图|网页图/.test(String(text || ''))
}

function toolAvailable(toolName, availableToolNames) {
    if (!Array.isArray(availableToolNames) || availableToolNames.length === 0) return true
    return availableToolNames.includes(toolName)
}

function makeToolPlanDecision({ toolName, url, reason, confidence = 0.35 }) {
    const args = toolName === 'browser.screenshot_url'
        ? { url, viewportWidth: 1280, viewportHeight: 900 }
        : { url, maxChars: 5000 }
    return {
        action: 'tool_plan',
        confidence,
        reason,
        topic: 'browser_fallback',
        replyStyle: 'none',
        replyDraft: '',
        memoryHints: [],
        toolIntent: {
            name: toolName,
            arguments: args
        }
    }
}

function planFallbackTool({ text, addressed = false, availableToolNames } = {}) {
    const normalizedText = String(text || '')
    if (!addressed) return null

    const url = extractFirstHttpUrl(normalizedText)
    if (!url || !isSafePublicHttpUrl(url)) return null

    if (hasReadIntent(normalizedText) && toolAvailable('browser.read_url', availableToolNames)) {
        return makeToolPlanDecision({
            toolName: 'browser.read_url',
            url,
            reason: `deterministic URL read fallback for: ${compactText(normalizedText, 120)}`
        })
    }

    if (hasScreenshotIntent(normalizedText) && toolAvailable('browser.screenshot_url', availableToolNames)) {
        return makeToolPlanDecision({
            toolName: 'browser.screenshot_url',
            url,
            reason: `deterministic URL screenshot fallback for: ${compactText(normalizedText, 120)}`
        })
    }

    return null
}

module.exports = {
    extractFirstHttpUrl,
    isSafePublicHttpUrl,
    hasReadIntent,
    hasScreenshotIntent,
    planFallbackTool
}
