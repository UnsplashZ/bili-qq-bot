'use strict'

const crypto = require('crypto')
const config = require('../../config')
const { getDefaultTemplate } = require('./defaults')
const { normalizeTemplate, clone, PreviewTemplateValidationError } = require('./normalizer')
const { migratePreviewLayoutConfig, migrateV1PatchToTemplate, migrateSavedV2Config, migrateSavedV2Template } = require('./migrator')
const { isEditableType, isLegacyRole } = require('./schema')

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function mergeDeep(base = {}, patch = {}) {
    const output = clone(base) || {}
    for (const [key, value] of Object.entries(patch || {})) {
        if (isPlainObject(value) && isPlainObject(output[key])) {
            output[key] = mergeDeep(output[key], value)
        } else if (value === undefined) {
            delete output[key]
        } else {
            output[key] = clone(value)
        }
    }
    return output
}

function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
    if (isPlainObject(value)) {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
    }
    return JSON.stringify(value)
}

function shortHash(value) {
    return crypto.createHash('sha256').update(stableStringify(value)).digest('hex').slice(0, 16)
}

function getStoredPreviewTemplateConfig(input = config.previewLayoutConfig) {
    const raw = input
    if (!isPlainObject(raw)) return { version: 2, legacyV1Backup: {}, global: {}, groups: {}, lastKnownGood: {} }
    if (raw.version === 2) {
        return migrateSavedV2Config({
            version: 2,
            legacyV1Backup: isPlainObject(raw.legacyV1Backup) ? clone(raw.legacyV1Backup) : {},
            global: isPlainObject(raw.global) ? clone(raw.global) : {},
            groups: isPlainObject(raw.groups) ? clone(raw.groups) : {},
            lastKnownGood: isPlainObject(raw.lastKnownGood) ? clone(raw.lastKnownGood) : {}
        })
    }
    return migratePreviewLayoutConfig(raw)
}

function normalizeMaybeTemplate(type, value, fallback) {
    if (!value) return fallback
    if (value.legacyTemplate) return normalizeTemplate(migrateSavedV2Template(type, value.legacyTemplate), { type })
    return normalizeTemplate(migrateSavedV2Template(type, value), { type })
}

function applyChildrenOrder(baseChildren, orderPatch = {}, nodesById) {
    let children = [...(baseChildren || [])]
    for (const id of orderPatch.remove || []) {
        children = children.filter(child => child !== id)
    }
    for (const id of Object.keys(nodesById)) {
        const parentId = nodesById[id].parentId
        if (parentId && !children.includes(id) && parentId === orderPatch.parentId) {
            children.push(id)
        }
    }
    const placeBefore = orderPatch.before || {}
    for (const [id, beforeId] of Object.entries(placeBefore)) {
        children = children.filter(child => child !== id)
        const index = children.indexOf(beforeId)
        if (index >= 0) children.splice(index, 0, id)
        else children.push(id)
    }
    const placeAfter = orderPatch.after || {}
    for (const [id, afterId] of Object.entries(placeAfter)) {
        children = children.filter(child => child !== id)
        const index = children.indexOf(afterId)
        if (index >= 0) children.splice(index + 1, 0, id)
        else children.push(id)
    }
    return children.filter((id, index) => nodesById[id] && children.indexOf(id) === index)
}

function removeNodeTree(template, nodeId) {
    const children = template.childrenByParentId[nodeId] || []
    for (const childId of children) removeNodeTree(template, childId)
    const parentId = template.nodesById[nodeId]?.parentId
    if (parentId && template.childrenByParentId[parentId]) {
        template.childrenByParentId[parentId] = template.childrenByParentId[parentId].filter(id => id !== nodeId)
    }
    delete template.childrenByParentId[nodeId]
    delete template.nodesById[nodeId]
}

