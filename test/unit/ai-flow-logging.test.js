#!/usr/bin/env node
'use strict'

const assert = require('assert')

const logger = require('../../src/utils/logger')
const aiHandler = require('../../src/handlers/aiHandler')
const axios = require('axios')
const config = require('../../src/config')
const mcpManager = require('../../src/services/mcpManager')
const vectorMemory = require('../../src/services/vectorMemoryService')
const aiContextService = require('../../src/services/aiContextService')
const userProfileService = require('../../src/services/userProfileService')

const originals = {
    axiosPost: axios.post,
    getGroupConfig: config.getGroupConfig,
    aiChatApiKey: config.aiChatApiKey,
    aiChatApiUrl: config.aiChatApiUrl,
    aiChatModel: config.aiChatModel,
    aiChatSystemPrompt: config.aiChatSystemPrompt,
    getOpenAITools: mcpManager.getOpenAITools,
    executeTool: mcpManager.executeTool,
    vectorSearch: vectorMemory.search,
    getContext: aiContextService.getContext,
    getActiveProfiles: userProfileService.getActiveProfiles,
    addMessageToContext: aiHandler.addMessageToContext
}

function restore() {
    axios.post = originals.axiosPost
    config.getGroupConfig = originals.getGroupConfig
    config.aiChatApiKey = originals.aiChatApiKey
    config.aiChatApiUrl = originals.aiChatApiUrl
    config.aiChatModel = originals.aiChatModel
    config.aiChatSystemPrompt = originals.aiChatSystemPrompt
    mcpManager.getOpenAITools = originals.getOpenAITools
    mcpManager.executeTool = originals.executeTool
    vectorMemory.search = originals.vectorSearch
    aiContextService.getContext = originals.getContext
    userProfileService.getActiveProfiles = originals.getActiveProfiles
    aiHandler.addMessageToContext = originals.addMessageToContext
}

async function run() {
    const logs = []
    const off = logger.onLog((entry) => logs.push(entry.message))

    try {
        config.aiChatApiKey = 'test-key'
        config.aiChatApiUrl = 'https://example.com/v1/chat/completions'
        config.aiChatModel = 'test-model'
        config.aiChatSystemPrompt = 'system'
        config.getGroupConfig = (_groupId, key) => {
            const map = {
                aiContextLimit: 20,
                aiTemperature: 0.7,
                aiPromptAssemblerEnabled: false,
                aiStructuredContextEnabled: true,
                aiProfileEnabled: true,
                aiAdminClaimRequiresTool: false,
                aiIdentityRagMode: 'normal'
            }
            if (Object.prototype.hasOwnProperty.call(map, key)) return map[key]
            return originals.getGroupConfig.call(config, _groupId, key)
        }

        aiContextService.getContext = () => ([
            { role: 'user', speakerId: '2', speakerName: '测试用户', content: '查一下天气', timestamp: Date.now() - 1000 },
            { role: 'user', speakerId: '2', speakerName: '测试用户', content: '帮我查天气', timestamp: Date.now() }
        ])
        vectorMemory.search = async () => ([{
            userName: '测试用户',
            role: 'user',
            text: '用户最近在问天气',
            timestamp: Date.now() - 5000
        }])
        userProfileService.getActiveProfiles = async () => ([{
            userId: '2',
            userName: '测试用户',
            profile: '偏好简短回复'
        }])
        mcpManager.getOpenAITools = () => ([{
            type: 'function',
            function: {
                name: 'weather_lookup',
                description: 'lookup weather',
                parameters: { type: 'object', properties: {} }
            }
        }])
        mcpManager.executeTool = async () => ({
            content: [{ text: '晴 18C' }]
        })
        aiHandler.addMessageToContext = () => {}

        let callCount = 0
        axios.post = async () => {
            callCount++
            if (callCount === 1) {
                return {
                    data: {
                        choices: [{
                            message: {
                                role: 'assistant',
                                tool_calls: [{
                                    id: 'call_1',
                                    function: {
                                        name: 'weather_lookup',
                                        arguments: '{}'
                                    }
                                }]
                            }
                        }]
                    }
                }
            }
            return {
                data: {
                    choices: [{
                        message: {
                            role: 'assistant',
                            content: '今天晴天。'
                        }
                    }]
                }
            }
        }

        const reply = await aiHandler.getReply('帮我查天气', '2', '1000', 'msg:1000:2:555')
        assert.strictEqual(reply, '今天晴天。')

        assert.ok(logs.some(line => line.includes('INF AI') && line.includes('[msg:1000:2:555]') && line.includes('rag-ready')))
        assert.ok(logs.some(line => line.includes('INF AI') && line.includes('[msg:1000:2:555]') && line.includes('tool-start')))
        assert.ok(logs.some(line => line.includes('INF AI') && line.includes('[msg:1000:2:555]') && line.includes('tool-done')))
        assert.ok(logs.some(line => line.includes('INF AI') && line.includes('[msg:1000:2:555]') && line.includes('reply-ready')))
        console.log('✓ aiHandler 会输出 rag/tool/reply 摘要日志')
    } finally {
        off()
        restore()
    }
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
