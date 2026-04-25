#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const toolRegistry = require(path.join(__dirname, '../../src/agent/tools/registry'))
const { checkToolPermission } = require(path.join(__dirname, '../../src/agent/tools/permissionGate'))
const longTermStore = require(path.join(__dirname, '../../src/agent/memory/longTermStore'))
const agentBrowserService = require(path.join(__dirname, '../../src/services/agentBrowserService'))

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
    assert.throws(() => agentBrowserService._private.assertSafeUrl('http://localhost:3000'), /local_url_denied/)
    assert.throws(() => agentBrowserService._private.assertSafeUrl('http://127.0.0.1/test'), /private_url_denied/)
    assert.throws(() => agentBrowserService._private.assertSafeUrl('file:///etc/passwd'), /unsupported_url_protocol/)
    assert.throws(() => agentBrowserService._private.assertSafeUrl('http://user:pass@example.com'), /url_credentials_denied/)
    assert.ok(agentBrowserService._private.htmlToText('<title>T</title><script>x</script><p>Hello&nbsp;World</p>').includes('Hello World'))

    fs.rmSync(tmpDir, { recursive: true, force: true })
    console.log('✓ Agent 浏览器和自学习工具边界正常')
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
