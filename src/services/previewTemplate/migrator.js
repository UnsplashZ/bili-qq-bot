'use strict'

const { getDefaultTemplate } = require('./defaults')
const { normalizeTemplate, clone } = require('./normalizer')
const { isLegacyRole, getRolePolicy } = require('./schema')

const PREVIEW_TEMPLATE_SCHEMA_VERSION = 3
const PREVIEW_TEMPLATE_DEFAULT_SIGNATURE = 'legacy-parity-v3'

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function mapV1ElementToNode(type, node, elementPatch = {}) {
    const next = clone(node)
    const policy = getRolePolicy(type)
    const required = new Set(policy.requiredRoles || [])
    const isLegacy = isLegacyRole(type, next.role)
    if (elementPatch.visible !== undefined && !(isLegacy && required.has(next.role))) next.visible = elementPatch.visible !== false
    if (isPlainObject(elementPatch.layout)) {
        next.layout = { ...(next.layout || { mode: 'flow' }) }
        if (next.layout.mode === undefined) next.layout.mode = 'flow'
        const resizable = new Set(policy.layoutPolicy?.resizableRoles || [])
        if (!isLegacy || resizable.has(next.role)) {
            if (elementPatch.layout.width !== undefined) next.layout.width = elementPatch.layout.width
            if (elementPatch.layout.height !== undefined) next.layout.height = elementPatch.layout.height
        }
        if (!isLegacy) {
            if (elementPatch.layout.marginTop !== undefined) next.layout.marginTop = elementPatch.layout.marginTop
            if (elementPatch.layout.marginBottom !== undefined) next.layout.marginBottom = elementPatch.layout.marginBottom
        }
        if (elementPatch.layout.offsetX !== undefined || elementPatch.layout.offsetY !== undefined) {
            next.layout.mode = 'flow'
            next.layout.transform = {
                ...(next.layout.transform || {}),
                ...(elementPatch.layout.offsetX !== undefined ? { x: elementPatch.layout.offsetX } : {}),
                ...(elementPatch.layout.offsetY !== undefined ? { y: elementPatch.layout.offsetY } : {})
            }
        }
    }
    if (isPlainObject(elementPatch.typography)) {
        next.style = { ...(next.style || {}) }
        if (elementPatch.typography.fontSize !== undefined) next.style.fontSize = elementPatch.typography.fontSize
        if (elementPatch.typography.lineHeight !== undefined) next.style.lineHeight = elementPatch.typography.lineHeight
        if (elementPatch.typography.maxLines !== undefined) next.style.maxLines = elementPatch.typography.maxLines
        if (elementPatch.typography.maxHeight !== undefined) next.style.maxHeight = elementPatch.typography.maxHeight
    }
    if (isPlainObject(elementPatch.media)) {
        next.style = { ...(next.style || {}) }
        if (elementPatch.media.objectFit !== undefined) next.style.objectFit = elementPatch.media.objectFit
        if (elementPatch.media.objectPosition !== undefined) next.style.objectPosition = elementPatch.media.objectPosition
        if (!isLegacy && elementPatch.media.borderRadius !== undefined) next.style.radius = elementPatch.media.borderRadius
        if (elementPatch.media.aspectRatio !== undefined) next.layout = { ...(next.layout || {}), aspectRatio: elementPatch.media.aspectRatio }
    }
    return next
}

function migrateV1PatchToTemplate(type, patch = {}) {
    const template = getDefaultTemplate(type)
    const elements = patch?.elements && typeof patch.elements === 'object' ? patch.elements : {}
    for (const [key, elementPatch] of Object.entries(elements)) {
        const node = template.nodesById[key]
        if (!node || !isPlainObject(elementPatch)) continue
        template.nodesById[key] = mapV1ElementToNode(type, node, elementPatch)
    }
    return normalizeTemplate(template, { type })
}

