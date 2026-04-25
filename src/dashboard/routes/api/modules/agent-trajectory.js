const fs = require('fs')
const path = require('path')
const express = require('express')
const { RUNS_DIR } = require('../../../../agent/runtime/trajectoryRecorder')
const { dashLog } = require('../shared/logging')

const router = express.Router()
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function parseLimit(value) {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isFinite(parsed)) return 100
    return Math.max(1, Math.min(300, parsed))
}

function normalizeFilter(value) {
    return String(value || '').trim()
}

async function listRunFiles(date = '') {
    try {
        const files = await fs.promises.readdir(RUNS_DIR)
        return files
            .filter((file) => file.endsWith('.jsonl'))
            .filter((file) => !date || file === `${date}.jsonl`)
            .sort()
            .map((file) => path.join(RUNS_DIR, file))
    } catch (error) {
        if (error.code === 'ENOENT') return []
        throw error
    }
}

function safeArray(value) {
    return Array.isArray(value) ? value : []
}

function summarizeTrajectory(event) {
    const llmDecision = event.llmDecision || {}
    const llmDecisionBody = llmDecision.decision || {}
    const policyDecision = event.policyDecision || {}
    const execution = event.execution || {}
    const toolPlan = event.toolPlanResult?.plan || event.toolConfirmation?.plan || null

    return {
        type: String(event.type || ''),
        recordedAt: event.recordedAt || '',
        traceScope: event.traceScope || '',
        groupId: String(event.groupId || ''),
        userId: String(event.userId || ''),
        messageId: String(event.messageId || ''),
        topicId: String(event.topicId || ''),
        rawTextPreview: String(event.rawTextPreview || ''),
        ruleDecision: {
            action: event.decision?.action || '',
            score: event.decision?.score ?? event.score?.score ?? null,
            wouldReply: Boolean(event.decision?.wouldReply),
            reasons: safeArray(event.decision?.reasons || event.score?.reasons),
            penalties: safeArray(event.decision?.penalties || event.score?.penalties)
        },
        messageTraits: event.messageTraits || event.score?.traits || {},
        budgetDecision: event.budgetDecision
            ? {
                allowed: Boolean(event.budgetDecision.allowed),
                reason: event.budgetDecision.reason || '',
                groupCount: event.budgetDecision.groupCount ?? null,
                userCount: event.budgetDecision.userCount ?? null
            }
            : null,
        llmDecision: {
            status: llmDecision.status || '',
            action: llmDecisionBody.action || '',
            confidence: llmDecisionBody.confidence ?? null,
            reason: llmDecisionBody.reason || llmDecision.reason || '',
            topic: llmDecisionBody.topic || '',
            replyStyle: llmDecisionBody.replyStyle || '',
            replyDraftPreview: String(llmDecisionBody.replyDraft || '').slice(0, 160),
            model: llmDecision.model || '',
            repaired: Boolean(llmDecision.repaired),
            totalTokens: llmDecision.usage?.total_tokens ?? null
        },
        policyDecision: {
            accepted: Boolean(policyDecision.accepted),
            finalAction: policyDecision.finalAction || '',
            reason: policyDecision.reason || '',
            wouldSend: Boolean(policyDecision.wouldSend)
        },
        execution: {
            executed: Boolean(execution.executed),
            reason: execution.reason || '',
            action: execution.action || ''
        },
        memoryWrite: event.memoryWrite || null,
        topicSummaryWrite: event.topicSummaryWrite || null,
        tool: toolPlan
            ? {
                status: event.toolPlanResult?.status || event.toolConfirmation?.status || '',
                name: toolPlan.name || '',
                risk: toolPlan.risk || '',
                summary: toolPlan.summary || ''
            }
            : null,
        actor: event.actor
            ? {
                isRoot: Boolean(event.actor.isRoot),
                isConfiguredGroupAdmin: Boolean(event.actor.isConfiguredGroupAdmin),
                qqRole: event.actor.qqRole || '',
                canManageGroupConfig: Boolean(event.actor.canManageGroupConfig),
                canManageSubscriptions: Boolean(event.actor.canManageSubscriptions),
                canManageGlobalConfig: Boolean(event.actor.canManageGlobalConfig)
            }
            : null
    }
}

function matchesFilters(item, filters) {
    if (filters.groupId && item.groupId !== filters.groupId) return false
    if (filters.userId && item.userId !== filters.userId) return false
    if (filters.action === 'tool_plan' && item.tool) return true
    if (filters.action && item.llmDecision.action !== filters.action && item.policyDecision.finalAction !== filters.action) return false
    if (filters.type && item.type !== filters.type) return false
    return true
}

async function readTrajectoryItems({ date, limit, filters }) {
    const files = await listRunFiles(date)
    const items = []

    for (const filePath of files.reverse()) {
        const content = await fs.promises.readFile(filePath, 'utf8')
        const lines = content.split('\n').filter(Boolean).reverse()
        for (const line of lines) {
            try {
                const item = summarizeTrajectory(JSON.parse(line))
                if (!matchesFilters(item, filters)) continue
                items.push(item)
                if (items.length >= limit) return items
            } catch {
                // Ignore malformed historical lines and continue reading newer records.
            }
        }
    }

    return items
}

router.get('/agent/trajectories', async (req, res) => {
    try {
        const date = normalizeFilter(req.query.date)
        if (date && !DATE_PATTERN.test(date)) {
            return res.status(400).json({ error: 'date must be YYYY-MM-DD' })
        }

        const limit = parseLimit(req.query.limit)
        const filters = {
            groupId: normalizeFilter(req.query.groupId),
            userId: normalizeFilter(req.query.userId),
            action: normalizeFilter(req.query.action),
            type: normalizeFilter(req.query.type)
        }
        const items = await readTrajectoryItems({ date, limit, filters })
        res.json({ items, limit })
    } catch (error) {
        dashLog(req, 'error', 'agent-trajectory-list-failed', { error: error.message })
        res.status(500).json({ error: 'Failed to list agent trajectories' })
    }
})

module.exports = router
