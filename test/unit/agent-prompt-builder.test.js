#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')

const { buildSystemPrompt } = require(path.join(__dirname, '../../src/agent/runtime/promptBuilder'))

function run() {
    const prompt = buildSystemPrompt({
        persona: {
            displayName: '测试助手',
            style: '冷静直接',
            boundaries: '不讨论无关八卦'
        }
    })

    assert.ok(prompt.includes('测试助手'))
    assert.ok(prompt.includes('冷静直接'))
    assert.ok(prompt.includes('不讨论无关八卦'))
    assert.ok(prompt.includes('只能输出 tool_plan 意图'))

    console.log('✓ Agent prompt persona 注入正常')
}

try {
    run()
    process.exit(0)
} catch (error) {
    console.error(error)
    process.exit(1)
}