function migratePreviewLayoutPatchToTemplate(type, patch = {}, options = {}) {
    const warnings = []
    const template = getDefaultTemplate(type)
    const elements = patch?.elements && typeof patch.elements === 'object' ? patch.elements : {}
    for (const [key, elementPatch] of Object.entries(elements)) {
        const node = template.nodesById[key]
        if (!node || !isPlainObject(elementPatch)) {
            warnings.push({ code: 'migration-field-dropped', path: `elements.${key}` })
            continue
        }
        template.nodesById[key] = mapV1ElementToNode(type, node, elementPatch)
    }
    const normalized = normalizeTemplate(template, { type })
    if (options.withMeta) {
        return { template: normalized, migratedFromVersion: 1, warnings }
    }
    return normalized
}

function migratePreviewLayoutConfig(rawConfig = {}) {
    if (rawConfig?.version === 2) return clone(rawConfig)
    const migrated = {
        version: 2,
        legacyV1Backup: clone(rawConfig || {}),
        global: {},
        groups: {},
        lastKnownGood: {}
    }
    const global = isPlainObject(rawConfig.global) ? rawConfig.global : {}
    for (const [type, patch] of Object.entries(global)) {
        migrated.global[type] = {
            template: migrateV1PatchToTemplate(type, patch),
            migratedFromVersion: Number(rawConfig.version) || 1
        }
    }
    const groups = isPlainObject(rawConfig.groups) ? rawConfig.groups : {}
    for (const [groupId, byType] of Object.entries(groups)) {
        if (!isPlainObject(byType)) continue
        migrated.groups[groupId] = {}
        for (const [type, patch] of Object.entries(byType)) {
            const template = migrateV1PatchToTemplate(type, patch)
            const nodes = {}
            for (const key of Object.keys(patch?.elements || {})) {
                if (template.nodesById[key]) nodes[key] = { op: 'merge', value: template.nodesById[key] }
            }
            migrated.groups[groupId][type] = {
                templatePatch: Object.keys(nodes).length > 0 ? { nodes } : {},
                migratedFromVersion: Number(rawConfig.version) || 1
            }
        }
    }
    return migrated
}

function migrateLegacyCoreNode(type, node) {
    const next = clone(node)
    const role = next.role
    if (!isLegacyRole(type, role)) return next

    const layout = { ...(next.layout || { mode: 'flow' }) }
    if (layout.mode === 'absolute') {
        const transform = { ...(layout.transform || {}) }
        if (layout.x !== undefined) transform.x = layout.x
        if (layout.y !== undefined) transform.y = layout.y
        next.layout = { mode: 'flow' }
        if (Object.keys(transform).length > 0) next.layout.transform = transform
    } else {
        next.layout = { mode: layout.mode || 'flow' }
        if (layout.transform) next.layout.transform = layout.transform
    }

    if (role === 'root' || role === 'card' || role === 'typeBadge' || role === 'content' || role === 'header' || role === 'stats') {
        next.layout.mode = next.layout.mode === 'absolute' ? 'flow' : next.layout.mode
    }
    if (layout.transform && !next.layout.transform) next.layout.transform = layout.transform
    if (layout.marginTop !== undefined || layout.marginBottom !== undefined) {
        // Old v2 stored visual spacing for core nodes. Legacy CSS owns that now.
    }
    next.style = {}
    return next
}

function migrateSavedV2Template(type, rawTemplate = {}, options = {}) {
    if (!rawTemplate || rawTemplate.version !== 2) return rawTemplate
    const alreadySigned = rawTemplate.previewTemplateDefaultSignature === PREVIEW_TEMPLATE_DEFAULT_SIGNATURE
        || rawTemplate.schemaVersion === PREVIEW_TEMPLATE_SCHEMA_VERSION
        || options.force !== true && rawTemplate.baseSignature === PREVIEW_TEMPLATE_DEFAULT_SIGNATURE
    if (alreadySigned) return rawTemplate

    const template = clone(rawTemplate)
    if (!template.nodesById || typeof template.nodesById !== 'object') return rawTemplate
    for (const [id, node] of Object.entries(template.nodesById)) {
        template.nodesById[id] = migrateLegacyCoreNode(type, node)
    }
    template.previewTemplateDefaultSignature = PREVIEW_TEMPLATE_DEFAULT_SIGNATURE
    template.schemaVersion = PREVIEW_TEMPLATE_SCHEMA_VERSION
    return template
}

