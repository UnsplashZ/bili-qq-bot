'use strict'

const { normalizeTemplate, PreviewTemplateValidationError } = require('./normalizer')
const { buildViewModel, resolveBinding, safeImageUrl, safeInternalImageUrl } = require('./bindings')
const { renderTemplateCss } = require('./css')

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

function attrs(node) {
    const classes = ['preview-template-node', `preview-template-${node.type}`]
    return `class="${classes.join(' ')}" data-template-node-id="${escapeHtml(node.id)}"`
}

function statValue(item, viewModel) {
    const map = {
        views: viewModel.stats?.views,
        likes: viewModel.stats?.likes,
        comments: viewModel.stats?.comments,
        shares: viewModel.stats?.shares
    }
    const labels = { views: '播放', likes: '点赞', comments: '评论', shares: '分享' }
    const value = map[item]
    if (value === undefined || value === null || value === '') return ''
    return `${labels[item] || item}: ${escapeHtml(value)}`
}

function renderLeaf(node, viewModel) {
    if (node.visible === false) return ''
    const value = resolveBinding(node.binding || {}, viewModel)
    if (node.hideWhenEmpty && !value) return ''
    if (node.type === 'image') {
        const src = safeImageUrl(value) || safeInternalImageUrl(viewModel.card?.placeholderImage) || ''
        return `<div ${attrs(node)}>${src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(node.label || node.id)}">` : ''}</div>`
    }
    if (node.type === 'tag') {
        return `<div ${attrs(node)}><span>${escapeHtml(value || node.label || '')}</span></div>`
    }
    if (node.type === 'stats') {
        const items = Array.isArray(node.items) && node.items.length > 0 ? node.items : ['views', 'likes', 'comments']
        const html = items.map(item => statValue(item, viewModel)).filter(Boolean).map(text => `<span class="stat-item">${text}</span>`).join('')
        return `<div ${attrs(node)}>${html}</div>`
    }
    if (node.type === 'shape') {
        return `<div ${attrs(node)}></div>`
    }
    return `<div ${attrs(node)}>${escapeHtml(value)}</div>`
}

function renderGenericNode(template, nodeId, viewModel) {
    const node = template.nodesById[nodeId]
    if (!node || node.visible === false) return ''
    const children = template.childrenByParentId[nodeId] || []
    if (children.length > 0) {
        const html = children.map(childId => renderGenericNode(template, childId, viewModel)).join('')
        return `<div ${attrs(node)}>${html}</div>`
    }
    return renderLeaf(node, viewModel)
}

function roleNodeIdMap(template) {
    const map = {}
    for (const node of Object.values(template.nodesById || {})) {
        if (node.role) map[node.role] = node.id
    }
    return map
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function injectTemplateIds(legacyHtml, template) {
    let html = legacyHtml || ''
    const map = roleNodeIdMap(template)
    for (const [role, nodeId] of Object.entries(map)) {
        if (role === 'root') continue
        const pattern = new RegExp(`(<[a-zA-Z][^>]*\\sdata-layout-key="${escapeRegExp(role)}"[^>]*)(>)`, 'g')
        html = html.replace(pattern, (match, start, end) => {
            if (/data-template-node-id=/.test(start)) return match
            return `${start} data-template-node-id="${escapeHtml(nodeId)}"${end}`
        })
    }
    return html
}

function collectGenericInsertions(template, viewModel) {
    const insertions = {}
    for (const parent of Object.values(template.nodesById || {})) {
        if (!parent?.role) continue
        const children = template.childrenByParentId?.[parent.id] || []
        for (const childId of children) {
            const node = template.nodesById?.[childId]
            if (!node || node.role || node.visible === false) continue
            if (!insertions[parent.id]) insertions[parent.id] = []
            insertions[parent.id].push(renderGenericNode(template, node.id, viewModel))
        }
    }
    return insertions
}

function insertGenericNodes(html, template, viewModel) {
    let output = html
    const insertions = collectGenericInsertions(template, viewModel)
    for (const [parentId, chunks] of Object.entries(insertions)) {
        const addition = chunks.join('')
        if (!addition) continue
        const pattern = new RegExp(`(<[a-zA-Z][^>]*\\sdata-template-node-id="${escapeRegExp(parentId)}"[^>]*>)`)
        if (!pattern.test(output)) {
            throw new PreviewTemplateValidationError(`generic insertion parent not found: ${parentId}`, {
                statusCode: 422,
                code: 'PREVIEW_TEMPLATE_ROLE_MISSING',
                nodeId: parentId
            })
        }
        output = output.replace(pattern, `$1${addition}`)
    }
    return output
}

function renderTemplateBody(template, viewModel, options = {}) {
    if (options.legacyHtml) {
        const legacyWithIds = injectTemplateIds(options.legacyHtml, template)
        const withGeneric = insertGenericNodes(legacyWithIds, template, viewModel)
        return `<div class="preview-template-root" data-template-node-id="${escapeHtml(template.rootId)}" data-layout-key="root">${withGeneric}</div>`
    }
    return renderGenericNode(template, template.rootId, viewModel)
}

function renderTemplateArtifacts(rawTemplate, data, type, options = {}) {
    const template = normalizeTemplate(rawTemplate, { type })
    const viewModel = buildViewModel(type, data, { showId: options.showId, url: options.url })
    return {
        template,
        viewModel,
        html: renderTemplateBody(template, viewModel, options),
        css: renderTemplateCss(template)
    }
}

function stripDangerousHtml(html) {
    return String(html || '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<\/script>/gi, '')
        .replace(/\son[a-zA-Z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/g, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/javascript\s*:/gi, '')
}

// Sanitizes a full HTML document that already contains <style> tags (keeps CSS, strips scripts/event-handlers)
function sanitizeArtifactHtml(html) {
    return String(html || '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<\/script>/gi, '')
        .replace(/\son[a-zA-Z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/g, '')
        .replace(/javascript\s*:/gi, '')
}

function buildStructuralElements(template) {
    const elements = {}
    for (const [nodeId, node] of Object.entries(template.nodesById || {})) {
        elements[nodeId] = {
            role: node.role || null,
            type: node.type,
            label: node.label || nodeId,
            parentId: node.parentId || null,
            visible: node.visible !== false
        }
    }
    return elements
}

function renderTemplateHtmlArtifact(rawTemplate, data, type, options = {}) {
    const artifacts = renderTemplateArtifacts(rawTemplate, data, type, options)
    return {
        html: stripDangerousHtml(artifacts.html),
        css: artifacts.css,
        elements: buildStructuralElements(artifacts.template),
        renderer: 'preview-template-v2'
    }
}

function renderTemplateToHtml(rawTemplate, data = {}, options = {}) {
    const type = options.type || rawTemplate?.type || 'video'
    const artifacts = renderTemplateArtifacts(rawTemplate, data, type, options)
    const html = `<div class="container preview-template-container">${artifacts.html}</div>`
    return {
        ...artifacts,
        html,
        fullHtml: `<html><head>${artifacts.css}</head><body>${html}</body></html>`
    }
}

module.exports = {
    escapeHtml,
    renderTemplateArtifacts,
    renderTemplateToHtml,
    renderTemplateBody,
    renderTemplateHtmlArtifact,
    buildStructuralElements,
    sanitizeArtifactHtml
}
