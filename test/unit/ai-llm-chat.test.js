#!/usr/bin/env node
'use strict'

const assert = require('assert')
const llmChatService = require('../../src/services/ai/llmChatService')

async function testTimeoutCalculation() {
    const timeout = llmChatService.computeDynamicTimeout({ baseTimeoutSeconds: 30, toolTimeoutSeconds: 2, maxTimeoutSeconds: 45, toolCount: 4 })
    assert.strictEqual(timeout, 38000)
    console.log('✓ computeDynamicTimeout 符合预期')
}

async function testToolLoopSuccess() {
    let callIndex = 0
    const result = await llmChatService.runChatLoop({
        apiUrl: 'http://test.local',
        apiKey: 'test-key',
        model: 'test-model',
        temperature: 0.7,
        messages: [{ role: 'system', content: '你是测试助手' }],
        tools: [{ type: 'function', function: { name: 'kick_user', parameters: { type: 'object', properties: {} } } }],
        dynamicTimeout: 30000,
        contextKey: '1065812436',
        userId: '2402855757',
        intentType: 'admin_action',
        ragMode: 'strict',
        hybridSearchOptions: { crossUserPenalty: 0.12 },
        proxyConfig: { host: '127.0.0.1', port: 7890 },
        axiosPost: async () => {
            callIndex++
            if (callIndex === 1) {
                return { data: { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'kick_user', arguments: '{}' } }] } }] } }
            }
            return { data: { choices: [{ message: { role: 'assistant', content: '已根据执行结果处理。' } }] } }
        },
        executeTool: async () => ({ content: [{ text: '执行成功' }] }),
        toolExecutionGuardExecute: async (name, runner) => ({ ok: true, value: await runner({ signal: null }) }),
        vectorSearch: async () => [],
        log: () => {}
    })
    assert.strictEqual(result.reply, '已根据执行结果处理。')
    assert.strictEqual(result.hasToolResult, true)
    console.log('✓ runChatLoop 在 tool success 时返回 reply')
}

async function testApiValidationAndArgsFallback() {
    let parseFailureLogged = false
    const invalid = await llmChatService.runChatLoop({
        apiUrl: 'http://test.local',
        apiKey: 'test-key',
        model: 'test-model',
        temperature: 0.7,
        messages: [{ role: 'system', content: '你是测试助手' }],
        tools: [{ type: 'function', function: { name: 'mem0_search', parameters: { type: 'object', properties: {} } } }],
        dynamicTimeout: 30000,
        contextKey: '1065812436',
        userId: '2402855757',
        intentType: 'self_identity',
        ragMode: 'strict',
        hybridSearchOptions: { strictUserId: '2402855757', crossUserPenalty: 0.2 },
        proxyConfig: null,
        axiosPost: async () => ({ data: { choices: [] } }),
        executeTool: async () => ({ content: [{ text: '执行成功' }] }),
        toolExecutionGuardExecute: async (name, runner) => ({ ok: true, value: await runner({ signal: null }) }),
        vectorSearch: async () => [],
        log: (level, message) => {
            if (message === 'tool-args-parse-failed') parseFailureLogged = true
        }
    })
    assert.strictEqual(invalid.reply, null)
    assert.strictEqual(parseFailureLogged, false)
    console.log('✓ runChatLoop 会校验空 choices 响应')
}