function migrateSavedV2PatchValue(type, id, value = {}) {
    if (!isPlainObject(value)) return value
    const defaults = getDefaultTemplate(type)
    const baseNode = defaults.nodesById?.[id]
    const role = value.role || baseNode?.role
    if (!isLegacyRole(type, role)) return value

    const next = clone(value)
    if (isPlainObject(next.layout)) {
        const migratedLayout = { ...(next.layout || {}) }
        if (migratedLayout.mode === 'absolute') {
            const transform = { ...(migratedLayout.transform || {}) }
            if (migratedLayout.x !== undefined) transform.x = migratedLayout.x
            if (migratedLayout.y !== undefined) transform.y = migratedLayout.y
            next.layout = { mode: 'flow' }
            if (Object.keys(transform).length > 0) next.layout.transform = transform
        } else {
            next.layout = { mode: migratedLayout.mode || 'flow' }
            for (const key of ['width', 'height', 'padding', 'gap', 'zIndex', 'columns', 'direction', 'align', 'justify', 'aspectRatio', 'anchor', 'absoluteChildren', 'transform']) {
                if (migratedLayout[key] !== undefined) next.layout[key] = clone(migratedLayout[key])
            }
        }
    }
    if (isPlainObject(next.style)) {
        const allowed = new Set((getRolePolicy(type).stylePolicy?.coreFields || []))
        next.style = Object.fromEntries(Object.entries(next.style).filter(([key]) => allowed.has(key)))
    }
    return next
}

function migrateSavedV2TemplatePatch(type, patch = {}) {
    if (!isPlainObject(patch)) return patch
    const next = clone(patch)
    for (const [id, operation] of Object.entries(next.nodes || {})) {
        if (operation?.value) operation.value = migrateSavedV2PatchValue(type, id, operation.value)
    }
    return next
}

function migrateSavedV2Config(rawConfig = {}) {
    const migrated = clone(rawConfig || {})
    if (migrated.version !== 2) return migratePreviewLayoutConfig(rawConfig)
    migrated.previewTemplateDefaultSignature = PREVIEW_TEMPLATE_DEFAULT_SIGNATURE
    migrated.previewTemplateSchemaVersion = PREVIEW_TEMPLATE_SCHEMA_VERSION
    for (const [type, entry] of Object.entries(migrated.global || {})) {
        if (entry?.template) {
            entry.template = migrateSavedV2Template(type, entry.template)
            entry.baseSignature = entry.baseSignature || PREVIEW_TEMPLATE_DEFAULT_SIGNATURE
        }
    }
    for (const byType of Object.values(migrated.groups || {})) {
        if (!isPlainObject(byType)) continue
        for (const [type, entry] of Object.entries(byType)) {
            if (entry?.templatePatch) entry.templatePatch = migrateSavedV2TemplatePatch(type, entry.templatePatch)
        }
    }
    return migrated
}

function migratePreviewLayoutConfigToTemplates(rawConfig = {}) {
    return {
        config: migratePreviewLayoutConfig(rawConfig),
        migratedFromVersion: Number(rawConfig?.version) || 1,
        warnings: []
    }
}

module.exports = {
    migrateV1PatchToTemplate,
    migrateSavedV2Template,
    migrateSavedV2TemplatePatch,
    migrateSavedV2Config,
    migratePreviewLayoutPatchToTemplate,
    migratePreviewLayoutConfig,
    migratePreviewLayoutConfigToTemplates,
    PREVIEW_TEMPLATE_SCHEMA_VERSION,
    PREVIEW_TEMPLATE_DEFAULT_SIGNATURE
}
