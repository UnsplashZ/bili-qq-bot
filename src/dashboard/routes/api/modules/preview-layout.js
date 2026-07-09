'use strict'

const express = require('express')
const logger = require('../../../../utils/logger')
const sysConfig = require('../../../../config')
const { resolvePreviewInput } = require('../../../../services/previewLab/inputResolver')
const { resolvePreviewTarget } = require('../../../../services/previewLab/targetResolver')
const { buildMockPreviewTarget } = require('../../../../services/previewLab/mockData')
const { generatePreviewCardArtifacts } = require('../../../../services/imageGenerator/generators/previewCard')
const {
    getPreviewLayoutSchema,
    getElementSchema,
    isEditableType,
    LIMITS
} = require('../../../../services/previewLayout/schema')
const {
    PreviewLayoutValidationError,
    assertJsonSize,
    normalizePreviewLayoutPatch
} = require('../../../../services/previewLayout/normalizer')
const {
    getPreviewTemplateSchema
} = require('../../../../services/previewTemplate/schema')
const {
    PreviewTemplateValidationError,
    normalizeTemplate
} = require('../../../../services/previewTemplate/normalizer')
const {
    migrateV1PatchToTemplate
} = require('../../../../services/previewTemplate/migrator')
const {
    getEffectiveTemplate,
    getPreviewTemplateConfigForScope,
    savePreviewTemplate,
    saveLegacyPatchAsTemplate,
    resetPreviewTemplate
} = require('../../../../services/previewTemplate/merge')
const { dashLog } = require('../shared/logging')
const { isOfficialProviderMode } = require('../shared/group-guard')
const { isNumericGroupId, isOfficialOpaqueGroupId } = require('../shared/normalize')

const router = express.Router()

function sendError(req, res, error, fallbackMessage = 'Preview layout request failed') {
    const statusCode = error instanceof PreviewLayoutValidationError || error instanceof PreviewTemplateValidationError
        ? error.statusCode
        : 500
    dashLog(req, statusCode >= 500 ? 'error' : 'warn', 'preview-layout-request-failed', {
        error: logger.getErrorMessage(error),
        statusCode
    })
    res.status(statusCode).json({
        error: statusCode >= 500 ? fallbackMessage : error.message,
        ...(error.details?.code ? { code: error.details.code } : {}),
        ...(error.details ? { details: error.details } : {})
    })
}

function assertBodySize(body) {
    assertJsonSize(body || {}, LIMITS.jsonBytes)
}

function assertAllowedKeys(body, allowedKeys, context) {
    const payload = body || {}
    for (const key of Object.keys(payload)) {
        if (!allowedKeys.includes(key)) {
            throw new PreviewLayoutValidationError(`${context} contains unknown field: ${key}`)
        }
    }
}

function normalizeType(value) {
    return String(value || 'video').trim() || 'video'
}

function normalizeGroupId(value) {
    const groupId = String(value || '').trim()
    if (!groupId) return ''
    if (isNumericGroupId(groupId)) return groupId
    if (isOfficialProviderMode(sysConfig, global.bot) && isOfficialOpaqueGroupId(groupId)) {
        return groupId
    }
    throw new PreviewLayoutValidationError('groupId must be a numeric QQ group id or Official group_openid')
}

function normalizeScope(value) {
    const scope = String(value || 'global').trim()
    if (!['global', 'group'].includes(scope)) {
        throw new PreviewLayoutValidationError('scope must be global or group')
    }
    return scope
}

function assertEditableType(type) {
    if (!isEditableType(type)) {
        throw new PreviewLayoutValidationError(`preview layout type is not editable: ${type}`)
    }
}

