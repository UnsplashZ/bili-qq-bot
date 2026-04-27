const SECRET_PATTERNS = [
    /sk-[A-Za-z0-9_-]{16,}/,
    /api[_-]?key\s*[:=]\s*["']?[^"'\s]{12,}/i,
    /authorization\s*:\s*bearer\s+[A-Za-z0-9._-]{12,}/i
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
    const configured = Number(agentConfig?.replyPolicy?.maxReplyChars)
    return Number.isFinite(configured)
        ? Math.max(80, Math.min(2000, Math.trunc(configured)))
        : 500
}

function maxReplyCharsForDecision(agentConfig, policyDecision) {
    if (policyDecision?.finalAction === 'casual_interject' || policyDecision?.finalAction === 'ambient_react') {
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
    const replyDraft = wouldSend ? trimReplyDraft(originalReplyDraft, limit) : originalReplyDraft

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
                finalAction: 'observe_only',
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
    applyOutputGuardrails
}
