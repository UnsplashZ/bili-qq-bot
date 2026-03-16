#!/usr/bin/env node
import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { LABEL_CONFIG_ITEMS, createDefaultLabelConfig, mergeLabelConfig } from '../../dashboard/src/pages/groups/constants/labelConfig.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')

const expectedKeys = [
  'interactive_video',
  'favorite_list',
  'audio',
  'audio_list',
  'topic',
  'channel_series',
  'article_list',
  'note',
  'cheese_video'
]

const defaults = createDefaultLabelConfig()
const itemKeys = LABEL_CONFIG_ITEMS.map((item) => item.key)
const merged = mergeLabelConfig({ favorite_list: false })

expectedKeys.forEach((key) => {
  assert.strictEqual(defaults[key], true, `默认标签配置应包含 ${key}`)
  assert.ok(itemKeys.includes(key), `Dashboard 标签项应包含 ${key}`)
})

assert.strictEqual(merged.favorite_list, false)

const groupFormSource = fs.readFileSync(
  path.join(repoRoot, 'dashboard/src/pages/groups/utils/groupForm.js'),
  'utf8'
)
const generalTabSource = fs.readFileSync(
  path.join(repoRoot, 'dashboard/src/pages/groups/components/tabs/GeneralTab.jsx'),
  'utf8'
)
const syncTabSource = fs.readFileSync(
  path.join(repoRoot, 'dashboard/src/pages/groups/components/tabs/SyncTab.jsx'),
  'utf8'
)

assert.ok(groupFormSource.includes('createDefaultLabelConfig()'))
assert.ok(groupFormSource.includes('mergeLabelConfig(labels)'))
assert.ok(generalTabSource.includes('LABEL_CONFIG_ITEMS'))
assert.ok(syncTabSource.includes('链接解析卡片不在此范围内'))

console.log('PASS dashboard-group-form-labels')
