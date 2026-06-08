'use strict'

const {
    LIMITS,
    NODE_TYPES,
    LAYOUT_MODES,
    DIRECTIONS,
    ALIGN_VALUES,
    JUSTIFY_VALUES,
    OBJECT_FIT_VALUES,
    OBJECT_POSITION_VALUES,
    SHADOW_VALUES,
    FORMAT_VALUES,
    COMPONENT_REGISTRY,
    getAllowedBindings,
    isEditableType,
    isLegacyRole,
    getRolePolicy
} = require('./schema')

class PreviewTemplateValidationError extends Error {
    constructor(message, details = {}) {
        super(message)
        this.name = 'PreviewTemplateValidationError'
        this.statusCode = details.statusCode || 400
        this.details = details
    }
}

function clone(value) {
    if (value === undefined || value === null) return value
    return JSON.parse(JSON.stringify(value))
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function assertPlainObject(value, label) {
    if (!isPlainObject(value)) {
        throw new PreviewTemplateValidationError(`${label} must be an object`)
    }
}

function measureJsonBytes(value) {
    return Buffer.byteLength(JSON.stringify(value || {}), 'utf8')
}

function assertJsonSize(value, limit = LIMITS.jsonBytes) {
    const bytes = measureJsonBytes(value)
    if (bytes > limit) {
        throw new PreviewTemplateValidationError('preview template payload is too large', {
            statusCode: 413,
            bytes,
            limit
        })
    }
}

function normalizeNumber(value, limit, path) {
    if (value === undefined || value === null || value === '') return undefined
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new PreviewTemplateValidationError(`${path} must be a finite number`)
    }
    if (limit.integer && !Number.isInteger(value)) {
        throw new PreviewTemplateValidationError(`${path} must be an integer`)
    }
    if (value < limit.min || value > limit.max) {
        throw new PreviewTemplateValidationError(`${path} is out of range`, { path, min: limit.min, max: limit.max })
    }
    return value
}

function normalizeEnum(value, allowed, path) {
    if (value === undefined || value === null || value === '') return undefined
    if (typeof value !== 'string' || !allowed.includes(value)) {
        throw new PreviewTemplateValidationError(`${path} must be one of: ${allowed.join(', ')}`)
    }
    return value
}

