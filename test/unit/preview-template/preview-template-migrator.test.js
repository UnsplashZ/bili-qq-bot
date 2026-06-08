'use strict'

const assert = require('assert')

const {
    migratePreviewLayoutPatchToTemplate,
    migratePreviewLayoutConfigToTemplates,
    migrateSavedV2Config
} = require('../../../src/services/previewTemplate/migrator')

describe('preview template migrator', function () {
    it('migrates v1 layout patch to v2 flow transform without forcing absolute', function () {
        const result = migratePreviewLayoutPatchToTemplate('video', {
            elements: {
                title: {
                    visible: false,
                    layout: {
                        offsetX: 12,
                        offsetY: -8,
                        width: 420,
                        height: 88,
                        marginTop: 6
                    },
                    typography: {
                        fontSize: 36,
                        lineHeight: 1.2,
                        maxLines: 2
                    }
                },
                cover: {
                    media: {
                        aspectRatio: '4/3',
                        objectFit: 'contain',
                        objectPosition: 'top',
                        borderRadius: 12
                    }
                }
            }
        }, { withMeta: true })

        const title = result.template.nodesById.title
        assert.strictEqual(result.migratedFromVersion, 1)
        assert.strictEqual(title.visible, true)
        assert.strictEqual(title.layout.mode, 'flow')
        assert.deepStrictEqual(title.layout.transform, { x: 12, y: -8 })
        assert.strictEqual(title.layout.width, 420)
        assert.strictEqual(title.layout.height, 88)
        assert.strictEqual(title.style.fontSize, 36)
        assert.strictEqual(title.style.maxLines, 2)
        assert.ok(!('x' in title.layout))
        assert.ok(!('y' in title.layout))
        assert.strictEqual(result.template.nodesById.cover.style.radius, undefined)
        assert.strictEqual(result.template.nodesById.cover.style.objectFit, 'contain')
    })

    it('drops unknown v1 elements with warnings and keeps a valid template', function () {
        const result = migratePreviewLayoutPatchToTemplate('dynamic', {
            elements: {
                unknown: { visible: false },
                text: { visible: false }
            }
        }, { withMeta: true })

        assert.strictEqual(result.template.nodesById.text.visible, true)
        assert.ok(result.warnings.some(item => item.path === 'elements.unknown'))
    })

    it('migrates stored v1 config without overwriting legacy backup', function () {
        const result = migratePreviewLayoutConfigToTemplates({
            version: 1,
            global: {
                video: {
                    elements: {
                        title: { layout: { offsetY: -12 } }
                    }
                }
            },
            groups: {
                '123': {
                    video: {
                        elements: {
                            typeBadge: { visible: false }
                        }
                    }
                }
            }
        })

        assert.strictEqual(result.config.version, 2)
        assert.strictEqual(result.migratedFromVersion, 1)
        assert.strictEqual(result.config.legacyV1Backup.version, 1)
        assert.strictEqual(result.config.global.video.template.nodesById.title.layout.transform.y, -12)
        assert.strictEqual(result.config.groups['123'].video.templatePatch.nodes.typeBadge.op, 'merge')
    })

    it('cleans old v2 group template patches for legacy core nodes', function () {
        const result = migrateSavedV2Config({
            version: 2,
            groups: {
                '123': {
                    video: {
                        templatePatch: {
                            nodes: {
                                card: {
                                    op: 'merge',
                                    value: {
                                        role: 'card',
                                        layout: {
                                            mode: 'absolute',
                                            x: 18,
                                            y: -6,
                                            width: 640,
                                            height: 360
                                        },
                                        style: {
                                            color: '#111827',
                                            background: '#ffffff',
                                            radius: 24,
                                            borderColor: '#2563eb',
                                            fontSize: 32
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        })

        const value = result.groups['123'].video.templatePatch.nodes.card.value
        assert.deepStrictEqual(value.layout, {
            mode: 'flow',
            transform: { x: 18, y: -6 }
        })
        assert.deepStrictEqual(value.style, {
            color: '#111827',
            fontSize: 32
        })
    })
})
