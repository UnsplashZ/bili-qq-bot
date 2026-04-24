const logger = require('../../utils/logger')

function buildChatCompletionsUrl(baseURL) {
    const raw = String(baseURL || '').trim().replace(/\/+$/, '')
    if (!raw) return ''
    if (raw.endsWith('/chat/completions')) return raw
    return `${raw}/chat/completions`
}

function getApiKey(llmConfig, env = process.env) {
    const envName = String(llmConfig?.apiKeyEnv || '').trim()
    if (envName && env[envName]) return env[envName]
    if (llmConfig?.apiKey) return String(llmConfig.apiKey)
    return ''
}

async function createChatCompletion({ llmConfig, messages, traceScope }) {
    const url = buildChatCompletionsUrl(llmConfig.baseURL)
    const apiKey = getApiKey(llmConfig)

    if (!url) throw new Error('missing_agent_llm_base_url')
    if (!llmConfig.model) throw new Error('missing_agent_llm_model')
    if (!apiKey) throw new Error(`missing_agent_llm_api_key:${llmConfig.apiKeyEnv}`)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), llmConfig.timeoutMs)

    try {
        const response = await fetch(url, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: llmConfig.model,
                messages,
                temperature: llmConfig.temperature,
                max_tokens: llmConfig.maxTokens,
                response_format: { type: 'json_object' }
            })
        })

        const text = await response.text()
        if (!response.ok) {
            throw new Error(`agent_llm_http_${response.status}:${text.slice(0, 200)}`)
        }

        let payload
        try {
            payload = JSON.parse(text)
        } catch (error) {
            throw new Error(`agent_llm_invalid_response_json:${logger.getErrorMessage(error)}`)
        }

        const content = payload?.choices?.[0]?.message?.content
        if (typeof content !== 'string' || !content.trim()) {
            throw new Error('agent_llm_empty_message_content')
        }

        return {
            content,
            usage: payload.usage || null,
            model: payload.model || llmConfig.model
        }
    } finally {
        clearTimeout(timeout)
    }
}

module.exports = {
    buildChatCompletionsUrl,
    getApiKey,
    createChatCompletion
}
