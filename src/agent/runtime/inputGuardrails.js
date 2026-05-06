function checkMessageShape(agentMessage = {}) {
    const hasText = Boolean(String(agentMessage.normalizedText || agentMessage.rawText || '').trim())
    const hasSender = Boolean(String(agentMessage.userId || '').trim())
    return [
        {
            name: 'message_text',
            passed: hasText,
            reason: hasText ? 'text_available' : 'empty_message_text'
        },
        {
            name: 'message_sender',
            passed: hasSender,
            reason: hasSender ? 'sender_available' : 'missing_sender'
        }
    ]
}

function checkBudgetDecision(budgetDecision = null) {
    if (!budgetDecision) {
        return {
            name: 'llm_budget',
            passed: true,
            reason: 'budget_not_checked'
        }
    }
    return {
        name: 'llm_budget',
        passed: budgetDecision.allowed !== false,
        reason: budgetDecision.reason || (budgetDecision.allowed === false ? 'budget_blocked' : 'budget_allowed'),
        detail: {
            groupCount: budgetDecision.groupCount ?? null,
            userCount: budgetDecision.userCount ?? null
        }
    }
}

function evaluateInputGuardrails({ agentMessage, budgetDecision } = {}) {
    const checks = [
        ...checkMessageShape(agentMessage),
        checkBudgetDecision(budgetDecision)
    ]
    const failed = checks.find((check) => !check.passed)
    return {
        allowed: !failed,
        reason: failed ? failed.reason : 'allowed',
        checks
    }
}

module.exports = {
    evaluateInputGuardrails
}
