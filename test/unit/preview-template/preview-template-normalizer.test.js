'use strict'

const assert = require('assert')

const {
    PreviewTemplateValidationError,
    normalizeTemplate
} = require('../../../src/services/previewTemplate/normalizer')
const { getDefaultTemplate } = require('../../../src/services/previewTemplate/defaults')

describe('preview template normalizer', function () {
    it('normalizes templates, removes unknown safe fields and generated missing ids', function () {
        const template = getDefaultTemplate('video')
        template.nodes = [
            ...Object.values(template.nodesById),
            {
                type: 'text',
                parentId: 'content',
                label: '临时文本',
                unknownField: 'ignored',
                layout: { mode: 'flow', unknownLayout: 1 },
                style: { fontSize: 24, unknownStyle: true },
                binding: { source: 'static', value: '纯文本', ignored: true }
            }
        ]
        delete template.nodesById
        delete template.childrenByParentId
        const normalized = normalizeTemplate('video', template)

        const generatedId = Object.keys(normalized.nodesById).find(id => id.startsWith('node_text_'))
        assert.ok(generatedId)
        assert.strictEqual(normalized.nodesById[generatedId].style.fontSize, 24)
        assert.strictEqual(normalized.nodesById[generatedId].binding.value, '纯文本')
        assert.ok(!('unknownField' in normalized.nodesById[generatedId]))
        assert.ok(!('unknownLayout' in normalized.nodesById[generatedId].layout))
        assert.ok(!('unknownStyle' in normalized.nodesById[generatedId].style))
    })

    it('rejects dangerous HTML, CSS, JavaScript and raw binding paths', function () {
        const template = getDefaultTemplate('video')
        template.nodesById.title.binding = { source: 'static', value: '<b>bad</b>' }
        assert.throws(() => normalizeTemplate('video', template), PreviewTemplateValidationError)

        const cssTemplate = getDefaultTemplate('video')
        cssTemplate.nodesById.title.style = { background: 'url(https://example.com/a.png)' }
        assert.throws(() => normalizeTemplate('video', cssTemplate), PreviewTemplateValidationError)

        const rawPathTemplate = getDefaultTemplate('video')
        rawPathTemplate.nodesById.title.binding = { source: 'render_payload.data.title' }
        assert.throws(() => normalizeTemplate('video', rawPathTemplate), PreviewTemplateValidationError)

        const staticExternalImage = getDefaultTemplate('video')
        staticExternalImage.nodesById.cover.binding = {
            source: 'static',
            value: 'https://example.com/cover.jpg',
            format: 'imageUrl'
        }
        assert.throws(() => normalizeTemplate('video', staticExternalImage), PreviewTemplateValidationError)

        const dataImageTemplate = getDefaultTemplate('video')
        dataImageTemplate.nodesById.cover.binding = {
            source: 'static',
            value: 'data:image/svg+xml;charset=UTF-8,%3Csvg%3E%3C/svg%3E',
            format: 'imageUrl'
        }
        assert.throws(() => normalizeTemplate('video', dataImageTemplate), PreviewTemplateValidationError)

        const externalFallbackTemplate = getDefaultTemplate('video')
        externalFallbackTemplate.nodesById.cover.binding = {
            source: 'video.cover',
            fallback: 'https://example.com/cover.jpg',
            format: 'imageUrl'
        }
        assert.throws(() => normalizeTemplate('video', externalFallbackTemplate), PreviewTemplateValidationError)

        const eventTemplate = getDefaultTemplate('video')
        eventTemplate.nodesById.title.onClick = 'alert(1)'
        assert.throws(() => normalizeTemplate('video', eventTemplate), PreviewTemplateValidationError)

        const aspectRatioInjection = getDefaultTemplate('video')
        aspectRatioInjection.nodesById.cover.layout.aspectRatio = '1 / 1; position: fixed; inset: 0'
        assert.throws(() => normalizeTemplate('video', aspectRatioInjection), PreviewTemplateValidationError)
    })

    it('rejects invalid ids, duplicate children, missing parents, cycles and excessive nesting', function () {
        const invalidId = getDefaultTemplate('video')
        invalidId.nodesById['bad id'] = { id: 'bad id', type: 'text', parentId: 'root' }
        invalidId.childrenByParentId.root.push('bad id')
        assert.throws(() => normalizeTemplate('video', invalidId), PreviewTemplateValidationError)

        const duplicateChild = getDefaultTemplate('video')
        duplicateChild.childrenByParentId.root.push('typeBadge')
        assert.throws(() => normalizeTemplate('video', duplicateChild), PreviewTemplateValidationError)

        const missingParent = getDefaultTemplate('video')
        missingParent.nodesById.title.parentId = 'missing'
        assert.throws(() => normalizeTemplate('video', missingParent), PreviewTemplateValidationError)

        const cycle = getDefaultTemplate('video')
        cycle.nodesById.content.parentId = 'title'
        cycle.nodesById.title.parentId = 'content'
        cycle.childrenByParentId.content = ['title']
        cycle.childrenByParentId.title = ['content']
        assert.throws(() => normalizeTemplate('video', cycle), PreviewTemplateValidationError)

        const deep = {
            rootId: 'root',
            nodes: [
                { id: 'root', type: 'container', layout: { mode: 'stack' } },
                { id: 'a', type: 'container', parentId: 'root', layout: { mode: 'stack' } },
                { id: 'b', type: 'container', parentId: 'a', layout: { mode: 'stack' } },
                { id: 'c', type: 'container', parentId: 'b', layout: { mode: 'stack' } },
                { id: 'd', type: 'container', parentId: 'c', layout: { mode: 'stack' } },
                { id: 'e', type: 'container', parentId: 'd', layout: { mode: 'stack' } },
                { id: 'f', type: 'container', parentId: 'e', layout: { mode: 'stack' } }
            ]
        }
        assert.throws(() => normalizeTemplate('video', deep), PreviewTemplateValidationError)
    })

    it('enforces payload size limits', function () {
        const template = getDefaultTemplate('video')
        template.nodesById.title.binding = {
            source: 'static',
            value: 'x'.repeat(140 * 1024)
        }
        assert.throws(() => normalizeTemplate('video', template), /too large/)
    })
})
