function cleanText(value) {
    return String(value || '')
        .replace(/\[CQ:[^\]]+\]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

function stripBotLead(text) {
    return cleanText(text)
        .replace(/^(小助手|助手|bot|Bot|我是|Bilibili助手)[，,：:\s]*/i, '')
        .replace(/^(记住|记一下|帮我记|记得)[，,：:\s]*/i, '')
        .trim()
}

function makeHint({ scope = 'group', type = 'fact', content, confidence = 0.7, source }) {
    const normalizedContent = cleanText(content)
    if (!normalizedContent) return null
    return {
        scope,
        type,
        content: normalizedContent,
        confidence,
        source
    }
}

function isBadSubject(subject) {
    return /^(我|你|他|她|它|咱|咱们|我们|你们|他们|她们|bot|Bot|小助手|助手|机器人)$/.test(String(subject || '').trim())
}

function extractExplicitMemory(text) {
    const match = cleanText(text).match(/(?:记住|记一下|帮我记|记得)[，,：:\s]*(.+)$/i)
    if (!match) return null
    const content = cleanText(match[1])
    if (!content || content.length < 2) return null
    return makeHint({
        scope: /我|我的|本人/.test(content) ? 'user' : 'group',
        type: /喜欢|讨厌|偏好|不喜欢|爱/.test(content) ? 'preference' : 'fact',
        content,
        confidence: 0.82,
        source: 'explicit_memory_request'
    })
}

function extractUidRelation(text) {
    const cleaned = stripBotLead(text)
    const direct = cleaned.match(/uid\s*([0-9]{5,})\s*(?:是|=|叫|就是)\s*([\u4e00-\u9fa5A-Za-z0-9_\-]{1,24})/i)
    if (direct) {
        return makeHint({
            scope: 'group',
            type: 'relation',
            content: `uid ${direct[1]} 是 ${direct[2]}`,
            confidence: 0.8,
            source: 'uid_relation_pattern'
        })
    }

    const reverse = cleaned.match(/([\u4e00-\u9fa5A-Za-z0-9_\-]{1,24})\s*(?:是|=|叫|就是)\s*uid\s*([0-9]{5,})/i)
    if (!reverse || isBadSubject(reverse[1])) return null
    return makeHint({
        scope: 'group',
        type: 'relation',
        content: `uid ${reverse[2]} 是 ${reverse[1]}`,
        confidence: 0.8,
        source: 'uid_relation_pattern'
    })
}

function extractUserPreference(text) {
    const cleaned = stripBotLead(text)
    const match = cleaned.match(/(?:我|本人|俺)\s*(喜欢|爱|偏好|讨厌|不喜欢)\s*([^，。,.!?！？]{1,40})/)
    if (!match) return null
    return makeHint({
        scope: 'user',
        type: 'preference',
        content: `用户${match[1]}${cleanText(match[2])}`,
        confidence: 0.78,
        source: 'user_preference_pattern'
    })
}

function extractNamedFact(text) {
    const cleaned = stripBotLead(text)
    if (/uid\s*[0-9]{5,}/i.test(cleaned)) return null
    if (/不是|不算|好像|可能|也许|大概/.test(cleaned)) return null
    const match = cleaned.match(/([\u4e00-\u9fa5A-Za-z0-9_\-]{1,24})\s*(?:是|就是)\s*([^，。,.!?！？]{2,40})/)
    if (!match || isBadSubject(match[1])) return null
    const subject = cleanText(match[1])
    const predicate = cleanText(match[2])
    if (!subject || !predicate || /^[谁什么啥哪]/.test(predicate)) return null
    return makeHint({
        scope: 'group',
        type: 'fact',
        content: `${subject}是${predicate}`,
        confidence: 0.68,
        source: 'named_fact_pattern'
    })
}

function dedupeHints(hints) {
    const seen = new Set()
    const accepted = []
    return hints.filter((hint) => {
        if (!hint) return false
        const scope = hint.scope || ''
        const type = hint.type || ''
        const content = cleanText(hint.content).toLowerCase()
        const key = [scope, type, content].join('|')
        if (seen.has(key)) return false
        if (accepted.some((item) => (
            item.scope === scope &&
            item.type === type &&
            (item.content.includes(content) || content.includes(item.content))
        ))) {
            return false
        }
        seen.add(key)
        accepted.push({ scope, type, content })
        return true
    })
}

function extractMemoryHints({ agentMessage }) {
    const text = agentMessage?.normalizedText || agentMessage?.rawText || ''
    return dedupeHints([
        extractExplicitMemory(text),
        extractUidRelation(text),
        extractUserPreference(text),
        extractNamedFact(text)
    ])
}

function mergeMemoryHints(llmHints = [], extractedHints = []) {
    const normalizedLlmHints = Array.isArray(llmHints) ? llmHints : []
    return dedupeHints([...normalizedLlmHints, ...extractedHints]).slice(0, 8)
}

module.exports = {
    cleanText,
    extractMemoryHints,
    mergeMemoryHints
}
