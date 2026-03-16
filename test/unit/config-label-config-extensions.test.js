#!/usr/bin/env node
'use strict'

const assert = require('assert')
const config = require('../../src/config')

function run() {
    const globalLabels = config.labelConfig
    const sameGlobalLabels = config.labelConfig
    const groupLabels = config.getGroupConfig('non-existent-group', 'labelConfig')
    const originalGlobalLabels = { ...globalLabels }
    const tempGroupId = 'test-label-config-normalization'
    const originalTempGroupConfig = config.groupConfigs[tempGroupId]

    ;[
        'interactive_video',
        'favorite_list',
        'audio',
        'audio_list',
        'topic',
        'channel_series',
        'article_list',
        'note',
        'cheese_video'
    ].forEach((key) => {
        assert.strictEqual(globalLabels[key], true, `全局 labelConfig 应包含 ${key}`)
        assert.strictEqual(groupLabels[key], true, `群级回退 labelConfig 应包含 ${key}`)
    })

    assert.strictEqual(globalLabels, sameGlobalLabels, '全局 labelConfig 应保持同一引用')
    globalLabels.favorite_list = false
    assert.strictEqual(config.labelConfig.favorite_list, false, '原地修改全局 labelConfig 后应立即可读')

    config.groupConfigs[tempGroupId] = {
        labelConfig: {
            favorite_list: false
        }
    }
    const normalizedGroupLabels = config.getGroupConfig(tempGroupId, 'labelConfig')
    assert.strictEqual(normalizedGroupLabels.favorite_list, false)
    assert.strictEqual(normalizedGroupLabels.video, true, '群级 labelConfig 缺失键应自动补齐')

    ;[
        'video',
        'dynamic',
        'live',
        'article',
        'bangumi',
        'movie',
        'tv',
        'guocha',
        'doc',
        'variety'
    ].forEach((key) => {
        assert.ok(Object.prototype.hasOwnProperty.call(config.normalizeSubscriptionAtAllRules({}).categories, key))
    })

    Object.keys(originalGlobalLabels).forEach((key) => {
        globalLabels[key] = originalGlobalLabels[key]
    })
    if (originalTempGroupConfig === undefined) {
        delete config.groupConfigs[tempGroupId]
    } else {
        config.groupConfigs[tempGroupId] = originalTempGroupConfig
    }

    assert.ok(!Object.prototype.hasOwnProperty.call(config.normalizeSubscriptionAtAllRules({}).categories, 'favorite_list'))
    console.log('PASS config-label-config-extensions')
}

run()
