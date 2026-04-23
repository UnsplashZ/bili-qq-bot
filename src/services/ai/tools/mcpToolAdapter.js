'use strict'

const {
    TOOL_SOURCES,
    TOOL_RISK_CLASSES,
    TOOL_SCOPE_POLICIES,
    TOOL_CONFIRM_POLICIES
} = require('./registry')

function createMcpToolAdapter({ mcpManager }) {
    if (!mcpManager || typeof mcpManager.getOpenAITools !== 'function' || typeof mcpManager.executeTool !== 'function') {
        throw new Error('createMcpToolAdapter requires an mcpManager with getOpenAITools() and executeTool()')
    }

    const openAITools = mcpManager.getOpenAITools()
    return (Array.isArray(openAITools) ? openAITools : []).map(toolDefinition => {
        const functionDefinition = toolDefinition?.function || {}
        return {
            name: String(functionDefinition.name || '').trim(),
            description: String(functionDefinition.description || '').trim() || 'MCP tool',
            source: TOOL_SOURCES.MCP,
            riskClass: TOOL_RISK_CLASSES.PUBLIC_READ,
            scopePolicy: TOOL_SCOPE_POLICIES.CURRENT_GROUP,
            confirmPolicy: TOOL_CONFIRM_POLICIES.NEVER,
            inputSchema: functionDefinition.parameters && typeof functionDefinition.parameters === 'object'
                ? functionDefinition.parameters
                : { type: 'object', properties: {}, additionalProperties: true },
            execute: (input, execution = {}) => mcpManager.executeTool(
                functionDefinition.name,
                input,
                execution.requestOptions || {}
            )
        }
    }).filter(tool => tool.name)
}

module.exports = {
    createMcpToolAdapter
}
