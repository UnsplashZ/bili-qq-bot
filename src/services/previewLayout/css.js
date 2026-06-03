'use strict'

const { normalizePreviewLayoutPatch } = require('./normalizer')

function px(value) {
    return `${value}px`
}

function selectorFor(key) {
    return `[data-layout-key="${key}"]`
}

function addRule(rules, selector, declarations) {
    const entries = Object.entries(declarations).filter(([, value]) => value !== undefined && value !== null && value !== '')
    if (entries.length === 0) return
    rules.push(`${selector} { ${entries.map(([key, value]) => `${key}: ${value};`).join(' ')} }`)
}

function buildLayoutDeclarations(layout = {}) {
    const declarations = {}
    if (layout.width !== undefined) declarations.width = px(layout.width)
    if (layout.height !== undefined) declarations.height = px(layout.height)
    if (layout.marginTop !== undefined) declarations['margin-top'] = px(layout.marginTop)
    if (layout.marginBottom !== undefined) declarations['margin-bottom'] = px(layout.marginBottom)
    if (layout.offsetX !== undefined || layout.offsetY !== undefined) {
        declarations.transform = `translate(${px(layout.offsetX || 0)}, ${px(layout.offsetY || 0)})`
    }
    return declarations
}

function buildTypographyDeclarations(typography = {}) {
    const declarations = {}
    if (typography.fontSize !== undefined) declarations['font-size'] = px(typography.fontSize)
    if (typography.lineHeight !== undefined) declarations['line-height'] = String(typography.lineHeight)
    if (typography.maxHeight !== undefined) {
        declarations['max-height'] = px(typography.maxHeight)
        declarations.overflow = 'hidden'
    }
    if (typography.maxLines !== undefined) {
        declarations.display = '-webkit-box'
        declarations['-webkit-line-clamp'] = String(typography.maxLines)
        declarations['-webkit-box-orient'] = 'vertical'
        declarations.overflow = 'hidden'
    }
    return declarations
}

function buildMediaDeclarations(media = {}) {
    const declarations = {}
    if (media.aspectRatio !== undefined) declarations['aspect-ratio'] = media.aspectRatio
    if (media.objectFit !== undefined) declarations['object-fit'] = media.objectFit
    if (media.objectPosition !== undefined) declarations['object-position'] = media.objectPosition
    if (media.borderRadius !== undefined) declarations['border-radius'] = px(media.borderRadius)
    return declarations
}

function buildMediaImageDeclarations(media = {}) {
    const declarations = {}
    if (media.objectFit !== undefined) declarations['object-fit'] = media.objectFit
    if (media.objectPosition !== undefined) declarations['object-position'] = media.objectPosition
    if (media.borderRadius !== undefined) declarations['border-radius'] = px(media.borderRadius)
    return declarations
}

function buildPreviewLayoutOverrideCss(rawLayout = {}, options = {}) {
    const { type = 'video', alreadyNormalized = false } = options
    const layout = alreadyNormalized
        ? rawLayout || {}
        : normalizePreviewLayoutPatch(type, rawLayout || {}, { requireEditable: false })
    const elements = layout.elements || {}
    const rules = []

    for (const [key, element] of Object.entries(elements)) {
        const selector = selectorFor(key)
        if (element.visible === false) {
            addRule(rules, selector, { display: 'none !important' })
        }

        const baseDeclarations = {
            ...buildLayoutDeclarations(element.layout),
            ...buildTypographyDeclarations(element.typography)
        }
        addRule(rules, selector, baseDeclarations)

        if (element.media) {
            const mediaDeclarations = buildMediaDeclarations(element.media)
            if (key === 'cover') {
                addRule(rules, selector, {
                    overflow: 'hidden',
                    ...(element.media.aspectRatio !== undefined ? { 'aspect-ratio': element.media.aspectRatio } : {})
                })
                addRule(rules, `${selector} > img`, {
                    width: '100%',
                    height: '100%',
                    ...mediaDeclarations
                })
            } else {
                addRule(rules, selector, {
                    ...mediaDeclarations,
                    ...(element.media.borderRadius !== undefined ? { overflow: 'hidden' } : {})
                })
                addRule(rules, `${selector} img`, buildMediaImageDeclarations(element.media))
            }
        }

        if (key === 'cover' && element.layout?.height !== undefined) {
            addRule(rules, `${selector} > img`, {
                height: '100%',
                'aspect-ratio': 'auto'
            })
        }
    }

    if (rules.length === 0) return ''
    return `<style data-preview-layout-overrides>\n${rules.join('\n')}\n</style>`
}

module.exports = {
    buildPreviewLayoutOverrideCss
}
