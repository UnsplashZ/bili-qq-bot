#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { renderArticleContent } = require('../../src/services/imageGenerator/renderers/article')
const { replaceEmojiTokensInHtml } = require('../../src/services/imageGenerator/renderers/components/articleHtmlEmoji')
const { EmojiIndexProvider } = require('../../src/services/imageGenerator/renderers/components/emojiIndexProvider')
const { createRenderEmojiContext } = require('../../src/services/imageGenerator/renderers/components/renderEmojiContext')

async function buildContext() {
    return createRenderEmojiContext({
        provider: new EmojiIndexProvider({
            loader: async () => [{
                rawText: '[星星眼]',
                iconUrl: 'https://i0.hdslb.com/bfs/emote/63c9d1a31c0da745b61cdb35e0ecb28635675db2.png'
            }],
            ttlMs: 60_000
        })
    })
}

async function testArticleHtmlOnlyReplacesTextNodes() {
    const emojiContext = await buildContext()
    const html = replaceEmojiTokensInHtml(
        '<p>正文[星星眼]</p><img src="https://example.com/[星星眼].png"><script>var x = "[星星眼]"</script>',
        emojiContext
    )

    assert.ok(html.includes('<p>正文<img class="emoji"'), '正文文本节点内的官方表情应被替换')
    assert.ok(html.includes('src="https://example.com/[星星眼].png"'), '标签属性不应被错误替换')
    assert.ok(html.includes('<script>var x = "[星星眼]"</script>'), 'script 内容不应被错误替换')
}

async function testArticleRendererSupportsHtmlContentEmojiReplacement() {
    const emojiContext = await buildContext()
    const html = renderArticleContent({
        data: {
            author_face: 'https://i0.hdslb.com/bfs/face/member/noface.jpg',
            author_name: 'tester',
            title: '专栏标题',
            html_content: '<p>专栏正文[星星眼]</p>',
            publish_time: 1700000000,
            stats: {}
        }
    }, emojiContext)

    assert.ok(html.includes('<img class="emoji"'), 'article html_content 应支持文本节点级官方表情替换')
}

async function testArticleHtmlDoesNotReplaceEmojiInsideCodeLikeTags() {
    const emojiContext = await buildContext()
    const html = replaceEmojiTokensInHtml(
        '<pre>[星星眼]</pre><code>[星星眼]</code><p>[星星眼]</p>',
        emojiContext
    )

    assert.ok(html.includes('<pre>[星星眼]</pre>'), 'pre 内文本不应被替换')
    assert.ok(html.includes('<code>[星星眼]</code>'), 'code 内文本不应被替换')
    assert.ok(html.includes('<p><img class="emoji"'), '普通正文中的官方表情仍应替换')
}

async function testArticleHtmlKeepsNestedBlockedTagContentUntouched() {
    const emojiContext = await buildContext()
    const html = replaceEmojiTokensInHtml(
        '<pre><code>[星星眼]</code>尾部[星星眼]</pre><p>[星星眼]</p>',
        emojiContext
    )

    assert.ok(
        html.includes('<pre><code>[星星眼]</code>尾部[星星眼]</pre>'),
        '嵌套 block tag 内的后续文本也不应被替换'
    )
    assert.ok(html.includes('<p><img class="emoji"'), '离开 block tag 后正文仍应替换')
}

async function run() {
    await testArticleHtmlOnlyReplacesTextNodes()
    await testArticleRendererSupportsHtmlContentEmojiReplacement()
    await testArticleHtmlDoesNotReplaceEmojiInsideCodeLikeTags()
    await testArticleHtmlKeepsNestedBlockedTagContentUntouched()
    console.log('PASS article-html-emoji')
}

run().catch(error => {
    console.error(error)
    process.exit(1)
})
