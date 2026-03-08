#!/usr/bin/env node
'use strict'

const assert = require('assert')

const messageHandler = require('../../src/handlers/messageHandler')
const aiContextService = require('../../src/services/aiContextService')
const config = require('../../src/config')

const originalGetGroupConfig = config.getGroupConfig

function restore() {
    config.getGroupConfig = originalGetGroupConfig
}

function testExtractMessageMetaIncludesReplyAndBotFacts() {
    config.getGroupConfig = (_groupId, key) => {
        if (key === 'aiBotName') return '测试助手'
        if (key === 'aiBotAliases') return ['小助手', 'BiliBot']
        return originalGetGroupConfig.call(config, _groupId, key)
    }

    const meta = messageHandler.extractMessageMeta({
        self_id: 42,
        message: [
            { type: 'reply', data: { id: '5566', qq: '42' } },
            { type: 'at', data: { qq: '42' } },
            { type: 'text', data: { text: '小助手 在吗' } }
        ],
        raw_message: '小助手 在吗'
    }, '1000', '2000', '张三')

    assert.strictEqual(meta.speakerId, '2000')
    assert.strictEqual(meta.speakerName, '张三')
    assert.deepStrictEqual(meta.mentionIds, ['42'])
    assert.strictEqual(meta.currentMentionsBot, true)
    assert.strictEqual(meta.isAtBot, true)
    assert.strictEqual(meta.replyToMessageId, '5566')
    assert.strictEqual(meta.replyToSpeakerId, '42')
    assert.strictEqual(meta.isReplyToBot, true)
    assert.strictEqual(meta.botNameHit, '小助手')
    assert.strictEqual(meta.source, 'group')
    console.log('✓ extractMessageMeta 包含 reply 与 bot 识别元数据')
}

function testReplyToOthersDoesNotPretendReplyToBot() {
    config.getGroupConfig = (_groupId, key) => {
        if (key === 'aiBotName') return '测试助手'
        if (key === 'aiBotAliases') return ['小助手', 'BiliBot']
        return originalGetGroupConfig.call(config, _groupId, key)
    }

    const meta = messageHandler.extractMessageMeta({
        self_id: 42,
        message: [
            { type: 'reply', data: { id: '7788' } },
            { type: 'text', data: { text: '我刚刚在跟小助手说另一件事' } }
        ],
        raw_message: '我刚刚在跟小助手说另一件事'
    }, '1000', '2000', '张三')

    assert.strictEqual(meta.replyToMessageId, '7788')
    assert.strictEqual(meta.botNameHit, '小助手')
    assert.strictEqual(meta.isReplyToBot, false)
    console.log('✓ reply 别人但提到 bot 名称时不会误标记为 reply bot')
}

function testAiContextStoresOptionalMetadata() {
    const contextId = 'private_990001'
    aiContextService.resetContext(contextId)
    aiContextService.addMessageToContext(contextId, 'user', '测试消息', '10001', '测试用户', {
        speakerId: '10001',
        speakerName: '测试用户',
        mentionIds: ['42'],
        isAtBot: true,
        source: 'private',
        messageId: '9001',
        replyToMessageId: '5566',
        replyToSpeakerId: '42',
        isReplyToBot: true,
        normalizedText: '测试消息',
        topicHints: ['订阅', '超时'],
        currentMentionsBot: true,
        botNameHit: '小助手'
    })

    const context = aiContextService.getContext(contextId)
    const last = context[context.length - 1]
    assert.strictEqual(last.messageId, '9001')
    assert.strictEqual(last.replyToMessageId, '5566')
    assert.strictEqual(last.replyToSpeakerId, '42')
    assert.strictEqual(last.isReplyToBot, true)
    assert.strictEqual(last.normalizedText, '测试消息')
    assert.deepStrictEqual(last.topicHints, ['订阅', '超时'])
    assert.strictEqual(last.currentMentionsBot, true)
    assert.strictEqual(last.botNameHit, '小助手')
    aiContextService.resetContext(contextId)
    console.log('✓ aiContextService 存储新增可选元数据')
}

function run() {
    testExtractMessageMetaIncludesReplyAndBotFacts()
    testReplyToOthersDoesNotPretendReplyToBot()
    testAiContextStoresOptionalMetadata()
}

try {
    run()
    process.exit(0)
} catch (error) {
    console.error(error)
    process.exit(1)
} finally {
    restore()
}
