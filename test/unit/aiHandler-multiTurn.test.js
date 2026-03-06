#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')

const aiHandler = require(path.join(__dirname, '../../src/handlers/aiHandler'))
const aiContextService = require(path.join(__dirname, '../../src/services/aiContextService'))
const vectorMemory = require(path.join(__dirname, '../../src/services/vectorMemoryService'))
const mcpManager = require(path.join(__dirname, '../../src/services/mcpManager'))
const userProfileService = require(path.join(__dirname, '../../src/services/userProfileService'))
const config = require(path.join(__dirname, '../../src/config'))
const axios = require('axios')

// aiContextService 内部有常驻清理定时器，单测中 unref 以避免进程被挂住
if (aiContextService.cleanupTimer && typeof aiContextService.cleanupTimer.unref === 'function') {
    aiContextService.cleanupTimer.unref()
}

const originals = {
    getContext: aiContextService.getContext,
    vectorSearch: vectorMemory.search,
    vectorAddMemory: vectorMemory.addMemory,
    getOpenAITools: mcpManager.getOpenAITools,
    executeTool: mcpManager.executeTool,
    getActiveProfiles: userProfileService.getActiveProfiles,
    addMessageToContext: aiHandler.addMessageToContext,
    getGroupConfig: config.getGroupConfig,
    isRagEnabledForGroup: config.isRagEnabledForGroup,
    axiosPost: axios.post,
    globalBot: global.bot,
}

const originalConfigDescriptors = {}
function overrideConfigValue(key, value) {
    originalConfigDescriptors[key] = Object.getOwnPropertyDescriptor(config, key)
    Object.defineProperty(config, key, {
        value,
        writable: true,
        configurable: true,
        enumerable: true
    })
}

function restoreConfigValues() {
    Object.keys(originalConfigDescriptors).forEach((key) => {
        Object.defineProperty(config, key, originalConfigDescriptors[key])
    })
}

function makeGroupConfig(overrides = {}) {
    const defaults = {
        aiContextLimit: 20,
        aiTemperature: 0.7,
        aiIdentityRagMode: 'strict',
        aiStructuredContextEnabled: true,
        aiAdminClaimRequiresTool: true,
        aiProfileEnabled: false,
    }
    return (groupId, key) => {
        if (Object.prototype.hasOwnProperty.call(overrides, key)) {
            return overrides[key]
        }
        return defaults[key]
    }
}

