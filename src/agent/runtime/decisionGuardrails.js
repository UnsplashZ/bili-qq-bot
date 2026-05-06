const { ALLOWED_ACTIONS } = require('../cognition/decisionSchema')

function makeCheck(name, passed, reason = 'ok', detail = {}) {
    return {
        name,
        passed: Boolean(passed),
        reason,
        ...detail
    }
}

function evaluateDecisionGuardrails(llmDecision) {
    const checks = []
    const decision = llmDecision?.decision || null

    checks.push(makeCheck(
        'decision_available',
        Boolean(decision),
        decision ? 'ok' : (llmDecision?.reason || llmDecision?.status || 'llm_decision_unavailable')
    ))

    if (decision) {
        checks.push(makeCheck(
            'action_allowed',
            ALLOWED_ACTIONS.has(decision.action),
            ALLOWED_ACTIONS.has(decision.action) ? 'ok' : `invalid_decision_action:${decision.action || 'empty'}`,
            { action: decision.action || '' }
        ))

        checks.push(makeCheck(
            'confidence_range',
            Number.isFinite(Number(decision.confidence)) && decision.confidence >= 0 && decision.confidence <= 1,
            'invalid_confidence',
            { confidence: decision.confidence }
        ))

        checks.push(makeCheck(
            'participation_consistency',
            !decision.participation?.action || decision.participation.action === decision.action,
            decision.participation?.action && decision.participation.action !== decision.action ? 'participation_action_mismatch' : 'ok'
        ))

        checks.push(makeCheck(
            'tool_intent_consistency',
            decision.action !== 'act' || Boolean(decision.toolIntent),
            decision.action === 'act' && !decision.toolIntent ? 'missing_tool_intent' : 'ok'
        ))

        checks.push(makeCheck(
            'reply_draft_consistency',
            !['listen', 'wait', 'act'].includes(decision.action) || !decision.replyDraft,
            ['listen', 'wait', 'act'].includes(decision.action) && decision.replyDraft ? 'non_reply_action_reply_must_be_empty' : 'ok'
        ))
    }

    const failed = checks.find((check) => !check.passed)
    return {
        allowed: !failed,
        reason: failed?.reason || 'allowed',
        checks
    }
}

module.exports = {
    evaluateDecisionGuardrails
}
