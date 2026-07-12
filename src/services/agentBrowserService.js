const dns = require('dns').promises
const puppeteer = require('puppeteer')
const config = require('../config')

const MAX_FETCH_BYTES = 512 * 1024
const DEFAULT_TIMEOUT_MS = 8000
const DEFAULT_CHROMIUM_TIMEOUT_MS = 22000
const DEFAULT_RENDER_WAIT_MS = 9000
const MAX_REDIRECTS = 5
const MIN_USEFUL_TEXT_LENGTH = 240
const DESKTOP_CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

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

function extractTitle(html) {
    const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    return compactText(decodeHtml(match ? match[1] : ''), 160)
}

function extractMetaDescription(html) {
    const match = String(html || '').match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)["'][^>]*>/i)
        || String(html || '').match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:description|og:description)["'][^>]*>/i)
    return compactText(decodeHtml(match ? match[1] : ''), 500)
}

function buildBrowserLikeHeaders(url) {
    const origin = url instanceof URL ? url.origin : new URL(String(url || '')).origin
    return {
        'user-agent': DESKTOP_CHROME_UA,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
        referer: `${origin}/`,
        'upgrade-insecure-requests': '1',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-user': '?1'
    }
}

function chromiumExecutable() {
    const configured = String(config.chromiumPath || config.puppeteerExecutablePath || '').trim()
    if (configured) return configured
    return '/usr/bin/chromium'
}

function isRedirectStatus(status) {
    return [301, 302, 303, 307, 308].includes(Number(status))
}

function shouldFallbackStatus(status) {
    return [401, 403, 406, 408, 409, 425, 429, 500, 502, 503, 504].includes(Number(status))
}

function looksLikeAccessBlocked(text, html = '') {
    const visibleText = String(text || '').trim()
    const visibleTextLength = visibleText.length
    if (/验证码|安全验证|请求存在异常|暂时限制|访问被拒绝|Access Denied|Forbidden|captcha|verify|anti[-_\s]?bot/i.test(visibleText)) {
        return true
    }
    if (
        visibleTextLength < 160 &&
        /验证码|安全验证|请求存在异常|暂时限制|访问被拒绝|Access Denied|Forbidden|captcha|verify|anti[-_\s]?bot/i.test(String(html || ''))
    ) {
        return true
    }
    return visibleTextLength < 160 && /登录后查看|请登录|登录后继续|需要登录|login required/i.test(`${visibleText} ${html || ''}`)
}

