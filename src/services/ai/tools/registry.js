'use strict'

const { filterVisibleTools } = require('./toolPolicy')

const TOOL_SOURCES = Object.freeze({
    LOCAL: 'local',
    MCP: 'mcp'
})

const TOOL_RISK_CLASSES = Object.freeze({
    PUBLIC_READ: 'public_read',
    ADMIN_READ: 'admin_read',
    ADMIN_WRITE: 'admin_write',
    ROOT_PRIVATE_ONLY: 'root_private_only'
})

const TOOL_SCOPE_POLICIES = Object.freeze({
    CURRENT_GROUP: 'current_group',
    ROOT_PRIVATE: 'root_private'
})

const TOOL_CONFIRM_POLICIES = Object.freeze({
    NEVER: 'never',
    GROUP_MUTATION: 'group_mutation',
    ROOT_SENSITIVE: 'root_sensitive'
})

function validateToolDefinition(tool) {
    if (!tool || typeof tool !== 'object') {
        throw new Error('AI tool definition must be an object')
    }

    const requiredStringFields = ['name', 'description', 'source', 'riskClass', 'scopePolicy', 'confirmPolicy']
    for (const field of requiredStringFields) {
        if (!String(tool[field] || '').trim()) {
            throw new Error(`AI tool definition requires ${field}`)
        }
    }

    if (!tool.inputSchema || typeof tool.inputSchema !== 'object' || Array.isArray(tool.inputSchema)) {
        throw new Error(`AI tool ${tool.name} requires an inputSchema object`)
    }

    if (typeof tool.execute !== 'function') {
        throw new Error(`AI tool ${tool.name} requires execute()`)
    }
}

function toOpenAIToolDefinition(tool) {
    return {
        type: 'function',
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema
        }
    }
}

class AIToolRegistry {
    constructor({ toolPolicy } = {}) {
        this.toolPolicy = toolPolicy || { filterVisibleTools }
        this.tools = new Map()
    }

    registerTool(tool) {
        validateToolDefinition(tool)

        if (this.tools.has(tool.name)) {
            throw new Error(`AI tool already registered: ${tool.name}`)
        }

        this.tools.set(tool.name, Object.freeze({ ...tool }))
        return this
    }

    registerTools(tools) {
        for (const tool of Array.isArray(tools) ? tools : []) {
            this.registerTool(tool)
        }
        return this
    }

    getTool(name) {
        return this.tools.get(String(name || '').trim()) || null
    }

    getTools() {
        return Array.from(this.tools.values())
    }

    listToolsForContext(context = {}) {
        return this.toolPolicy.filterVisibleTools(this.getTools(), context)
    }

    getOpenAITools(context = {}) {
        return this.listToolsForContext(context).map(toOpenAIToolDefinition)
    }

    async executeTool(name, input = {}, context = {}, requestOptions = {}) {
        const tool = this.getTool(name)
        if (!tool) {
            throw new Error(`AI tool not found: ${name}`)
        }

        const visibleToolNames = new Set(this.listToolsForContext(context).map(visibleTool => visibleTool.name))
        if (!visibleToolNames.has(tool.name)) {
            throw new Error(`AI tool not allowed in current context: ${name}`)
        }

        return tool.execute(input, {
            tool,
            context,
            requestOptions
        })
    }
}

module.exports = {
    AIToolRegistry,
    TOOL_SOURCES,
    TOOL_RISK_CLASSES,
    TOOL_SCOPE_POLICIES,
    TOOL_CONFIRM_POLICIES,
    toOpenAIToolDefinition,
    validateToolDefinition
}
