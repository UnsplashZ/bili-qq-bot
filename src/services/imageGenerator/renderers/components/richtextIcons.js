'use strict'

const fs = require('fs')
const path = require('path')

const ICON_CACHE = new Map()
const ICON_DIR = path.resolve(__dirname, '../../assets/icons/richtext')

function normalizeInlineSvg(svgText) {
    const raw = String(svgText || '').trim()
    if (!raw) return ''

    return raw.replace(
        /<svg\b([^>]*)>/i,
        (match, attrs) => `<svg${attrs} class="rt-link-icon-svg" aria-hidden="true" focusable="false">`
    )
}

function loadRichTextIcon(type) {
    const safeType = String(type || '').trim()
    if (!safeType) return ''
    if (ICON_CACHE.has(safeType)) return ICON_CACHE.get(safeType)

    try {
        const filePath = path.join(ICON_DIR, `${safeType}.svg`)
        const svgText = fs.readFileSync(filePath, 'utf8')
        const inlineSvg = normalizeInlineSvg(svgText)
        ICON_CACHE.set(safeType, inlineSvg)
        return inlineSvg
    } catch (_error) {
        ICON_CACHE.set(safeType, '')
        return ''
    }
}

module.exports = {
    loadRichTextIcon
}
