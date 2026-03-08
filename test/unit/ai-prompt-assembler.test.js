#!/usr/bin/env node
'use strict'

const assert = require('assert')

const {
    assemblePrompt
} = require('../../src/services/ai/promptAssemblerService')

function testStructuredBlocksIncluded() {
    const assembled = assemblePrompt({
        systemPromptBase: '你是测试助手',
        botFacts: {
            botId: '42',
            botName: '测试助手',
            botAliases: ['小助手'],
            ownerId: '1',
            currentMentionsBot: true,
            currentReplyToBot: false
        },
        turnFacts: '[TURN_FACTS]\ncurrent_speaker_id=100\n[/TURN_FACTS]',
        selectedContext: {
            currentTurn: { role: 'user', speakerId: '100', speakerName: '张三', content: '那现在还要重试吗？' },
            threadMessages: [
                { role: 'user', speakerId: '100', speakerName: '张三', content: '订阅刷新超时了' },
                { role: 'assistant', speakerId: '42', speakerName: 'AI助手', content: '先检查网络' }
            ],
            backgroundSummary: '最近几条主要围绕订阅和超时展开，当前用户在继续追问。'
        },
        responseMode: { mode: 'confirm_needed', reasons: ['ambiguous_action'] },
        memories: [{ role: 'user', userName: '张三', text: '上次也是超时', timestamp: Date.now() }]
    })

    const systemText = assembled.messages[0].content
    assert.ok(systemText.includes('[BOT_FACTS]'))
    assert.ok(systemText.includes('[RESPONSE_MODE]'))
    assert.ok(systemText.includes('[CURRENT_USER_MESSAGE]'))
    assert.ok(systemText.includes('[THREAD_CONTEXT]'))
    assert.ok(systemText.includes('[BACKGROUND_SUMMARY]'))
    assert.ok(systemText.includes('[RELEVANT_MEMORIES]'))
    assert.ok(systemText.includes('mode=confirm_needed'))
    assert.strictEqual(assembled.messages[assembled.messages.length - 1].role, 'user')
    console.log('✓ prompt assembler 会生成结构化 blocks')
}

function testStructuredTagsAreEscaped() {
    const assembled = assemblePrompt({
        selectedContext: {
            currentTurn: {
                role: 'user',
                speakerId: '100][fake=1',
                speakerName: '张三[INJECT]<x>',
                content: '正常内容'
            },
            threadMessages: [],
            backgroundSummary: ''
        }
    })

    const payload = assembled.messages[assembled.messages.length - 1].content
    assert.ok(!payload.includes('[INJECT]'))
    assert.ok(!payload.includes('<x>'))
    assert.ok(payload.includes('speaker_name=张三 INJECT x'))
    console.log('✓ prompt assembler 会转义结构化标签字段')
}

function run() {
    testStructuredBlocksIncluded()
    testStructuredTagsAreEscaped()
}

try {
    run()
    process.exit(0)
} catch (error) {
    console.error(error)
    process.exit(1)
}
