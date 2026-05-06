const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const logger = require('../../utils/logger')
const { sanitizeContent, isSensitiveContent, isPromptInjectionContent } = require('../memory/longTermStore')

const EXPRESSION_DIR = path.join(__dirname, '../../../data/agent/expression')
const EXPRESSION_FILE = path.join(EXPRESSION_DIR, 'expressions.json')
const MAX_EXPRESSIONS = 300
const MAX_SOURCE_IDS = 20

let loaded = false
let expressions = []
let expressionFile = EXPRESSION_FILE

function nowIso() {
    return new Date().toISOString()
}

function hash(value) {
    return crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, 12)
}

function compactText(value, limit = 180) {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    if (!text) return ''
    return text.length > limit ? `${text.slice(0, limit - 3)}...` : text
}

function normalizeSourceIds(value) {
    return Array.isArray(value)
        ? value.map((item) => String(item || '').trim()).filter(Boolean).slice(-MAX_SOURCE_IDS)
        : []
}

function isUnsafeExpressionText(value) {
    const text = String(value || '')
    if (!text) return true
    if (isSensitiveContent(text) || isPromptInjectionContent(text)) return true
    return /死全家|自杀|开盒|人肉|密码|密钥|token|cookie|authorization/i.test(text)
}

function normalizeExpression(input, groupId) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null
    const situation = compactText(sanitizeContent(input.situation || ''), 120)
    const style = compactText(sanitizeContent(input.style || ''), 180)
    if (isUnsafeExpressionText(situation) || isUnsafeExpressionText(style)) return null
    const confidence = Math.min(1, Math.max(0, Number(input.confidence) || 0.55))
    if (confidence < 0.3) return null
    return {
        id: `expr_${hash(`${groupId}|${situation.toLowerCase()}|${style.toLowerCase()}`)}`,
        groupId: String(groupId || ''),
        situation,
        style,
        sourceMessageIds: normalizeSourceIds(input.sourceMessageIds),
        count: Math.max(1, Math.trunc(Number(input.count) || 1)),
        confidence,
        lastUsedAt: '',
        createdAt: nowIso(),
        updatedAt: nowIso()
    }
}

async function load() {
    if (loaded) return expressions
    loaded = true
    try {
        const raw = await fs.promises.readFile(expressionFile, 'utf8')
        const parsed = JSON.parse(raw)
        expressions = Array.isArray(parsed) ? parsed : []
    } catch (error) {
        if (error.code !== 'ENOENT') {
            logger.logEvent('warn', 'AGENT', '', 'expression-load-failed', { error: logger.getErrorMessage(error) })
        }
        expressions = []
    }
    return expressions
}

async function save() {
    await fs.promises.mkdir(path.dirname(expressionFile), { recursive: true })
    const tmpPath = `${expressionFile}.tmp`
    await fs.promises.writeFile(tmpPath, `${JSON.stringify(expressions, null, 2)}\n`, 'utf8')
    await fs.promises.rename(tmpPath, expressionFile)
}

function rankExpression(expression) {
    const updatedAt = Date.parse(expression.updatedAt || expression.createdAt || '')
    const ageDays = Number.isFinite(updatedAt) ? Math.max(0, (Date.now() - updatedAt) / (24 * 60 * 60 * 1000)) : 999
    const recency = Math.max(0, 1 - ageDays / 60)
    return Number(expression.confidence || 0) * 0.55 + Math.min(0.25, Number(expression.count || 0) * 0.03) + recency * 0.2
}

function prune() {
    expressions = expressions
        .filter((item) => item && item.groupId && item.situation && item.style && Number(item.confidence || 0) >= 0.15)
        .sort((a, b) => rankExpression(b) - rankExpression(a))
        .slice(0, MAX_EXPRESSIONS)
}

