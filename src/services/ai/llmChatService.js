'use strict'

function computeDynamicTimeout({ baseTimeoutSeconds, toolTimeoutSeconds, maxTimeoutSeconds, toolCount }) {
    const baseTimeoutMs = baseTimeoutSeconds * 1000
    const toolTimeoutMs = toolTimeoutSeconds * 1000
    const maxTimeoutMs = maxTimeoutSeconds * 1000
    return Math.min(baseTimeoutMs + (toolCount * toolTimeoutMs), maxTimeoutMs)
}

function extractToolResultText(mcpResult) {
    if (mcpResult && Array.isArray(mcpResult.content)) {
        return mcpResult.content.map(item => item.text).filter(Boolean).join('\n')
    }
    if (typeof mcpResult === 'string') return mcpResult
    return JSON.stringify(mcpResult)
}

async function appendHybridSearchResult({ functionName, args, resultText, contextKey, userId, hybridSearchOptions, vectorSearch, log }) {
    if (!(functionName.includes('mem0') && (functionName.includes('search') || functionName.includes('query') || functionName.includes('get')))) {
        return resultText
    }
    const queryText = args.query || args.text || args.content || args.q
    if (!queryText) return resultText
    try {
        const vectorResults = await vectorSearch(contextKey, queryText, 5, userId, hybridSearchOptions)
        if (!vectorResults.length) return resultText
        const vectorText = vectorResults.map(item => `[Local Memory] ${item.userName || '某位用户'}: ${item.text}`).join('\n')
        return `${resultText}\n\n=== Additional Local Memories ===\n${vectorText}`
    } catch (error) {
        log('warn', 'hybrid-search-failed', {
            functionName,
            error: String(error?.message || error || '')
        })
        return resultText
    }
}

async function runChatLoop({
    apiUrl,
    apiKey,
    model,
    temperature,
    messages,
    tools,
    dynamicTimeout,
    contextKey,
    userId,
    intentType,
    ragMode,
    hybridSearchOptions,
    axiosPost,
    executeTool,
    toolExecutionGuardExecute,
    vectorSearch,
    proxyConfig,
    toolExecutionContext,
    log
}) {
    const currentMessages = [...messages]
    let loopCount = 0
    let emptyContentRetries = 0
    let hasToolResult = false
    const steps = []
    const MAX_LOOPS = 10
    const MAX_EMPTY_RETRIES = 2

    while (loopCount < MAX_LOOPS) {
        steps.push({ type: 'llm_request', loop: loopCount + 1, toolCount: tools.length })
        const payload = { model, messages: currentMessages, temperature }
        if (tools.length > 0) payload.tools = tools
        let response
        try {
            response = await axiosPost(apiUrl, payload, {
                headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                proxy: proxyConfig,
                timeout: dynamicTimeout
            })
        } catch (error) {
            if (error.code === 'ECONNABORTED' || String(error.message || '').includes('timeout')) {
                log('error', 'api-timeout', {
                    timeoutMs: dynamicTimeout,
                    toolCount: tools.length,
                    error: String(error.message || '')
                })
                steps.push({ type: 'error', kind: 'api-timeout' })
                return { reply: '抱歉，AI响应超时。请稍后重试。', hasToolResult, rawMessages: currentMessages, steps }
            }
            if (error.response) {
                log('error', 'api-error', {
                    status: error.response.status
                })
                steps.push({ type: 'error', kind: 'api-error', status: error.response.status })
                return { reply: null, hasToolResult, rawMessages: currentMessages, steps }
            }
            log('error', 'api-request-failed', {
                error: String(error.message || '')
            })
            steps.push({ type: 'error', kind: 'api-request-failed' })
            return { reply: null, hasToolResult, rawMessages: currentMessages, steps }
        }

        if (!response.data || !Array.isArray(response.data.choices) || response.data.choices.length === 0) {
            log('error', 'api-response-invalid', {})
            steps.push({ type: 'error', kind: 'api-response-invalid' })
            return { reply: null, hasToolResult, rawMessages: currentMessages, steps }
        }

        const messageData = response.data.choices[0].message
        currentMessages.push(messageData)

        if (messageData.tool_calls && messageData.tool_calls.length > 0) {
            steps.push({ type: 'tool_batch', count: messageData.tool_calls.length, loop: loopCount + 1 })
            log('info', 'tool-batch', {
                count: messageData.tool_calls.length
            })

            for (const toolCall of messageData.tool_calls) {
                const functionName = toolCall.function.name
                steps.push({ type: 'tool_start', functionName, toolCallId: toolCall.id })
                log('info', 'tool-start', {
                    functionName
                })
                let args = {}
                try {
                    args = JSON.parse(toolCall.function.arguments || '{}')
                } catch (error) {
                    log('error', 'tool-args-parse-failed', {
                        functionName,
                        error: String(error.message || '')
                    })
                    steps.push({ type: 'tool_args_parse_failed', functionName })
                }

                let toolContent = ''
                const guarded = await toolExecutionGuardExecute(functionName, ({ signal }) => executeTool(functionName, args, { signal }, toolExecutionContext))
                if (!guarded.ok) {
                    log('warn', 'tool-failed', {
                        functionName,
                        reason: guarded.reason,
                        error: String(guarded.error?.message || guarded.error || '')
                    })
                    steps.push({ type: 'tool_failed', functionName, reason: guarded.reason || 'unknown' })
                    toolContent = `Error executing tool ${functionName}: ${guarded.error.message}`
                } else {
                    hasToolResult = true
                    toolContent = extractToolResultText(guarded.value)
                    toolContent = await appendHybridSearchResult({
                        functionName,
                        args,
                        resultText: toolContent,
                        contextKey,
                        userId,
                        hybridSearchOptions,
                        vectorSearch,
                        log
                    })
                    log('info', 'tool-done', {
                        functionName
                    })
                    steps.push({ type: 'tool_done', functionName })
                }

                currentMessages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    name: functionName,
                    content: toolContent
                })
            }
            loopCount++
            continue
        }

        if (!messageData.content) {
            if (loopCount > 0 && emptyContentRetries < MAX_EMPTY_RETRIES) {
                emptyContentRetries++
                log('warn', 'reply-empty-retry', {
                    retry: emptyContentRetries,
                    maxRetries: MAX_EMPTY_RETRIES
                })
                steps.push({ type: 'reply_empty_retry', retry: emptyContentRetries })
                currentMessages.push({ role: 'user', content: '请根据上述工具调用的结果，回答我的问题。' })
                loopCount++
                continue
            }
            log('warn', 'reply-empty', {})
            steps.push({ type: 'reply_empty' })
            return { reply: null, hasToolResult, rawMessages: currentMessages, steps }
        }

        log('info', 'reply-ready', { hasToolResult })
        steps.push({ type: 'reply_ready', hasToolResult })
        return { reply: messageData.content, hasToolResult, rawMessages: currentMessages, steps }
    }

    log('warn', 'tool-loop-exhausted', {
        maxLoops: MAX_LOOPS
    })
    steps.push({ type: 'tool_loop_exhausted', maxLoops: MAX_LOOPS })
    return { reply: 'Unable to complete request (max steps reached).', hasToolResult, rawMessages: currentMessages, steps }
}

module.exports = {
    computeDynamicTimeout,
    extractToolResultText,
    appendHybridSearchResult,
    runChatLoop
}