async function testTimeoutAndNetworkMapping() {
    const timeoutResult = await llmChatService.runChatLoop({
        apiUrl: 'http://test.local',
        apiKey: 'test-key',
        model: 'test-model',
        temperature: 0.7,
        messages: [{ role: 'system', content: '你是测试助手' }],
        tools: [],
        dynamicTimeout: 30000,
        contextKey: '1065812436',
        userId: '2402855757',
        intentType: 'general',
        ragMode: 'strict',
        hybridSearchOptions: {},
        proxyConfig: { host: '127.0.0.1', port: 7890 },
        axiosPost: async () => {
            const error = new Error('timeout of 30000ms exceeded')
            error.code = 'ECONNABORTED'
            throw error
        },
        executeTool: async () => ({ content: [{ text: '执行成功' }] }),
        toolExecutionGuardExecute: async (name, runner) => ({ ok: true, value: await runner({ signal: null }) }),
        vectorSearch: async () => [],
        log: () => {}
    })
    assert.strictEqual(timeoutResult.reply, '抱歉，AI响应超时。请稍后重试。')

    let requestFailedLogged = false
    const networkResult = await llmChatService.runChatLoop({
        apiUrl: 'http://test.local',
        apiKey: 'test-key',
        model: 'test-model',
        temperature: 0.7,
        messages: [{ role: 'system', content: '你是测试助手' }],
        tools: [],
        dynamicTimeout: 30000,
        contextKey: '1065812436',
        userId: '2402855757',
        intentType: 'general',
        ragMode: 'strict',
        hybridSearchOptions: {},
        proxyConfig: { host: '127.0.0.1', port: 7890 },
        axiosPost: async () => {
            const error = new Error('connect ECONNREFUSED 127.0.0.1:7890')
            error.code = 'ECONNREFUSED'
            throw error
        },
        executeTool: async () => ({ content: [{ text: '执行成功' }] }),
        toolExecutionGuardExecute: async (name, runner) => ({ ok: true, value: await runner({ signal: null }) }),
        vectorSearch: async () => [],
        log: (level, message) => {
            if (message === 'api-request-failed') requestFailedLogged = true
        }
    })
    assert.strictEqual(networkResult.reply, null)
    assert.strictEqual(requestFailedLogged, true)
    console.log('✓ runChatLoop 会保留超时文案与普通网络失败返回 null 的现有语义')
}

async function testHybridSearchAppend() {
    let callIndex = 0
    let capturedOptions = null
    const result = await llmChatService.runChatLoop({
        apiUrl: 'http://test.local',
        apiKey: 'test-key',
        model: 'test-model',
        temperature: 0.7,
        messages: [{ role: 'system', content: '你是测试助手' }],
        tools: [{ type: 'function', function: { name: 'mem0_search', parameters: { type: 'object', properties: { query: { type: 'string' } } } } }],
        dynamicTimeout: 30000,
        contextKey: '1065812436',
        userId: '2402855757',
        intentType: 'self_identity',
        ragMode: 'strict',
        hybridSearchOptions: { strictUserId: '2402855757', crossUserPenalty: 0.2 },
        proxyConfig: null,
        axiosPost: async () => {
            callIndex++
            if (callIndex === 1) {
                return { data: { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'mem0_search', arguments: '{"query":"我是谁"}' } }] } }] } }
            }
            return { data: { choices: [{ message: { role: 'assistant', content: '已补充本地记忆。' } }] } }
        },
        executeTool: async () => ({ content: [{ text: '远端记忆A' }] }),
        toolExecutionGuardExecute: async (name, runner) => ({ ok: true, value: await runner({ signal: null }) }),
        vectorSearch: async (contextKey, queryText, limit, userId, options) => {
            capturedOptions = options
            return [{ userName: '张三', text: '本地记忆B', timestamp: Date.now() }]
        },
        log: () => {}
    })
    assert.strictEqual(result.reply, '已补充本地记忆。')
    assert.deepStrictEqual(capturedOptions, { strictUserId: '2402855757', crossUserPenalty: 0.2 })
    assert.ok(result.rawMessages.some(msg => msg.role === 'tool' && msg.content.includes('Additional Local Memories')))
    console.log('✓ mem0 search 会追加本地 vector memory 结果，并沿用主链路 hybrid search 参数')
}

async function run() {
    await testTimeoutCalculation()
    await testToolLoopSuccess()
    await testApiValidationAndArgsFallback()
    await testTimeoutAndNetworkMapping()
    await testHybridSearchAppend()
}

run().then(() => process.exit(0)).catch((error) => {
    console.error(error)
    process.exit(1)
})
