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

async function requestChatCompletion({ url, apiKey, llmConfig, messages, signal }) {
    const response = await fetch(url, {
        method: 'POST',
        signal,
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
}

async function createChatCompletion({ llmConfig, messages, traceScope }) {
    const url = buildChatCompletionsUrl(llmConfig.baseURL)
    const apiKey = getApiKey(llmConfig)

    if (!url) throw new Error('missing_agent_llm_base_url')
    if (!llmConfig.model) throw new Error('missing_agent_llm_model')
    if (!apiKey) throw new Error(`missing_agent_llm_api_key:${llmConfig.apiKeyEnv}`)

    const maxAttempts = Math.max(1, Math.min(3, Math.trunc(Number(llmConfig.emptyContentRetries) || 2)))
    let lastError = null

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), llmConfig.timeoutMs)
        try {
            return await requestChatCompletion({
                url,
                apiKey,
                llmConfig,
                messages,
                signal: controller.signal
            })
        } catch (error) {
            lastError = error
            const errorMessage = logger.getErrorMessage(error)
            if (errorMessage !== 'agent_llm_empty_message_content' || attempt >= maxAttempts) {
                throw error
            }
            logger.logEvent('warn', 'AGENT', traceScope || '', 'llm-empty-content-retry', {
                attempt,
                maxAttempts,
                model: llmConfig.model
            })
        } finally {
            clearTimeout(timeout)
        }
    }

    throw lastError || new Error('agent_llm_empty_message_content')
}

module.exports = {
    buildChatCompletionsUrl,
    getApiKey,
    requestChatCompletion,
    createChatCompletion
}
