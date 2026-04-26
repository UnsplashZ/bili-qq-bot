#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')

const llmClient = require(path.join(__dirname, '../../src/agent/runtime/llmClient'))

const originalFetch = global.fetch

async function run() {
    let calls = 0
    global.fetch = async () => {
        calls += 1
        return {
            ok: true,
            async text() {
                if (calls === 1) {
                    return JSON.stringify({ choices: [{ message: { content: '' } }] })
                }
                return JSON.stringify({
                    model: 'retry-model',
                    choices: [{ message: { content: '{"action":"observe_only"}' } }],
                    usage: { total_tokens: 1 }
                })
            }
        }
    }

    try {
        const result = await llmClient.createChatCompletion({
            llmConfig: {
                baseURL: 'https://example.com/v1',
                apiKey: 'test-key',
                model: 'retry-model',
                timeoutMs: 1000,
                maxTokens: 100,
                temperature: 0,
                emptyContentRetries: 2
            },
            messages: [{ role: 'user', content: 'hi' }],
            traceScope: 'test:llm-empty-retry'
        })
        assert.strictEqual(calls, 2)
        assert.strictEqual(result.content, '{"action":"observe_only"}')
    } finally {
        global.fetch = originalFetch
    }

    console.log('✓ Agent LLM 空响应重试正常')
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        global.fetch = originalFetch
        console.error(error)
        process.exit(1)
    })
