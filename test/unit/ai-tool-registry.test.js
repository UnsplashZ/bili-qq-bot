#!/usr/bin/env node
'use strict'

const assert = require('assert')
const {
    AIToolRegistry,
    TOOL_SOURCES,
    TOOL_RISK_CLASSES,
    TOOL_SCOPE_POLICIES,
    TOOL_CONFIRM_POLICIES
} = require('../../src/services/ai/tools/registry')
const { createMcpToolAdapter } = require('../../src/services/ai/tools/mcpToolAdapter')

async function testRegistryListsAndExecutesAcrossSources() {
    const registry = new AIToolRegistry()
    const executed = []

    registry.registerTool({
        name: 'local.echo',
        description: 'Local echo tool',
        source: TOOL_SOURCES.LOCAL,
        riskClass: TOOL_RISK_CLASSES.PUBLIC_READ,
        scopePolicy: TOOL_SCOPE_POLICIES.CURRENT_GROUP,
        confirmPolicy: TOOL_CONFIRM_POLICIES.NEVER,
        inputSchema: {
            type: 'object',
            properties: {
                text: { type: 'string' }
            },
            additionalProperties: false
        },
        execute: async (input, execution) => {
            executed.push({
                name: 'local.echo',
                input,
                context: execution.context,
                requestOptions: execution.requestOptions
            })
            return { ok: true, source: 'local', text: input.text }
        }
    })

    registry.registerTools(createMcpToolAdapter({
        mcpManager: {
            getOpenAITools: () => [{
                type: 'function',
                function: {
                    name: 'mcp.lookup',
                    description: 'Lookup through MCP',
                    parameters: {
                        type: 'object',
                        properties: {
                            q: { type: 'string' }
                        },
                        required: ['q'],
                        additionalProperties: false
                    }
                }
            }],
            executeTool: async (name, args, requestOptions = {}) => {
                executed.push({ name, input: args, requestOptions })
                return `mcp:${name}:${args.q}:${requestOptions.timeout}`
            }
        }
    }))

    assert.deepStrictEqual(
        registry.getTools().map(tool => [tool.name, tool.source]),
        [
            ['local.echo', 'local'],
            ['mcp.lookup', 'mcp']
        ]
    )

    assert.deepStrictEqual(
        registry.getOpenAITools({ allowLocalTools: false }).map(tool => tool.function.name),
        ['mcp.lookup']
    )

    assert.deepStrictEqual(
        registry.getOpenAITools({ allowMcpTools: false }).map(tool => tool.function.name),
        ['local.echo']
    )

    const localResult = await registry.executeTool('local.echo', { text: 'hello' }, { traceId: 'trace-1' }, { timeout: 123 })
    const mcpResult = await registry.executeTool('mcp.lookup', { q: 'world' }, { traceId: 'trace-2', allowLocalTools: false }, { timeout: 456 })

    assert.deepStrictEqual(localResult, { ok: true, source: 'local', text: 'hello' })
    assert.strictEqual(mcpResult, 'mcp:mcp.lookup:world:456')
    assert.deepStrictEqual(executed[0], {
        name: 'local.echo',
        input: { text: 'hello' },
        context: { traceId: 'trace-1' },
        requestOptions: { timeout: 123 }
    })
    assert.deepStrictEqual(executed[1], {
        name: 'mcp.lookup',
        input: { q: 'world' },
        requestOptions: { timeout: 456 }
    })
}

async function testRegistryRejectsDuplicateToolNames() {
    const registry = new AIToolRegistry()
    const tool = {
        name: 'duplicate.tool',
        description: 'test',
        source: TOOL_SOURCES.LOCAL,
        riskClass: TOOL_RISK_CLASSES.PUBLIC_READ,
        scopePolicy: TOOL_SCOPE_POLICIES.CURRENT_GROUP,
        confirmPolicy: TOOL_CONFIRM_POLICIES.NEVER,
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        execute: async () => 'ok'
    }

    registry.registerTool(tool)
    assert.throws(() => registry.registerTool(tool), /already registered/)
}

async function testRegistryBlocksHiddenToolsFromExecution() {
    const registry = new AIToolRegistry()
    registry.registerTool({
        name: 'local.hidden',
        description: 'Hidden local tool',
        source: TOOL_SOURCES.LOCAL,
        riskClass: TOOL_RISK_CLASSES.ADMIN_WRITE,
        scopePolicy: TOOL_SCOPE_POLICIES.CURRENT_GROUP,
        confirmPolicy: TOOL_CONFIRM_POLICIES.GROUP_MUTATION,
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        execute: async () => 'should not run'
    })

    await assert.rejects(
        () => registry.executeTool('local.hidden', {}, { allowLocalTools: false }),
        /not allowed in current context/
    )
}

async function run() {
    await testRegistryListsAndExecutesAcrossSources()
    await testRegistryRejectsDuplicateToolNames()
    await testRegistryBlocksHiddenToolsFromExecution()
    console.log('✓ unified AI tool registry can register, filter, and execute local + MCP tools')
}

run().then(() => process.exit(0)).catch(error => {
    console.error(error)
    process.exit(1)
})
