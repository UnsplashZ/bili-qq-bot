#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { buildBotFacts } = require('../../src/services/ai/botFactsService')

function testBuildBotFactsWithRuntimeNickname() {
    const facts = buildBotFacts({
        bot: {
            selfId: '424242',
            nickname: '运行时机器人'
        },
        botName: '配置机器人',
        botAliases: ['小助手', ' BiliBot '],
        ownerId: '123456',
        turnMeta: {
            currentMentionsBot: true,
            isReplyToBot: false
        }
    })

    assert.strictEqual(facts.botId, '424242')
    assert.strictEqual(facts.botName, '运行时机器人')
    assert.deepStrictEqual(facts.botAliases, ['小助手', 'BiliBot'])
    assert.strictEqual(facts.ownerId, '123456')
    assert.strictEqual(facts.currentMentionsBot, true)
    assert.strictEqual(facts.currentReplyToBot, false)
    console.log('✓ buildBotFacts 优先使用运行时昵称')
}

function testBuildBotFactsFallsBackToConfigName() {
    const facts = buildBotFacts({
        bot: {
            selfId: '424242'
        },
        botName: '配置机器人',
        botAliases: [],
        ownerId: '123456',
        turnMeta: {
            currentMentionsBot: false,
            isReplyToBot: true
        }
    })

    assert.strictEqual(facts.botName, '配置机器人')
    assert.strictEqual(facts.currentMentionsBot, false)
    assert.strictEqual(facts.currentReplyToBot, true)
    console.log('✓ buildBotFacts 可回退到配置 bot 名称')
}

function run() {
    testBuildBotFactsWithRuntimeNickname()
    testBuildBotFactsFallsBackToConfigName()
}

try {
    run()
} catch (error) {
    console.error(error)
    process.exit(1)
}
