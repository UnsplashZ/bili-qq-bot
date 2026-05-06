import sharedPreviewGradientModel from '../../../../../src/shared/previewGradientModel.cjs'

const {
    buildPreviewGradientLayers,
    normalizeHexColor,
    DEFAULT_PREVIEW_ATMOSPHERE_COLOR1,
    DEFAULT_PREVIEW_ATMOSPHERE_COLOR2
} = sharedPreviewGradientModel

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
