const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const logger = require('../../utils/logger')
const { sanitizeContent, isSensitiveContent, isPromptInjectionContent } = require('./longTermStore')

const PROFILE_DIR = path.join(__dirname, '../../../data/agent/profile')
const PROFILE_FILE = path.join(PROFILE_DIR, 'person_profiles.json')
const MAX_PROFILES = 500

let loaded = false
let profiles = []
let profileFile = PROFILE_FILE

function nowIso() {
    return new Date().toISOString()
}

function hash(value) {
    return crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, 12)
}

function compactText(value, limit = 120) {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    if (!text) return ''
    return text.length > limit ? `${text.slice(0, limit - 3)}...` : text
}

function cleanArray(value, limit = 8) {
    if (!Array.isArray(value)) return []
    return Array.from(new Set(value
        .map((item) => compactText(sanitizeContent(item), 120))
        .filter((item) => item && !isSensitiveContent(item) && !isPromptInjectionContent(item))))
        .slice(0, limit)
}

async function load() {
    if (loaded) return profiles
    loaded = true
    try {
        const raw = await fs.promises.readFile(profileFile, 'utf8')
        const parsed = JSON.parse(raw)
        profiles = Array.isArray(parsed) ? parsed : []
    } catch (error) {
        if (error.code !== 'ENOENT') {
            logger.logEvent('warn', 'AGENT', '', 'person-profile-load-failed', { error: logger.getErrorMessage(error) })
        }
        profiles = []
    }
    return profiles
}

async function save() {
    await fs.promises.mkdir(path.dirname(profileFile), { recursive: true })
    const tmpPath = `${profileFile}.tmp`
    await fs.promises.writeFile(tmpPath, `${JSON.stringify(profiles, null, 2)}\n`, 'utf8')
    await fs.promises.rename(tmpPath, profileFile)
}

function profileId(groupId, userId) {
    return `profile_${hash(`${groupId}|${userId}`)}`
}

function profileFromMemory({ groupId, userId, memories = [], sender = {} }) {
    const displayNames = cleanArray([sender.card, sender.nickname, sender.userName, sender.name], 6)
    const preferences = []
    const communicationStyle = []
    const relationshipNotes = []
    const boundaries = []
    const sourceMemoryIds = []

    memories.forEach((memory) => {
        if (memory.scope !== 'user' || String(memory.groupId || '') !== String(groupId || '') || String(memory.userId || '') !== String(userId || '')) return
        const content = compactText(memory.content || '', 140)
        if (!content || isSensitiveContent(content) || isPromptInjectionContent(content)) return
        sourceMemoryIds.push(memory.id)
        if (memory.type === 'preference') preferences.push(content)
        else if (memory.type === 'relation') relationshipNotes.push(content)
        else if (memory.type === 'persona') communicationStyle.push(content)
        else if (/不喜欢|不要|别/.test(content)) boundaries.push(content)
        else relationshipNotes.push(content)
    })

    const confidenceBase = sourceMemoryIds.length > 0 ? 0.55 + Math.min(0.35, sourceMemoryIds.length * 0.05) : 0.35
    return {
        id: profileId(groupId, userId),
        userId: String(userId || ''),
        groupId: String(groupId || ''),
        displayNames: cleanArray(displayNames, 6),
        preferences: cleanArray(preferences, 8),
        communicationStyle: cleanArray(communicationStyle, 6),
        boundaries: cleanArray(boundaries, 6),
        relationshipNotes: cleanArray(relationshipNotes, 8),
        sourceMemoryIds: Array.from(new Set(sourceMemoryIds)).slice(-20),
        confidence: Math.min(1, confidenceBase),
        updatedAt: nowIso()
    }
}

async function upsertProfile(profile) {
    if (!profile?.groupId || !profile?.userId) return { stored: 0, skipped: 1 }
    await load()
    const existing = profiles.find((item) => item.id === profile.id)
    if (existing) {
        existing.displayNames = cleanArray([...existing.displayNames || [], ...profile.displayNames || []], 8)
        existing.preferences = cleanArray([...profile.preferences || [], ...existing.preferences || []], 8)
        existing.communicationStyle = cleanArray([...profile.communicationStyle || [], ...existing.communicationStyle || []], 6)
        existing.boundaries = cleanArray([...profile.boundaries || [], ...existing.boundaries || []], 6)
        existing.relationshipNotes = cleanArray([...profile.relationshipNotes || [], ...existing.relationshipNotes || []], 8)
        existing.sourceMemoryIds = Array.from(new Set([...(existing.sourceMemoryIds || []), ...(profile.sourceMemoryIds || [])])).slice(-20)
        existing.confidence = Math.max(Number(existing.confidence || 0), Number(profile.confidence || 0))
        existing.updatedAt = nowIso()
    } else {
        profiles.push({ ...profile, createdAt: nowIso() })
    }
    profiles = profiles
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
        .slice(0, MAX_PROFILES)
    await save()
    return { stored: 1, skipped: 0, id: profile.id }
}

async function buildAndStoreProfile({ groupId, userId, memories = [], sender = {} } = {}) {
    const profile = profileFromMemory({ groupId, userId, memories, sender })
    if (!profile.groupId || !profile.userId) return { stored: 0, skipped: 1, profile: null }
    const result = await upsertProfile(profile)
    return { ...result, profile }
}

async function getProfile({ groupId, userId } = {}) {
    await load()
    return profiles.find((profile) => profile.groupId === String(groupId || '') && profile.userId === String(userId || '')) || null
}

async function listProfiles({ groupId = '', limit = 20 } = {}) {
    await load()
    return profiles
        .filter((profile) => !groupId || profile.groupId === String(groupId))
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
        .slice(0, Math.max(1, Math.min(100, Number(limit) || 20)))
}

function resetForTest(nextProfileFile = PROFILE_FILE) {
    profileFile = nextProfileFile
    loaded = true
    profiles = []
}

module.exports = {
    PROFILE_FILE,
    load,
    profileFromMemory,
    buildAndStoreProfile,
    getProfile,
    listProfiles,
    resetForTest
}
