const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const logger = require('../../utils/logger')
const { selectRelevantMemories } = require('./memoryRetriever')

const MEMORY_DIR = path.join(__dirname, '../../../data/agent/memory')
const MEMORY_FILE = path.join(MEMORY_DIR, 'memories.json')
const MAX_MEMORY_ITEMS = 500
const MAX_CONTENT_LENGTH = 240
const DEFAULT_CONFIDENCE = 0.6
const EPISODE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const LOW_CONFIDENCE_TTL_MS = 7 * 24 * 60 * 60 * 1000

let loaded = false
let memories = []
let memoryFile = MEMORY_FILE

function nowIso() {
    return new Date().toISOString()
}

function hash(value) {
    return crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, 12)
}

function compactText(value, limit = MAX_CONTENT_LENGTH) {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    if (!text) return ''
    return text.length > limit ? `${text.slice(0, limit - 3)}...` : text
}

function sanitizeContent(value) {
    return compactText(value)
        .replace(/<\/?memory-context>/gi, '[memory-context]')
        .replace(/<\/?system>/gi, '[system]')
        .replace(/```/g, "'''")
}

function addMsIso(baseIso, durationMs) {
    const base = Date.parse(baseIso)
    return new Date((Number.isFinite(base) ? base : Date.now()) + durationMs).toISOString()
}

function isSensitiveContent(value) {
    const text = String(value || '')
    return /(sk-[A-Za-z0-9_-]{12,}|api[_-]?key|token|password|密码|密钥|cookie|authorization)/i.test(text)
}

function inferExpiresAt({ type, confidence, createdAt, explicitExpiresAt }) {
    if (explicitExpiresAt) return explicitExpiresAt
    if (type === 'episode') return addMsIso(createdAt, EPISODE_TTL_MS)
    if (confidence > 0 && confidence < 0.45) return addMsIso(createdAt, LOW_CONFIDENCE_TTL_MS)
    return null
}

function calculateImportance({ scope, type, confidence }) {
    const typeWeight = {
        preference: 0.85,
        relation: 0.8,
        persona: 0.75,
        fact: 0.65,
        episode: 0.45
    }[type] || 0.55
    const scopeWeight = {
        user: 0.08,
        group: 0.06,
        topic: 0.02,
        global: 0.04
    }[scope] || 0
    return Math.min(1, Math.max(0, typeWeight + scopeWeight + (Number(confidence) || 0) * 0.1))
}

function parseUidRelation(content) {
    const match = String(content || '').match(/uid\s*([0-9]{5,})\s*(?:是|=|叫|就是)\s*([\u4e00-\u9fa5A-Za-z0-9_\-]{1,24})/i)
    if (!match) return null
    return { uid: match[1], name: match[2] }
}

function parseNegativeFact(content) {
    const match = String(content || '').match(/([\u4e00-\u9fa5A-Za-z0-9_\-]{1,24})\s*不是\s*([^，。,.!?！？]{1,40})/)
    if (!match) return null
    return { subject: match[1], predicate: String(match[2] || '').trim() }
}

function sameMemoryScope(left, right) {
    if (left.scope !== right.scope) return false
    if (left.groupId !== right.groupId) return false
    if (left.userId !== right.userId) return false
    return true
}

function findConflictIds(item) {
    const conflicts = []
    const uidRelation = parseUidRelation(item.content)
    const negativeFact = parseNegativeFact(item.content)

    for (const memory of memories) {
        if (memory.id === item.id || !sameMemoryScope(memory, item)) continue

        if (uidRelation) {
            const existing = parseUidRelation(memory.content)
            if (existing && existing.uid === uidRelation.uid && existing.name !== uidRelation.name) {
                conflicts.push(memory.id)
            }
            continue
        }

        if (negativeFact) {
            const compactExisting = String(memory.content || '').replace(/\s+/g, '')
            const compactPredicate = negativeFact.predicate.replace(/\s+/g, '')
            if (compactExisting.includes(`${negativeFact.subject}是${compactPredicate}`)) {
                conflicts.push(memory.id)
            }
        }
    }

    return conflicts
}

async function load() {
    if (loaded) return memories
    loaded = true
    try {
        const raw = await fs.promises.readFile(memoryFile, 'utf8')
        const parsed = JSON.parse(raw)
        memories = Array.isArray(parsed) ? parsed : []
    } catch (error) {
        if (error.code !== 'ENOENT') {
            logger.logEvent('warn', 'AGENT', '', 'long-memory-load-failed', {
                error: logger.getErrorMessage(error)
            })
        }
        memories = []
    }
    return memories
}

async function save() {
    await fs.promises.mkdir(path.dirname(memoryFile), { recursive: true })
    const tmpPath = `${memoryFile}.tmp`
    await fs.promises.writeFile(tmpPath, `${JSON.stringify(memories, null, 2)}\n`, 'utf8')
    await fs.promises.rename(tmpPath, memoryFile)
}

function normalizeHint(hint) {
    if (typeof hint === 'string') {
        return { content: hint }
    }
    if (!hint || typeof hint !== 'object' || Array.isArray(hint)) {
        return null
    }
    return hint
}

function buildMemoryItem({ hint, sessionContext, agentMessage, decision }) {
    const normalizedHint = normalizeHint(hint)
    if (!normalizedHint) return null

    const content = sanitizeContent(normalizedHint.content || normalizedHint.text || normalizedHint.value || '')
    if (!content || isSensitiveContent(content)) return null

    const scope = ['global', 'group', 'user', 'topic'].includes(normalizedHint.scope)
        ? normalizedHint.scope
        : 'group'
    const type = ['fact', 'preference', 'relation', 'episode', 'persona'].includes(normalizedHint.type)
        ? normalizedHint.type
        : 'fact'
    const confidence = Math.min(1, Math.max(0, Number(normalizedHint.confidence) || DEFAULT_CONFIDENCE))
    const createdAt = nowIso()
    const sourceMessageIds = [agentMessage?.id].filter(Boolean)
    const dedupeKey = [scope, type, sessionContext?.groupId || '', sessionContext?.userId || '', content.toLowerCase()].join('|')

    return {
        id: `mem_${hash(dedupeKey)}`,
        scope,
        groupId: sessionContext?.groupId || '',
        userId: scope === 'user' || type === 'preference' ? (sessionContext?.userId || '') : '',
        topicId: sessionContext?.topicId || '',
        type,
        content,
        confidence,
        importance: calculateImportance({ scope, type, confidence }),
        sourceMessageIds,
        sourceDecision: decision?.action || '',
        createdAt,
        updatedAt: createdAt,
        lastAccessedAt: null,
        accessCount: 0,
        supersedes: [],
        expiresAt: inferExpiresAt({
            type,
            confidence,
            createdAt,
            explicitExpiresAt: normalizedHint.expiresAt
        })
    }
}

function isExpired(memory, timestamp = Date.now()) {
    if (!memory.expiresAt) return false
    const expiresAt = Date.parse(memory.expiresAt)
    return Number.isFinite(expiresAt) && expiresAt <= timestamp
}

async function storeMemoryHints({ hints, sessionContext, agentMessage, decision }) {
    const rawHints = Array.isArray(hints) ? hints.slice(0, 5) : []
    if (rawHints.length === 0) return { stored: 0, skipped: 0 }

    try {
        await load()
    } catch (error) {
        logger.logEvent('warn', 'AGENT', sessionContext?.traceScope || '', 'long-memory-load-failed', {
            error: logger.getErrorMessage(error)
        })
        return { stored: 0, skipped: rawHints.length, error: logger.getErrorMessage(error) }
    }

    let stored = 0
    let skipped = 0

    for (const hint of rawHints) {
        const item = buildMemoryItem({ hint, sessionContext, agentMessage, decision })
        if (!item) {
            skipped += 1
            continue
        }

        const conflictIds = findConflictIds(item)
        if (conflictIds.length > 0) {
            memories = memories.filter((memory) => !conflictIds.includes(memory.id))
            item.supersedes = conflictIds
        }

        const existing = memories.find((memory) => memory.id === item.id)
        if (existing) {
            existing.updatedAt = nowIso()
            existing.confidence = Math.max(existing.confidence || 0, item.confidence)
            existing.importance = Math.max(existing.importance || 0, item.importance)
            existing.sourceMessageIds = Array.from(new Set([...(existing.sourceMessageIds || []), ...item.sourceMessageIds])).slice(-10)
            existing.supersedes = Array.from(new Set([...(existing.supersedes || []), ...item.supersedes]))
        } else {
            memories.push(item)
        }
        stored += 1
    }

    pruneMemories()
    try {
        await save()
    } catch (error) {
        logger.logEvent('warn', 'AGENT', sessionContext?.traceScope || '', 'long-memory-save-failed', {
            error: logger.getErrorMessage(error)
        })
        return { stored: 0, skipped: rawHints.length, error: logger.getErrorMessage(error) }
    }
    return { stored, skipped }
}

function getRetentionScore(memory) {
    const updatedAt = Date.parse(memory.updatedAt || memory.createdAt || '')
    const ageDays = Number.isFinite(updatedAt) ? Math.max(0, (Date.now() - updatedAt) / (24 * 60 * 60 * 1000)) : 999
    const recency = Math.max(0, 1 - ageDays / 180)
    return (
        (Number(memory.importance) || 0) * 0.55 +
        (Number(memory.confidence) || 0) * 0.25 +
        Math.min(0.1, (Number(memory.accessCount) || 0) * 0.01) +
        recency * 0.1
    )
}

function pruneMemories() {
    memories = memories
        .filter((memory) => !isExpired(memory))
        .sort((a, b) => getRetentionScore(b) - getRetentionScore(a))
        .slice(0, MAX_MEMORY_ITEMS)
}

async function retrieveRelevantMemories({ groupId, userId, topicId = '', text, limit = 5 }) {
    await load()
    const timestamp = Date.now()
    const selected = selectRelevantMemories({
        memories,
        groupId,
        userId,
        topicId,
        text,
        limit,
        timestamp,
        isExpired
    })
    if (selected.length > 0) {
        const accessedAt = nowIso()
        selected.forEach((memory) => {
            memory.lastAccessedAt = accessedAt
            memory.accessCount = (Number(memory.accessCount) || 0) + 1
        })
        try {
            await save()
        } catch (error) {
            logger.logEvent('warn', 'AGENT', '', 'long-memory-access-save-failed', {
                error: logger.getErrorMessage(error)
            })
        }
    }
    return selected
}

async function listMemories({ groupId = '', userId = '', limit = 10 } = {}) {
    await load()
    const timestamp = Date.now()
    return memories
        .filter((memory) => !isExpired(memory, timestamp))
        .filter((memory) => !groupId || memory.groupId === groupId || memory.scope === 'global')
        .filter((memory) => !userId || memory.userId === userId)
        .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))
        .slice(0, limit)
}

async function storeTopicSummary({ sessionContext, topicSnapshot, content, confidence = 0.55 }) {
    const topicId = topicSnapshot?.topicId || sessionContext?.topicId || ''
    const groupId = sessionContext?.groupId || ''
    const safeContent = sanitizeContent(content)
    if (!groupId || !topicId || !safeContent || isSensitiveContent(safeContent)) {
        return { stored: 0, skipped: 1 }
    }

    await load()
    const timestamp = nowIso()
    const id = `mem_topic_${hash(`${groupId}|${topicId}`)}`
    const sourceMessageIds = Array.isArray(topicSnapshot?.recentMessageIds)
        ? topicSnapshot.recentMessageIds.slice(-10).filter(Boolean)
        : []
    const item = {
        id,
        scope: 'topic',
        groupId,
        userId: '',
        topicId,
        type: 'episode',
        content: safeContent,
        confidence: Math.min(1, Math.max(0, Number(confidence) || DEFAULT_CONFIDENCE)),
        importance: calculateImportance({ scope: 'topic', type: 'episode', confidence }),
        sourceMessageIds,
        sourceDecision: 'topic_summary',
        createdAt: timestamp,
        updatedAt: timestamp,
        lastAccessedAt: null,
        accessCount: 0,
        supersedes: [],
        expiresAt: inferExpiresAt({
            type: 'episode',
            confidence,
            createdAt: timestamp,
            explicitExpiresAt: null
        })
    }

    const existing = memories.find((memory) => memory.id === id)
    if (existing) {
        existing.content = item.content
        existing.confidence = Math.max(existing.confidence || 0, item.confidence)
        existing.importance = Math.max(existing.importance || 0, item.importance)
        existing.sourceMessageIds = Array.from(new Set([...(existing.sourceMessageIds || []), ...sourceMessageIds])).slice(-10)
        existing.updatedAt = timestamp
    } else {
        memories.push(item)
    }

    pruneMemories()
    await save()
    return { stored: 1, skipped: 0, id }
}

async function deleteMemory(memoryId) {
    const id = String(memoryId || '').trim()
    if (!id) return false
    await load()
    const before = memories.length
    memories = memories.filter((memory) => memory.id !== id)
    if (memories.length === before) return false
    await save()
    return true
}

async function clearMemories({ groupId = '', userId = '' } = {}) {
    await load()
    const before = memories.length
    memories = memories.filter((memory) => {
        if (groupId && memory.groupId !== groupId) return true
        if (userId && memory.userId !== userId) return true
        return false
    })
    const removed = before - memories.length
    if (removed > 0) {
        await save()
    }
    return removed
}

function resetForTest(nextMemoryFile = MEMORY_FILE) {
    memoryFile = nextMemoryFile
    loaded = true
    memories = []
}

module.exports = {
    MEMORY_FILE,
    load,
    storeMemoryHints,
    retrieveRelevantMemories,
    listMemories,
    storeTopicSummary,
    deleteMemory,
    clearMemories,
    resetForTest,
    sanitizeContent
}
