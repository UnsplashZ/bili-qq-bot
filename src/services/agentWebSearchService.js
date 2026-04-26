const SEARCH_ENDPOINT = 'https://www.bing.com/search'
const DEFAULT_TIMEOUT_MS = 8000
const MAX_RESULTS = 5

function compactText(value, limit = 500) {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    return text.length > limit ? `${text.slice(0, limit - 3)}...` : text
}

function decodeHtml(value) {
    return String(value || '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
}

function stripTags(value) {
    return compactText(decodeHtml(String(value || '').replace(/<[^>]+>/g, ' ')), 500)
}

function normalizeResultUrl(rawUrl) {
    const decoded = decodeHtml(rawUrl)
    try {
        const url = new URL(decoded, SEARCH_ENDPOINT)
        const redirected = url.searchParams.get('uddg')
        if (redirected) return new URL(redirected).toString()
        if (['http:', 'https:'].includes(url.protocol)) return url.toString()
    } catch (_) {
        return ''
    }
    return ''
}

function extractResultBlocks(html) {
    return String(html || '').match(/<div[^>]+class="[^"]*result[^"]*"[\s\S]*?(?=<div[^>]+class="[^"]*result[^"]*"|<\/body>|$)/gi) || []
}

function parseDuckDuckGoResults(html, limit = MAX_RESULTS) {
    const results = []
    const blocks = extractResultBlocks(html)
    for (const block of blocks) {
        const linkMatch = block.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
            || block.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
        if (!linkMatch) continue
        const url = normalizeResultUrl(linkMatch[1])
        const title = stripTags(linkMatch[2])
        if (!url || !title) continue
        const snippetMatch = block.match(/<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
            || block.match(/<div[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
        results.push({
            title: compactText(title, 120),
            url,
            snippet: compactText(stripTags(snippetMatch ? snippetMatch[1] : ''), 220)
        })
        if (results.length >= limit) break
    }
    return results
}

function parseBingResults(html, limit = MAX_RESULTS) {
    const results = []
    const blocks = String(html || '').match(/<li[^>]+class="[^"]*b_algo[^"]*"[\s\S]*?<\/li>/gi) || []
    for (const block of blocks) {
        const linkMatch = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/i)
            || block.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
        if (!linkMatch) continue
        const url = normalizeResultUrl(linkMatch[1])
        const title = stripTags(linkMatch[2])
        if (!url || !title) continue
        const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
        results.push({
            title: compactText(title, 120),
            url,
            snippet: compactText(stripTags(snippetMatch ? snippetMatch[1] : ''), 220)
        })
        if (results.length >= limit) break
    }
    return results
}

function parseSearchResults(html, limit = MAX_RESULTS) {
    const bingResults = parseBingResults(html, limit)
    return bingResults.length > 0 ? bingResults : parseDuckDuckGoResults(html, limit)
}

function normalizeQuery(query) {
    return compactText(query, 120)
}

class AgentWebSearchService {
    async search({ query, maxResults = MAX_RESULTS }, options = {}) {
        const normalizedQuery = normalizeQuery(query)
        const limit = Math.max(1, Math.min(MAX_RESULTS, Math.trunc(Number(maxResults) || MAX_RESULTS)))
        if (!normalizedQuery) throw new Error('missing_search_query')

        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS)
        try {
            const url = new URL(SEARCH_ENDPOINT)
            url.searchParams.set('q', normalizedQuery)
            const response = await fetch(url.toString(), {
                method: 'GET',
                signal: controller.signal,
                headers: {
                    'user-agent': 'Mozilla/5.0 (compatible; bili-qq-bot-agent/1.0; +https://github.com)',
                    accept: 'text/html'
                }
            })
            if (!response.ok) throw new Error(`search_http_${response.status}`)
            const html = await response.text()
            const results = parseSearchResults(html, limit)
            return {
                message: results.length > 0
                    ? `搜索到 ${results.length} 条网页结果：${results.map((item, index) => `${index + 1}. ${item.title}`).join('；')}`
                    : `没有搜索到「${normalizedQuery}」的网页结果。`,
                data: {
                    query: normalizedQuery,
                    provider: 'bing_html',
                    results
                }
            }
        } finally {
            clearTimeout(timeout)
        }
    }
}

module.exports = new AgentWebSearchService()
module.exports._private = {
    decodeHtml,
    normalizeResultUrl,
    parseBingResults,
    parseDuckDuckGoResults,
    parseSearchResults,
    stripTags
}
