#!/usr/bin/env node
'use strict'

const assert = require('assert')

const { getPreviewLayoutSchema } = require('../../../src/services/previewLayout/schema')
const {
    PreviewLayoutValidationError,
    normalizePreviewLayoutPatch
} = require('../../../src/services/previewLayout/normalizer')
const { mergeLayoutConfigs, stableStringify } = require('../../../src/services/previewLayout/merge')
const { buildPreviewLayoutOverrideCss } = require('../../../src/services/previewLayout/css')

describe('preview layout core', function () {
    it('schema exposes video as editable and planned types as disabled', function () {
        const schema = getPreviewLayoutSchema()

        assert.strictEqual(schema.version, 1)
        assert.strictEqual(schema.types.video.status, 'editable')
        assert.strictEqual(schema.types.dynamic.status, 'planned')
        assert.ok(schema.types.video.elements.cover)
        assert.ok(schema.types.video.elements.title)
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

    it('normalizer rejects unknown fields, unknown elements, planned types and out-of-range values', function () {
        assert.throws(
            () => normalizePreviewLayoutPatch('video', { elements: { unknown: { visible: false } } }),
            PreviewLayoutValidationError
        )
        assert.throws(
            () => normalizePreviewLayoutPatch('video', { elements: { cover: { css: 'display:block' } } }),
            PreviewLayoutValidationError
        )
        assert.throws(
            () => normalizePreviewLayoutPatch('dynamic', { elements: {} }),
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

    it('stableStringify is key-order independent for layout signatures', function () {
        assert.strictEqual(
            stableStringify({ b: 1, a: { d: 2, c: 3 } }),
            stableStringify({ a: { c: 3, d: 2 }, b: 1 })
        )
    })
})
