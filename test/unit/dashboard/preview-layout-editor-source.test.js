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
    it('uses the v2 template designer dependencies and backend draftTemplate contract', function () {
        assert.match(source, /import Moveable from 'react-moveable'/)
        assert.match(source, /DndContext/)
        assert.match(source, /SortableContext/)
        assert.match(source, /draftTemplate: draft/)
        assert.match(source, /api\.post\('\/api\/preview-layout\/preview', payload\)/)
        assert.match(source, /api\.post\('\/api\/preview-layout\/template\/validate'/)
    })

    it('keeps stale preview responses and stale canvas state explicit', function () {
        assert.match(source, /lastPreviewPayloadRef\.current !== payloadKey/)
        assert.match(source, /setPreviewPayloadKey\(payloadKey\)/)
        assert.match(source, /预览更新中/)
        assert.match(source, /预览待更新/)
    })

    it('clears stale preview image and overlay when the current preview request fails', function () {
        const previewRequestIndex = source.indexOf("api.post('/api/preview-layout/preview', payload)")
        assert.ok(previewRequestIndex > -1, 'preview request should exist')
        const catchBlockStart = source.indexOf('} catch (error) {', previewRequestIndex)
        assert.ok(catchBlockStart > -1, 'preview catch block should exist')
        const catchBlock = source.slice(catchBlockStart, catchBlockStart + 360)
        assert.match(catchBlock, /setPreview\(null\)/)
        assert.match(catchBlock, /setPreviewPayloadKey\(payloadKey\)/)
        assert.match(catchBlock, /setSelectedTargetElement\(null\)/)
        assert.match(catchBlock, /setPreviewError\(getApiError\(error, '预览生成失败'\)\)/)
    })

    it('keeps apply, save, reset, history and import/export controls in the main action bar', function () {
        assert.match(source, /应用预览/)
        assert.match(source, /保存全局/)
        assert.match(source, /保存群组/)
        assert.match(source, /重置模板/)
        assert.match(source, /撤销/)
        assert.match(source, /重做/)
        assert.match(source, /导出/)
        assert.match(source, /导入/)
        const propertyPanel = source.slice(source.indexOf('<PanelHeader title="属性面板"'))
        assert.doesNotMatch(propertyPanel, /保存全局|保存群组|导入|导出/)
    })

    it('places source controls below preview gradient settings', function () {
        const gradientIndex = source.indexOf('<PreviewGradientSection')
        const sourceIndex = source.indexOf('<span className="text-xs font-semibold text-[var(--muted)]">来源</span>')
        const actionBarIndex = source.indexOf('应用预览')
        assert.ok(gradientIndex > -1, 'gradient section should exist')
        assert.ok(sourceIndex > -1, 'source controls should exist')
        assert.ok(actionBarIndex > -1, 'action bar should exist')
        assert.ok(gradientIndex < sourceIndex, 'source controls should be below gradient section')
        assert.ok(sourceIndex < actionBarIndex, 'action bar should stay below source controls')
        assert.match(source, /usePreviewGradientSettings\(show, configGenerationRef\)/)
    })

    it('only auto-refreshes preview when the current canvas is stale', function () {
        assert.match(source, /const previewOutdated = Boolean\(preview\?\.image\?\.base64 && previewPayloadKey && previewPayloadKey !== currentPreviewPayloadKey\)/)
        assert.match(source, /if \(!preview\?\.image\?\.base64 \|\| !dirty \|\| !previewOutdated\) return undefined/)
        assert.match(source, /lastPreviewPayloadRef\.current !== payloadKey/)
        assert.match(source, /window\.setTimeout\(\(\) => runPreview\(\{ silent: true \}\), 700\)/)
    })

    it('applies node edits as template draft changes and saves only through explicit actions', function () {
        assert.match(source, /const toggleVisible = \(nodeId\) =>/)
        assert.match(source, /return updateNode\(current, nodeId, \{ visible: node\.visible === false \}\)/)
        assert.match(source, /onChange=\{\(checked\) => onChange\(\{ visible: checked \}\)\}/)
        assert.match(source, /onClick=\{\(\) => saveConfig\('global'\)\}/)
        assert.match(source, /onClick=\{\(\) => saveConfig\('group'\)\}/)
        assert.match(source, /api\.post\('\/api\/preview-layout\/config'/)
        assert.doesNotMatch(source, /toggleVisible[\s\S]{0,400}api\.post\('\/api\/preview-layout\/config'/)
    })

    it('debounces draft preview refreshes and keeps history for undo and redo', function () {
        assert.match(source, /window\.clearTimeout\(debounceRef\.current\)/)
        assert.match(source, /setHistory\(\(items\) => \[\.\.\.items\.slice\(-29\), current\]\)/)
        assert.match(source, /setFuture\(\[\]\)/)
        assert.match(source, /const undo = \(\) =>/)
        assert.match(source, /const redo = \(\) =>/)
    })

    it('supports dnd-kit hierarchy changes and Moveable output-coordinate edits', function () {
        assert.match(source, /function moveNode\(template, nodeId, newParentId, overId = null\)/)
        assert.match(source, /function reorderNode\(template, activeId, overId\)/)
        assert.match(source, /while \(cursor\)/)
        assert.match(source, /pushTemplate\(\(current\) => reorderNode\(current, active\.id, over\.id\)\)/)
        assert.doesNotMatch(source, /draggable=\{node\.id !== 'root' && !node\.locked\}/)
        assert.doesNotMatch(source, /onDrop=\{/)
        assert.doesNotMatch(source, /onDragStart=\{.*onTreeDragStart/)
        assert.doesNotMatch(source, /onPointerUpCapture=\{onTreePointerUp\}/)
        assert.match(source, /const \[selectedTargetElement, setSelectedTargetElement\] = useState\(null\)/)
        assert.match(source, /ref=\{id === selectedId \? setSelectedTargetRef : null\}/)
        assert.match(source, /const overlayWidth = overlayRef\.current\?\.getBoundingClientRect\(\)\.width/)
        assert.match(source, /beforeTranslate\[0\] \/ scale/)
        assert.match(source, /applyVisualDeltaToLayout\(node, delta\)/)
        assert.match(source, /applyVisualSizeToLayout\(node, meta, \{ width, height \}\)/)
    })

    it('duplicates container nodes by cloning descendants instead of sharing child ids', function () {
        assert.match(source, /function cloneSubtree\(template, sourceId, parentId, componentType\)/)
        assert.match(source, /childClone = cloneSubtree/)
        assert.match(source, /Object\.assign\(next\.nodesById, cloned\.nodesById\)/)
        assert.match(source, /Object\.assign\(next\.childrenByParentId, cloned\.childrenByParentId\)/)
        assert.doesNotMatch(source, /childrenByParentId\[selectedNode\.id\][\s\S]{0,120}childrenByParentId\[id\]/)
    })

    it('renders overlay boxes from backend template metadata and exposes component palette entries', function () {
        assert.match(source, /Object\.entries\(preview\.elements \|\| \{\}\)\.map/)
        assert.match(source, /meta\.box/)
        assert.match(source, /data-node-id=\{id\}/)
        assert.match(source, /componentRegistry/)
        assert.match(source, /addComponent\(current, key, componentRegistry, selectedId, schema, selectedType\)/)
        assert.match(source, /节点树/)
        assert.match(source, /组件库/)
        assert.match(source, /图层/)
    })

    it('uses LivePreviewCanvas as primary canvas when htmlArtifact is available', function () {
        assert.match(source, /import LivePreviewCanvas from/)
        assert.match(source, /preview\?\.htmlArtifact/)
        assert.match(source, /<LivePreviewCanvas/)
        assert.match(source, /onNodeDragEnd=/)
        assert.match(source, /onNodeResizeEnd=/)
        assert.match(source, /artifactMode: 'image\+html'/)
    })

    it('live canvas drag/resize writes back via applyVisualDeltaToLayout and applyVisualSizeToLayout', function () {
        const liveCanvasStart = source.indexOf('<LivePreviewCanvas')
        assert.ok(liveCanvasStart > -1, 'LivePreviewCanvas should exist')
        const liveCanvasBlock = source.slice(liveCanvasStart, liveCanvasStart + 1500)
        assert.match(liveCanvasBlock, /applyVisualDeltaToLayout\(node, delta\)/)
        assert.match(liveCanvasBlock, /applyVisualSizeToLayout\(node, meta, size\)/)
        assert.doesNotMatch(liveCanvasBlock, /setSelectedTargetRef/)
    })
})
