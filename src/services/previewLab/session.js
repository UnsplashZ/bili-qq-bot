const fs = require('fs')
const path = require('path')
const browserManager = require('../imageGenerator/core/browser')
const { generatePreviewCardArtifacts } = require('../imageGenerator/generators/previewCard')
const { generateHelpCard } = require('../imageGenerator/generators/helpCard')
const { generateSubscriptionList } = require('../imageGenerator/generators/subscriptionList')
const { isNightMode } = require('../imageGenerator/core/theme')
const { renderEmbeddedResourceCard } = require('../imageGenerator/renderers/components/media')
const { resolveOrigEmbeddedResourceCard } = require('../imageGenerator/renderers/components/embeddedResourceResolver')
const { resolvePreviewInput } = require('./inputResolver')
const { resolvePreviewTarget } = require('./targetResolver')
const { buildPreviewDebugHtml } = require('./htmlReport')
const { generatePreviewLabAIHelpCard } = require('./structureAiHelpCard')
const { buildMockPreviewTarget, normalizeStructureOptions } = require('./mockData')

function ensureDirectory(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true })
}

function sanitizeFileName(value) {
    return String(value || '')
        .trim()
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
}

function buildDefaultOutputName(resolvedLink) {
    const datePrefix = new Date().toISOString().slice(0, 10)
    return sanitizeFileName(`${datePrefix}-${resolvedLink.type}-${resolvedLink.id}`) || `${datePrefix}-preview`
}

function createStructureResolvedInput(options = {}) {
    const mockType = String(options.mockType || 'dynamic')
    const previewUrl = `preview-lab://structure/${mockType}`
    return {
        input: '',
        normalizedInput: previewUrl,
        resolvedLink: {
            type: mockType,
            id: 'structure',
            match: previewUrl
        },
        skippedLinks: []
    }
}

function createGeneratorDebugMeta(label, icon, groupId) {
    return {
        viewport: {},
        themeClass: isNightMode(groupId || null) ? 'theme-dark' : 'theme-light',
        resolvedTypeConfig: {
            label,
            icon
        },
        colorSummary: {}
    }
}

async function generateStructureArtifacts(previewTarget, options = {}, deps = {}) {
    const runPreviewCardArtifacts = deps.generatePreviewCardArtifacts || generatePreviewCardArtifacts
    const mockType = previewTarget.mockType || options.mockType

    if (mockType === 'help_user') {
        return {
            base64: await (deps.generateHelpCard || generateHelpCard)('user', options.groupId || null),
            html: '',
            debugMeta: createGeneratorDebugMeta('使用帮助', '💡', options.groupId)
        }
    }

    if (mockType === 'help_admin') {
        return {
            base64: await (deps.generateHelpCard || generateHelpCard)('admin', options.groupId || null),
            html: '',
            debugMeta: createGeneratorDebugMeta('管理面板', '⚙️', options.groupId)
        }
    }

    if (mockType === 'ai_help') {
        return {
            base64: await (deps.generatePreviewLabAIHelpCard || generatePreviewLabAIHelpCard)(options.groupId || null),
            html: '',
            debugMeta: createGeneratorDebugMeta('AI 配置', '🤖', options.groupId)
        }
    }

    if (mockType === 'subscription_list') {
        return {
            base64: await (deps.generateSubscriptionList || generateSubscriptionList)(
                previewTarget.info?.data || {},
                options.groupId || null,
                options.showId,
                '订阅列表'
            ),
            html: '',
            debugMeta: createGeneratorDebugMeta('订阅列表', '📋', options.groupId)
        }
    }

    return runPreviewCardArtifacts(
        previewTarget.info,
        previewTarget.cardType,
        options.groupId || null,
        options.showId
    )
}

