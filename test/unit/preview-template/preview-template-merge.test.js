'use strict'

const assert = require('assert')

const { getDefaultTemplate } = require('../../../src/services/previewTemplate/defaults')
const {
    applyTemplatePatch,
    collectPatchBaseSignatures,
    getEffectiveTemplate,
    mergeEffectiveTemplate,
    savePreviewTemplate,
    stableStringify
} = require('../../../src/services/previewTemplate/merge')
const config = require('../../../src/config')

describe('preview template merge', function () {
    const originalPreviewLayoutConfig = config.previewLayoutConfig

    afterEach(function () {
        config.previewLayoutConfig = originalPreviewLayoutConfig
    })

    it('applies builtIn -> global template -> group patch -> draft template order', function () {
        const globalTemplate = getDefaultTemplate('video')
        globalTemplate.nodesById.title.style.fontSize = 34

        const effective = mergeEffectiveTemplate('video', {
            globalTemplate,
            groupTemplatePatch: {
                nodes: {
                    text: {
                        op: 'merge',
                        value: { visible: false }
                    }
                }
            },
            draftTemplate: {
                nodes: {
                    title: {
                        op: 'merge',
                        value: { style: { maxLines: 1 } }
                    }
                }
            }
        })

        assert.strictEqual(effective.nodesById.title.style.fontSize, 34)
        assert.strictEqual(effective.nodesById.text.visible, false)
        assert.strictEqual(effective.nodesById.title.style.maxLines, 1)
    })

    it('supports add, merge, remove, move and children order diff without hiding new base children', function () {
        const base = getDefaultTemplate('video')
        base.nodesById.subtitle = {
            id: 'subtitle',
            type: 'text',
            label: '副标题',
            parentId: 'content',
            visible: true,
            locked: false,
            layout: { mode: 'flow' },
            style: {},
            binding: { source: 'static', value: 'base child', format: 'plainText' }
        }
        base.childrenByParentId.content.splice(2, 0, 'subtitle')

        const effective = applyTemplatePatch('video', base, {
            nodes: {
                customTag_1: {
                    op: 'add',
                    value: {
                        id: 'customTag_1',
                        type: 'tag',
                        label: '群标签',
                        parentId: 'content',
                        binding: { source: 'static', value: '群', format: 'badgeText' },
                        layout: { mode: 'flow' },
                        style: { background: '#F85B8F', color: '#FFFFFF' }
                    }
                },
                customTag_2: {
                    op: 'add',
                    value: {
                        id: 'customTag_2',
                        type: 'tag',
                        label: '备用标签',
                        parentId: 'content',
                        binding: { source: 'static', value: '备', format: 'badgeText' },
                        layout: { mode: 'flow' },
                        style: { background: '#F85B8F', color: '#FFFFFF' }
                    }
                },
                title: {
                    op: 'merge',
                    value: { style: { fontSize: 38 } }
                }
            },
            children: {
                content: {
                    before: { customTag_1: 'stats' }
                }
            }
        })

        assert.ok(effective.nodesById.customTag_1)
        assert.ok(effective.nodesById.customTag_2)
        assert.strictEqual(effective.nodesById.title.style.fontSize, 38)
        assert.ok(effective.childrenByParentId.content.includes('subtitle'))
        assert.ok(effective.childrenByParentId.content.indexOf('customTag_1') < effective.childrenByParentId.content.indexOf('stats'))
    })

    it('supports reorder and reset no-op inheritance semantics', function () {
        const effective = applyTemplatePatch('video', getDefaultTemplate('video'), {
            nodes: {
                title: { op: 'reset' },
                stats: {
                    op: 'reorder',
                    value: { parentId: 'content', after: { stats: 'text' } }
                }
            }
        })

        assert.ok(effective.nodesById.title)
        assert.ok(effective.childrenByParentId.content.indexOf('stats') > effective.childrenByParentId.content.indexOf('text'))
    })

    it('stableStringify is independent of object key order', function () {
        assert.strictEqual(
            stableStringify({ b: 1, a: { d: 2, c: 3 } }),
            stableStringify({ a: { c: 3, d: 2 }, b: 1 })
        )
    })

    it('rejects corrupt stored v2 template instead of falling back to lastKnownGood', function () {
        const lkg = getDefaultTemplate('video')
        lkg.nodesById.title.style.fontSize = 36
        config.previewLayoutConfig = {
            version: 2,
            global: {
                video: {
                    template: {
                        version: 2,
                        type: 'video',
                        rootId: 'root',
                        canvas: {},
                        nodesById: {
                            root: {
                                id: 'root',
                                type: 'container',
                                parentId: 'missing',
                                layout: {},
                                style: {},
                                binding: {}
                            }
                        },
                        childrenByParentId: { root: [] }
                    }
                }
            },
            groups: {
                '1000': {
                    video: {
                        templatePatch: {
                            nodes: {
                                title: {
                                    op: 'merge',
                                    value: { binding: { source: 'raw.payload' } }
                                }
                            }
                        }
                    }
                }
            },
            lastKnownGood: {
                video: lkg
            }
        }

        assert.throws(() => getEffectiveTemplate('video', '1000'), /root node cannot have parentId/)
    })

    it('records group patch base signatures and rejects conflicting rebases', function () {
        const base = getDefaultTemplate('video')
        const target = JSON.parse(JSON.stringify(base))
        target.nodesById.title.style.fontSize = 34
        config.previewLayoutConfig = {
            version: 2,
            global: { video: { template: base } },
            groups: {},
            lastKnownGood: {}
        }

        savePreviewTemplate('group', 'video', target, '1000')
        const groupEntry = config.previewLayoutConfig.groups['1000'].video
        assert.ok(groupEntry.baseSignature)
        assert.ok(groupEntry.baseNodeSignatures.nodes.title)

        const conflictingConfig = JSON.parse(JSON.stringify(config.previewLayoutConfig))
        conflictingConfig.global.video.template.nodesById.title = {
            ...conflictingConfig.global.video.template.nodesById.title,
            style: { maxLines: 1 }
        }
        config.previewLayoutConfig = conflictingConfig
        assert.throws(
            () => getEffectiveTemplate('video', '1000'),
            (error) => error.details?.code === 'PREVIEW_TEMPLATE_REBASE_CONFLICT'
        )
    })

    it('rebases group patches when unrelated base nodes change', function () {
        const base = getDefaultTemplate('video')
        const target = JSON.parse(JSON.stringify(base))
        target.nodesById.title.style.fontSize = 34
        config.previewLayoutConfig = {
            version: 2,
            global: { video: { template: base } },
            groups: {},
            lastKnownGood: {}
        }

        savePreviewTemplate('group', 'video', target, '1000')
        const changedConfig = JSON.parse(JSON.stringify(config.previewLayoutConfig))
        changedConfig.global.video.template.nodesById.text = {
            ...changedConfig.global.video.template.nodesById.text,
            style: { maxLines: 2 }
        }
        config.previewLayoutConfig = changedConfig
        const effective = getEffectiveTemplate('video', '1000')

        assert.strictEqual(effective.nodesById.title.style.fontSize, 34)
        assert.strictEqual(effective.nodesById.text.style.maxLines, 2)
    })

    it('preserves group-scoped root node changes in template patch', function () {
        const base = getDefaultTemplate('video')
        const target = JSON.parse(JSON.stringify(base))
        target.nodesById.root.label = '群专属视频模板'
        target.nodesById.root.style.opacity = 0.92
        target.nodesById.root.layout.padding = 24
        config.previewLayoutConfig = {
            version: 2,
            global: { video: { template: base } },
            groups: {},
            lastKnownGood: {}
        }

        savePreviewTemplate('group', 'video', target, '1000')

        const groupEntry = config.previewLayoutConfig.groups['1000'].video
        assert.strictEqual(groupEntry.templatePatch.nodes.root.value.label, '群专属视频模板')
        assert.strictEqual(groupEntry.templatePatch.nodes.root.value.style.opacity, 0.92)
        assert.strictEqual(groupEntry.templatePatch.nodes.root.value.layout.padding, 24)
        assert.ok(groupEntry.baseNodeSignatures.nodes.root)

        const effective = getEffectiveTemplate('video', '1000')
        assert.strictEqual(effective.nodesById.root.label, '群专属视频模板')
        assert.strictEqual(effective.nodesById.root.style.opacity, 0.92)
        assert.strictEqual(effective.nodesById.root.layout.padding, 24)
    })

    it('collects group patch base signatures only for touched nodes and children', function () {
        const base = getDefaultTemplate('video')
        const signatures = collectPatchBaseSignatures(base, {
            nodes: {
                title: { op: 'merge', value: { style: { fontSize: 34 } } },
                custom: { op: 'add', value: { parentId: 'content' } }
            },
            children: {
                content: { before: { custom: 'stats' } }
            }
        })

        assert.ok(signatures.nodes.title)
        assert.strictEqual(signatures.nodes.custom, undefined)
        assert.ok(signatures.children.content)
    })
})
