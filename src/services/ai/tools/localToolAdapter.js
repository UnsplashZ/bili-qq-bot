'use strict'

const {
    TOOL_SOURCES,
    TOOL_RISK_CLASSES,
    TOOL_SCOPE_POLICIES,
    TOOL_CONFIRM_POLICIES
} = require('./registry')

function buildObjectSchema(properties, required = []) {
    return {
        type: 'object',
        properties,
        required,
        additionalProperties: false
    }
}

function createLocalToolAdapter({ botControlRuntime }) {
    if (!botControlRuntime || typeof botControlRuntime.read !== 'function' || typeof botControlRuntime.write !== 'function') {
        throw new Error('createLocalToolAdapter requires a botControlRuntime with read() and write()')
    }

    return [
        {
            name: 'subscription.search_user',
            description: 'Search Bilibili users to inspect subscription candidates for the current group.',
            source: TOOL_SOURCES.LOCAL,
            riskClass: TOOL_RISK_CLASSES.ADMIN_READ,
            scopePolicy: TOOL_SCOPE_POLICIES.CURRENT_GROUP,
            confirmPolicy: TOOL_CONFIRM_POLICIES.NEVER,
            inputSchema: buildObjectSchema({
                query: { type: 'string', description: 'Bilibili user keyword to search.' },
                limit: { type: 'integer', minimum: 1, maximum: 10, description: 'Maximum candidates to return.' }
            }, ['query']),
            execute: (input, execution) => botControlRuntime.read('subscription.read', {
                operation: 'search_user',
                query: input?.query,
                limit: input?.limit
            }, execution?.context)
        },
        {
            name: 'subscription.list_current_group',
            description: 'List current group Bilibili subscriptions.',
            source: TOOL_SOURCES.LOCAL,
            riskClass: TOOL_RISK_CLASSES.ADMIN_READ,
            scopePolicy: TOOL_SCOPE_POLICIES.CURRENT_GROUP,
            confirmPolicy: TOOL_CONFIRM_POLICIES.NEVER,
            inputSchema: buildObjectSchema({}),
            execute: (_input, execution) => botControlRuntime.read('subscription.read', {}, execution?.context)
        },
        {
            name: 'subscription.add_user',
            description: 'Add a Bilibili user subscription to the current group.',
            source: TOOL_SOURCES.LOCAL,
            riskClass: TOOL_RISK_CLASSES.ADMIN_WRITE,
            scopePolicy: TOOL_SCOPE_POLICIES.CURRENT_GROUP,
            confirmPolicy: TOOL_CONFIRM_POLICIES.GROUP_MUTATION,
            inputSchema: buildObjectSchema({
                uid: { type: 'string', description: 'Exact Bilibili UID to subscribe.' },
                confirmationId: { type: 'string', description: 'Pending confirmation ID when confirming the change.' }
            }, ['uid']),
            execute: (input, execution) => botControlRuntime.write('subscription.write', {
                operation: 'add_user',
                uid: input?.uid,
                confirmationId: input?.confirmationId
            }, execution?.context)
        },
        {
            name: 'subscription.remove_user',
            description: 'Remove a Bilibili user subscription from the current group.',
            source: TOOL_SOURCES.LOCAL,
            riskClass: TOOL_RISK_CLASSES.ADMIN_WRITE,
            scopePolicy: TOOL_SCOPE_POLICIES.CURRENT_GROUP,
            confirmPolicy: TOOL_CONFIRM_POLICIES.GROUP_MUTATION,
            inputSchema: buildObjectSchema({
                uid: { type: 'string', description: 'Exact Bilibili UID to remove.' },
                confirmationId: { type: 'string', description: 'Pending confirmation ID when confirming the change.' }
            }, ['uid']),
            execute: (input, execution) => botControlRuntime.write('subscription.write', {
                operation: 'remove_user',
                uid: input?.uid,
                confirmationId: input?.confirmationId
            }, execution?.context)
        },
        {
            name: 'context.reset_current_group',
            description: 'Reset the current group AI conversation context.',
            source: TOOL_SOURCES.LOCAL,
            riskClass: TOOL_RISK_CLASSES.ADMIN_WRITE,
            scopePolicy: TOOL_SCOPE_POLICIES.CURRENT_GROUP,
            confirmPolicy: TOOL_CONFIRM_POLICIES.GROUP_MUTATION,
            inputSchema: buildObjectSchema({
                confirmationId: { type: 'string', description: 'Pending confirmation ID when confirming the reset.' }
            }),
            execute: (input, execution) => botControlRuntime.write('context.write', {
                operation: 'reset',
                confirmationId: input?.confirmationId
            }, execution?.context)
        },
        {
            name: 'config.get_ai_status',
            description: 'Read AI configuration for the current group.',
            source: TOOL_SOURCES.LOCAL,
            riskClass: TOOL_RISK_CLASSES.ADMIN_READ,
            scopePolicy: TOOL_SCOPE_POLICIES.CURRENT_GROUP,
            confirmPolicy: TOOL_CONFIRM_POLICIES.NEVER,
            inputSchema: buildObjectSchema({}),
            execute: (_input, execution) => botControlRuntime.read('config.read', {}, execution?.context)
        },
        {
            name: 'config.set_ai_enabled',
            description: 'Enable or disable AI replies for the current group.',
            source: TOOL_SOURCES.LOCAL,
            riskClass: TOOL_RISK_CLASSES.ADMIN_WRITE,
            scopePolicy: TOOL_SCOPE_POLICIES.CURRENT_GROUP,
            confirmPolicy: TOOL_CONFIRM_POLICIES.GROUP_MUTATION,
            inputSchema: buildObjectSchema({
                enabled: { type: 'boolean', description: 'Whether AI replies should be enabled.' },
                confirmationId: { type: 'string', description: 'Pending confirmation ID when confirming the change.' }
            }, ['enabled']),
            execute: (input, execution) => botControlRuntime.write('config.write', {
                aiEnabled: input?.enabled,
                confirmationId: input?.confirmationId
            }, execution?.context)
        },
        {
            name: 'config.set_rag_enabled',
            description: 'Enable or disable AI RAG for the current group.',
            source: TOOL_SOURCES.LOCAL,
            riskClass: TOOL_RISK_CLASSES.ADMIN_WRITE,
            scopePolicy: TOOL_SCOPE_POLICIES.CURRENT_GROUP,
            confirmPolicy: TOOL_CONFIRM_POLICIES.GROUP_MUTATION,
            inputSchema: buildObjectSchema({
                enabled: { type: 'boolean', description: 'Whether AI RAG should be enabled.' },
                confirmationId: { type: 'string', description: 'Pending confirmation ID when confirming the change.' }
            }, ['enabled']),
            execute: (input, execution) => botControlRuntime.write('config.write', {
                aiRagEnabled: input?.enabled,
                confirmationId: input?.confirmationId
            }, execution?.context)
        },
        {
            name: 'runtime.get_status',
            description: 'Read current runtime status for the active conversation scope.',
            source: TOOL_SOURCES.LOCAL,
            riskClass: TOOL_RISK_CLASSES.PUBLIC_READ,
            scopePolicy: TOOL_SCOPE_POLICIES.CURRENT_GROUP,
            confirmPolicy: TOOL_CONFIRM_POLICIES.NEVER,
            inputSchema: buildObjectSchema({}),
            execute: (_input, execution) => botControlRuntime.read('runtime.read', {}, execution?.context)
        }
    ]
}

module.exports = {
    createLocalToolAdapter
}