async function run() {
    overrideConfigValue('aiChatApiKey', 'test-key')
    overrideConfigValue('aiChatApiUrl', 'http://test.local/v1/chat/completions')
    overrideConfigValue('aiChatModel', 'test-model')
    overrideConfigValue('aiChatSystemPrompt', '你是测试助手')
    overrideConfigValue('adminQQ', '793122294')
    overrideConfigValue('aiApiKey', '')
    overrideConfigValue('aiApiUrl', '')
    overrideConfigValue('aiModel', '')

    config.getGroupConfig = makeGroupConfig()
    config.isRagEnabledForGroup = () => false
    global.bot = { selfId: '1099804769' }

    vectorMemory.search = async () => []
    vectorMemory.addMemory = async () => {}
    userProfileService.getActiveProfiles = async () => []
    mcpManager.getOpenAITools = () => []
    mcpManager.executeTool = async () => ({ content: [{ text: 'ok' }] })
    aiHandler.addMessageToContext = () => {}

    // Case 1: 意图识别收敛
    assert.strictEqual(aiHandler.detectIdentityIntent('我是reborn'), 'self_identity')
    assert.strictEqual(aiHandler.detectIdentityIntent('我是来测试的'), 'general')
    assert.strictEqual(aiHandler.detectIdentityIntent('按照群规需要踢出用户2402855757'), 'admin_action')
    console.log('✓ Case 1: detectIdentityIntent 分类符合预期')

    // Case 2: TURN_FACTS 构造与转义
    const facts = aiHandler._buildTurnFacts({
        currentMsg: {
            speakerId: '2402855757',
            speakerName: 'Re[b]orn<test>\n',
            mentionIds: ['1099804769', 'bad_id', '1099804769'],
            isAtBot: true,
            source: 'group'
        },
        userId: '2402855757',
        groupId: '1065812436',
        intentType: 'self_identity'
    })
    assert.ok(facts.includes('owner_id=793122294'))
    assert.ok(facts.includes('current_speaker_id=2402855757'))
    assert.ok(facts.includes('current_mention_ids=[1099804769]'))
    assert.ok(facts.includes('current_is_owner=false'))
    assert.ok(facts.includes('current_is_at_bot=true'))
    assert.ok(facts.includes('current_speaker_name=Re b orntest'))
    console.log('✓ Case 2: TURN_FACTS 含 owner 且字段已安全转义')

    // Case 3: 即使 structured context 关闭也会永久注入 TURN_FACTS
    config.getGroupConfig = makeGroupConfig({ aiStructuredContextEnabled: false })
    aiContextService.getContext = () => ([
        {
            role: 'user',
            content: '我是谁',
            userId: '2402855757',
            userName: '测试用户',
            speakerId: '2402855757',
            speakerName: '测试用户',
            mentionIds: ['1099804769'],
            isAtBot: true,
            source: 'group',
            timestamp: Date.now()
        }
    ])
    let capturedPayload = null
    axios.post = async (url, payload) => {
        capturedPayload = payload
        return {
            data: {
                choices: [{ message: { role: 'assistant', content: '你是测试用户。' } }]
            }
        }
    }
    const injectedReply = await aiHandler.getReply('raw message', '2402855757', '1065812436')
    assert.strictEqual(injectedReply, '你是测试用户。')
    assert.ok(capturedPayload.messages[0].content.includes('[TURN_FACTS]'))
    assert.ok(capturedPayload.messages[0].content.includes('owner_id=793122294'))
    console.log('✓ Case 3: aiStructuredContextEnabled=false 时仍注入 TURN_FACTS')

    // Case 4: admin_action + 无工具结果 => 强制硬拦截
    config.getGroupConfig = makeGroupConfig({ aiStructuredContextEnabled: true, aiAdminClaimRequiresTool: true })
    aiContextService.getContext = () => ([
        {
            role: 'user',
            content: '按照群规踢出用户2402855757',
            userId: '2402855757',
            userName: '管理员',
            speakerId: '2402855757',
            speakerName: '管理员',
            mentionIds: ['1099804769'],
            isAtBot: true,
            source: 'group',
            timestamp: Date.now()
        }
    ])
    mcpManager.getOpenAITools = () => []
    axios.post = async () => ({
        data: {
            choices: [{ message: { role: 'assistant', content: '已经帮你处理好了。' } }]
        }
    })
    let storedReply = null
    aiHandler.addMessageToContext = (groupId, role, content) => {
        if (role === 'assistant') storedReply = content
    }
    const guarded = await aiHandler.getReply('raw message', '2402855757', '1065812436')
    const expectedGuard = aiHandler._buildAdminNoToolReply()
    assert.strictEqual(guarded, expectedGuard)
    assert.strictEqual(storedReply, expectedGuard)
    console.log('✓ Case 4: 无工具结果时管理动作回复被硬拦截')

    // Case 5: 触发了 tool_calls 但工具执行失败，仍应被硬拦截
    let callIdx = 0
    mcpManager.getOpenAITools = () => ([{
        type: 'function',
        function: { name: 'kick_user', description: 'kick', parameters: { type: 'object', properties: {} } }
    }])
    mcpManager.executeTool = async () => {
        throw new Error('permission denied')
    }
    axios.post = async () => {
        callIdx++
        if (callIdx === 1) {
            return {
                data: {
                    choices: [{
                        message: {
                            role: 'assistant',
                            content: null,
                            tool_calls: [{
                                id: 'call_1',
                                type: 'function',
                                function: { name: 'kick_user', arguments: '{}' }
                            }]
                        }
                    }]
                }
            }
        }
        return {
            data: {
                choices: [{ message: { role: 'assistant', content: '已踢出该用户。' } }]
            }
        }
    }
    const guardedAfterFailedTool = await aiHandler.getReply('raw message', '2402855757', '1065812436')
    assert.strictEqual(guardedAfterFailedTool, expectedGuard)
    console.log('✓ Case 5: 工具调用失败不会绕过管理动作硬拦截')

    // Case 6: 有成功工具结果时，不应触发硬拦截
    callIdx = 0
    mcpManager.executeTool = async () => ({ content: [{ text: '执行成功' }] })
    axios.post = async () => {
        callIdx++
        if (callIdx === 1) {
            return {
                data: {
                    choices: [{
                        message: {
                            role: 'assistant',
                            content: null,
                            tool_calls: [{
                                id: 'call_2',
                                type: 'function',
                                function: { name: 'kick_user', arguments: '{}' }
                            }]
                        }
                    }]
                }
            }
        }
        return {
            data: {
                choices: [{ message: { role: 'assistant', content: '已根据执行结果处理。' } }]
            }
        }
    }
    const passed = await aiHandler.getReply('raw message', '2402855757', '1065812436')
    assert.strictEqual(passed, '已根据执行结果处理。')
    console.log('✓ Case 6: 有成功工具结果时按模型回复返回')

    console.log('\n所有测试通过 ✓')
}

run()
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
    .finally(() => {
        aiContextService.getContext = originals.getContext
        vectorMemory.search = originals.vectorSearch
        vectorMemory.addMemory = originals.vectorAddMemory
        mcpManager.getOpenAITools = originals.getOpenAITools
        mcpManager.executeTool = originals.executeTool
        userProfileService.getActiveProfiles = originals.getActiveProfiles
        aiHandler.addMessageToContext = originals.addMessageToContext
        config.getGroupConfig = originals.getGroupConfig
        config.isRagEnabledForGroup = originals.isRagEnabledForGroup
        axios.post = originals.axiosPost
        global.bot = originals.globalBot
        restoreConfigValues()
    })