async function upsertExpressions({ groupId, candidates = [] } = {}) {
    const normalizedGroupId = String(groupId || '')
    if (!normalizedGroupId || !Array.isArray(candidates) || candidates.length === 0) return { stored: 0, skipped: 0, ids: [] }
    await load()

    let stored = 0
    let skipped = 0
    const ids = []
    for (const candidate of candidates.slice(0, 8)) {
        const item = normalizeExpression(candidate, normalizedGroupId)
        if (!item) {
            skipped += 1
            continue
        }
        const existing = expressions.find((expression) => expression.id === item.id)
        if (existing) {
            existing.count = Math.max(1, Number(existing.count || 0) + item.count)
            existing.confidence = Math.min(1, Math.max(Number(existing.confidence || 0), item.confidence))
            existing.sourceMessageIds = Array.from(new Set([...(existing.sourceMessageIds || []), ...item.sourceMessageIds])).slice(-MAX_SOURCE_IDS)
            existing.updatedAt = nowIso()
            ids.push(existing.id)
        } else {
            expressions.push(item)
            ids.push(item.id)
        }
        stored += 1
    }
    prune()
    await save()
    return { stored, skipped, ids }
}

async function selectExpressions({ groupId, text = '', replyMode = 'reply', limit = 3 } = {}) {
    await load()
    const normalizedGroupId = String(groupId || '')
    if (!normalizedGroupId) return []
    const query = String(text || '').toLowerCase()
    const maxItems = Math.max(0, Math.min(5, Number(limit) || 0))
    if (maxItems === 0) return []

    const minConfidence = replyMode === 'react' ? 0.35 : 0.55
    const selected = expressions
        .filter((item) => item.groupId === normalizedGroupId && Number(item.confidence || 0) >= minConfidence)
        .map((item) => {
            const textMatch = query && (`${item.situation} ${item.style}`).toLowerCase().split(/\s+/).some((word) => word.length >= 2 && query.includes(word))
            return { item, score: rankExpression(item) + (textMatch ? 0.15 : 0) + (replyMode === 'react' ? 0.05 : 0) }
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, maxItems)
        .map(({ item }) => ({
            id: item.id,
            situation: item.situation,
            style: item.style,
            confidence: item.confidence,
            count: item.count
        }))

    if (selected.length > 0) {
        const usedAt = nowIso()
        const ids = new Set(selected.map((item) => item.id))
        expressions.forEach((item) => {
            if (ids.has(item.id)) item.lastUsedAt = usedAt
        })
        await save()
    }
    return selected
}

async function adjustExpressionConfidence({ ids = [], delta = 0, reason = '' } = {}) {
    const targetIds = Array.isArray(ids) ? ids.map(String).filter(Boolean) : []
    if (targetIds.length === 0 || !Number.isFinite(Number(delta))) return { adjusted: 0 }
    await load()
    let adjusted = 0
    const now = nowIso()
    expressions.forEach((item) => {
        if (!targetIds.includes(item.id)) return
        item.confidence = Math.min(1, Math.max(0, Number(item.confidence || 0) + Number(delta)))
        item.updatedAt = now
        item.lastFeedbackReason = reason || ''
        adjusted += 1
    })
    if (adjusted > 0) {
        prune()
        await save()
    }
    return { adjusted }
}

async function listExpressions({ groupId = '', limit = 20 } = {}) {
    await load()
    return expressions
        .filter((item) => !groupId || item.groupId === String(groupId))
        .sort((a, b) => rankExpression(b) - rankExpression(a))
        .slice(0, Math.max(1, Math.min(100, Number(limit) || 20)))
}

function resetForTest(nextExpressionFile = EXPRESSION_FILE) {
    expressionFile = nextExpressionFile
    loaded = true
    expressions = []
}

module.exports = {
    EXPRESSION_FILE,
    load,
    upsertExpressions,
    selectExpressions,
    adjustExpressionConfidence,
    listExpressions,
    resetForTest,
    normalizeExpression,
    isUnsafeExpressionText
}
