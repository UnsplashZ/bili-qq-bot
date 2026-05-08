const SECRET_PATTERNS = [
    /sk-[A-Za-z0-9_-]{16,}/,
    /api[_-]?key\s*[:=]\s*["']?[^"'\s]{12,}/i,
    /authorization\s*:\s*bearer\s+[A-Za-z0-9._-]{12,}/i
]

const INTERNAL_ERROR_PATTERNS = [
    /我刚才没能正确解析/,
    /解析失败/,
    /agent_llm_/i,
    /decision_json_object_not_found/i,
    /(?:JSON|LLM|decision|schema).{0,20}(失败|错误|解析|格式|输出)/i,
    /(失败|错误|解析|格式|输出).{0,20}(JSON|LLM|decision|schema)/i
]

function makeCheck(name, passed, reason = 'ok', detail = {}) {
    return {
        name,
        passed: Boolean(passed),
        reason,
        ...detail
    }
}

function maxReplyChars(agentConfig) {
    const configured = Number(agentConfig?.replyer?.maxReplyChars ?? agentConfig?.replyPolicy?.maxReplyChars)
    return Number.isFinite(configured)
        ? Math.max(80, Math.min(2000, Math.trunc(configured)))
        : 500
}

function maxReplyCharsForDecision(agentConfig, policyDecision) {
    if (policyDecision?.finalAction === 'react') {
        const configured = Number(agentConfig?.social?.maxCasualReplyChars)
        return Number.isFinite(configured)
            ? Math.max(20, Math.min(500, Math.trunc(configured)))
            : 120
    }
    return maxReplyChars(agentConfig)
}

function containsSecret(text) {
    return SECRET_PATTERNS.some((pattern) => pattern.test(String(text || '')))
}

function containsInternalError(text) {
    return INTERNAL_ERROR_PATTERNS.some((pattern) => pattern.test(String(text || '')))
}

function safeFallbackReply(policyDecision = {}, llmDecision = {}) {
    const reasonText = `${policyDecision.reason || ''} ${llmDecision.reason || ''} ${llmDecision.decision?.reason || ''}`
    if (/screenshot|browser_screenshot|截图|截屏|网页图|页面图/i.test(reasonText)) {
        return '这条截图请求还缺少可用的原网页链接。请把链接发出来，或回复我上一条带链接的消息。'
    }
    if (/browser|read_url|search_web|网页|链接|url|http/i.test(reasonText)) {
        return '这条网页请求还缺少可用链接或动作。你可以直接说“总结这个链接”或“截这个网页”。'
    }
    if (/qq_management|禁言|撤回|踢|群管理|加群|好友/i.test(reasonText)) {
        return '这个操作需要明确目标、参数和权限。请补充对象和必要参数后再发一次。'
    }
    return '这句我没理解具体要我做什么。可以直接说动作和对象，比如“总结这个链接”“截图这个网页”或“禁言某人 60 秒”。'
}

function trimReplyDraft(replyDraft, limit) {
    const text = String(replyDraft || '').trim()
    if (text.length <= limit) return text
    return `${text.slice(0, Math.max(0, limit - 3))}...`
}

function evaluateOutputGuardrails({ agentConfig, policyDecision, llmDecision }) {
    const checks = []
    const wouldSend = Boolean(policyDecision?.accepted && policyDecision?.wouldSend)
    const originalReplyDraft = String(policyDecision?.replyDraft || llmDecision?.decision?.replyDraft || '').trim()
    const limit = maxReplyCharsForDecision(agentConfig, policyDecision)
    let replyDraft = wouldSend ? trimReplyDraft(originalReplyDraft, limit) : originalReplyDraft

    checks.push(makeCheck('sendable_policy', wouldSend || !originalReplyDraft, wouldSend ? 'ok' : (policyDecision?.reason || 'not_sending')))

    if (wouldSend) {
        checks.push(makeCheck('reply_not_empty', Boolean(replyDraft), replyDraft ? 'ok' : 'empty_reply_draft'))
        checks.push(makeCheck(
            'reply_length',
            originalReplyDraft.length <= limit,
            originalReplyDraft.length <= limit ? 'ok' : 'reply_trimmed',
            { originalLength: originalReplyDraft.length, maxReplyChars: limit }
        ))
        const hasSecret = containsSecret(originalReplyDraft)
        checks.push(makeCheck('secret_leakage', !hasSecret, hasSecret ? 'possible_secret_leakage' : 'ok'))
        const hasInternalError = containsInternalError(replyDraft)
        checks.push(makeCheck('internal_error_leakage', !hasInternalError, hasInternalError ? 'internal_error_rewritten' : 'ok'))
        if (hasInternalError) {
            replyDraft = trimReplyDraft(safeFallbackReply(policyDecision, llmDecision), limit)
        }
    }

    const secretFailure = checks.find((check) => check.reason === 'possible_secret_leakage')
    return {
        allowed: !secretFailure,
        reason: secretFailure?.reason || 'allowed',
        replyDraft,
        checks
    }
}

function applyOutputGuardrails({ agentConfig, policyDecision, llmDecision }) {
    const outputGuardrail = evaluateOutputGuardrails({ agentConfig, policyDecision, llmDecision })
    if (!outputGuardrail.allowed) {
        return {
            policyDecision: {
                ...policyDecision,
                accepted: false,
                wouldSend: false,
                finalAction: 'listen',
                reason: outputGuardrail.reason,
                outputGuardrail
            },
            outputGuardrail
        }
    }

    if (outputGuardrail.replyDraft && outputGuardrail.replyDraft !== policyDecision?.replyDraft) {
        return {
            policyDecision: {
                ...policyDecision,
                replyDraft: outputGuardrail.replyDraft,
                outputGuardrail
            },
            outputGuardrail
        }
    }

    return {
        policyDecision: {
            ...policyDecision,
            outputGuardrail
        },
        outputGuardrail
    }
}

module.exports = {
    evaluateOutputGuardrails,
    applyOutputGuardrails,
    containsInternalError,
    safeFallbackReply
}
