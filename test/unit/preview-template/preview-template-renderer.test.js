'use strict'

const assert = require('assert')

const { getDefaultTemplate } = require('../../../src/services/previewTemplate/defaults')
const { renderTemplateArtifacts, renderTemplateToHtml, renderTemplateHtmlArtifact, buildStructuralElements } = require('../../../src/services/previewTemplate/renderer')
const { buildTemplateCss } = require('../../../src/services/previewTemplate/css')
const { getPreviewTemplateSignature } = require('../../../src/services/previewTemplate/signature')

describe('preview template renderer and css', function () {
    it('injects v2 node ids into legacy preview HTML and keeps legacy classes', function () {
        const template = getDefaultTemplate('video')
        const legacyHtml = `
            <div class="type-badge" data-layout-key="typeBadge"><span>视频</span></div>
            <div class="card" data-layout-key="card">
                <div class="cover-container" data-layout-key="cover"><img class="cover video" src="https://i0.hdslb.com/bfs/archive/cover.jpg"></div>
                <div class="content" data-layout-key="content">
                    <div class="header" data-layout-key="header">
                        <div class="avatar-wrapper" data-layout-key="avatar"></div>
                        <span class="user-name" data-layout-key="authorName">UP</span>
                        <span class="pub-time" data-layout-key="pubTime">刚刚</span>
                    </div>
                    <div class="title" data-layout-key="title">标题</div>
                    <div class="stats video-stats" data-layout-key="stats"></div>
                </div>
            </div>`

        const result = renderTemplateArtifacts(template, {}, 'video', { legacyHtml })

        assert.match(result.html, /class="card" data-layout-key="card" data-template-node-id="card"/)
        assert.match(result.html, /class="cover video"/)
        assert.match(result.html, /class="stats video-stats" data-layout-key="stats" data-template-node-id="stats"/)
        assert.match(result.html, /data-template-node-id="title"/)
        assert.doesNotMatch(result.html, /<script/)
        assert.match(result.css, /data-preview-template-css/)
    })

    it('inserts generic nodes by saved children order inside a legacy parent', function () {
        const template = getDefaultTemplate('video')
        template.nodesById.customSecond = {
            id: 'customSecond',
            type: 'text',
            label: '第二',
            parentId: 'content',
            visible: true,
            layout: { mode: 'flow' },
            style: {},
            binding: { source: 'static', value: 'SECOND', format: 'plainText' },
            hideWhenEmpty: false
        }
        template.nodesById.customFirst = {
            id: 'customFirst',
            type: 'tag',
            label: '第一',
            parentId: 'content',
            visible: true,
            layout: { mode: 'flow' },
            style: {},
            binding: { source: 'static', value: 'FIRST', format: 'badgeText' },
            hideWhenEmpty: false
        }
        template.childrenByParentId.content = ['header', 'customFirst', 'customSecond', 'title', 'stats', 'text']
        const legacyHtml = `
            <div class="type-badge" data-layout-key="typeBadge"><span>视频</span></div>
            <div class="card" data-layout-key="card">
                <div class="content" data-layout-key="content">
                    <div class="header" data-layout-key="header"></div>
                    <div class="title" data-layout-key="title">标题</div>
                    <div class="stats video-stats" data-layout-key="stats"></div>
                </div>
            </div>`

        const result = renderTemplateArtifacts(template, {}, 'video', { legacyHtml })

        assert.ok(result.html.indexOf('data-template-node-id="customFirst"') < result.html.indexOf('data-template-node-id="customSecond"'))
        assert.match(result.html, /FIRST/)
        assert.match(result.html, /SECOND/)
    })

    it('emits only whitelisted CSS for layout and style fields', function () {
        const template = getDefaultTemplate('video')
        template.nodesById.title.layout = {
            mode: 'absolute',
            x: 120,
            y: 64,
            width: 420,
            height: 80,
            zIndex: 20,
            aspectRatio: '4 / 3'
        }
        template.nodesById.title.style = {
            fontSize: 36,
            fontWeight: 800,
            color: '#111827',
            background: '#FFFFFF',
            radius: 12,
            shadow: 'soft',
            maxLines: 2
        }

        const css = buildTemplateCss(template, { type: 'video' })
        assert.match(css, /\[data-template-node-id="title"\]/)
        assert.match(css, /position: absolute/)
        assert.match(css, /left: 120px/)
        assert.match(css, /top: 64px/)
        assert.match(css, /z-index: 20/)
        assert.match(css, /aspect-ratio: 4 \/ 3/)
        assert.match(css, /font-size: 36px/)
        assert.match(css, /-webkit-line-clamp: 2/)
        assert.doesNotMatch(css, /url\(/)
        assert.doesNotMatch(css, /javascript:/)
        assert.doesNotMatch(css, /position: fixed/)
    })

    it('renderTemplateHtmlArtifact returns html with data-template-node-id attributes', function () {
        const template = getDefaultTemplate('video')
        const legacyHtml = `
            <div class="type-badge" data-layout-key="typeBadge"><span>视频</span></div>
            <div class="card" data-layout-key="card">
                <div class="content" data-layout-key="content">
                    <div class="title" data-layout-key="title">测试标题</div>
                </div>
            </div>`
        const result = renderTemplateHtmlArtifact(template, {}, 'video', { legacyHtml })
        assert.match(result.html, /data-template-node-id="title"/)
        assert.match(result.html, /data-template-node-id="card"/)
        assert.strictEqual(result.renderer, 'preview-template-v2')
        assert.ok(result.css)
        assert.ok(result.elements)
    })

    it('renderTemplateHtmlArtifact css does not contain script or event handlers', function () {
        const template = getDefaultTemplate('video')
        const result = renderTemplateHtmlArtifact(template, {}, 'video', {})
        assert.doesNotMatch(result.css, /<script/i)
        assert.doesNotMatch(result.css, /javascript:/i)
        assert.doesNotMatch(result.css, /on[a-z]+\s*=/i)
        assert.doesNotMatch(result.css, /url\(http/i)
    })

    it('renderTemplateHtmlArtifact html does not contain script tags or event handlers', function () {
        const template = getDefaultTemplate('video')
        const legacyHtml = `<div data-layout-key="title"><script>alert(1)</script></div>`
        const result = renderTemplateHtmlArtifact(template, {}, 'video', { legacyHtml })
        assert.doesNotMatch(result.html, /<script/i)
        assert.doesNotMatch(result.html, /onclick/i)
    })

    it('buildStructuralElements returns node catalog from template', function () {
        const template = getDefaultTemplate('video')
        const elements = buildStructuralElements(template)
        assert.ok(elements.title)
        assert.strictEqual(elements.title.type, 'text')
        assert.ok(elements.title.visible)
        assert.ok('role' in elements.title)
        assert.ok('parentId' in elements.title)
    })

    it('renderTemplateHtmlArtifact elements covers all nodes in template', function () {
        const template = getDefaultTemplate('video')
        const result = renderTemplateHtmlArtifact(template, {}, 'video', {})
        const nodeIds = Object.keys(template.nodesById)
        for (const nodeId of nodeIds) {
            assert.ok(result.elements[nodeId], `missing element: ${nodeId}`)
        }
    })

    it('omits hideWhenEmpty nodes and produces stable signatures', function () {
        const template = getDefaultTemplate('video')
        template.nodesById.text.binding = { source: 'static', value: '', fallback: '', format: 'plainText' }
        template.nodesById.text.hideWhenEmpty = true

        const result = renderTemplateToHtml(template, {}, { type: 'video' })
        assert.doesNotMatch(result.html, /data-template-node-id="text"/)

        const a = getPreviewTemplateSignature('video', template)
        const reorderedKeys = JSON.parse(JSON.stringify(template))
        reorderedKeys.nodesById.title = {
            style: reorderedKeys.nodesById.title.style,
            layout: reorderedKeys.nodesById.title.layout,
            id: reorderedKeys.nodesById.title.id,
            type: reorderedKeys.nodesById.title.type,
            role: reorderedKeys.nodesById.title.role,
            label: reorderedKeys.nodesById.title.label,
            parentId: reorderedKeys.nodesById.title.parentId,
            visible: reorderedKeys.nodesById.title.visible,
            locked: reorderedKeys.nodesById.title.locked,
            binding: reorderedKeys.nodesById.title.binding
        }
        const b = getPreviewTemplateSignature('video', reorderedKeys)
        assert.strictEqual(a, b)
    })
})
