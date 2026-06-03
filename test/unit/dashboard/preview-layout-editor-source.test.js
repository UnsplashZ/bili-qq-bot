#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const repoRoot = path.join(__dirname, '../../..')
const source = fs.readFileSync(
    path.join(repoRoot, 'dashboard/src/pages/PreviewLayoutEditor.jsx'),
    'utf8'
)

describe('PreviewLayoutEditor source contracts', function () {
    it('uses draft visibility before preview metadata for element status labels', function () {
        assert.match(source, /function getElementStatusLabel/)
        assert.match(source, /getDraftVisibleState\(draft, elementKey\)/)
        assert.match(source, /draftVisible === 'hidden'.*隐藏/s)
        assert.match(source, /return '显示'/)
        assert.doesNotMatch(source, /待预览|缺失|可见/)
    })

    it('keeps stale preview responses and stale canvas state explicit', function () {
        assert.match(source, /lastPreviewPayloadRef\.current !== payloadKey/)
        assert.match(source, /setPreviewPayloadKey\(payloadKey\)/)
        assert.match(source, /预览更新中/)
        assert.match(source, /预览待更新/)
    })

    it('keeps apply, save and reset controls in a horizontal action bar outside property panel', function () {
        assert.match(source, /function PreviewActionBar/)
        assert.match(source, /<PreviewActionBar/)
        assert.match(source, /保存到全局/)
        assert.match(source, /保存到当前群/)
        assert.match(source, /重置已保存元素/)
        const propertyPanel = source.slice(source.indexOf('<PanelHeader title="属性"'))
        assert.doesNotMatch(propertyPanel, /保存到全局|保存到当前群|重置已保存元素|重置当前模板/)
    })

    it('places source controls below preview gradient settings and removes header sync pills', function () {
        const gradientIndex = source.indexOf('<PreviewGradientSection')
        const sourceIndex = source.indexOf('<span className="text-xs font-semibold text-[var(--muted)]">来源</span>')
        const actionBarIndex = source.indexOf('<PreviewActionBar')
        assert.ok(gradientIndex > -1, 'gradient section should exist')
        assert.ok(sourceIndex > -1, 'source controls should exist')
        assert.ok(actionBarIndex > -1, 'action bar should exist')
        assert.ok(gradientIndex < sourceIndex, 'source controls should be below gradient section')
        assert.ok(sourceIndex < actionBarIndex, 'action bar should stay below source controls')
        const sourceCardStart = source.lastIndexOf('<Card className="grid gap-3" padded>', sourceIndex)
        const sourceCardEnd = source.indexOf('</Card>', actionBarIndex)
        assert.ok(sourceCardStart > -1, 'source card should wrap source controls')
        assert.ok(sourceCardStart < sourceIndex, 'source card should start before source controls')
        assert.ok(sourceCardEnd > actionBarIndex, 'source card should also wrap action bar')
        assert.doesNotMatch(source, /可编辑` : '暂未开放'|已同步/)
    })

    it('only auto-refreshes preview when the current canvas is stale', function () {
        assert.match(source, /const hasPreviewImage = Boolean\(preview\?\.image\?\.base64\)/)
        assert.match(source, /if \(!hasPreviewImage \|\| !dirty \|\| !editable \|\| !previewOutdated\) return undefined/)
        assert.match(source, /lastPreviewPayloadRef\.current === currentPreviewPayloadKey/)
        assert.doesNotMatch(source, /if \(!preview \|\| !dirty \|\| !editable\) return undefined/)
    })

    it('applies visibility toggles to preview without persisting global config', function () {
        assert.match(source, /const updateElement = \(elementKey, patch, options = \{\}\)/)
        assert.match(source, /const toggleElementVisible = \(elementKey\) =>/)
        assert.match(source, /const currentVisible = getElementDraft\(current, elementKey\)\.visible/)
        assert.match(source, /const nextVisible = currentVisible === false/)
        assert.match(source, /onChange=\{\(\) => toggleElementVisible\(selectedElement\)\}/)
        assert.match(source, /onSaveGlobal=\{\(\) => saveConfig\('global'\)\}/)
    })

    it('debounces rapid visibility toggles using the latest draft state', function () {
        assert.match(source, /const scheduleDraftPreview = \(nextDraftOverrides, delayMs = 0\) =>/)
        assert.match(source, /window\.clearTimeout\(debounceRef\.current\)/)
        assert.match(source, /scheduleDraftPreview\(nextDraftOverrides, 180\)/)
        assert.match(source, /setDraftOverrides\(\(current\) =>/)
        assert.doesNotMatch(source, /updateElement\(selectedElement, \{ visible: checked \}/)
    })

    it('does not reload saved config when switching selected elements', function () {
        assert.match(source, /setSelectedElement\(\(currentElement\) =>/)
        assert.match(source, /if \(elements\[currentElement\]\) return currentElement/)
        assert.match(source, /}, \[selectedType, groupId, elements\]\)/)
        assert.doesNotMatch(source, /}, \[selectedType, groupId, elements, selectedElement\]\)/)
    })

    it('shows concrete default values for inherited controls when preview metadata is available', function () {
        assert.match(source, /function getDefaultFieldValue\(defaults, groupName, field\)/)
        assert.match(source, /const selectedDefaults = preview\?\.elements\?\.\[selectedElement\]\?\.defaults \|\| \{\}/)
        assert.match(source, /placeholder=\{defaultDisplay \? `默认：\$\{defaultDisplay\}` : ''\}/)
        assert.match(source, /<option value="">\{defaultDisplay \? `默认：\$\{defaultDisplay\}` : '默认'\}<\/option>/)
        assert.match(source, /defaults=\{selectedDefaults\}/)
        assert.doesNotMatch(source, /继承默认/)
    })
})