function looksLikeSpaShell({ text, html, contentType }) {
    if (!String(contentType || '').includes('text/html')) return false
    const normalizedText = String(text || '').trim()
    const rawHtml = String(html || '')
    if (normalizedText.length >= MIN_USEFUL_TEXT_LENGTH) return false
    const scriptCount = (rawHtml.match(/<script\b/gi) || []).length
    return scriptCount >= 3 ||
        /<div[^>]+id=["'](?:root|app|__next)["']/i.test(rawHtml) ||
        /__INITIAL_STATE__|window\.__|type=["']module["']|vite|webpack|static\/js|assets\/.*\.js/i.test(rawHtml)
}

function assessContentQuality({ status = 200, contentType = '', text = '', html = '' } = {}) {
    const textLength = String(text || '').trim().length
    if (shouldFallbackStatus(status)) {
        return { usable: false, reason: `http_${status}`, shouldFallback: true }
    }
    if (Number(status) >= 400) {
        return { usable: false, reason: `http_${status}`, shouldFallback: false }
    }
    if (textLength < MIN_USEFUL_TEXT_LENGTH && looksLikeAccessBlocked(text, html)) {
        return { usable: false, reason: 'access_blocked_page', shouldFallback: true }
    }
    if (looksLikeSpaShell({ text, html, contentType })) {
        return { usable: false, reason: 'spa_shell_or_low_text', shouldFallback: true }
    }
    if (textLength < 80 && String(contentType || '').includes('text/html')) {
        return { usable: false, reason: 'low_text_content', shouldFallback: true }
    }
    return { usable: true, reason: 'ok', shouldFallback: false }
}

async function readResponseBody(response) {
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
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')
}

async function fetchUrlContent(initialUrl, { signal } = {}) {
    let safeUrl = initialUrl
    let response = null
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
        await assertResolvedHostSafe(safeUrl.hostname)
        response = await fetch(safeUrl.toString(), {
            method: 'GET',
            redirect: 'manual',
            signal,
            headers: buildBrowserLikeHeaders(safeUrl)
        })
        if (!isRedirectStatus(response.status)) break
        const location = response.headers.get('location')
        if (!location) throw new Error('redirect_location_missing')
        safeUrl = assertSafeUrl(new URL(location, safeUrl).toString())
        if (redirectCount === MAX_REDIRECTS) throw new Error('too_many_redirects')
    }

    const contentType = response.headers.get('content-type') || ''
    const raw = await readResponseBody(response)
    const text = contentType.includes('text/html') ? htmlToText(raw) : compactText(raw)
    const quality = assessContentQuality({
        status: response.status,
        contentType,
        text,
        html: raw
    })

    return {
        method: 'fetch',
        url: safeUrl,
        status: response.status,
        contentType,
        title: extractTitle(raw),
        description: extractMetaDescription(raw),
        raw,
        text,
        quality
    }
}

async function assertSafeBrowserRequest(rawUrl, trustedOrigin = '') {
    const protocol = (() => {
        try {
            return new URL(String(rawUrl || '')).protocol
        } catch (_) {
            return ''
        }
    })()

    if (['about:', 'blob:', 'data:'].includes(protocol)) return

    const safeUrl = assertSafeUrl(rawUrl)
    if (trustedOrigin && safeUrl.origin === trustedOrigin) return
    await assertResolvedHostSafe(safeUrl.hostname)
}

async function prepareStealthPage(page) {
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
        Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] })
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] })
    })
}

async function waitForReadableText(page, timeoutMs) {
    const waitMs = Math.max(1000, Math.min(DEFAULT_RENDER_WAIT_MS, Math.trunc(Number(timeoutMs) || DEFAULT_CHROMIUM_TIMEOUT_MS)))
    try {
        await page.waitForFunction((minTextLength) => {
            const text = String(document.body?.innerText || '').trim()
            return text.length >= minTextLength
        }, { timeout: waitMs }, MIN_USEFUL_TEXT_LENGTH)
    } catch (_) {
        // 页面可能只暴露少量文本；后续质量评估决定是否可用。
    }
    await new Promise((resolve) => setTimeout(resolve, 1200))
}

