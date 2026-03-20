#!/usr/bin/env node
'use strict'

const assert = require('assert')

const config = require('../../src/config')
const theme = require('../../src/services/imageGenerator/core/theme')

const originals = {
    save: config.save,
    performSave: config._performSave,
    previewGradientColor1: config.previewGradientColor1,
    previewGradientColor2: config.previewGradientColor2
}

async function run() {
    config.save = () => {}
    config._performSave = async () => {}

    config.previewGradientColor1 = '#102030'
    config.previewGradientColor2 = '#A0B0C0'

    const extracted = theme.calculateColors('user', { data: {} }, { color: '#445566' }, false)
    assert.ok(extracted.gradientMix.includes('#102030'))
    assert.ok(extracted.gradientMix.includes('#A0B0C0'))
    assert.ok(extracted.gradientMix.includes('#445566'))

    const staticGradient = theme.getStaticPreviewGradientMix()
    assert.ok(staticGradient.includes('#102030'))
    assert.ok(staticGradient.includes('#A0B0C0'))

    const baseColors = theme.getPreviewGradientBaseColors()
    assert.strictEqual(baseColors.color1, '#102030')
    assert.strictEqual(baseColors.color2, '#A0B0C0')

    console.log('✓ 预览图主题层会读取并应用全局渐变色配置')
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
        config.previewGradientColor1 = originals.previewGradientColor1
        config.previewGradientColor2 = originals.previewGradientColor2
        config.save = originals.save
        config._performSave = originals.performSave
    })
