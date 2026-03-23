const HEX_COLOR_PATTERN = /^#([0-9A-F]{6})$/i

const FIXED_PREVIEW_BASE_GRADIENT = 'linear-gradient(135deg, #FFF7FB 0%, #F4F6FF 50%, #F0F9FF 100%)'
const FIXED_PREVIEW_DARK_BASE_GRADIENT = 'linear-gradient(135deg, #121418 0%, #233346 100%)'
const DEFAULT_PREVIEW_ATMOSPHERE_COLOR1 = '#D8C7F1'
const DEFAULT_PREVIEW_ATMOSPHERE_COLOR2 = '#BFE6E2'

function normalizeHexColor(value, fallback = '') {
    const normalized = String(value || '').trim().toUpperCase()
    if (HEX_COLOR_PATTERN.test(normalized)) return normalized
    return fallback
}

function hexToRgba(hex, alpha) {
    const normalized = normalizeHexColor(hex, '#000000').replace('#', '')
    const r = parseInt(normalized.slice(0, 2), 16)
    const g = parseInt(normalized.slice(2, 4), 16)
    const b = parseInt(normalized.slice(4, 6), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function collectContentColors(contentColors = []) {
    const normalizedContentColors = []
    const seen = new Set()
    for (const color of contentColors) {
        const normalized = normalizeHexColor(color, '')
        if (!normalized || seen.has(normalized)) continue
        seen.add(normalized)
        normalizedContentColors.push(normalized)
        if (normalizedContentColors.length >= 1) break
    }
    return normalizedContentColors
}

function buildPreviewGradientLayers({
    accentColor1 = DEFAULT_PREVIEW_ATMOSPHERE_COLOR1,
    accentColor2 = DEFAULT_PREVIEW_ATMOSPHERE_COLOR2,
    contentColors = [],
    isNight = false
} = {}) {
    const primary = normalizeHexColor(accentColor1, DEFAULT_PREVIEW_ATMOSPHERE_COLOR1)
    const secondary = normalizeHexColor(accentColor2, DEFAULT_PREVIEW_ATMOSPHERE_COLOR2)
    const tintAlpha = isNight ? 0.16 : 0.18
    const contentLayerParts = []
    const normalizedContentColors = collectContentColors(contentColors)

    normalizedContentColors.forEach((color) => {
        contentLayerParts.push(
            `radial-gradient(ellipse 96% 72% at 36% 14%, ${hexToRgba(color, tintAlpha)} 0%, ${hexToRgba(color, tintAlpha * 0.55)} 42%, ${hexToRgba(color, tintAlpha * 0.22)} 68%, transparent 86%)`
        )
    })

    const atmosphereParts = [
        `radial-gradient(ellipse 88% 64% at 84% 14%, ${hexToRgba(primary, isNight ? 0.16 : 0.34)} 0%, transparent 76%)`,
        `radial-gradient(ellipse 86% 62% at 16% 84%, ${hexToRgba(secondary, isNight ? 0.14 : 0.3)} 0%, transparent 76%)`
    ]
    const overlayLayer = isNight
        ? 'linear-gradient(180deg, rgba(6, 10, 18, 0.34) 0%, rgba(6, 10, 18, 0.5) 100%)'
        : ''

    atmosphereParts.push(isNight ? FIXED_PREVIEW_DARK_BASE_GRADIENT : FIXED_PREVIEW_BASE_GRADIENT)

    return {
        atmosphereLayer: atmosphereParts.join(', '),
        contentLayer: contentLayerParts.join(', '),
        overlayLayer
    }
}

function buildPreviewGradientMix(options = {}) {
    const { atmosphereLayer, contentLayer, overlayLayer } = buildPreviewGradientLayers(options)
    return [overlayLayer, contentLayer, atmosphereLayer].filter(Boolean).join(', ')
}

module.exports = {
    FIXED_PREVIEW_BASE_GRADIENT,
    FIXED_PREVIEW_DARK_BASE_GRADIENT,
    DEFAULT_PREVIEW_ATMOSPHERE_COLOR1,
    DEFAULT_PREVIEW_ATMOSPHERE_COLOR2,
    normalizeHexColor,
    hexToRgba,
    buildPreviewGradientLayers,
    buildPreviewGradientMix
}
