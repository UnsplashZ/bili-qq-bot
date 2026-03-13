#!/usr/bin/env node
'use strict'

const assert = require('assert')

const aiHandler = require('../../src/handlers/aiHandler')
const aiContextService = require('../../src/services/aiContextService')
const vectorMemory = require('../../src/services/vectorMemoryService')
const mcpManager = require('../../src/services/mcpManager')
const userProfileService = require('../../src/services/userProfileService')
const config = require('../../src/config')
const axios = require('axios')

if (aiContextService.cleanupTimer && typeof aiContextService.cleanupTimer.unref === 'function') {
    aiContextService.cleanupTimer.unref()
}

const originals = {
    getContext: aiContextService.getContext,
    vectorSearch: vectorMemory.search,
    vectorAddMemory: vectorMemory.addMemory,
    getOpenAITools: mcpManager.getOpenAITools,
    getActiveProfiles: userProfileService.getActiveProfiles,
    addMessageToContext: aiHandler.addMessageToContext,
    getGroupConfig: config.getGroupConfig,
    isRagEnabledForGroup: config.isRagEnabledForGroup,
    aiChatApiKey: config.aiChatApiKey,
    aiApiKey: config.aiApiKey,
    axiosPost: axios.post
}

async function run() {
    config.aiChatApiKey = 'test-key'
    config.aiApiKey = 'test-key'
    config.getGroupConfig = (_groupId, key) => {
        const defaults = {
            aiContextLimit: 20,
            aiTemperature: 0.7,
            aiIdentityRagMode: 'strict',
            aiStructuredContextEnabled: true,
            aiAdminClaimRequiresTool: true,
            aiPromptAssemblerEnabled: true,
            aiProfileEnabled: false
        }
        return defaults[key]
    }
    config.isRagEnabledForGroup = () => true
    aiContextService.getContext = () => ([
        {
            role: 'user',
            content: '这个问题还记得吗',
            userId: '2402855757',
            userName: '测试用户',
            speakerId: '2402855757',
            speakerName: '测试用户',
            mentionIds: [],
            isAtBot: false,
            source: 'group',
            timestamp: Date.now()
        }
    ])
    vectorMemory.search = async () => ([
        { role: 'user', userName: '测试用户', text: '上次也是订阅超时', timestamp: Date.now() - 10000 }
    ])
    vectorMemory.addMemory = async () => {}
    userProfileService.getActiveProfiles = async () => []
    mcpManager.getOpenAITools = () => []
    aiHandler.addMessageToContext = () => {}

    let capturedPayload = null
    axios.post = async (_url, payload) => {
        capturedPayload = payload
        return {
            data: {
                choices: [{ message: { role: 'assistant', content: '记得，上次也是超时。' } }]
            }
        }
    }

    const reply = await aiHandler.getReply('raw', '2402855757', '1065812436', null, {
        gateDecision: { triggerLevel: 'followup', busyMode: false, score: 60, reasons: ['test'] },
        selectedContext: {
            currentTurn: {
                role: 'user',
                speakerId: '2402855757',
                speakerName: '测试用户',
                content: '这个问题还记得吗'
            },
            threadMessages: [],
            backgroundSummary: ''
        },
        responseMode: { mode: 'answer_only', reasons: ['question_like'] }
    })

    assert.strictEqual(reply, '记得，上次也是超时。')
    assert.ok(capturedPayload.messages[0].content.includes('[RELEVANT_MEMORIES]'))
    console.log('✓ 结构化 prompt 下仍会独立注入 memories block')
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
    .finally(() => {
        aiContextService.getContext = originals.getContext
        vectorMemory.search = originals.vectorSearch
        vectorMemory.addMemory = originals.vectorAddMemory
        mcpManager.getOpenAITools = originals.getOpenAITools
        userProfileService.getActiveProfiles = originals.getActiveProfiles
        aiHandler.addMessageToContext = originals.addMessageToContext
        config.getGroupConfig = originals.getGroupConfig
        config.isRagEnabledForGroup = originals.isRagEnabledForGroup
        config.aiChatApiKey = originals.aiChatApiKey
        config.aiApiKey = originals.aiApiKey
        axios.post = originals.axiosPost
    })