async function resolvePreviewTargetForRequest(body) {
    const mode = body.mode === undefined ? 'link' : String(body.mode).trim()
    if (!['link', 'structure'].includes(mode)) {
        throw new PreviewLayoutValidationError('mode must be link or structure')
    }

    const groupId = normalizeGroupId(body.groupId)
    if (body.showId !== undefined && typeof body.showId !== 'boolean') {
        throw new PreviewLayoutValidationError('showId must be a boolean')
    }
    const showId = body.showId === undefined ? true : body.showId

    const cacheMode = body.cacheMode === undefined ? 'cached' : String(body.cacheMode).trim()
    if (!['cached', 'fresh'].includes(cacheMode)) {
        throw new PreviewLayoutValidationError('cacheMode must be cached or fresh')
    }

    if (mode === 'structure') {
        const mockType = normalizeType(body.mockType)
        assertEditableType(mockType)
        let target
        try {
            target = buildMockPreviewTarget(mockType, body.structureOptions || {})
        } catch (error) {
            throw new PreviewLayoutValidationError(error.message || `unsupported structure preview type: ${mockType}`)
        }
        return {
            mode,
            groupId,
            showId,
            target,
            resolvedInput: {
                input: '',
                normalizedInput: `preview-lab://structure/${mockType}`,
                resolvedLink: { type: mockType, id: 'structure', match: `preview-lab://structure/${mockType}` },
                skippedLinks: []
            }
        }
    }

    if (!body.input || typeof body.input !== 'string') {
        throw new PreviewLayoutValidationError('input is required for link preview')
    }

    let resolvedInput
    let target
    try {
        resolvedInput = await resolvePreviewInput(body.input, { groupId, cacheMode })
        target = await resolvePreviewTarget(resolvedInput.resolvedLink, { groupId, cacheMode })
    } catch (error) {
        throw new PreviewLayoutValidationError(error.message || '预览链接解析失败')
    }
    return {
        mode,
        groupId,
        showId,
        target,
        resolvedInput
    }
}

router.get('/preview-layout/schema', (req, res) => {
    res.json({
        ...getPreviewTemplateSchema(),
        legacyVersion: getPreviewLayoutSchema().version,
        legacyFieldGroups: getPreviewLayoutSchema().fieldGroups,
        legacyLimits: getPreviewLayoutSchema().limits
    })
})

router.get('/preview-layout/config', (req, res) => {
    try {
        const type = normalizeType(req.query.type)
        const groupId = normalizeGroupId(req.query.groupId)
        assertEditableType(type)
        const result = getPreviewTemplateConfigForScope(type, groupId)
        res.json(result)
    } catch (error) {
        sendError(req, res, error, 'Failed to read preview layout config')
    }
})

router.post('/preview-layout/config', (req, res) => {
    try {
        assertBodySize(req.body)
        assertAllowedKeys(req.body, ['scope', 'groupId', 'type', 'patch', 'template'], 'preview layout config request')
        const scope = normalizeScope(req.body?.scope)
        const type = normalizeType(req.body?.type)
        assertEditableType(type)

        const groupId = scope === 'group' ? normalizeGroupId(req.body?.groupId) : ''
        if (scope === 'group' && !groupId) {
            throw new PreviewLayoutValidationError('groupId is required for group scope')
        }

        if (!req.body?.template && !req.body?.patch) {
            throw new PreviewTemplateValidationError('template or patch is required')
        }
        if (req.body?.template && req.body?.patch) {
            throw new PreviewTemplateValidationError('template and patch cannot be used together', {
                code: 'PREVIEW_TEMPLATE_AMBIGUOUS_INPUT'
            })
        }

        let saved
        if (req.body?.template) {
            saved = savePreviewTemplate(scope, type, req.body.template, groupId)
        } else {
            const patch = normalizePreviewLayoutPatch(type, req.body.patch || {}, {
                requireEditable: true,
                checkSize: true
            })
            saved = saveLegacyPatchAsTemplate(scope, type, patch, groupId)
        }
        dashLog(req, 'info', 'preview-layout-config-saved', {
            scope,
            type,
            groupId
        })
        res.json({
            status: 'success',
            saved,
            config: getPreviewTemplateConfigForScope(type, groupId)
        })
    } catch (error) {
        sendError(req, res, error, 'Failed to save preview layout config')
    }
})

router.post('/preview-layout/reset', (req, res) => {
    try {
        assertBodySize(req.body)
        assertAllowedKeys(req.body, ['scope', 'groupId', 'type', 'element', 'nodeId', 'resetScope'], 'preview layout reset request')
        const scope = normalizeScope(req.body?.scope)
        const type = normalizeType(req.body?.type)
        assertEditableType(type)

        const groupId = scope === 'group' ? normalizeGroupId(req.body?.groupId) : ''
        if (scope === 'group' && !groupId) {
            throw new PreviewLayoutValidationError('groupId is required for group scope')
        }

        const nodeId = req.body?.nodeId ? String(req.body.nodeId).trim() : ''
        const element = req.body?.element ? String(req.body.element).trim() : ''
        if (element && !nodeId && !getElementSchema(type, element)) {
            throw new PreviewLayoutValidationError(`unknown preview layout element: ${element}`)
        }

        const resetResult = resetPreviewTemplate(scope, type, groupId, nodeId || element || null)
        dashLog(req, 'info', 'preview-layout-config-reset', {
            scope,
            type,
            groupId,
            element
        })
        res.json({
            status: 'success',
            config: resetResult
        })
    } catch (error) {
        sendError(req, res, error, 'Failed to reset preview layout config')
    }
})

