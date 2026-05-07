const HEX_COLOR_PATTERN = /^#([0-9A-F]{6})$/i

const FIXED_PREVIEW_BASE_GRADIENT = 'linear-gradient(135deg, #FFF7FB 0%, #F4F6FF 50%, #F0F9FF 100%)'
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

function buildPreviewGradientLayers({
    accentColor1 = DEFAULT_PREVIEW_ATMOSPHERE_COLOR1,
    accentColor2 = DEFAULT_PREVIEW_ATMOSPHERE_COLOR2
} = {}) {
    const primary = normalizeHexColor(accentColor1, DEFAULT_PREVIEW_ATMOSPHERE_COLOR1)
    const secondary = normalizeHexColor(accentColor2, DEFAULT_PREVIEW_ATMOSPHERE_COLOR2)
    const atmosphereParts = [
        `radial-gradient(ellipse 88% 64% at 84% 14%, ${hexToRgba(primary, 0.34)} 0%, transparent 76%)`,
        `radial-gradient(ellipse 86% 62% at 16% 84%, ${hexToRgba(secondary, 0.3)} 0%, transparent 76%)`,
        FIXED_PREVIEW_BASE_GRADIENT
    ]

    return {
        atmosphereLayer: atmosphereParts.join(', ')
    }
}

export {
    DEFAULT_PREVIEW_ATMOSPHERE_COLOR1,
    DEFAULT_PREVIEW_ATMOSPHERE_COLOR2
}

export const FIELD_LABELS = {
    previewGradientColor1: '氛围色 1',
    previewGradientColor2: '氛围色 2'
}

export const FIELD_DESCRIPTIONS = {
    previewGradientColor1: '控制右上区域的氛围色。',
    previewGradientColor2: '控制左下区域的氛围色。'
}

export function resolveEffectivePreviewGradientColors(gradientInputs = {}, previewGradientConfig = {}) {
    return {
        previewGradientColor1: normalizeHexColor(
            gradientInputs.previewGradientColor1,
            normalizeHexColor(previewGradientConfig.previewGradientColor1, DEFAULT_PREVIEW_ATMOSPHERE_COLOR1)
        ),
        previewGradientColor2: normalizeHexColor(
            gradientInputs.previewGradientColor2,
            normalizeHexColor(previewGradientConfig.previewGradientColor2, DEFAULT_PREVIEW_ATMOSPHERE_COLOR2)
        )
    }
}

export function buildGradientBackground(color1, color2) {
    const { atmosphereLayer } = buildPreviewGradientLayers({
        accentColor1: normalizeHexColor(color1, DEFAULT_PREVIEW_ATMOSPHERE_COLOR1),
        accentColor2: normalizeHexColor(color2, DEFAULT_PREVIEW_ATMOSPHERE_COLOR2)
    })
    return {
        backgroundImage: atmosphereLayer
    }
}
