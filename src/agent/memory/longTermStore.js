const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const logger = require('../../utils/logger')
const { extractKeywords } = require('./topicContextEngine')

const MEMORY_DIR = path.join(__dirname, '../../../data/agent/memory')
const MEMORY_FILE = path.join(MEMORY_DIR, 'memories.json')
const MAX_MEMORY_ITEMS = 500
const MAX_CONTENT_LENGTH = 240
const DEFAULT_CONFIDENCE = 0.6

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

function isSensitiveContent(value) {
    const text = String(value || '')
    return /(sk-[A-Za-z0-9_-]{12,}|api[_-]?key|token|password|密码|密钥|cookie|authorization)/i.test(text)
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
        sourceMessageIds,
        sourceDecision: decision?.action || '',
        createdAt,
        updatedAt: createdAt,
        expiresAt: normalizedHint.expiresAt || null
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

        const existing = memories.find((memory) => memory.id === item.id)
        if (existing) {
            existing.updatedAt = nowIso()
            existing.confidence = Math.max(existing.confidence || 0, item.confidence)
            existing.sourceMessageIds = Array.from(new Set([...(existing.sourceMessageIds || []), ...item.sourceMessageIds])).slice(-10)
        } else {
            memories.push(item)
        }
        stored += 1
    }

    memories = memories.filter((memory) => !isExpired(memory)).slice(-MAX_MEMORY_ITEMS)
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

function scoreMemory(memory, { groupId, userId, text }) {
    let score = 0
    if (memory.scope === 'global') score += 0.2
    if (memory.groupId && memory.groupId === groupId) score += 0.4
    if (memory.userId && memory.userId === userId) score += 0.4
    if (memory.scope === 'group' && memory.groupId === groupId) score += 0.3

    const whitespaceWords = String(text || '').toLowerCase().split(/\s+/).filter((word) => word.length >= 2)
    const words = Array.from(new Set([...whitespaceWords, ...extractKeywords(text)]))
    const content = String(memory.content || '').toLowerCase()
    const matches = words.filter((word) => content.includes(word)).length
    score += Math.min(0.3, matches * 0.08)
    score += Math.min(0.2, Number(memory.confidence) || 0)
    return score
}

async function retrieveRelevantMemories({ groupId, userId, text, limit = 5 }) {
    await load()
    const timestamp = Date.now()
    return memories
        .filter((memory) => !isExpired(memory, timestamp))
        .filter((memory) => {
            if (memory.scope === 'global') return true
            if (memory.scope === 'group' || memory.scope === 'topic') return memory.groupId === groupId
            if (memory.scope === 'user') return memory.groupId === groupId && memory.userId === userId
            return false
        })
        .map((memory) => ({ memory, score: scoreMemory(memory, { groupId, userId, text }) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((item) => item.memory)
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
        sourceMessageIds,
        sourceDecision: 'topic_summary',
        createdAt: timestamp,
        updatedAt: timestamp,
        expiresAt: null
    }

    const existing = memories.find((memory) => memory.id === id)
    if (existing) {
        existing.content = item.content
        existing.confidence = Math.max(existing.confidence || 0, item.confidence)
        existing.sourceMessageIds = Array.from(new Set([...(existing.sourceMessageIds || []), ...sourceMessageIds])).slice(-10)
        existing.updatedAt = timestamp
    } else {
        memories.push(item)
    }

    memories = memories.filter((memory) => !isExpired(memory)).slice(-MAX_MEMORY_ITEMS)
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
