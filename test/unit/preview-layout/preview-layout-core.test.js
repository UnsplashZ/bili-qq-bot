#!/usr/bin/env node
'use strict'

const assert = require('assert')

const { getPreviewLayoutSchema } = require('../../../src/services/previewLayout/schema')
const {
    PreviewLayoutValidationError,
    normalizePreviewLayoutPatch
} = require('../../../src/services/previewLayout/normalizer')
const {
    mergeLayoutConfigs,
    resetPreviewLayoutPatch,
    savePreviewLayoutPatch,
    stableStringify
} = require('../../../src/services/previewLayout/merge')
const { buildPreviewLayoutOverrideCss } = require('../../../src/services/previewLayout/css')

describe('preview layout core', function () {
    it('schema exposes Bilibili link card types as editable', function () {
        const schema = getPreviewLayoutSchema()

        assert.strictEqual(schema.version, 1)
        for (const type of ['video', 'dynamic', 'article', 'live', 'bangumi', 'user']) {
            assert.strictEqual(schema.types[type].status, 'editable')
            assert.ok(schema.types[type].elements.typeBadge)
            assert.ok(schema.types[type].elements.card)
        }
        assert.ok(schema.types.video.elements.cover)
        assert.ok(schema.types.video.elements.title)
        assert.ok(schema.types.dynamic.elements.origCard)
        assert.ok(schema.types.user.elements.dynamicSection)
    })

    it('normalizer accepts valid video fields and removes null overrides', function () {
        const normalized = normalizePreviewLayoutPatch('video', {
            elements: {
                cover: {
                    visible: true,
                    layout: {
                        height: 420,
                        offsetY: -12,
                        width: null
                    },
                    media: {
                        objectFit: 'contain',
                        objectPosition: 'top',
                        borderRadius: 12
                    }
                },
                title: {
                    typography: {
                        fontSize: 36,
                        maxLines: 2
                    }
                }
            }
        })

        assert.deepStrictEqual(normalized, {
            elements: {
                cover: {
                    visible: true,
                    layout: {
                        height: 420,
                        offsetY: -12
                    },
                    media: {
                        objectFit: 'contain',
                        objectPosition: 'top',
                        borderRadius: 12
                    }
                },
                title: {
                    typography: {
                        fontSize: 36,
                        maxLines: 2
                    }
                }
            }
        })
    })

    it('normalizer accepts valid non-video editable fields', function () {
        const normalized = normalizePreviewLayoutPatch('dynamic', {
            elements: {
                media: {
                    visible: false,
                    layout: {
                        marginTop: 12
                    },
                    media: {
                        borderRadius: 8
                    }
                },
                origCard: {
                    visible: false
                }
            }
        })

        assert.deepStrictEqual(normalized, {
            elements: {
                media: {
                    visible: false,
                    layout: {
                        marginTop: 12
                    },
                    media: {
                        borderRadius: 8
                    }
                },
                origCard: {
                    visible: false
                }
            }
        })
    })

    it('normalizer rejects unknown fields, unknown elements, unsupported types and out-of-range values', function () {
        assert.throws(
            () => normalizePreviewLayoutPatch('video', { elements: { unknown: { visible: false } } }),
            PreviewLayoutValidationError
        )
        assert.throws(
            () => normalizePreviewLayoutPatch('video', { elements: { cover: { css: 'display:block' } } }),
            PreviewLayoutValidationError
        )
        assert.throws(
            () => normalizePreviewLayoutPatch('help_user', { elements: {} }),
            PreviewLayoutValidationError
        )
        assert.throws(
            () => normalizePreviewLayoutPatch('video', { elements: { cover: { layout: { height: 9999 } } } }),
            PreviewLayoutValidationError
        )
    })

    it('merge order applies global, group and temporary patches', function () {
        const globalPatch = normalizePreviewLayoutPatch('video', {
            elements: {
                cover: { layout: { height: 420 } },
                title: { typography: { maxLines: 2 } }
            }
        })
        const groupPatch = normalizePreviewLayoutPatch('video', {
            elements: {
                cover: { layout: { offsetY: 10 } }
            }
        })
        const temporaryPatch = normalizePreviewLayoutPatch('video', {
            elements: {
                cover: { layout: { height: 360 } }
            }
        })

        assert.deepStrictEqual(
            mergeLayoutConfigs(globalPatch, groupPatch, temporaryPatch),
            {
                elements: {
                    cover: {
                        layout: {
                            height: 360,
                            offsetY: 10
                        }
                    },
                    title: {
                        typography: {
                            maxLines: 2
                        }
                    }
                }
            }
        )
    })

    it('save and reset helpers return pure config mutations', function () {
        const stored = { version: 1, global: {}, groups: {} }
        const saved = savePreviewLayoutPatch('global', 'video', {
            elements: { cover: { visible: false } }
        }, null, stored)
        assert.deepStrictEqual(stored, { version: 1, global: {}, groups: {} })
        assert.strictEqual(saved.nextConfig.global.video.elements.cover.visible, false)
        assert.strictEqual(saved.saved.elements.cover.visible, false)

        const reset = resetPreviewLayoutPatch('global', 'video', null, 'cover', saved.nextConfig)
        assert.strictEqual(reset.result.elements, undefined)
        assert.strictEqual(reset.nextConfig.global, undefined)
    })

    it('merge preserves false visibility overrides', function () {
        const savedPatch = normalizePreviewLayoutPatch('video', {
            elements: {
                typeBadge: { visible: true },
                cover: { visible: true }
            }
        })
        const temporaryPatch = normalizePreviewLayoutPatch('video', {
            elements: {
                typeBadge: { visible: false }
            }
        })

        assert.deepStrictEqual(
            mergeLayoutConfigs(savedPatch, temporaryPatch),
            {
                elements: {
                    typeBadge: { visible: false },
                    cover: { visible: true }
                }
            }
        )
    })

    it('css builder only emits schema-controlled declarations', function () {
        const css = buildPreviewLayoutOverrideCss({
            elements: {
                cover: {
                    visible: false,
                    layout: {
                        height: 420,
                        offsetY: -8
                    },
                    media: {
                        objectFit: 'contain',
                        borderRadius: 16
                    }
                }
            }
        })

        assert.match(css, /\[data-layout-key="cover"\]/)
        assert.match(css, /display: none !important/)
        assert.match(css, /height: 420px/)
        assert.match(css, /object-fit: contain/)
        assert.doesNotMatch(css, /display:block/)
        assert.doesNotMatch(css, /url\(/)
    })

    it('css builder applies media controls to non-cover inner images', function () {
        const css = buildPreviewLayoutOverrideCss({
            elements: {
                media: {
                    media: {
                        objectFit: 'contain',
                        objectPosition: 'top',
                        borderRadius: 12
                    }
                }
            }
        }, { type: 'dynamic' })

        assert.match(css, /\[data-layout-key="media"\] \{/)
        assert.match(css, /overflow: hidden/)
        assert.match(css, /\[data-layout-key="media"\] img \{/)
        assert.match(css, /object-fit: contain/)
        assert.match(css, /object-position: top/)
        assert.match(css, /border-radius: 12px/)
    })

    it('stableStringify is key-order independent for layout signatures', function () {
        assert.strictEqual(
            stableStringify({ b: 1, a: { d: 2, c: 3 } }),
            stableStringify({ a: { c: 3, d: 2 }, b: 1 })
        )
    })
})
