#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')

const { listToolDefinitions } = require(path.join(__dirname, '../../src/agent/tools/registry'))
const {
    buildSpecialistContext,
    getSpecialistForTool,
    selectSpecialists
} = require(path.join(__dirname, '../../src/agent/specialists/specialistRouter'))

function run() {
    const allTools = listToolDefinitions()

    const biliSpecialists = selectSpecialists({
        agentMessage: { normalizedText: '小助手，订阅 uid 2 并查一下 BV1xx411c7mD' }
    })
    assert.strictEqual(biliSpecialists[0].id, 'bili_agent')

    const biliContext = buildSpecialistContext({
        agentMessage: { normalizedText: '小助手，订阅 uid 2' },
        toolDefinitions: allTools
    })
    assert.strictEqual(biliContext.mode, 'specialist_scoped')
    assert.ok(biliContext.availableTools.length < allTools.length)
    assert.ok(biliContext.availableTools.some((tool) => tool.name === 'subscription.add_user'))
    assert.ok(!biliContext.availableTools.some((tool) => tool.name === 'qq.mute_member'))

    const qqContext = buildSpecialistContext({
        agentMessage: { normalizedText: '小助手，把这个人禁言 60 秒，然后看看本群配置' },
        toolDefinitions: allTools
    })
    assert.ok(qqContext.selectedSpecialists.some((specialist) => specialist.id === 'qq_admin_agent'))
    assert.ok(qqContext.availableTools.some((tool) => tool.name === 'qq.mute_member'))
    assert.ok(qqContext.availableTools.some((tool) => tool.name === 'agent.get_group_config'))

    const memoryContext = buildSpecialistContext({
        agentMessage: { normalizedText: '小助手，记住楠哥喜欢蔚蓝档案' },
        toolDefinitions: allTools
    })
    assert.ok(memoryContext.availableTools.some((tool) => tool.name === 'agent.learn_memory'))
    assert.ok(!memoryContext.availableTools.some((tool) => tool.name === 'browser.read_url'))

    const browserContext = buildSpecialistContext({
        agentMessage: { normalizedText: '小助手，读一下 https://example.com 这个网页' },
        toolDefinitions: allTools
    })
    assert.ok(browserContext.availableTools.some((tool) => tool.name === 'browser.read_url'))
    assert.ok(browserContext.availableTools.some((tool) => tool.name === 'browser.search_web'))

    assert.strictEqual(getSpecialistForTool('qq.delete_message').id, 'qq_admin_agent')
    assert.strictEqual(getSpecialistForTool('browser.read_url').id, 'browser_agent')
    assert.strictEqual(getSpecialistForTool('browser.search_web').id, 'browser_agent')
    assert.strictEqual(getSpecialistForTool('browser.screenshot_url').id, 'browser_agent')

    console.log('✓ Agent specialist 路由和工具裁剪正常')
}

try {
    run()
    process.exit(0)
} catch (error) {
    console.error(error)
    process.exit(1)
}