function normalizeString(value, path, options = {}) {
    if (value === undefined || value === null) return undefined
    if (typeof value !== 'string') {
        throw new PreviewTemplateValidationError(`${path} must be a string`)
    }
    const text = value.slice(0, options.max || LIMITS.textLength)
    if (options.rejectDangerous !== false && /<[^>]+>|javascript:|<\/|<script|url\s*\(/i.test(text)) {
        throw new PreviewTemplateValidationError(`${path} contains unsafe text`)
    }
    return text
}

function normalizeAspectRatio(value, path) {
    if (value === undefined || value === null || value === '') return undefined
    if (typeof value !== 'string') {
        throw new PreviewTemplateValidationError(`${path} must be a string`)
    }
    const text = value.trim()
    if (text === 'auto') return text
    if (!/^\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?$/.test(text)) {
        throw new PreviewTemplateValidationError(`${path} must be a safe aspect ratio`)
    }
    return text.replace(/\s*\/\s*/, ' / ')
}

function isSafeControlledImageUrl(value) {
    if (!value) return true
    const text = String(value).trim()
    if (/^data:/i.test(text)) return false
    const normalized = text.startsWith('//') ? `https:${text}` : text
    if (!/^https?:\/\/[^ "'<>]+$/i.test(normalized)) return false
    try {
        const url = new URL(normalized)
        const host = url.hostname.toLowerCase()
        return url.protocol === 'https:' && (
            host === 'bilibili.com' ||
            host.endsWith('.bilibili.com') ||
            host === 'hdslb.com' ||
            host.endsWith('.hdslb.com') ||
            host === 'biliimg.com' ||
            host.endsWith('.biliimg.com')
        )
    } catch {
        return false
    }
}

function assertNoDangerousUnknownFields(value, path, allowedKeys) {
    if (!isPlainObject(value)) return
    const allowed = new Set(allowedKeys)
    for (const key of Object.keys(value)) {
        if (allowed.has(key)) continue
        const lower = String(key).toLowerCase()
        if (lower === 'css' || lower === 'html' || lower === 'innerhtml' || lower === 'script' || lower.startsWith('on')) {
            throw new PreviewTemplateValidationError(`${path}.${key} is not allowed`)
        }
    }
}

function normalizeColor(value, path) {
    if (value === undefined || value === null || value === '') return undefined
    if (typeof value !== 'string') throw new PreviewTemplateValidationError(`${path} must be a string`)
    const text = value.trim()
    if (!/^(#[0-9a-fA-F]{3,8}|rgba?\([0-9,.\s]+\)|transparent)$/.test(text)) {
        throw new PreviewTemplateValidationError(`${path} must be a safe color`)
    }
    return text
}

function normalizeCanvas(canvas = {}) {
    assertPlainObject(canvas, 'template.canvas')
    assertNoDangerousUnknownFields(canvas, 'template.canvas', ['width', 'height', 'minHeight', 'maxHeight', 'padding', 'background'])
    const normalized = {
        width: normalizeNumber(canvas.width ?? 1000, LIMITS.canvas.width, 'canvas.width') ?? 1000,
        height: canvas.height === 'auto' || canvas.height === undefined ? 'auto' : normalizeNumber(canvas.height, LIMITS.canvas.maxHeight, 'canvas.height'),
        minHeight: normalizeNumber(canvas.minHeight ?? 320, LIMITS.canvas.minHeight, 'canvas.minHeight') ?? 320,
        maxHeight: normalizeNumber(canvas.maxHeight ?? 1600, LIMITS.canvas.maxHeight, 'canvas.maxHeight') ?? 1600,
        padding: normalizeNumber(canvas.padding ?? 24, LIMITS.layout.padding, 'canvas.padding') ?? 24
    }
    if (canvas.background !== undefined) {
        assertPlainObject(canvas.background, 'canvas.background')
        normalized.background = { type: normalizeString(canvas.background.type || 'gradient', 'canvas.background.type') || 'gradient' }
    }
    return normalized
}

function normalizeLayout(layout = {}, path = 'layout') {
    assertPlainObject(layout, path)
    assertNoDangerousUnknownFields(layout, path, ['mode', 'x', 'y', 'width', 'height', 'marginTop', 'marginBottom', 'padding', 'gap', 'zIndex', 'columns', 'direction', 'align', 'justify', 'aspectRatio', 'anchor', 'absoluteChildren', 'transform'])
    const mode = normalizeEnum(layout.mode || 'flow', LAYOUT_MODES, `${path}.mode`) || 'flow'
    const normalized = { mode }
    for (const key of ['x', 'y', 'width', 'height', 'marginTop', 'marginBottom', 'padding', 'gap', 'zIndex', 'columns']) {
        if (layout[key] !== undefined) {
            normalized[key] = normalizeNumber(layout[key], LIMITS.layout[key], `${path}.${key}`)
        }
    }
    if (layout.direction !== undefined) normalized.direction = normalizeEnum(layout.direction, DIRECTIONS, `${path}.direction`)
    if (layout.align !== undefined) normalized.align = normalizeEnum(layout.align, ALIGN_VALUES, `${path}.align`)
    if (layout.justify !== undefined) normalized.justify = normalizeEnum(layout.justify, JUSTIFY_VALUES, `${path}.justify`)
    if (layout.aspectRatio !== undefined) normalized.aspectRatio = normalizeAspectRatio(layout.aspectRatio, `${path}.aspectRatio`)
    if (layout.anchor !== undefined) normalized.anchor = normalizeEnum(layout.anchor, ['topLeft'], `${path}.anchor`) || 'topLeft'
    if (layout.absoluteChildren !== undefined) {
        if (typeof layout.absoluteChildren !== 'boolean') throw new PreviewTemplateValidationError(`${path}.absoluteChildren must be a boolean`)
        normalized.absoluteChildren = layout.absoluteChildren
    }
    if (layout.transform !== undefined) {
        assertPlainObject(layout.transform, `${path}.transform`)
        const transform = {}
        if (layout.transform.x !== undefined) transform.x = normalizeNumber(layout.transform.x, LIMITS.layout.x, `${path}.transform.x`)
        if (layout.transform.y !== undefined) transform.y = normalizeNumber(layout.transform.y, LIMITS.layout.y, `${path}.transform.y`)
        if (Object.keys(transform).length > 0) normalized.transform = transform
    }
    return removeUndefined(normalized)
}

function normalizeStyle(style = {}, path = 'style') {
    assertPlainObject(style, path)
    assertNoDangerousUnknownFields(style, path, ['fontSize', 'fontWeight', 'lineHeight', 'maxLines', 'maxHeight', 'radius', 'opacity', 'borderWidth', 'color', 'background', 'borderColor', 'objectFit', 'objectPosition', 'shadow'])
    const normalized = {}
    const numberKeys = ['fontSize', 'fontWeight', 'lineHeight', 'maxLines', 'maxHeight', 'radius', 'opacity', 'borderWidth']
    for (const key of numberKeys) {
        if (style[key] !== undefined) normalized[key] = normalizeNumber(style[key], LIMITS.style[key], `${path}.${key}`)
    }
    for (const key of ['color', 'background', 'borderColor']) {
        if (style[key] !== undefined) normalized[key] = normalizeColor(style[key], `${path}.${key}`)
    }
    if (style.objectFit !== undefined) normalized.objectFit = normalizeEnum(style.objectFit, OBJECT_FIT_VALUES, `${path}.objectFit`)
    if (style.objectPosition !== undefined) normalized.objectPosition = normalizeEnum(style.objectPosition, OBJECT_POSITION_VALUES, `${path}.objectPosition`)
    if (style.shadow !== undefined) normalized.shadow = normalizeEnum(style.shadow, SHADOW_VALUES, `${path}.shadow`)
    return removeUndefined(normalized)
}

function normalizeBinding(binding = {}, type, path = 'binding') {
    assertPlainObject(binding, path)
    assertNoDangerousUnknownFields(binding, path, ['source', 'value', 'fallback', 'format'])
    const normalized = {}
    const source = normalizeString(binding.source || '', `${path}.source`, { max: 80 })
    if (source) {
        const allowed = getAllowedBindings(type)
        if (!allowed.has(source)) {
            throw new PreviewTemplateValidationError(`${path}.source is not allowed: ${source}`)
        }
        normalized.source = source
    }
    if (binding.value !== undefined) normalized.value = normalizeString(binding.value, `${path}.value`)
    if (binding.fallback !== undefined) normalized.fallback = normalizeString(binding.fallback, `${path}.fallback`)
    if (binding.format !== undefined) normalized.format = normalizeEnum(binding.format, FORMAT_VALUES, `${path}.format`)
    if (normalized.format === 'imageUrl') {
        if (!isSafeControlledImageUrl(normalized.value) || !isSafeControlledImageUrl(normalized.fallback)) {
            throw new PreviewTemplateValidationError(`${path}.value must be a controlled image URL`)
        }
    }
    return removeUndefined(normalized)
}

function removeUndefined(value) {
    const output = {}
    for (const [key, child] of Object.entries(value || {})) {
        if (child !== undefined) output[key] = child
    }
    return output
}

function normalizeNode(rawNode, type) {
    assertPlainObject(rawNode, 'node')
    assertNoDangerousUnknownFields(rawNode, 'node', ['id', 'type', 'role', 'label', 'parentId', 'visible', 'locked', 'layout', 'style', 'binding', 'componentType', 'hideWhenEmpty', 'items', 'children'])
    const id = normalizeString(rawNode.id, 'node.id', { max: 64, rejectDangerous: false })
    if (!id || !LIMITS.nodeId.test(id)) throw new PreviewTemplateValidationError(`invalid node id: ${id}`)
    const nodeType = normalizeString(rawNode.type, `nodesById.${id}.type`, { max: 32, rejectDangerous: false })
    if (!NODE_TYPES[nodeType]) throw new PreviewTemplateValidationError(`unknown node type: ${nodeType}`)
    const parentId = rawNode.parentId === null || rawNode.parentId === undefined
        ? null
        : normalizeString(rawNode.parentId, `nodesById.${id}.parentId`, { max: 64, rejectDangerous: false })
    if (parentId && !LIMITS.nodeId.test(parentId)) throw new PreviewTemplateValidationError(`invalid parentId for node: ${id}`)
    const normalized = {
        id,
        type: nodeType,
        parentId,
        visible: rawNode.visible !== false,
        locked: rawNode.locked === true,
        layout: normalizeLayout(rawNode.layout || { mode: 'flow' }, `nodesById.${id}.layout`),
        style: normalizeStyle(rawNode.style || {}, `nodesById.${id}.style`),
        binding: normalizeBinding(rawNode.binding || {}, type, `nodesById.${id}.binding`),
        hideWhenEmpty: rawNode.hideWhenEmpty === true
    }
    if (rawNode.role !== undefined) normalized.role = normalizeString(rawNode.role, `nodesById.${id}.role`, { max: 64, rejectDangerous: false })
    if (rawNode.label !== undefined) normalized.label = normalizeString(rawNode.label, `nodesById.${id}.label`, { max: 80 })
    if (rawNode.componentType !== undefined) {
        const componentType = normalizeString(rawNode.componentType, `nodesById.${id}.componentType`, { max: 64, rejectDangerous: false })
        if (!COMPONENT_REGISTRY[componentType]) throw new PreviewTemplateValidationError(`unknown component type: ${componentType}`)
        normalized.componentType = componentType
    }
    if (rawNode.items !== undefined) {
        if (!Array.isArray(rawNode.items)) throw new PreviewTemplateValidationError(`nodesById.${id}.items must be an array`)
        normalized.items = rawNode.items.map((item, index) => normalizeString(item, `nodesById.${id}.items.${index}`, { max: 40, rejectDangerous: false })).filter(Boolean)
    }
    return normalized
}

function validateRolePolicy(template, type) {
    const policy = getRolePolicy(type)
    const required = new Set(policy.requiredRoles || [])
    const optional = new Set(policy.optionalRoles || [])
    const legacyRoles = new Set(['root', ...required, ...optional])
    const seenRoles = new Map()

    for (const [id, node] of Object.entries(template.nodesById || {})) {
        const role = node.role
        const isLegacy = Boolean(role && legacyRoles.has(role))
        if (role && !isLegacy) {
            throw new PreviewTemplateValidationError(`unknown legacy role: ${role}`, {
                code: 'PREVIEW_TEMPLATE_VALIDATION_FAILED',
                nodeId: id,
                role
            })
        }
        if (isLegacy) {
            if (seenRoles.has(role)) throw new PreviewTemplateValidationError(`duplicate role: ${role}`)
            seenRoles.set(role, id)
            if (required.has(role) && node.visible === false) {
                throw new PreviewTemplateValidationError(`required role cannot be hidden: ${role}`)
            }
            if (node.layout?.mode === 'absolute') {
                throw new PreviewTemplateValidationError(`legacy role cannot use absolute layout: ${role}`, {
                    code: 'PREVIEW_TEMPLATE_VALIDATION_FAILED',
                    nodeId: id,
                    role
                })
            }
            const expectedParent = policy.allowedParentByRole?.[role]
            if (role !== 'root' && expectedParent) {
                const allowedParents = Array.isArray(expectedParent) ? expectedParent : [expectedParent]
                if (!allowedParents.includes(node.parentId)) {
                    throw new PreviewTemplateValidationError(`legacy role has invalid parent: ${role}`, {
                        code: 'PREVIEW_TEMPLATE_VALIDATION_FAILED',
                        nodeId: id,
                        role,
                        parentId: node.parentId,
                        allowedParents
                    })
                }
            }
            const allowedStyle = new Set(policy.stylePolicy?.coreFields || [])
            for (const field of Object.keys(node.style || {})) {
                if (!allowedStyle.has(field)) {
                    throw new PreviewTemplateValidationError(`style field is not allowed for legacy role ${role}: ${field}`)
                }
            }
        } else if (id !== template.rootId) {
            const parentNode = template.nodesById[node.parentId]
            const parentRole = parentNode?.role
            const genericParents = new Set(policy.genericInsertParents || [])
            if (!genericParents.has(parentRole) && parentNode?.role !== undefined) {
                throw new PreviewTemplateValidationError(`generic node parent is not allowed: ${id}`, {
                    code: 'PREVIEW_TEMPLATE_VALIDATION_FAILED',
                    nodeId: id,
                    parentRole
                })
            }
        }
    }

    for (const role of required) {
        if (!seenRoles.has(role)) {
            throw new PreviewTemplateValidationError(`required role is missing: ${role}`, {
                code: 'PREVIEW_TEMPLATE_ROLE_MISSING',
                role
            })
        }
    }
}

function flattenNodes(rawNodes, parentId = null, output = []) {
    if (!Array.isArray(rawNodes)) return output
    rawNodes.forEach((rawNode, index) => {
        if (!isPlainObject(rawNode)) {
            throw new PreviewTemplateValidationError(`template.nodes.${index} must be an object`)
        }
        const copy = clone(rawNode)
        const children = Array.isArray(copy.children) ? copy.children : []
        delete copy.children
        if (!copy.id) copy.id = `node_${copy.type || 'item'}_${output.length}`
        if (parentId && !copy.parentId) copy.parentId = parentId
        output.push(copy)
        flattenNodes(children, copy.id, output)
    })
    return output
}

function prepareTemplate(rawTemplate) {
    const prepared = clone(rawTemplate)
    if (!prepared.nodesById && Array.isArray(prepared.nodes)) {
        const nodesById = {}
        for (const rawNode of flattenNodes(prepared.nodes)) {
            nodesById[rawNode.id] = rawNode
        }
        prepared.nodesById = nodesById
    }
    if (!prepared.childrenByParentId && prepared.nodesById) {
        const childrenByParentId = {}
        for (const [id, rawNode] of Object.entries(prepared.nodesById)) {
            if (!childrenByParentId[id]) childrenByParentId[id] = []
            if (id === (prepared.rootId || 'root')) continue
            const parentId = rawNode.parentId || 'root'
            if (!childrenByParentId[parentId]) childrenByParentId[parentId] = []
            childrenByParentId[parentId].push(id)
        }
        prepared.childrenByParentId = childrenByParentId
    }
    delete prepared.nodes
    return prepared
}

function normalizeChildrenMap(childrenByParentId = {}, nodesById) {
    assertPlainObject(childrenByParentId, 'childrenByParentId')
    const normalized = {}
    const seenChildren = new Set()
    for (const [parentId, children] of Object.entries(childrenByParentId)) {
        if (!nodesById[parentId]) throw new PreviewTemplateValidationError(`unknown children parent: ${parentId}`)
        if (!Array.isArray(children)) throw new PreviewTemplateValidationError(`childrenByParentId.${parentId} must be an array`)
        normalized[parentId] = []
        for (const childId of children) {
            if (typeof childId !== 'string' || !nodesById[childId]) throw new PreviewTemplateValidationError(`unknown child node: ${childId}`)
            if (seenChildren.has(childId)) throw new PreviewTemplateValidationError(`duplicate child node: ${childId}`)
            if (nodesById[childId].parentId !== parentId) throw new PreviewTemplateValidationError(`parent mismatch for node: ${childId}`)
            seenChildren.add(childId)
            normalized[parentId].push(childId)
        }
    }
    for (const [id, node] of Object.entries(nodesById)) {
        if (id === 'root') continue
        if (!seenChildren.has(id)) throw new PreviewTemplateValidationError(`node is missing from children map: ${id}`)
        if (!nodesById[node.parentId]) throw new PreviewTemplateValidationError(`missing parent for node: ${id}`)
    }
    return normalized
}

function assertTree(template) {
    const { rootId, nodesById, childrenByParentId } = template
    if (!nodesById[rootId]) throw new PreviewTemplateValidationError('root node is missing')
    if (nodesById[rootId].parentId !== null) throw new PreviewTemplateValidationError('root node cannot have parentId')
    if (Object.keys(nodesById).length > LIMITS.nodes) throw new PreviewTemplateValidationError('template has too many nodes')
    const roleIds = new Map()
    for (const node of Object.values(nodesById)) {
        if (node.role && !['text', 'tag', 'shape'].includes(node.type)) {
            if (roleIds.has(node.role)) throw new PreviewTemplateValidationError(`duplicate role: ${node.role}`)
            roleIds.set(node.role, node.id)
        }
    }
    const visit = (id, stack = [], depth = 0) => {
        if (stack.includes(id)) throw new PreviewTemplateValidationError(`node cycle detected: ${id}`)
        if (depth > LIMITS.depth) throw new PreviewTemplateValidationError('template nesting is too deep')
        const node = nodesById[id]
        const children = childrenByParentId[id] || []
        if (children.length > 0 && !NODE_TYPES[node.type].allowsChildren) {
            throw new PreviewTemplateValidationError(`node type cannot contain children: ${id}`)
        }
        for (const childId of children) visit(childId, [...stack, id], depth + 1)
    }
    visit(rootId)
}

function normalizeTemplate(rawTemplate = {}, options = {}) {
    if (typeof rawTemplate === 'string') {
        const type = rawTemplate
        const template = options || {}
        const nextOptions = arguments[2] || {}
        return normalizeTemplate(template, { ...nextOptions, type })
    }
    const { type = rawTemplate.type || 'video', checkSize = true } = options
    if (!isEditableType(type)) throw new PreviewTemplateValidationError(`preview template type is not editable: ${type}`)
    if (checkSize) assertJsonSize(rawTemplate)
    rawTemplate = prepareTemplate(rawTemplate)
    assertPlainObject(rawTemplate, 'template')
    const rootId = rawTemplate.rootId || 'root'
    if (!LIMITS.nodeId.test(rootId)) throw new PreviewTemplateValidationError('invalid rootId')
    assertPlainObject(rawTemplate.nodesById, 'template.nodesById')
    const nodesById = {}
    for (const [id, rawNode] of Object.entries(rawTemplate.nodesById)) {
        const node = normalizeNode({ ...rawNode, id: rawNode.id || id }, type)
        if (node.id !== id) throw new PreviewTemplateValidationError(`node id mismatch: ${id}`)
        nodesById[id] = node
    }
    const template = {
        version: 2,
        type,
        ...(rawTemplate.previewTemplateDefaultSignature ? { previewTemplateDefaultSignature: rawTemplate.previewTemplateDefaultSignature } : {}),
        ...(rawTemplate.schemaVersion ? { schemaVersion: rawTemplate.schemaVersion } : {}),
        canvas: normalizeCanvas(rawTemplate.canvas || {}),
        rootId,
        nodesById,
        childrenByParentId: normalizeChildrenMap(rawTemplate.childrenByParentId || {}, nodesById)
    }
    assertTree(template)
    validateRolePolicy(template, type)
    return template
}

module.exports = {
    PreviewTemplateValidationError,
    assertJsonSize,
    measureJsonBytes,
    normalizeTemplate,
    normalizeLayout,
    normalizeStyle,
    normalizeBinding,
    validateRolePolicy,
    clone
}
