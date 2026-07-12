#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')
const { pathToFileURL } = require('url')

const config = require('../../../src/config')
const theme = require('../../../src/services/imageGenerator/core/theme')

const originals = {
    save: config.save,
    performSave: config._performSave,
    previewGradientColor1: config.previewGradientColor1,
    previewGradientColor2: config.previewGradientColor2
}

async function run() {
    config.save = () => {}
    config._performSave = async () => {}

    config.__getMutableCompatStateForTests().previewGradientColor1 = '#102030'
    config.__getMutableCompatStateForTests().previewGradientColor2 = '#A0B0C0'

    const neutralOnly = theme.calculateColors('user', { data: {} }, { color: '#445566' }, false)
    assert.ok(neutralOnly.gradientAtmosphere.includes('linear-gradient(135deg, #FFF7FB 0%, #F4F6FF 50%, #F0F9FF 100%)'))
    assert.ok(neutralOnly.gradientAtmosphere.includes(theme.hexToRgba('#102030', 0.34)))
    assert.ok(neutralOnly.gradientAtmosphere.includes(theme.hexToRgba('#A0B0C0', 0.3)))
    assert.ok(!neutralOnly.gradientAtmosphere.includes(theme.hexToRgba('#102030', 0.2)))
    assert.ok(!neutralOnly.gradientAtmosphere.includes(theme.hexToRgba('#A0B0C0', 0.18)))
    assert.strictEqual(neutralOnly.gradientContent, '')
    assert.strictEqual(neutralOnly.gradientOverlay, '')

    const extracted = theme.calculateColors(
        'user',
        { data: { focus: { avatar: '#445566' } } },
        { color: '#778899' },
        false
    )
    assert.ok(extracted.gradientContent.includes(theme.hexToRgba('#445566', 0.18)))
    assert.ok(extracted.gradientContent.includes(theme.hexToRgba('#445566', 0.099)))
    assert.ok(extracted.gradientContent.includes(theme.hexToRgba('#445566', 0.039599999999999996)))
    assert.ok(extracted.gradientContent.includes('36% 14%'))
    assert.ok(extracted.gradientContent.includes('transparent 86%'))
    assert.ok(!extracted.gradientContent.includes('42% 20%'))
    assert.ok(extracted.gradientMix.indexOf(theme.hexToRgba('#445566', 0.18)) < extracted.gradientMix.indexOf(theme.hexToRgba('#102030', 0.34)))

    const noContentGradient = theme.buildGradientMixFromColors([], {
        accentColor1: '#102030',
        accentColor2: '#A0B0C0',
        isNight: false
    })
    assert.ok(noContentGradient.includes('linear-gradient(135deg, #FFF7FB 0%, #F4F6FF 50%, #F0F9FF 100%)'))
    assert.ok(!noContentGradient.includes('#445566'))

    const darkNeutral = theme.calculateColors('user', { data: {} }, { color: '#445566' }, true)
    assert.ok(darkNeutral.gradientAtmosphere.includes('linear-gradient(135deg, #121418 0%, #233346 100%)'))
    assert.ok(!darkNeutral.gradientAtmosphere.includes('linear-gradient(135deg, #FFF7FB 0%, #F4F6FF 50%, #F0F9FF 100%)'))
    assert.ok(darkNeutral.gradientAtmosphere.includes(theme.hexToRgba('#102030', 0.16)))
    assert.ok(darkNeutral.gradientAtmosphere.includes(theme.hexToRgba('#A0B0C0', 0.14)))
    assert.ok(darkNeutral.gradientOverlay.includes('linear-gradient(180deg, rgba(6, 10, 18, 0.34) 0%, rgba(6, 10, 18, 0.5) 100%)'))
    assert.strictEqual(darkNeutral.gradientContent, '')
    assert.ok(darkNeutral.gradientMix.includes(darkNeutral.gradientOverlay))

    const darkExtracted = theme.calculateColors(
        'user',
        { data: { focus: { avatar: '#445566' } } },
        { color: '#778899' },
        true
    )
    assert.ok(darkExtracted.gradientContent.includes(theme.hexToRgba('#445566', 0.16)))
    assert.ok(darkExtracted.gradientContent.includes(theme.hexToRgba('#445566', 0.08800000000000001)))
    assert.ok(darkExtracted.gradientContent.includes(theme.hexToRgba('#445566', 0.0352)))
    assert.ok(darkExtracted.gradientContent.includes('36% 14%'))
    assert.ok(darkExtracted.gradientContent.includes('transparent 86%'))
    assert.ok(!darkExtracted.gradientContent.includes('42% 20%'))

    const baseColors = theme.getPreviewGradientBaseColors()
    assert.strictEqual(baseColors.color1, '#102030')
    assert.strictEqual(baseColors.color2, '#A0B0C0')

    const previewGradientModelUrl = pathToFileURL(path.resolve(__dirname, '../../../dashboard/src/pages/settings/components/previewGradientModel.js')).href
    const previewGradientModel = await import(previewGradientModelUrl)
    const settingsPreview = previewGradientModel.buildGradientBackground('#102030', '#A0B0C0').backgroundImage

    assert.ok(settingsPreview.includes('linear-gradient(135deg, #FFF7FB 0%, #F4F6FF 50%, #F0F9FF 100%)'))
    assert.ok(settingsPreview.includes('rgba(16, 32, 48, 0.34)'))
    assert.ok(settingsPreview.includes('rgba(160, 176, 192, 0.3)'))
    assert.ok(!settingsPreview.includes('rgba(16, 32, 48, 0.2)'))
    assert.ok(!settingsPreview.includes('rgba(160, 176, 192, 0.18)'))
    assert.strictEqual(previewGradientModel.FIELD_LABELS.previewGradientColor1, '氛围色 1')
    assert.strictEqual(previewGradientModel.FIELD_LABELS.previewGradientColor2, '氛围色 2')
    assert.strictEqual(previewGradientModel.FIELD_DESCRIPTIONS.previewGradientColor1, '控制右上区域的氛围色。')
    assert.strictEqual(previewGradientModel.FIELD_DESCRIPTIONS.previewGradientColor2, '控制左下区域的氛围色。')

    console.log('✓ 预览图主题层会使用固定底板与自定义氛围层')
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
    .finally(() => {
        config.save = () => {}
        config._performSave = async () => {}
        config.__getMutableCompatStateForTests().previewGradientColor1 = originals.previewGradientColor1
        config.__getMutableCompatStateForTests().previewGradientColor2 = originals.previewGradientColor2
        config.save = originals.save
        config._performSave = originals.performSave
    })
