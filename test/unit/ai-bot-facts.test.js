#!/usr/bin/env node
'use strict'

const assert = require('assert')
const config = require('../../src/config')
const { buildBotFacts } = require('../../src/services/ai/botFactsService')

const originalGetGroupConfig = config.getGroupConfig
const originalGetRootAdminQQ = config.getRootAdminQQ
const originalBot = global.bot

function restore() {
    config.getGroupConfig = originalGetGroupConfig
    config.getRootAdminQQ = originalGetRootAdminQQ
    global.bot = originalBot
}

function testBuildBotFactsWithRuntimeNickname() {
    config.getGroupConfig = (groupId, key) => {
        if (key === 'aiBotName') return '配置机器人'
        if (key === 'aiBotAliases') return ['小助手', ' BiliBot ']
        return originalGetGroupConfig.call(config, groupId, key)
    }
    config.getRootAdminQQ = () => '123456'
    global.bot = {
        selfId: '424242',
        nickname: '运行时机器人'
    }

    const facts = buildBotFacts('1000', {
        currentMentionsBot: true,
        isReplyToBot: false
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
    config.getGroupConfig = (_groupId, key) => {
        if (key === 'aiBotName') return '配置机器人'
        if (key === 'aiBotAliases') return []
        return originalGetGroupConfig.call(config, _groupId, key)
    }
    config.getRootAdminQQ = () => '123456'
    global.bot = {
        selfId: '424242'
    }

    const facts = buildBotFacts('1000', {
        currentMentionsBot: false,
        isReplyToBot: true
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
} finally {
    restore()
}
