const fs = require('fs')
const path = require('path')
const puppeteer = require('puppeteer')
const config = require('../config')
const agentBrowserService = require('./agentBrowserService')

const DEFAULT_TIMEOUT_MS = 15000
const DEFAULT_RENDER_WAIT_MS = 9000
const MAX_REDIRECTS = 5
const MIN_VIEWPORT_WIDTH = 320
const MAX_VIEWPORT_WIDTH = 1920
const MIN_VIEWPORT_HEIGHT = 240
const MAX_VIEWPORT_HEIGHT = 2400
const MIN_NON_BLANK_BYTES = 8 * 1024
const DESKTOP_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

function compactText(value, limit = 500) {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    return text.length > limit ? `${text.slice(0, limit - 3)}...` : text
}

function chromiumExecutable() {
    const configured = String(config.chromiumPath || config.puppeteerExecutablePath || '').trim()
    if (configured) return configured
    if (fs.existsSync('/usr/bin/chromium')) return '/usr/bin/chromium'
    if (fs.existsSync('/usr/bin/chromium-browser')) return '/usr/bin/chromium-browser'
    if (fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')) {
        return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    }
    return 'chromium'
}

function normalizeViewport(value, min, max, fallback) {
    const parsed = Math.trunc(Number(value) || fallback)
    return Math.max(min, Math.min(max, parsed))
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

    const safeUrl = agentBrowserService._private.assertSafeUrl(rawUrl)
    if (trustedOrigin && safeUrl.origin === trustedOrigin) return
    await agentBrowserService._private.assertResolvedHostSafe(safeUrl.hostname)
}

async function prepareStealthPage(page) {
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
        Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] })
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] })
    })
}

async function waitForPageRender(page, timeoutMs) {
    const waitMs = Math.max(1000, Math.min(DEFAULT_RENDER_WAIT_MS, Math.trunc(Number(timeoutMs) || DEFAULT_TIMEOUT_MS)))
    try {
        await page.waitForFunction(() => {
            const bodyText = String(document.body?.innerText || '').trim()
            return bodyText.length >= 80 ||
                document.images.length > 1 ||
                Boolean(document.querySelector('canvas,video'))
        }, { timeout: waitMs })
    } catch (_) {
        // 页面可能是纯图片/空白落地页，后续用页面状态和文件大小兜底判断。
    }
    await new Promise((resolve) => setTimeout(resolve, 1200))
}

async function getPageRenderState(page) {
    return page.evaluate(() => ({
        url: String(location.href || ''),
        title: String(document.title || '').trim(),
        bodyText: String(document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 1000),
        bodyHtml: String(document.documentElement?.outerHTML || '').slice(0, 3000),
        bodyTextLength: String(document.body?.innerText || '').trim().length,
        bodyChildCount: document.body?.children?.length || 0,
        imageCount: document.images.length,
        hasCanvas: Boolean(document.querySelector('canvas')),
        hasVideo: Boolean(document.querySelector('video')),
        hasSvg: Boolean(document.querySelector('svg')),
        bodyBackground: getComputedStyle(document.body || document.documentElement).backgroundColor
    }))
}

function hasRenderableContent(renderState = {}) {
    return Number(renderState.bodyTextLength || 0) >= 20 ||
        Number(renderState.imageCount || 0) > 0 ||
        Boolean(renderState.hasCanvas) ||
        Boolean(renderState.hasVideo)
}

function isBlankScreenshot({ renderState, bytes }) {
    return !hasRenderableContent(renderState) && Number(bytes || 0) < MIN_NON_BLANK_BYTES
}

function isBlockedScreenshot(renderState = {}) {
    return agentBrowserService._private.looksLikeAccessBlocked(renderState.bodyText || '', renderState.bodyHtml || '')
}

async function resolveSafeFinalUrl(rawUrl, timeoutMs = DEFAULT_TIMEOUT_MS) {
    let safeUrl = agentBrowserService._private.assertSafeUrl(rawUrl)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
        for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
            await agentBrowserService._private.assertResolvedHostSafe(safeUrl.hostname)
            const response = await fetch(safeUrl.toString(), {
                method: 'GET',
                redirect: 'manual',
                signal: controller.signal,
                headers: {
                    'user-agent': 'bili-qq-bot-agent/1.0'
                }
            })
            if (![301, 302, 303, 307, 308].includes(response.status)) {
                return safeUrl
            }
            const location = response.headers.get('location')
            if (!location) throw new Error('redirect_location_missing')
            safeUrl = agentBrowserService._private.assertSafeUrl(new URL(location, safeUrl).toString())
            if (redirectCount === MAX_REDIRECTS) throw new Error('too_many_redirects')
        }
        return safeUrl
    } finally {
        clearTimeout(timeout)
    }
}

