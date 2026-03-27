#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { persistAssistantReply } = require('../../src/services/ai/replyPersistenceService')

async function run() {
    const calls = []
    await persistAssistantReply({
        contextKey: '1065812436',
        groupId: '1065812436',
        reply: '已根据执行结果处理。',
        addMessageToContext: (...args) => calls.push(['context', ...args]),
        addMemory: (...args) => {
            calls.push(['memory', ...args])
            return Promise.resolve()
        },
        botSelfId: '1099804769',
        log: () => {}
    })

    assert.strictEqual(calls.length, 2)
    assert.deepStrictEqual(calls[0].slice(0, 3), ['context', '1065812436', 'assistant'])
    assert.deepStrictEqual(calls[1], ['memory', '1065812436', '已根据执行结果处理。', 'assistant'])
    console.log('✓ persistAssistantReply 会写入 context 与 vector memory')
}

run().then(() => process.exit(0)).catch((error) => {
    console.error(error)
    process.exit(1)
})
