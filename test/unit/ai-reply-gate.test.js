#!/usr/bin/env node
'use strict'

const assert = require('assert')

const config = require('../../src/config')
const {
    ReplyGateService
} = require('../../src/services/ai/replyGateService')

const originalIsAiEnabledForGroup = config.isAiEnabledForGroup
const originalGetGroupConfig = config.getGroupConfig

function createService(nowValue) {
    return new ReplyGateService({
        now: () => nowValue.current
    })
}

function restore() {
    config.isAiEnabledForGroup = originalIsAiEnabledForGroup
    config.getGroupConfig = originalGetGroupConfig
}

function installConfig() {
    config.isAiEnabledForGroup = () => true
    config.getGroupConfig = (_groupId, key) => {
        const map = {
            aiReplyGateEnabled: true,
            aiReplyScoreThreshold: 45,
            aiBusyReplyScoreThreshold: 80,
            aiBusyWindowSeconds: 10,
            aiBusyMessageCount: 3,
            aiReplyCooldownMs: 0,
            aiMaxRepliesPerWindow: 3
        }
        if (Object.prototype.hasOwnProperty.call(map, key)) return map[key]
        return originalGetGroupConfig.call(config, _groupId, key)
    }
}

function testAtBotAlwaysPasses() {
    installConfig()
    const clock = { current: 1000 }
    const service = createService(clock)
    const result = service.evaluate({
        groupId: '1000',
        userId: '2000',
        rawMessage: '你好',
        messageMeta: { isAtBot: true, source: 'group' }
    })

    assert.strictEqual(result.shouldReply, true)
    assert.strictEqual(result.triggerLevel, 'direct')
    console.log('✓ @bot 会直接通过 reply gate')
}

function testEvaluateAdmissionAliasesEvaluate() {
    installConfig()
    const clock = { current: 1000 }
    const service = createService(clock)
    const input = {
        groupId: '1000',
        userId: '2000',
        rawMessage: '这个为什么会超时？',
        messageMeta: { source: 'group' }
    }

    assert.deepStrictEqual(service.evaluateAdmission(input), service.evaluate(input))
    console.log('✓ replyGateService 将 reply gate 暴露为 admission 兼容别名')
}

function testPrivateChatAlwaysPasses() {
    installConfig()
    const clock = { current: 1000 }
    const service = createService(clock)
    const result = service.evaluate({
        groupId: 'private_2000',
        userId: '2000',
        rawMessage: '你好',
        messageMeta: { isAtBot: false, source: 'private' }
    })

    assert.strictEqual(result.shouldReply, true)
    assert.strictEqual(result.triggerLevel, 'direct')
    console.log('✓ 私聊会直接通过 reply gate')
}

function testShortNoiseFailsInBusyMode() {
    installConfig()
    const clock = { current: 1000 }
    const service = createService(clock)

    service.evaluate({ groupId: '1000', userId: 'u1', rawMessage: '哈', messageMeta: { source: 'group' } })
    clock.current += 100
    service.evaluate({ groupId: '1000', userId: 'u2', rawMessage: '嗯', messageMeta: { source: 'group' } })
    clock.current += 100
    const result = service.evaluate({
        groupId: '1000',
        userId: 'u3',
        rawMessage: '好',
        messageMeta: { source: 'group' }
    })

    assert.strictEqual(result.busyMode, true)
    assert.strictEqual(result.shouldReply, false)
    console.log('✓ busy mode 下短噪声消息不会通过')
}

function testRecentBotInteractionCanPassFollowUp() {
    installConfig()
    const clock = { current: 1000 }
    const service = createService(clock)
    service.recordBotReply('1000', '2000')
    clock.current += 1000

    const result = service.evaluate({
        groupId: '1000',
        userId: '2000',
        rawMessage: '这个为什么会超时？',
        messageMeta: { source: 'group' }
    })

    assert.strictEqual(result.shouldReply, true)
    assert.strictEqual(result.triggerLevel, 'followup')
    console.log('✓ 最近与 bot 交互后的追问可通过')
}

function testAmbientChatterFails() {
    installConfig()
    const clock = { current: 1000 }
    const service = createService(clock)

    const result = service.evaluate({
        groupId: '1000',
        userId: '2000',
        rawMessage: '今天好热',
        messageMeta: { source: 'group' }
    })

    assert.strictEqual(result.shouldReply, false)
    console.log('✓ 普通群聊闲聊不会误触发')
}

function testChineseQuestionWithoutPunctuationStillScoresAsQuestion() {
    installConfig()
    const clock = { current: 1000 }
    const service = createService(clock)
    service.recordBotReply('1000', '2000')
    clock.current += 1000

    const result = service.evaluate({
        groupId: '1000',
        userId: '2000',
        rawMessage: '为什么会超时',
        messageMeta: { source: 'group' }
    })

    assert.strictEqual(result.shouldReply, true)
    assert.ok(result.reasons.includes('question_like'))
    console.log('✓ 无问号中文问句也会命中 question_like')
}

function run() {
    testAtBotAlwaysPasses()
    testEvaluateAdmissionAliasesEvaluate()
    testPrivateChatAlwaysPasses()
    testShortNoiseFailsInBusyMode()
    testRecentBotInteractionCanPassFollowUp()
    testAmbientChatterFails()
    testChineseQuestionWithoutPunctuationStillScoresAsQuestion()
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