function resolvePreviewOnlyEmbeddedResource(previewTarget) {
    const mockType = previewTarget.mockType || ''
    if (mockType !== 'dynamic' && mockType !== 'user') return null

    const dynamicModule = mockType === 'dynamic'
        ? previewTarget.info?.data?.item?.modules?.module_dynamic
        : previewTarget.info?.data?.dynamic?.modules?.module_dynamic

    return resolveOrigEmbeddedResourceCard(dynamicModule || {})
}

async function waitAllImagesReady(page) {
    await page.evaluate(async () => {
        const images = Array.from(document.querySelectorAll('img'))
        await Promise.all(images.map((img) => {
            if (img.complete && img.naturalWidth > 0) return Promise.resolve()
            return new Promise((resolve) => {
                const done = () => resolve()
                img.addEventListener('load', done, { once: true })
                img.addEventListener('error', done, { once: true })
            })
        }))
    })
}

async function injectPreviewOnlyEmbeddedResource(page, previewTarget, embeddedResourceHtml) {
    const mockType = previewTarget.mockType || ''
    await page.evaluate(({ html, mockType: currentMockType }) => {
        const template = document.createElement('template')
        template.innerHTML = html.trim()
        const fragment = template.content

        if (currentMockType === 'dynamic') {
            const actionBar = document.querySelector('.content > .action-bar')
            if (actionBar && actionBar.parentNode) {
                actionBar.parentNode.insertBefore(fragment, actionBar)
                return
            }
            const content = document.querySelector('.content')
            if (content) content.appendChild(fragment)
            return
        }

        if (currentMockType === 'user') {
            const dynamicSection = document.querySelector('.user-dynamic-section')
            if (!dynamicSection) return
            const firstSupplemental = dynamicSection.querySelector('.opus-link-card, .vote-card, .embedded-resource-card--compact')
            if (firstSupplemental && firstSupplemental.parentNode === dynamicSection) {
                dynamicSection.insertBefore(fragment, firstSupplemental)
                return
            }
            dynamicSection.appendChild(fragment)
        }
    }, {
        html: embeddedResourceHtml,
        mockType
    })
}

async function renderInjectedStructureArtifacts(previewTarget, artifacts) {
    const embeddedResource = resolvePreviewOnlyEmbeddedResource(previewTarget)
    if (!embeddedResource) return artifacts

    const embeddedResourceHtml = renderEmbeddedResourceCard(embeddedResource)
    if (!embeddedResourceHtml) return artifacts

    return browserManager.withRetry(async () => {
        await browserManager.init()
        const page = await browserManager.createPage(artifacts.debugMeta?.viewport || { width: 1200, height: 1200 })

        try {
            await page.setContent(artifacts.html, { waitUntil: 'domcontentloaded', timeout: 30000 })
            await page.waitForSelector('.container', { timeout: 5000 })
            await injectPreviewOnlyEmbeddedResource(page, previewTarget, embeddedResourceHtml)
            await waitAllImagesReady(page)

            const element = await page.$('.container')
            if (!element) {
                throw new Error('Container element not found')
            }

            const imageBuffer = await element.screenshot({
                type: 'png',
                omitBackground: true
            })

            const html = await page.content()
            return {
                base64: imageBuffer.toString('base64'),
                html,
                debugMeta: artifacts.debugMeta
            }
        } finally {
            await browserManager.closePage(page)
        }
    })
}

