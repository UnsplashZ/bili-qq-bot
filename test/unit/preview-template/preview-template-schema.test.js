'use strict'

const assert = require('assert')

const {
    PREVIEW_TEMPLATE_VERSION,
    getPreviewTemplateSchema,
    getComponentRegistry
} = require('../../../src/services/previewTemplate/schema')
const { getDefaultTemplate } = require('../../../src/services/previewTemplate/defaults')

describe('preview template schema and defaults', function () {
    it('exposes v2 schema, node types, binding whitelist and component registry', function () {
        const schema = getPreviewTemplateSchema()

        assert.strictEqual(schema.version, PREVIEW_TEMPLATE_VERSION)
        for (const type of ['video', 'dynamic', 'article', 'live', 'bangumi', 'user']) {
            assert.ok(schema.types[type])
            assert.ok(schema.roles[type].includes('typeBadge'))
            assert.ok(schema.roles[type].includes('card'))
        }
        for (const nodeType of ['container', 'element', 'tag', 'text', 'image', 'stats', 'shape']) {
            assert.ok(schema.nodeTypes[nodeType])
        }
        assert.ok(schema.bindingSources.includes('video.title'))
        assert.ok(!schema.bindingSources.includes('render_payload.data'))

        const registry = getComponentRegistry()
        for (const componentType of ['container', 'staticText', 'boundText', 'tag', 'imagePlaceholder', 'stats', 'shape']) {
            assert.ok(registry[componentType])
            assert.ok(registry[componentType].defaultNode)
        }
    })

    it('provides flat default templates aligned with existing data-layout-key ids', function () {
        const expected = {
            video: ['typeBadge', 'card', 'cover', 'content', 'header', 'avatar', 'authorName', 'pubTime', 'title', 'stats', 'text'],
            dynamic: ['typeBadge', 'card', 'content', 'header', 'avatar', 'authorName', 'pubTime', 'decorationCard', 'title', 'text', 'media', 'embeddedResource', 'supplementalCards', 'origCard', 'stats'],
            article: ['typeBadge', 'card', 'content', 'header', 'avatar', 'authorName', 'pubTime', 'decorationCard', 'cover', 'title', 'text', 'stats'],
            live: ['typeBadge', 'card', 'cover', 'content', 'header', 'avatar', 'authorName', 'roomId', 'liveBadge', 'title', 'stats'],
            bangumi: ['typeBadge', 'card', 'cover', 'content', 'title', 'statusLine', 'stats', 'text'],
            user: ['typeBadge', 'card', 'content', 'header', 'avatar', 'authorName', 'uid', 'medal', 'signature', 'stats', 'dynamicSection', 'dynamicText', 'dynamicMedia', 'supplementalCards']
        }

        for (const [type, nodeIds] of Object.entries(expected)) {
            const template = getDefaultTemplate(type)
            assert.strictEqual(template.version, 2)
            assert.strictEqual(template.rootId, 'root')
            assert.ok(template.nodesById.root)
            assert.strictEqual(template.nodesById.typeBadge.layout.mode, 'flow')
            assert.strictEqual(template.nodesById.typeBadge.layout.marginBottom, undefined)
            assert.deepStrictEqual(template.nodesById.typeBadge.style, {})
            assert.deepStrictEqual(template.childrenByParentId.root, ['typeBadge', 'card'])
            if (template.nodesById.cover) {
                assert.strictEqual(template.nodesById.cover.layout.width, undefined)
                assert.strictEqual(template.nodesById.cover.layout.height, undefined)
                if (type === 'bangumi') assert.strictEqual(template.nodesById.cover.layout.aspectRatio, '3 / 4')
            }
            for (const nodeId of nodeIds) {
                assert.ok(template.nodesById[nodeId], `${type}.${nodeId}`)
            }
            for (const [parentId, children] of Object.entries(template.childrenByParentId)) {
                for (const childId of children) {
                    assert.strictEqual(template.nodesById[childId].parentId, parentId)
                }
            }
        }
    })
})
