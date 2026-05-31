'use strict'

const express = require('express')
const logger = require('../../../../utils/logger')
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
    mergeLayoutConfigs,
    getSavedEffectiveLayout,
    getPreviewLayoutConfigForScope,
    savePreviewLayoutPatch,
    resetPreviewLayoutPatch
} = require('../../../../services/previewLayout/merge')
const { dashLog } = require('../shared/logging')

const router = express.Router()

function sendError(req, res, error, fallbackMessage = 'Preview layout request failed') {
    const statusCode = error instanceof PreviewLayoutValidationError
        ? error.statusCode
        : 500
    dashLog(req, statusCode >= 500 ? 'error' : 'warn', 'preview-layout-request-failed', {
        error: logger.getErrorMessage(error),
        statusCode
    })
    res.status(statusCode).json({
        error: statusCode >= 500 ? fallbackMessage : error.message
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
    if (!/^\d{5,20}$/.test(groupId)) {
        throw new PreviewLayoutValidationError('groupId must be a numeric QQ group id')
    }
    return groupId
}

function normalizeScope(value) {
    const scope = String(value || 'global').trim()
    if (!['global', 'group'].includes(scope)) {
        throw new PreviewLayoutValidationError('scope must be global or group')
    }
    return scope
}

function assertEditableVideo(type) {
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
        if (mockType !== 'video') {
            throw new PreviewLayoutValidationError('第一阶段仅支持 video 结构示例')
        }
        return {
            mode,
            groupId,
            showId,
            target: buildMockPreviewTarget('video', body.structureOptions || {}),
            resolvedInput: {
                input: '',
                normalizedInput: 'preview-lab://structure/video',
                resolvedLink: { type: 'video', id: 'structure', match: 'preview-lab://structure/video' },
                skippedLinks: []
            }
        }
    }

    if (!body.input || typeof body.input !== 'string') {
        throw new PreviewLayoutValidationError('input is required for link preview')
    }

    const resolvedInput = await resolvePreviewInput(body.input, { groupId, cacheMode })
    const target = await resolvePreviewTarget(resolvedInput.resolvedLink, { groupId, cacheMode })
    return {
        mode,
        groupId,
        showId,
        target,
        resolvedInput
    }
}

router.get('/preview-layout/schema', (req, res) => {
    res.json(getPreviewLayoutSchema())
})

router.get('/preview-layout/config', (req, res) => {
    try {
        const type = normalizeType(req.query.type)
        const groupId = normalizeGroupId(req.query.groupId)
        const result = getPreviewLayoutConfigForScope(type, groupId)
        res.json(result)
    } catch (error) {
        sendError(req, res, error, 'Failed to read preview layout config')
    }
})

router.post('/preview-layout/config', (req, res) => {
    try {
        assertBodySize(req.body)
        assertAllowedKeys(req.body, ['scope', 'groupId', 'type', 'patch'], 'preview layout config request')
        const scope = normalizeScope(req.body?.scope)
        const type = normalizeType(req.body?.type)
        assertEditableVideo(type)

        const groupId = scope === 'group' ? normalizeGroupId(req.body?.groupId) : ''
        if (scope === 'group' && !groupId) {
            throw new PreviewLayoutValidationError('groupId is required for group scope')
        }

        const patch = req.body?.patch || {}
        const saved = savePreviewLayoutPatch(scope, type, patch, groupId)
        dashLog(req, 'info', 'preview-layout-config-saved', {
            scope,
            type,
            groupId
        })
        res.json({
            status: 'success',
            saved,
            config: getPreviewLayoutConfigForScope(type, groupId)
        })
    } catch (error) {
        sendError(req, res, error, 'Failed to save preview layout config')
    }
})

router.post('/preview-layout/reset', (req, res) => {
    try {
        assertBodySize(req.body)
        assertAllowedKeys(req.body, ['scope', 'groupId', 'type', 'element'], 'preview layout reset request')
        const scope = normalizeScope(req.body?.scope)
        const type = normalizeType(req.body?.type)
        assertEditableVideo(type)

        const groupId = scope === 'group' ? normalizeGroupId(req.body?.groupId) : ''
        if (scope === 'group' && !groupId) {
            throw new PreviewLayoutValidationError('groupId is required for group scope')
        }

        const element = req.body?.element ? String(req.body.element).trim() : ''
        if (element && !getElementSchema(type, element)) {
            throw new PreviewLayoutValidationError(`unknown preview layout element: ${element}`)
        }

        const patch = resetPreviewLayoutPatch(scope, type, groupId, element || null)
        dashLog(req, 'info', 'preview-layout-config-reset', {
            scope,
            type,
            groupId,
            element
        })
        res.json({
            status: 'success',
            patch,
            config: getPreviewLayoutConfigForScope(type, groupId)
        })
    } catch (error) {
        sendError(req, res, error, 'Failed to reset preview layout config')
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
            'structureOptions'
        ], 'preview layout preview request')
        const { mode, groupId, showId, target, resolvedInput } = await resolvePreviewTargetForRequest(req.body || {})

        if (!target.info || target.info.status !== 'success') {
            throw new PreviewLayoutValidationError(`预览数据获取失败: ${target.info?.message || target.info?.status || target.url || ''}`)
        }

        const cardType = target.cardType || target.info.type || 'video'
        assertEditableVideo(cardType)

        const temporaryOverrides = normalizePreviewLayoutPatch(cardType, req.body?.renderOverrides || {}, {
            requireEditable: true,
            checkSize: true
        })
        const savedOverrides = getSavedEffectiveLayout(cardType, groupId, {
            tolerateInvalid: true,
            logScope: 'svc:dashboard-preview-layout'
        })
        const effectiveOverrides = mergeLayoutConfigs(savedOverrides, temporaryOverrides)
        const artifacts = await generatePreviewCardArtifacts(
            target.info,
            cardType,
            groupId || null,
            showId,
            {
                renderOverrides: effectiveOverrides,
                collectElementMetadata: true
            }
        )

        res.json({
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
            layout: {
                saved: savedOverrides,
                effective: effectiveOverrides
            },
            container: artifacts.elementMetadata?.container || { width: 0, height: 0 },
            elements: artifacts.elementMetadata?.elements || {}
        })
    } catch (error) {
        sendError(req, res, error, 'Failed to generate preview layout image')
    }
})

module.exports = router