function applyTemplatePatch(baseTemplate, patch = {}) {
    if (typeof baseTemplate === 'string') {
        return applyTemplatePatch(patch, arguments[2] || {})
    }
    if (!patch || Object.keys(patch).length === 0) return normalizeTemplate(baseTemplate, { type: baseTemplate.type })
    if (patch.legacyTemplate) return normalizeTemplate(migrateSavedV2Template(baseTemplate.type, patch.legacyTemplate), { type: baseTemplate.type })
    const next = clone(baseTemplate)
    const tombstones = new Set()
    for (const [id, operation] of Object.entries(patch.nodes || {})) {
        const op = operation?.op || 'merge'
        if (op === 'remove') {
            tombstones.add(id)
            if (next.nodesById[id]) removeNodeTree(next, id)
            continue
        }
        if (op === 'reset') continue
        if (op === 'add') {
            const value = clone(operation.value || {})
            next.nodesById[id] = { ...value, id }
            const parentId = next.nodesById[id].parentId
            if (parentId) {
                if (!next.childrenByParentId[parentId]) next.childrenByParentId[parentId] = []
                if (!next.childrenByParentId[parentId].includes(id)) next.childrenByParentId[parentId].push(id)
            }
            continue
        }
        if (op === 'move') {
            if (!next.nodesById[id]) continue
            const parentId = String(operation.parentId || operation.value?.parentId || '')
            const oldParent = next.nodesById[id].parentId
            if (oldParent && next.childrenByParentId[oldParent]) {
                next.childrenByParentId[oldParent] = next.childrenByParentId[oldParent].filter(child => child !== id)
            }
            next.nodesById[id].parentId = parentId
            if (!next.childrenByParentId[parentId]) next.childrenByParentId[parentId] = []
            next.childrenByParentId[parentId].push(id)
            if (operation.value?.before) {
                next.childrenByParentId[parentId] = applyChildrenOrder(
                    next.childrenByParentId[parentId],
                    { parentId, before: { [id]: operation.value.before } },
                    next.nodesById
                )
            }
            if (operation.value?.after) {
                next.childrenByParentId[parentId] = applyChildrenOrder(
                    next.childrenByParentId[parentId],
                    { parentId, after: { [id]: operation.value.after } },
                    next.nodesById
                )
            }
            continue
        }
        if (op === 'reorder') {
            const parentId = String(operation.parentId || operation.value?.parentId || next.nodesById[id]?.parentId || '')
            if (!parentId) continue
            next.childrenByParentId[parentId] = applyChildrenOrder(
                next.childrenByParentId[parentId] || [],
                { ...(operation.value || {}), parentId },
                next.nodesById
            )
            continue
        }
        if (next.nodesById[id]) {
            next.nodesById[id] = mergeDeep(next.nodesById[id], operation.value || {})
        }
    }
    for (const [parentId, orderPatch] of Object.entries(patch.children || {})) {
        if (!next.nodesById[parentId]) continue
        next.childrenByParentId[parentId] = applyChildrenOrder(
            next.childrenByParentId[parentId] || [],
            { ...(orderPatch || {}), parentId },
            next.nodesById
        ).filter(id => !tombstones.has(id))
    }
    return normalizeTemplate(next, { type: next.type })
}

function collectPatchBaseSignatures(baseTemplate, patch = {}) {
    const signatures = { nodes: {}, children: {} }
    const touchedChildren = new Set()
    for (const [id, operation] of Object.entries(patch.nodes || {})) {
        const op = operation?.op || 'merge'
        if (op !== 'add' && baseTemplate.nodesById?.[id]) {
            signatures.nodes[id] = shortHash(baseTemplate.nodesById[id])
        }
        const parentId = operation?.parentId || operation?.value?.parentId || baseTemplate.nodesById?.[id]?.parentId
        if (parentId) touchedChildren.add(parentId)
    }
    for (const parentId of Object.keys(patch.children || {})) touchedChildren.add(parentId)
    for (const parentId of touchedChildren) {
        signatures.children[parentId] = shortHash(baseTemplate.childrenByParentId?.[parentId] || [])
    }
    if (Object.keys(signatures.nodes).length === 0) delete signatures.nodes
    if (Object.keys(signatures.children).length === 0) delete signatures.children
    return signatures
}

function ensureGroupPatchEntryMetadata(baseTemplate, groupEntry = {}) {
    if (!groupEntry?.templatePatch) return groupEntry
    if (groupEntry.baseSignature && groupEntry.baseNodeSignatures) return groupEntry
    return {
        ...groupEntry,
        baseSignature: groupEntry.baseSignature || shortHash(baseTemplate),
        baseNodeSignatures: groupEntry.baseNodeSignatures || collectPatchBaseSignatures(baseTemplate, groupEntry.templatePatch)
    }
}

function assertGroupPatchBaseCompatible(baseTemplate, groupEntry = {}) {
    const patch = groupEntry?.templatePatch
    if (!patch || Object.keys(patch).length === 0) return
    const currentBaseSignature = shortHash(baseTemplate)
    if (!groupEntry.baseSignature || groupEntry.baseSignature === currentBaseSignature) return
    const expected = groupEntry.baseNodeSignatures
    if (!expected || (!expected.nodes && !expected.children)) {
        throw new PreviewTemplateValidationError('group template patch base signature mismatch', {
            statusCode: 422,
            code: 'PREVIEW_TEMPLATE_REBASE_CONFLICT',
            expectedBaseSignature: groupEntry.baseSignature,
            currentBaseSignature
        })
    }
    const conflicts = []
    for (const [id, signature] of Object.entries(expected.nodes || {})) {
        if (shortHash(baseTemplate.nodesById?.[id] || null) !== signature) conflicts.push(`nodes.${id}`)
    }
    for (const [parentId, signature] of Object.entries(expected.children || {})) {
        if (shortHash(baseTemplate.childrenByParentId?.[parentId] || []) !== signature) conflicts.push(`children.${parentId}`)
    }
    if (conflicts.length > 0) {
        throw new PreviewTemplateValidationError('group template patch cannot be rebased automatically', {
            statusCode: 422,
            code: 'PREVIEW_TEMPLATE_REBASE_CONFLICT',
            expectedBaseSignature: groupEntry.baseSignature,
            currentBaseSignature,
            conflicts
        })
    }
}

