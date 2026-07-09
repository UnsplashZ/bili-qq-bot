#!/usr/bin/env node
'use strict'

const assert = require('assert')

const qqRuntime = require('../../../src/providers/qq/runtime')
const toolRegistry = require('../../../src/agent/tools/registry')

describe('agent provider capability gate', () => {
    afterEach(() => {
        qqRuntime.clearCurrentProvider()
    })

    it('hides NapCat-only qq tools under Official provider', () => {
        qqRuntime.setCurrentProvider({ id: 'official', readyState: 1 })
        const names = toolRegistry.listToolDefinitions().map((tool) => tool.name)
        assert.ok(!names.includes('qq.mute_member'))
        assert.ok(!names.includes('qq.set_online_status'))
        assert.ok(!names.includes('browser.screenshot_url'))
        assert.ok(names.includes('qq.delete_message'))
        assert.ok(names.includes('subscription.list'))
    })

    it('rejects unsupported qq tool execution under Official provider', async () => {
        qqRuntime.setCurrentProvider({ id: 'official', readyState: 1 })
        await assert.rejects(
            () => toolRegistry.executeToolPlan({ name: 'qq.mute_member', args: {}, timeoutMs: 1 }),
            /unsupported_provider_tool:qq\.mute_member/
        )
    })
})