router.post('/preview-layout/template/validate', (req, res) => {
    try {
        assertBodySize(req.body)
        assertAllowedKeys(req.body, ['type', 'template'], 'preview layout template validate request')
        const type = normalizeType(req.body?.type)
        assertEditableType(type)
        const template = normalizeTemplate(req.body?.template || {}, { type, checkSize: true })
        res.json({
            status: 'success',
            template
        })
    } catch (error) {
        sendError(req, res, error, 'Failed to validate preview layout template')
    }
})

router.post('/preview-layout/preview', async (req, res) => {
    try {
        assertBodySize(req.body)
        assertAllowedKeys(req.body, [
            'mode',
            'input',
            'groupId',
            'mockType',
            'showId',
            'cacheMode',
            'renderOverrides',
            'draftTemplate',
            'payloadKey',
            'structureOptions',
            'artifactMode'
        ], 'preview layout preview request')
        const { mode, groupId, showId, target, resolvedInput } = await resolvePreviewTargetForRequest(req.body || {})

        if (!target.info || target.info.status !== 'success') {
            throw new PreviewLayoutValidationError(`预览数据获取失败: ${target.info?.message || target.info?.status || target.url || ''}`)
        }

        const cardType = target.cardType || target.info.type || 'video'
        assertEditableType(cardType)

        if (req.body?.draftTemplate && req.body?.renderOverrides) {
            throw new PreviewTemplateValidationError('draftTemplate and renderOverrides cannot be used together', {
                code: 'PREVIEW_TEMPLATE_AMBIGUOUS_INPUT'
            })
        }

        let effectiveTemplate
        if (req.body?.draftTemplate) {
            effectiveTemplate = normalizeTemplate(req.body.draftTemplate, { type: cardType, checkSize: true })
        } else if (req.body?.renderOverrides) {
            const temporaryOverrides = normalizePreviewLayoutPatch(cardType, req.body.renderOverrides || {}, {
                requireEditable: true,
                checkSize: true
            })
            effectiveTemplate = migrateV1PatchToTemplate(cardType, temporaryOverrides)
        } else {
            effectiveTemplate = getEffectiveTemplate(cardType, groupId)
        }
        const artifactMode = req.body?.artifactMode
        if (artifactMode !== undefined && artifactMode !== 'image+html') {
            throw new PreviewLayoutValidationError('artifactMode must be "image+html" if specified')
        }

        const artifacts = await generatePreviewCardArtifacts(
            target.info,
            cardType,
            groupId || null,
            showId,
            {
                draftTemplate: effectiveTemplate,
                collectElementMetadata: true,
                artifactMode: artifactMode || null
            }
        )

        const responseBody = {
            status: 'success',
            image: {
                base64: artifacts.base64,
                mime: 'image/png'
            },
            resolved: {
                mode,
                cardType,
                canonicalUrl: target.canonicalUrl || target.url || resolvedInput.resolvedLink?.match || '',
                input: resolvedInput.input,
                normalizedInput: resolvedInput.normalizedInput,
                resolvedLink: resolvedInput.resolvedLink,
                skippedLinks: resolvedInput.skippedLinks || []
            },
            debugMeta: artifacts.debugMeta,
            template: effectiveTemplate,
            layout: {
                saved: {},
                effective: {}
            },
            container: artifacts.elementMetadata?.container || { width: 0, height: 0 },
            elements: artifacts.elementMetadata?.elements || {}
        }
        if (artifactMode === 'image+html' && artifacts.htmlArtifact) {
            responseBody.htmlArtifact = artifacts.htmlArtifact
        }
        res.json(responseBody)
    } catch (error) {
        sendError(req, res, error, 'Failed to generate preview layout image')
    }
})

module.exports = router