function runChromiumScreenshot({ url, outputPath, width, height, timeoutMs, executablePath }) {
    return (async () => {
        const browser = await puppeteer.launch({
            executablePath,
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-gpu',
                '--disable-dev-shm-usage',
                '--hide-scrollbars',
                '--disable-blink-features=AutomationControlled',
                '--lang=zh-CN,zh'
            ]
        })

        try {
            const page = await browser.newPage()
            page.setDefaultTimeout(timeoutMs)
            page.setDefaultNavigationTimeout(timeoutMs)
            const trustedOrigin = new URL(url).origin
            await prepareStealthPage(page)
            await page.setViewport({ width, height, deviceScaleFactor: 1 })
            await page.setUserAgent(DESKTOP_USER_AGENT)
            await page.setExtraHTTPHeaders({
                ...agentBrowserService._private.buildBrowserLikeHeaders(new URL(url)),
                'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
                referer: `${trustedOrigin}/`
            })
            await page.setJavaScriptEnabled(true)
            await page.setRequestInterception(true)
            page.on('request', (request) => {
                const isTrustedOrigin = (() => {
                    try {
                        return new URL(request.url()).origin === trustedOrigin
                    } catch (_) {
                        return false
                    }
                })()
                if (!isTrustedOrigin && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
                    request.abort().catch(() => {})
                    return
                }
                assertSafeBrowserRequest(request.url(), trustedOrigin)
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

            await page.goto(url, {
                waitUntil: 'domcontentloaded',
                timeout: timeoutMs
            })
            await waitForPageRender(page, timeoutMs)
            const renderState = await getPageRenderState(page)
            if (isBlockedScreenshot(renderState)) {
                throw new Error('screenshot_access_blocked')
            }
            await page.screenshot({
                path: outputPath,
                type: 'png',
                fullPage: false
            })
            return { renderState }
        } finally {
            await browser.close().catch(() => {})
        }
    })().catch((error) => {
        throw new Error(`screenshot_failed:${error.message || 'unknown'}`)
    })
}

class AgentScreenshotService {
    async screenshotUrl({ url, viewportWidth = 1280, viewportHeight = 900 }, options = {}) {
        const runtimePaths = {
            executablePath: chromiumExecutable(),
            writeBase: path.resolve(config.napcatTempPath),
            readBase: path.resolve(config.napcatReadPath)
        }
        const timeoutMs = Math.max(5000, Math.min(30000, Math.trunc(Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS)))
        const finalUrl = await resolveSafeFinalUrl(url, Math.min(timeoutMs, 10000))
        await agentBrowserService._private.assertResolvedHostSafe(finalUrl.hostname)

        const width = normalizeViewport(viewportWidth, MIN_VIEWPORT_WIDTH, MAX_VIEWPORT_WIDTH, 1280)
        const height = normalizeViewport(viewportHeight, MIN_VIEWPORT_HEIGHT, MAX_VIEWPORT_HEIGHT, 900)
        const fileName = `agent_screenshot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`
        const writePath = path.join(runtimePaths.writeBase, fileName)
        const readPath = path.join(runtimePaths.readBase, fileName)
        await fs.promises.mkdir(runtimePaths.writeBase, { recursive: true })

        const screenshotResult = await runChromiumScreenshot({
            url: finalUrl.toString(),
            outputPath: writePath,
            width,
            height,
            timeoutMs,
            executablePath: runtimePaths.executablePath
        })

        const stat = await fs.promises.stat(writePath)
        if (!stat.isFile() || stat.size <= 0) throw new Error('screenshot_file_empty')
        const renderState = screenshotResult?.renderState || {}
        if (isBlankScreenshot({ renderState, bytes: stat.size })) {
            throw new Error('screenshot_page_blank')
        }
        if (isBlockedScreenshot(renderState)) {
            throw new Error('screenshot_access_blocked')
        }

        const message = `已截取网页截图：${compactText(finalUrl.toString(), 120)}`
        return {
            message,
            messageChain: [
                { type: 'text', data: { text: message } },
                { type: 'image', data: { file: `file://${readPath}` } }
            ],
            data: {
                url: finalUrl.toString(),
                filePath: readPath,
                width,
                height,
                bytes: stat.size,
                renderState
            }
        }
    }
}

module.exports = new AgentScreenshotService()
module.exports._private = {
    chromiumExecutable,
    resolveSafeFinalUrl,
    runChromiumScreenshot,
    assertSafeBrowserRequest,
    prepareStealthPage,
    waitForPageRender,
    getPageRenderState,
    hasRenderableContent,
    isBlankScreenshot,
    isBlockedScreenshot
}
