'use strict'

const assert = require('assert')
const { normalizeAgentConfig } = require('../../../src/agent/config/agentConfig')
const { getApiKey, buildChatCompletionsUrl } = require('../../../src/agent/runtime/llmClient')

describe('Agent runtime config source', () => {
    it('uses config snapshot values instead of process.env and keeps only a runtime baseURL alias', () => {
        const previous = process.env.AGENT_LLM_BASE_URL
        process.env.AGENT_LLM_BASE_URL = 'https://env.invalid/v1'
        try {
            const normalized = normalizeAgentConfig({
                llm: {
                    enabled: true,
                    provider: 'openai-compatible',
                    baseUrl: 'https://yaml.example/v1',
                    model: 'model',
                    apiKey: 'yaml-secret'
                }
            })
            assert.strictEqual(normalized.llm.baseUrl, 'https://yaml.example/v1')
            assert.strictEqual(normalized.llm.baseURL, 'https://yaml.example/v1')
            assert.strictEqual(normalized.llm.apiKeyEnv, undefined)
            assert.strictEqual(getApiKey(normalized.llm), 'yaml-secret')
            assert.strictEqual(buildChatCompletionsUrl(normalized.llm.baseUrl), 'https://yaml.example/v1/chat/completions')
        } finally {
            if (previous === undefined) delete process.env.AGENT_LLM_BASE_URL
            else process.env.AGENT_LLM_BASE_URL = previous
        }
    })
})
