const dns = require('dns').promises

const MAX_FETCH_BYTES = 512 * 1024
const DEFAULT_TIMEOUT_MS = 8000
const MAX_REDIRECTS = 5

function compactText(value, limit = 4000) {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    return text.length > limit ? `${text.slice(0, limit - 3)}...` : text
}

function isPrivateIPv4(hostname) {
    const parts = String(hostname || '').split('.').map(Number)
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
    const [first, second] = parts
    return (
        first === 10 ||
        first === 127 ||
        (first === 169 && second === 254) ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168) ||
        first === 0
    )
}

function isPrivateIPv6(hostname) {
    const value = String(hostname || '').toLowerCase()
    return value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:')
}

function assertSafeUrl(rawUrl) {
    const url = new URL(String(rawUrl || '').trim())
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported_url_protocol')
    if (url.username || url.password) throw new Error('url_credentials_denied')
    const hostname = url.hostname.toLowerCase()
    if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) throw new Error('local_url_denied')
    if (isPrivateIPv4(hostname) || isPrivateIPv6(hostname)) throw new Error('private_url_denied')
    return url
}

async function assertResolvedHostSafe(hostname) {
    const records = await dns.lookup(hostname, { all: true })
    for (const record of records) {
        if (record.family === 4 && isPrivateIPv4(record.address)) throw new Error('private_url_denied')
        if (record.family === 6 && isPrivateIPv6(record.address)) throw new Error('private_url_denied')
    }
}

function htmlToText(html) {
    return compactText(String(html || '')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'"))
}

function extractTitle(html) {
    const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    return compactText(match ? match[1] : '', 160)
}

class AgentBrowserService {
    async readUrl({ url, maxChars = 3000 }, options = {}) {
        let safeUrl = assertSafeUrl(url)
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS)
        try {
            let response = null
            for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
                await assertResolvedHostSafe(safeUrl.hostname)
                response = await fetch(safeUrl.toString(), {
                    method: 'GET',
                    redirect: 'manual',
                    signal: controller.signal,
                    headers: {
                        'user-agent': 'bili-qq-bot-agent/1.0'
                    }
                })
                if (![301, 302, 303, 307, 308].includes(response.status)) break
                const location = response.headers.get('location')
                if (!location) throw new Error('redirect_location_missing')
                safeUrl = assertSafeUrl(new URL(location, safeUrl).toString())
                if (redirectCount === MAX_REDIRECTS) throw new Error('too_many_redirects')
            }
            if (!response.ok) throw new Error(`http_${response.status}`)
            const contentType = response.headers.get('content-type') || ''
            const reader = response.body?.getReader()
            if (!reader) throw new Error('response_body_unavailable')
            const chunks = []
            let size = 0
            while (size < MAX_FETCH_BYTES) {
                const { value, done } = await reader.read()
                if (done) break
                size += value.byteLength
                chunks.push(value)
            }
            const raw = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')
            const text = contentType.includes('text/html') ? htmlToText(raw) : compactText(raw)
            return {
                message: `已读取网页：${extractTitle(raw) || safeUrl.hostname}`,
                data: {
                    url: safeUrl.toString(),
                    status: response.status,
                    contentType,
                    title: extractTitle(raw),
                    text: compactText(text, Math.max(200, Math.min(8000, Math.trunc(Number(maxChars) || 3000))))
                }
            }
        } finally {
            clearTimeout(timeout)
        }
    }
}

module.exports = new AgentBrowserService()
module.exports._private = {
    assertSafeUrl,
    isPrivateIPv4,
    isPrivateIPv6,
    htmlToText
}
