#!/usr/bin/env node
'use strict'

const assert = require('assert')

const {
    classifyResponseMode,
    classifyResponseModeHint
} = require('../../src/services/ai/responseModeService')

const {
    classifyResponseModeHint: classifyResponseModeHintFromHelper
} = require('../../src/services/ai/agent/responseModeClassifier')

function testCompatibilityShimDelegatesToHelper() {
    const input = {
        rawMessage: '帮我把这个关掉',
        messageMeta: { source: 'group' },
        triggerLevel: 'direct'
    }

    assert.deepStrictEqual(classifyResponseMode(input), classifyResponseModeHint(input))
    assert.deepStrictEqual(classifyResponseMode(input), classifyResponseModeHintFromHelper(input))
    console.log('✓ responseModeService 作为兼容层委托给 agent response mode helper')
}

function testPlainQuestionBecomesAnswerOnly() {
    const result = classifyResponseMode({
        rawMessage: '这个超时一般是什么原因？',
        messageMeta: { source: 'group' },
        triggerLevel: 'followup'
    })

    assert.strictEqual(result.mode, 'answer_only')
    console.log('✓ 普通提问归类为 answer_only')
}

function testCasualBanterBecomesChat() {
    const result = classifyResponseMode({
        rawMessage: '哈哈确实',
        messageMeta: { source: 'group' },
        triggerLevel: 'ambient'
    })

    assert.strictEqual(result.mode, 'chat')
    console.log('✓ 随口闲聊归类为 chat')
}

function testAmbiguousActionNeedsConfirm() {
    const result = classifyResponseMode({
        rawMessage: '那就把这个关了吧',
        messageMeta: { source: 'group' },
        triggerLevel: 'direct'
    })

    assert.strictEqual(result.mode, 'confirm_needed')
    console.log('✓ 模糊动作表达归类为 confirm_needed')
}

function testNonDirectGroupActionDoesNotBecomeReady() {
    const result = classifyResponseMode({
        rawMessage: '把这个配置改了',
        messageMeta: { source: 'group' },
        triggerLevel: 'ambient'
    })

    assert.notStrictEqual(result.mode, 'action_ready')
    console.log('✓ 非强触发的群动作表达不会进入 action_ready')
}

function run() {
    testCompatibilityShimDelegatesToHelper()
    testPlainQuestionBecomesAnswerOnly()
    testCasualBanterBecomesChat()
    testAmbiguousActionNeedsConfirm()
    testNonDirectGroupActionDoesNotBecomeReady()
}

try {
    run()
    process.exit(0)
} catch (error) {
    console.error(error)
    process.exit(1)
}
