const fs = require('fs')
const path = require('path')
const { generatePreviewCardArtifacts } = require('../imageGenerator/generators/previewCard')
const { resolvePreviewInput } = require('./inputResolver')
const { resolvePreviewTarget } = require('./targetResolver')
const { buildPreviewDebugHtml } = require('./htmlReport')

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

async function runPreviewDebugSession(input, options = {}, deps = {}) {
    const startedAt = new Date().toISOString()
    const outputDir = path.resolve(process.cwd(), options.outputDir || 'test/output')
    const resolvedInput = await (deps.resolvePreviewInput || resolvePreviewInput)(input, options, deps)
    const previewTarget = await (deps.resolvePreviewTarget || resolvePreviewTarget)(resolvedInput.resolvedLink, options, deps)

    if (!previewTarget.info || previewTarget.info.status !== 'success') {
        const targetUrl = previewTarget.url || resolvedInput.resolvedLink.match || input
        throw new Error(`预览数据获取失败: ${previewTarget.info?.message || previewTarget.info?.status || targetUrl}`)
    }

    const artifacts = await (deps.generatePreviewCardArtifacts || generatePreviewCardArtifacts)(
        previewTarget.info,
        previewTarget.cardType,
        options.groupId || null,
        options.showId
    )

    const outputName = sanitizeFileName(options.outName) || buildDefaultOutputName(resolvedInput.resolvedLink)
    ensureDirectory(outputDir)

    const pngPath = path.join(outputDir, `${outputName}.png`)
    const jsonPath = path.join(outputDir, `${outputName}.json`)
    const manifestPath = path.join(outputDir, `${outputName}.manifest.json`)
    const htmlPath = options.emitHtml ? path.join(outputDir, `${outputName}.html`) : ''

    fs.writeFileSync(pngPath, Buffer.from(artifacts.base64, 'base64'))

    const dataPayload = {
        input: resolvedInput.input,
        normalizedInput: resolvedInput.normalizedInput,
        resolvedLink: resolvedInput.resolvedLink,
        skippedLinks: resolvedInput.skippedLinks,
        cardType: previewTarget.cardType,
        canonicalUrl: previewTarget.canonicalUrl,
        info: previewTarget.info,
        renderHtml: artifacts.html,
        debugMeta: artifacts.debugMeta,
        renderOverrides: options.renderOverrides || {}
    }
    fs.writeFileSync(jsonPath, JSON.stringify(dataPayload, null, 2))

    const manifest = {
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
        renderOverrides: options.renderOverrides || {}
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
