#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const toolRegistry = require(path.join(__dirname, '../../../src/agent/tools/registry'))
const { checkToolPermission } = require(path.join(__dirname, '../../../src/agent/tools/permissionGate'))
const longTermStore = require(path.join(__dirname, '../../../src/agent/memory/longTermStore'))
const agentBrowserService = require(path.join(__dirname, '../../../src/services/agentBrowserService'))
const agentWebSearchService = require(path.join(__dirname, '../../../src/services/agentWebSearchService'))
const agentScreenshotService = require(path.join(__dirname, '../../../src/services/agentScreenshotService'))
const { formatToolError } = require(path.join(__dirname, '../../../src/agent/tools/toolPlanProcessor'))

async function run() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-memory-tool-'))
    const memoryFile = path.join(tmpDir, 'memories.json')
    longTermStore.resetForTest(memoryFile)

    const actor = { userId: '42', groupId: '1000', isRoot: false, qqRole: 'member' }
    const learnPlan = toolRegistry.normalizeToolIntent({
        name: 'agent.learn_memory',
        arguments: {
            groupId: '1000',
            scope: 'group',
            type: 'fact',
            content: '测试群默认用简洁风格回复',
            confidence: 0.8
        }
    }, { groupId: '1000' })
    assert.strictEqual(checkToolPermission({ plan: learnPlan, actor }).allowed, true)
    const learnResult = await toolRegistry.executeToolPlan(learnPlan, {
        groupId: '1000',
        userId: '42',
        actor,
        agentMessage: { id: 'msg-learn-1' }
    })
    assert.ok(learnResult.message.includes('已学习'))
    const memories = await longTermStore.listMemories({ groupId: '1000', limit: 5 })
    assert.ok(memories.some(memory => memory.content.includes('简洁风格')))

    const browserPlan = toolRegistry.normalizeToolIntent({
        name: 'browser.read_url',
        arguments: { groupId: '1000', url: 'https://example.com', maxChars: 500 }
    }, { groupId: '1000' })
    assert.strictEqual(checkToolPermission({ plan: browserPlan, actor }).allowed, true)
    assert.strictEqual(browserPlan.timeoutMs, 40000)
    assert.throws(() => agentBrowserService._private.assertSafeUrl('http://localhost:3000'), /local_url_denied/)
    assert.throws(() => agentBrowserService._private.assertSafeUrl('http://127.0.0.1/test'), /private_url_denied/)
    assert.throws(() => agentBrowserService._private.assertSafeUrl('file:///etc/passwd'), /unsupported_url_protocol/)
    assert.throws(() => agentBrowserService._private.assertSafeUrl('http://user:pass@example.com'), /url_credentials_denied/)
    assert.ok(agentBrowserService._private.htmlToText('<title>T</title><script>x</script><p>Hello&nbsp;World</p>').includes('Hello World'))
    assert.strictEqual(agentBrowserService._private.extractMetaDescription('<meta name="description" content="页面描述">'), '页面描述')
    const browserHeaders = agentBrowserService._private.buildBrowserLikeHeaders(new URL('https://example.com/path'))
    assert.ok(browserHeaders['user-agent'].includes('Mozilla/5.0'))
    assert.ok(browserHeaders.accept.includes('text/html'))
    assert.strictEqual(browserHeaders.referer, 'https://example.com/')
    const blockedQuality = agentBrowserService._private.assessContentQuality({
        status: 403,
        contentType: 'text/html',
        text: 'Forbidden',
        html: '<html>Forbidden</html>'
    })
    assert.strictEqual(blockedQuality.usable, false)
    assert.strictEqual(blockedQuality.shouldFallback, true)
    const spaQuality = agentBrowserService._private.assessContentQuality({
        status: 200,
        contentType: 'text/html',
        text: 'Loading',
        html: '<div id="app"></div><script></script><script></script><script></script>'
    })
    assert.strictEqual(spaQuality.usable, false)
    assert.strictEqual(spaQuality.reason, 'spa_shell_or_low_text')
    const normalQuality = agentBrowserService._private.assessContentQuality({
        status: 200,
        contentType: 'text/html',
        text: '这是可用正文。'.repeat(80),
        html: '<article>这是可用正文。</article>'
    })
    assert.strictEqual(normalQuality.usable, true)

    const searchPlan = toolRegistry.normalizeToolIntent({
        name: 'browser.search_web',
        arguments: { groupId: '1000', query: 'runtime v2 agent', maxResults: 3 }
    }, { groupId: '1000' })
    assert.strictEqual(checkToolPermission({ plan: searchPlan, actor }).allowed, true)
    assert.strictEqual(searchPlan.args.maxResults, 3)
    const parsedResults = agentWebSearchService._private.parseSearchResults(`
        <div class="result">
          <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fdoc">Example &amp; Doc</a>
          <a class="result__snippet">A short &lt;b&gt;snippet&lt;/b&gt;</a>
        </div>
    `)
    assert.strictEqual(parsedResults.length, 1)
    assert.strictEqual(parsedResults[0].url, 'https://example.com/doc')
    assert.strictEqual(parsedResults[0].title, 'Example & Doc')
    assert.ok(parsedResults[0].snippet.includes('snippet'))

    const screenshotPlan = toolRegistry.normalizeToolIntent({
        name: 'browser.screenshot_url',
        arguments: { groupId: '1000', url: 'https://example.com', viewportWidth: 1600, viewportHeight: 1200 }
    }, { groupId: '1000' })
    assert.strictEqual(checkToolPermission({ plan: screenshotPlan, actor }).allowed, true)
    assert.strictEqual(screenshotPlan.args.viewportWidth, 1600)
    assert.strictEqual(screenshotPlan.args.viewportHeight, 1200)
    assert.strictEqual(typeof agentScreenshotService._private.chromiumExecutable(), 'string')
    assert.strictEqual(agentScreenshotService._private.isBlankScreenshot({
        renderState: { bodyTextLength: 0, imageCount: 0, hasCanvas: false, hasVideo: false, hasSvg: true },
        bytes: 4000
    }), true)
    assert.strictEqual(agentScreenshotService._private.isBlankScreenshot({
        renderState: { bodyTextLength: 120, imageCount: 0, hasCanvas: false, hasVideo: false },
        bytes: 4000
    }), false)
    assert.strictEqual(agentScreenshotService._private.isBlockedScreenshot({
        bodyText: '请求存在异常，请进行安全验证',
        bodyHtml: '<html><body>请求存在异常</body></html>'
    }), true)
    assert.strictEqual(agentScreenshotService._private.isBlockedScreenshot({
        bodyText: '这是正常网页正文。'.repeat(20),
        bodyHtml: '<article>正常内容</article>'
    }), false)
    assert.ok(formatToolError('screenshot_failed:screenshot_access_blocked').includes('安全验证拦截'))
    assert.throws(() => toolRegistry.normalizeToolIntent({
        name: 'browser.screenshot_url',
        arguments: { groupId: '1000', url: '' }
    }, { groupId: '1000' }), /missing_url/)

    fs.rmSync(tmpDir, { recursive: true, force: true })
    console.log('✓ Agent 浏览器和自学习工具边界正常')
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
