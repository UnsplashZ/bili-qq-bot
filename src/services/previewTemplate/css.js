'use strict'

function px(value) {
    return `${value}px`
}

function selector(id) {
    return `[data-template-node-id="${id}"]`
}

function addRule(rules, sel, declarations) {
    const entries = Object.entries(declarations).filter(([, value]) => value !== undefined && value !== null && value !== '')
    if (entries.length === 0) return
    rules.push(`${sel} { ${entries.map(([key, value]) => `${key}: ${value};`).join(' ')} }`)
}

function layoutDeclarations(layout = {}) {
    const declarations = {}
    if (layout.mode === 'absolute') {
        declarations.position = 'absolute'
        declarations.left = px(layout.x || 0)
        declarations.top = px(layout.y || 0)
        declarations['z-index'] = String(layout.zIndex || 1)
    }
    if (layout.mode === 'flex') {
        declarations.display = 'flex'
        declarations['flex-direction'] = layout.direction || 'row'
        declarations['align-items'] = layout.align || 'center'
        declarations['justify-content'] = layout.justify || 'start'
    }
    if (layout.mode === 'stack') {
        declarations.display = 'flex'
        declarations['flex-direction'] = 'column'
    }
    if (layout.mode === 'grid') {
        declarations.display = 'grid'
        declarations['grid-template-columns'] = `repeat(${layout.columns || 3}, minmax(0, 1fr))`
    }
    if (layout.gap !== undefined) declarations.gap = px(layout.gap)
    if (layout.padding !== undefined) declarations.padding = px(layout.padding)
    if (layout.width !== undefined) declarations.width = typeof layout.width === 'number' ? px(layout.width) : layout.width
    if (layout.height !== undefined) declarations.height = typeof layout.height === 'number' ? px(layout.height) : layout.height
    if (layout.marginTop !== undefined) declarations['margin-top'] = px(layout.marginTop)
    if (layout.marginBottom !== undefined) declarations['margin-bottom'] = px(layout.marginBottom)
    if (layout.aspectRatio !== undefined) declarations['aspect-ratio'] = layout.aspectRatio
    if (layout.transform?.x !== undefined || layout.transform?.y !== undefined) {
        declarations.transform = `translate(${px(layout.transform.x || 0)}, ${px(layout.transform.y || 0)})`
    }
    return declarations
}

function styleDeclarations(style = {}) {
    const declarations = {}
    if (style.fontSize !== undefined) declarations['font-size'] = px(style.fontSize)
    if (style.fontWeight !== undefined) declarations['font-weight'] = String(style.fontWeight)
    if (style.lineHeight !== undefined) declarations['line-height'] = String(style.lineHeight)
    if (style.color !== undefined) declarations.color = style.color
    if (style.background !== undefined) declarations.background = style.background
    if (style.radius !== undefined) declarations['border-radius'] = px(style.radius)
    if (style.opacity !== undefined) declarations.opacity = String(style.opacity)
    if (style.borderWidth !== undefined) declarations['border-width'] = px(style.borderWidth)
    if (style.borderColor !== undefined) declarations['border-color'] = style.borderColor
    if (style.shadow === 'soft') declarations['box-shadow'] = '0 10px 28px rgba(15, 23, 42, 0.14)'
    if (style.shadow === 'medium') declarations['box-shadow'] = '0 16px 42px rgba(15, 23, 42, 0.20)'
    if (style.maxHeight !== undefined) {
        declarations['max-height'] = px(style.maxHeight)
        declarations.overflow = 'hidden'
    }
    if (style.maxLines !== undefined) {
        declarations.display = '-webkit-box'
        declarations['-webkit-line-clamp'] = String(style.maxLines)
        declarations['-webkit-box-orient'] = 'vertical'
        declarations.overflow = 'hidden'
    }
    return declarations
}

function imageDeclarations(style = {}) {
    const declarations = {
        width: '100%',
        height: '100%'
    }
    if (style.objectFit !== undefined) declarations['object-fit'] = style.objectFit
    if (style.objectPosition !== undefined) declarations['object-position'] = style.objectPosition
    return declarations
}

function renderTemplateCss(template) {
    const rules = [
        '.preview-template-root { position: relative; width: 100%; box-sizing: border-box; }',
        '.preview-template-card { position: relative; overflow: hidden; }',
        '.preview-template-node { box-sizing: border-box; min-width: 0; }',
        '.preview-template-tag { display: inline-flex; align-items: center; justify-content: center; padding: 0 12px; white-space: nowrap; }',
        '.preview-template-text { word-break: break-word; }',
        '.preview-template-image { overflow: hidden; display: block; }',
        '.preview-template-image img { display: block; }',
        '.preview-template-stats { display: flex; flex-wrap: wrap; align-items: center; }',
        '.preview-template-shape { pointer-events: none; }'
    ]
    for (const node of Object.values(template.nodesById || {})) {
        const sel = selector(node.id)
        if (node.visible === false) {
            addRule(rules, sel, { display: 'none !important' })
            continue
        }
        addRule(rules, sel, {
            ...layoutDeclarations(node.layout || {}),
            ...styleDeclarations(node.style || {})
        })
        if (node.type === 'image') {
            addRule(rules, `${sel} > img`, imageDeclarations(node.style || {}))
        }
    }
    return `<style data-preview-template-css>\n${rules.join('\n')}\n</style>`
}

module.exports = {
    buildTemplateCss: renderTemplateCss,
    renderTemplateCss,
    layoutDeclarations,
    styleDeclarations
}