function applyGroupTemplatePatch(baseTemplate, groupEntry = {}) {
    const entry = ensureGroupPatchEntryMetadata(baseTemplate, groupEntry)
    assertGroupPatchBaseCompatible(baseTemplate, entry)
    return applyTemplatePatch(baseTemplate, entry.templatePatch || {})
}

function mergeEffectiveTemplate(type, options = {}) {
    let current = options.globalTemplate
        ? normalizeTemplate(options.globalTemplate.template || options.globalTemplate, { type })
        : normalizeTemplate(getDefaultTemplate(type), { type })
    const groupPatch = options.groupTemplatePatch?.templatePatch || options.groupTemplatePatch
    if (groupPatch && Object.keys(groupPatch).length > 0) {
        current = options.groupTemplatePatch?.templatePatch
            ? applyGroupTemplatePatch(current, options.groupTemplatePatch)
            : applyTemplatePatch(current, groupPatch)
    }
    const draft = options.draftTemplate
    if (draft && Object.keys(draft).length > 0) {
        current = draft.nodes || draft.children
            ? applyTemplatePatch(current, draft)
            : normalizeTemplate(draft, { type })
    }
    return normalizeTemplate(current, { type })
}

function diffTemplates(baseTemplate, targetTemplate) {
    const base = normalizeTemplate(baseTemplate, { type: baseTemplate.type })
    const target = normalizeTemplate(targetTemplate, { type: targetTemplate.type || base.type })
    const patch = { nodes: {}, children: {} }
    for (const id of Object.keys(base.nodesById)) {
        if (!target.nodesById[id]) patch.nodes[id] = { op: 'remove' }
    }
    for (const [id, node] of Object.entries(target.nodesById)) {
        if (!base.nodesById[id]) {
            patch.nodes[id] = { op: 'add', value: node }
        } else if (stableStringify(base.nodesById[id]) !== stableStringify(node)) {
            const value = isLegacyRole(target.type, node.role)
                ? diffNodeFields(base.nodesById[id], node)
                : node
            if (Object.keys(value).length > 0) patch.nodes[id] = { op: 'merge', value }
        }
    }
    for (const [parentId, children] of Object.entries(target.childrenByParentId)) {
        if (stableStringify(base.childrenByParentId[parentId] || []) !== stableStringify(children)) {
            const before = {}
            children.forEach((id, index) => {
                const next = children[index + 1]
                if (next) before[id] = next
            })
            patch.children[parentId] = { op: 'order', before }
        }
    }
    if (Object.keys(patch.nodes).length === 0) delete patch.nodes
    if (Object.keys(patch.children).length === 0) delete patch.children
    return patch
}

function diffNodeFields(baseNode, targetNode) {
    const value = {}
    for (const key of ['visible', 'label', 'layout', 'style', 'binding', 'items', 'hideWhenEmpty']) {
        if (stableStringify(baseNode[key]) !== stableStringify(targetNode[key])) {
            value[key] = clone(targetNode[key])
        }
    }
    return value
}

function getGlobalTemplate(rawConfig, type) {
    const base = getDefaultTemplate(type)
    const globalEntry = rawConfig.global?.[type]
    if (!globalEntry?.template) return normalizeTemplate(base, { type })
    return normalizeMaybeTemplate(type, globalEntry.template, null)
}

function getEffectiveTemplate(type, groupId = null, draftTemplate = null, storedConfig = undefined) {
    if (!isEditableType(type)) return null
    const rawConfig = getStoredPreviewTemplateConfig(storedConfig)
    const builtIn = getDefaultTemplate(type)
    const globalTemplate = getGlobalTemplate(rawConfig, type)
    const groupKey = groupId ? String(groupId) : ''
    const groupEntry = groupKey ? rawConfig.groups?.[groupKey]?.[type] : null
    let withGroup = globalTemplate || builtIn
    if (groupEntry?.templatePatch) {
        withGroup = applyGroupTemplatePatch(withGroup, groupEntry)
    }
    return draftTemplate ? normalizeTemplate(draftTemplate, { type }) : normalizeTemplate(withGroup, { type })
}

