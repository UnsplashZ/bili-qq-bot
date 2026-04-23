#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { createLocalToolAdapter } = require('../../src/services/ai/tools/localToolAdapter')

async function testLocalToolAdapterMapsExplicitToolNamesToBotControlRuntime() {
    const calls = []
    const tools = createLocalToolAdapter({
        botControlRuntime: {
            async read(action, input, context) {
                calls.push({ type: 'read', action, input, context })
                return { ok: true, action, input, context }
            },
            async write(action, input, context) {
                calls.push({ type: 'write', action, input, context })
                return { ok: true, action, input, context }
            }
        }
    })

    assert.deepStrictEqual(
        tools.map(tool => tool.name),
        [
            'subscription.search_user',
            'subscription.list_current_group',
            'subscription.add_user',
            'subscription.remove_user',
            'context.reset_current_group',
            'config.get_ai_status',
            'config.set_ai_enabled',
            'config.set_rag_enabled',
            'runtime.get_status'
        ]
    )

    const executionContext = { context: { groupId: '1000', actorUserId: '2000' } }

    await tools.find(tool => tool.name === 'subscription.search_user').execute({ query: '测试UP', limit: 3 }, executionContext)
    await tools.find(tool => tool.name === 'subscription.list_current_group').execute({}, executionContext)
    await tools.find(tool => tool.name === 'subscription.add_user').execute({ uid: '42', confirmationId: 'c-1' }, executionContext)
    await tools.find(tool => tool.name === 'subscription.remove_user').execute({ uid: '84' }, executionContext)
    await tools.find(tool => tool.name === 'context.reset_current_group').execute({ confirmationId: 'c-2' }, executionContext)
    await tools.find(tool => tool.name === 'config.get_ai_status').execute({}, executionContext)
    await tools.find(tool => tool.name === 'config.set_ai_enabled').execute({ enabled: true, confirmationId: 'c-3' }, executionContext)
    await tools.find(tool => tool.name === 'config.set_rag_enabled').execute({ enabled: false }, executionContext)
    await tools.find(tool => tool.name === 'runtime.get_status').execute({}, executionContext)

    assert.deepStrictEqual(calls, [
        {
            type: 'read',
            action: 'subscription.read',
            input: { operation: 'search_user', query: '测试UP', limit: 3 },
            context: { groupId: '1000', actorUserId: '2000' }
        },
        {
            type: 'read',
            action: 'subscription.read',
            input: {},
            context: { groupId: '1000', actorUserId: '2000' }
        },
        {
            type: 'write',
            action: 'subscription.write',
            input: { operation: 'add_user', uid: '42', confirmationId: 'c-1' },
            context: { groupId: '1000', actorUserId: '2000' }
        },
        {
            type: 'write',
            action: 'subscription.write',
            input: { operation: 'remove_user', uid: '84', confirmationId: undefined },
            context: { groupId: '1000', actorUserId: '2000' }
        },
        {
            type: 'write',
            action: 'context.write',
            input: { operation: 'reset', confirmationId: 'c-2' },
            context: { groupId: '1000', actorUserId: '2000' }
        },
        {
            type: 'read',
            action: 'config.read',
            input: {},
            context: { groupId: '1000', actorUserId: '2000' }
        },
        {
            type: 'write',
            action: 'config.write',
            input: { aiEnabled: true, confirmationId: 'c-3' },
            context: { groupId: '1000', actorUserId: '2000' }
        },
        {
            type: 'write',
            action: 'config.write',
            input: { aiRagEnabled: false, confirmationId: undefined },
            context: { groupId: '1000', actorUserId: '2000' }
        },
        {
            type: 'read',
            action: 'runtime.read',
            input: {},
            context: { groupId: '1000', actorUserId: '2000' }
        }
    ])

    const addUserTool = tools.find(tool => tool.name === 'subscription.add_user')
    assert.strictEqual(addUserTool.source, 'local')
    assert.strictEqual(addUserTool.riskClass, 'admin_write')
    assert.strictEqual(addUserTool.confirmPolicy, 'group_mutation')
}

async function run() {
    await testLocalToolAdapterMapsExplicitToolNamesToBotControlRuntime()
    console.log('✓ local tool adapter exposes explicit bot-control tools with unified metadata')
}

run().then(() => process.exit(0)).catch(error => {
    console.error(error)
    process.exit(1)
})