async function runPreviewDebugSession(input, options = {}, deps = {}) {
    const startedAt = new Date().toISOString()
    const outputDir = path.resolve(process.cwd(), options.outputDir || 'test/output')
    const mode = options.mode === 'structure' ? 'structure' : 'link'
    const normalizedStructureOptions = normalizeStructureOptions(options.structureOptions || {})
    const resolvedInput = mode === 'structure'
        ? createStructureResolvedInput(options)
        : await (deps.resolvePreviewInput || resolvePreviewInput)(input, options, deps)
    const previewTarget = mode === 'structure'
        ? (deps.buildMockPreviewTarget || buildMockPreviewTarget)(options.mockType, normalizedStructureOptions)
        : await (deps.resolvePreviewTarget || resolvePreviewTarget)(resolvedInput.resolvedLink, options, deps)

    if (!previewTarget.info || previewTarget.info.status !== 'success') {
        const targetUrl = previewTarget.url || resolvedInput.resolvedLink.match || input
        throw new Error(`预览数据获取失败: ${previewTarget.info?.message || previewTarget.info?.status || targetUrl}`)
    }

    let artifacts = mode === 'structure'
        ? await generateStructureArtifacts(previewTarget, options, deps)
        : await (deps.generatePreviewCardArtifacts || generatePreviewCardArtifacts)(
            previewTarget.info,
            previewTarget.cardType,
            options.groupId || null,
            options.showId
        )

    if (
        mode === 'structure'
        && normalizedStructureOptions.withEmbeddedResource
        && (previewTarget.mockType === 'dynamic' || previewTarget.mockType === 'user')
    ) {
        artifacts = await (deps.renderInjectedStructureArtifacts || renderInjectedStructureArtifacts)(previewTarget, artifacts)
    }

    const outputName = sanitizeFileName(options.outName) || buildDefaultOutputName(resolvedInput.resolvedLink)
    ensureDirectory(outputDir)

    const pngPath = path.join(outputDir, `${outputName}.png`)
    const jsonPath = path.join(outputDir, `${outputName}.json`)
    const manifestPath = path.join(outputDir, `${outputName}.manifest.json`)
    const htmlPath = options.emitHtml ? path.join(outputDir, `${outputName}.html`) : ''

    fs.writeFileSync(pngPath, Buffer.from(artifacts.base64, 'base64'))

    const dataPayload = {
        mode,
        input: resolvedInput.input,
        normalizedInput: resolvedInput.normalizedInput,
        resolvedLink: resolvedInput.resolvedLink,
        skippedLinks: resolvedInput.skippedLinks,
        cardType: previewTarget.cardType,
        canonicalUrl: previewTarget.canonicalUrl,
        info: previewTarget.info,
        renderHtml: artifacts.html,
        debugMeta: artifacts.debugMeta,
        renderOverrides: options.renderOverrides || {},
        mockType: mode === 'structure' ? String(options.mockType || '') : '',
        structureOptions: mode === 'structure' ? normalizedStructureOptions : {}
    }
    fs.writeFileSync(jsonPath, JSON.stringify(dataPayload, null, 2))

    const manifest = {
        mode,
        input: resolvedInput.input,
        resolvedLink: resolvedInput.resolvedLink,
        skippedLinks: resolvedInput.skippedLinks,
        cardType: previewTarget.cardType,
        canonicalUrl: previewTarget.canonicalUrl,
        status: 'success',
        jsonPath,
        pngPath,
        htmlPath,
        startedAt,
        finishedAt: new Date().toISOString(),
        outputName,
        debugMeta: artifacts.debugMeta,
        renderOverrides: options.renderOverrides || {},
        mockType: mode === 'structure' ? String(options.mockType || '') : '',
        structureOptions: mode === 'structure' ? normalizedStructureOptions : {}
    }

    if (options.emitHtml) {
        const html = buildPreviewDebugHtml({
            manifest,
            dataPayload,
            dataFileName: path.basename(jsonPath),
            imageFileName: path.basename(pngPath),
            renderHtml: artifacts.html
        })
        fs.writeFileSync(htmlPath, html)
    }

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
    manifest.manifestPath = manifestPath
    return {
        status: 'success',
        manifest,
        dataPayload,
        previewTargetSummary: {
            status: previewTarget.status,
            cardType: previewTarget.cardType,
            canonicalUrl: previewTarget.canonicalUrl
        },
        artifactsSummary: {
            renderHtml: artifacts.html,
            debugMeta: artifacts.debugMeta
        }
    }
}

module.exports = {
    runPreviewDebugSession
}