async function readUrlWithChromium(initialUrl, { timeoutMs = DEFAULT_CHROMIUM_TIMEOUT_MS, executablePath = chromiumExecutable() } = {}) {
    await assertResolvedHostSafe(initialUrl.hostname)
    const browser = await puppeteer.launch({
        executablePath,
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-gpu',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
            '--lang=zh-CN,zh'
        ]
    })

    try {
        const page = await browser.newPage()
        page.setDefaultTimeout(timeoutMs)
        page.setDefaultNavigationTimeout(timeoutMs)
        await prepareStealthPage(page)
        await page.setViewport({ width: 1365, height: 900, deviceScaleFactor: 1 })
        await page.setUserAgent(DESKTOP_CHROME_UA)
        await page.setExtraHTTPHeaders({
            'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
            referer: `${initialUrl.origin}/`
        })
        await page.setJavaScriptEnabled(true)
        await page.setRequestInterception(true)
        page.on('request', (request) => {
            const isTrustedOrigin = (() => {
                try {
                    return new URL(request.url()).origin === initialUrl.origin
                } catch (_) {
                    return false
                }
            })()
            if (!isTrustedOrigin && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
                request.abort().catch(() => {})
                return
            }
            assertSafeBrowserRequest(request.url(), initialUrl.origin)
                .then(() => {
                    if (typeof request.isInterceptResolutionHandled === 'function' && request.isInterceptResolutionHandled()) return
                    return request.continue()
                })
                .catch(() => {
                    if (typeof request.isInterceptResolutionHandled === 'function' && request.isInterceptResolutionHandled()) return
                    return request.abort()
                })
                .catch(() => {})
        })

        const response = await page.goto(initialUrl.toString(), {
            waitUntil: 'networkidle2',
            timeout: timeoutMs
        })
        await waitForReadableText(page, timeoutMs)
        const pageData = await page.evaluate(() => {
            const metaDescription = document.querySelector('meta[name="description"], meta[property="og:description"]')?.getAttribute('content') || ''
            return {
                url: location.href,
                title: String(document.title || '').trim(),
                description: String(metaDescription || '').trim(),
                text: String(document.body?.innerText || '').replace(/\s+/g, ' ').trim(),
                html: String(document.documentElement?.outerHTML || '')
            }
        })
        const finalUrl = assertSafeUrl(pageData.url || initialUrl.toString())
        await assertResolvedHostSafe(finalUrl.hostname)
        const quality = assessContentQuality({
            status: response?.status?.() || 200,
            contentType: 'text/html',
            text: pageData.text,
            html: pageData.html
        })

        return {
            method: 'chromium',
            url: finalUrl,
            status: response?.status?.() || 200,
            contentType: 'text/html; rendered=1',
            title: compactText(pageData.title, 160),
            description: compactText(pageData.description, 500),
            raw: pageData.html,
            text: pageData.text,
            quality
        }
    } finally {
        await browser.close().catch(() => {})
    }
}

function formatReadResult(result, maxChars) {
    const limit = Math.max(200, Math.min(8000, Math.trunc(Number(maxChars) || 3000)))
    const title = result.title || result.url.hostname
    const description = result.description || ''
    const text = compactText([description, result.text].filter(Boolean).join('\n'), limit)
    return {
        message: `已读取网页：${title}`,
        data: {
            url: result.url.toString(),
            status: result.status,
            contentType: result.contentType,
            title,
            text,
            method: result.method,
            quality: result.quality?.reason || 'ok'
        }
    }
}

class AgentBrowserService {
    async readUrl({ url, maxChars = 3000 }, options = {}) {
        const executablePath = chromiumExecutable()
        const safeUrl = assertSafeUrl(url)
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS)
        try {
            const fetchResult = await fetchUrlContent(safeUrl, { signal: controller.signal })
            if (fetchResult.quality.usable) {
                return formatReadResult(fetchResult, maxChars)
            }
            if (!fetchResult.quality.shouldFallback || options.disableChromiumFallback) {
                throw new Error(fetchResult.quality.reason)
            }
            const chromiumTimeoutMs = Math.max(
                DEFAULT_CHROMIUM_TIMEOUT_MS,
                Math.trunc(Number(options.chromiumTimeoutMs || options.timeoutMs) || DEFAULT_CHROMIUM_TIMEOUT_MS)
            )
            const chromiumResult = await readUrlWithChromium(fetchResult.url, {
                timeoutMs: chromiumTimeoutMs,
                executablePath
            })
            if (!chromiumResult.quality.usable) {
                throw new Error(chromiumResult.quality.reason)
            }
            return formatReadResult(chromiumResult, maxChars)
        } finally {
            clearTimeout(timeout)
        }
    }
}

module.exports = new AgentBrowserService()
module.exports._private = {
    assertSafeUrl,
    assertResolvedHostSafe,
    isPrivateIPv4,
    isPrivateIPv6,
    htmlToText,
    decodeHtml,
    extractMetaDescription,
    buildBrowserLikeHeaders,
    assessContentQuality,
    looksLikeSpaShell,
    looksLikeAccessBlocked,
    chromiumExecutable,
    readUrlWithChromium,
    formatReadResult
}