function getPreviewTemplateConfigForScope(type, groupId = null, storedConfig = undefined) {
    const rawConfig = getStoredPreviewTemplateConfig(storedConfig)
    const builtIn = getDefaultTemplate(type)
    const globalTemplate = getGlobalTemplate(rawConfig, type)
    const groupKey = groupId ? String(groupId) : ''
    const groupEntry = groupKey ? rawConfig.groups?.[groupKey]?.[type] : null
    const effective = getEffectiveTemplate(type, groupId, null, rawConfig)
    return {
        type,
        groupId: groupKey,
        template: effective,
        source: {
            builtIn,
            globalTemplate,
            groupTemplatePatch: groupEntry?.templatePatch || {}
        },
        legacyPatch: rawConfig.legacyV1Backup || {},
        migratedFromVersion: groupEntry?.migratedFromVersion || rawConfig.global?.[type]?.migratedFromVersion || null,
        scopeMeta: {
            type,
            groupId: groupKey,
            hasGlobalOverride: Boolean(rawConfig.global?.[type]?.template),
            hasGroupOverride: Boolean(groupEntry?.templatePatch)
        }
    }
}

function savePreviewTemplate(scope, type, template, groupId = null, storedConfig = undefined) {
    const rawConfig = getStoredPreviewTemplateConfig(storedConfig)
    const normalized = normalizeTemplate(template, { type, checkSize: true })
    if (!rawConfig.global) rawConfig.global = {}
    if (!rawConfig.groups) rawConfig.groups = {}
    if (scope === 'global') {
        rawConfig.global[type] = { template: normalized, updatedAt: new Date().toISOString() }
        rawConfig.lastKnownGood = rawConfig.lastKnownGood || {}
        rawConfig.lastKnownGood[type] = normalized
    } else {
        const groupKey = String(groupId || '')
        if (!groupKey) throw new Error('groupId is required for group scope')
        if (!rawConfig.groups[groupKey]) rawConfig.groups[groupKey] = {}
        const base = getGlobalTemplate(rawConfig, type)
        const templatePatch = diffTemplates(base, normalized)
        rawConfig.groups[groupKey][type] = {
            templatePatch,
            baseSignature: shortHash(base),
            baseNodeSignatures: collectPatchBaseSignatures(base, templatePatch),
            updatedAt: new Date().toISOString()
        }
    }
    return { nextConfig: rawConfig, saved: normalized }
}

function saveLegacyPatchAsTemplate(scope, type, patch, groupId = null, storedConfig = undefined) {
    const migrated = migrateV1PatchToTemplate(type, patch || {})
    return savePreviewTemplate(scope, type, migrated, groupId, storedConfig)
}

function resetPreviewTemplate(scope, type, groupId = null, nodeId = null, storedConfig = undefined) {
    const rawConfig = getStoredPreviewTemplateConfig(storedConfig)
    if (scope === 'global') {
        if (nodeId && rawConfig.global?.[type]?.template?.nodesById?.[nodeId]) {
            const template = normalizeTemplate(rawConfig.global[type].template, { type })
            const fallback = getDefaultTemplate(type)
            if (fallback.nodesById[nodeId]) template.nodesById[nodeId] = fallback.nodesById[nodeId]
            rawConfig.global[type].template = template
        } else if (rawConfig.global) {
            delete rawConfig.global[type]
        }
    } else {
        const groupKey = String(groupId || '')
        if (rawConfig.groups?.[groupKey]?.[type]) {
            if (nodeId) {
                const patch = rawConfig.groups[groupKey][type].templatePatch || {}
                if (patch.nodes) delete patch.nodes[nodeId]
                rawConfig.groups[groupKey][type].templatePatch = patch
            } else {
                delete rawConfig.groups[groupKey][type]
            }
        }
    }
    return {
        nextConfig: rawConfig,
        result: getPreviewTemplateConfigForScope(type, groupId, rawConfig)
    }
}

function getPreviewTemplateSignature(type, groupId = null) {
    const template = getEffectiveTemplate(type, groupId)
    if (!template) return 'default'
    return shortHash(template)
}

module.exports = {
    getStoredPreviewTemplateConfig,
    getEffectiveTemplate,
    getPreviewTemplateConfigForScope,
    savePreviewTemplate,
    saveLegacyPatchAsTemplate,
    resetPreviewTemplate,
    mergeEffectiveTemplate,
    applyTemplatePatch,
    applyGroupTemplatePatch,
    collectPatchBaseSignatures,
    diffTemplates,
    stableStringify,
    getPreviewTemplateSignature
}
