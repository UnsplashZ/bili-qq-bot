'use strict'

const fs = require('fs').promises
const path = require('path')
const axios = require('axios')
const logger = require('../utils/logger')
const config = require('../config')
const { asyncWriteWithBackup } = require('../utils/storageUtils')
const { getAxiosProxyConfig } = require('../utils/proxyUtils')

const PROFILE_SCHEMA_VERSION = 2
const PROFILE_EVIDENCE_LIMIT = 8
const PROFILE_GENERATION_SAMPLE_LIMIT = 80
const PROFILE_GENERATION_FAILURE_COOLDOWN_MS = 10 * 60 * 1000

function storeLog(level, message, fields = {}) {
    logger.logEvent(level, 'STORE', 'svc:profile', message, fields)
}

function clampPositiveInt(value, fallback) {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
    return fallback
}

function normalizeTimestamp(value) {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function trimString(value, maxLength = 0) {
    if (typeof value !== 'string') return ''
    const trimmed = value.trim()
    if (!maxLength || trimmed.length <= maxLength) return trimmed
    return trimmed.slice(0, maxLength)
}

function normalizeStringList(value, maxItems = 6, maxItemLength = 48) {
    if (!Array.isArray(value)) return []
    const normalized = []
    for (const item of value) {
        const text = trimString(item, maxItemLength)
        if (!text || normalized.includes(text)) continue
        normalized.push(text)
        if (normalized.length >= maxItems) break
    }
    return normalized
}

function buildProfileDataFromSummary(summaryText = '') {
    const summary = trimString(summaryText, 300)
    if (!summary) return null
    return {
        summary,
        topics: [],
        traits: [],
        speakingStyle: [],
        personalFacts: [],
        notes: []
    }
}

function normalizeProfileData(value, fallbackSummary = '') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return buildProfileDataFromSummary(fallbackSummary)
    }

    const summary = trimString(value.summary || fallbackSummary, 300)
    if (!summary) return null

    return {
        summary,
        topics: normalizeStringList(value.topics),
        traits: normalizeStringList(value.traits),
        speakingStyle: normalizeStringList(value.speakingStyle),
        personalFacts: normalizeStringList(value.personalFacts),
        notes: normalizeStringList(value.notes)
    }
}

function summarizeProfileText(entry) {
    if (!entry || typeof entry !== 'object') return ''
    const profileData = normalizeProfileData(entry.profileData, entry.profileSummary || entry.profile || '')
    if (profileData && profileData.summary) {
        return profileData.summary
    }
    return trimString(entry.profileSummary || entry.profile || '', 300)
}

function buildPromptProfileLine(entry) {
    const summary = summarizeProfileText(entry)
    if (!summary) return ''
    const name = trimString(entry.userName, 64) || `用户${entry.userId || ''}` || '用户'
    return `${name}: ${summary}`
}

function normalizeEvidenceItem(item) {
    if (!item || typeof item !== 'object') return null
    const excerpt = trimString(item.excerpt, 120)
    if (!excerpt) return null
    const source = item.source === 'vector_memory' ? 'vector_memory' : 'context'
    const timestamp = normalizeTimestamp(item.timestamp)
    return {
        source,
        excerpt,
        timestamp
    }
}

function normalizeSourceStats(value) {
    const safe = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    return {
        contextMessages: clampPositiveInt(safe.contextMessages, 0),
        vectorMessages: clampPositiveInt(safe.vectorMessages, 0),
        totalMessages: clampPositiveInt(safe.totalMessages, 0),
        lastGeneratedFromMessageCount: clampPositiveInt(safe.lastGeneratedFromMessageCount, 0)
    }
}

function normalizeProfileEntry(entry, userId, fallbackUserName = '') {
    const existing = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : {}
    const normalizedUserId = String(existing.userId || userId || '').trim()
    const profileSummary = summarizeProfileText(existing)
    const profileData = normalizeProfileData(existing.profileData, profileSummary)
    return {
        userId: normalizedUserId,
        userName: trimString(existing.userName || fallbackUserName || `用户${normalizedUserId}`, 64) || `用户${normalizedUserId}`,
        profile: profileSummary || null,
        profileSummary: profileSummary || null,
        profileData,
        profileVersion: profileData ? PROFILE_SCHEMA_VERSION : (existing.profileVersion || null),
        lastUpdated: normalizeTimestamp(existing.lastUpdated),
        totalMessages: clampPositiveInt(existing.totalMessages, 0),
        messagesSinceUpdate: clampPositiveInt(existing.messagesSinceUpdate, 0),
        lastActiveTime: normalizeTimestamp(existing.lastActiveTime),
        generationStatus: ['idle', 'running', 'failed'].includes(existing.generationStatus) ? existing.generationStatus : 'idle',
        lastGenerationAttemptAt: normalizeTimestamp(existing.lastGenerationAttemptAt),
        lastGenerationError: trimString(existing.lastGenerationError, 200) || null,
        evidence: Array.isArray(existing.evidence)
            ? existing.evidence.map(normalizeEvidenceItem).filter(Boolean).slice(0, PROFILE_EVIDENCE_LIMIT)
            : [],
        sourceStats: normalizeSourceStats(existing.sourceStats)
    }
}

function shouldGenerateProfile(entry, { minMessages, updateInterval, now = Date.now() }) {
    if (!entry) return false
    if ((entry.totalMessages || 0) < minMessages) return false
    if (entry.generationStatus === 'running') return false
    if (entry.generationStatus === 'failed' && entry.lastGenerationAttemptAt && (now - entry.lastGenerationAttemptAt) < PROFILE_GENERATION_FAILURE_COOLDOWN_MS) {
        return false
    }
    if (!summarizeProfileText(entry)) return true
    return (entry.messagesSinceUpdate || 0) >= updateInterval
}

function normalizeGeneratedPayload(rawContent, fallbackMaxLength) {
    const content = trimString(rawContent, 4000)
    if (!content) return null

    const jsonBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/i)
    const candidateJson = jsonBlockMatch ? jsonBlockMatch[1].trim() : content

    try {
        const parsed = JSON.parse(candidateJson)
        const profileData = normalizeProfileData({
            summary: parsed.summary,
            topics: parsed.topics,
            traits: parsed.traits,
            speakingStyle: parsed.speakingStyle,
            personalFacts: parsed.personalFacts,
            notes: parsed.notes
        })
        if (profileData) {
            const summary = trimString(profileData.summary, fallbackMaxLength)
            return {
                profileData: {
                    ...profileData,
                    summary
                },
                profileSummary: summary
            }
        }
    } catch (_) {
        // Fall back to plain text summary
    }

    const summary = trimString(content.replace(/```(?:json)?/gi, '').replace(/```/g, ''), fallbackMaxLength)
    if (!summary) return null
    return {
        profileData: buildProfileDataFromSummary(summary),
        profileSummary: summary
    }
}

class UserProfileService {
    constructor() {
        this.dataDir = path.join(process.cwd(), 'data', 'profiles')
        this._resolvedDataDir = path.resolve(this.dataDir)
        this.profiles = new Map()
        this.saveTimers = new Map()
        this._pendingUpdates = new Set()
        this.init()
    }

    async init() {
        try {
            await fs.mkdir(this.dataDir, { recursive: true })
        } catch (e) {
            storeLog('error', 'profile-dir-create-failed', {
                error: logger.getErrorMessage(e)
            })
        }
    }

    _validateGroupId(groupId) {
        const normalized = String(groupId || '').trim()
        if (!/^\d+$/.test(normalized)) {
            throw new Error(`invalid groupId: ${groupId}`)
        }
        return normalized
    }

    _profilePath(groupId) {
        const safeGroupId = this._validateGroupId(groupId)
        const resolved = path.resolve(this._resolvedDataDir, `${safeGroupId}.json`)
        if (resolved !== this._resolvedDataDir && !resolved.startsWith(this._resolvedDataDir + path.sep)) {
            throw new Error(`unsafe profile path for groupId: ${groupId}`)
        }
        return { safeGroupId, resolvedPath: resolved }
    }

    _normalizeGroupProfiles(rawProfiles) {
        const source = rawProfiles && typeof rawProfiles === 'object' && !Array.isArray(rawProfiles) ? rawProfiles : {}
        const normalized = {}
        for (const [userId, entry] of Object.entries(source)) {
            normalized[String(userId)] = normalizeProfileEntry(entry, userId)
        }
        return normalized
    }

    async _loadGroupProfiles(groupId) {
        const { safeGroupId, resolvedPath } = this._profilePath(groupId)
        if (this.profiles.has(safeGroupId)) return this.profiles.get(safeGroupId)
        try {
            const data = await fs.readFile(resolvedPath, 'utf8')
            const parsed = JSON.parse(data)
            const normalized = this._normalizeGroupProfiles(parsed)
            this.profiles.set(safeGroupId, normalized)
            return normalized
        } catch (_) {
            const empty = {}
            this.profiles.set(safeGroupId, empty)
            return empty
        }
    }

    _saveGroupProfilesDebounced(groupId) {
        const { safeGroupId, resolvedPath } = this._profilePath(groupId)
        if (this.saveTimers.has(safeGroupId)) clearTimeout(this.saveTimers.get(safeGroupId))
        this.saveTimers.set(safeGroupId, setTimeout(async () => {
            this.saveTimers.delete(safeGroupId)
            const data = this.profiles.get(safeGroupId)
            if (!data) return
            try {
                await asyncWriteWithBackup(resolvedPath, data)
                storeLog('info', 'profile-saved', {
                    groupId: safeGroupId,
                    userCount: Object.keys(data).length
                })
            } catch (e) {
                storeLog('error', 'profile-save-failed', {
                    groupId: safeGroupId,
                    error: logger.getErrorMessage(e)
                })
            }
        }, 500))
    }

    async recordMessage(groupId, userId, userName) {
        if (String(groupId).startsWith('private_')) return null
        if (!userId) return null

        const safeGroupId = this._validateGroupId(groupId)
        const profiles = await this._loadGroupProfiles(safeGroupId)
        const normalizedUserId = String(userId)
        const existing = normalizeProfileEntry(profiles[normalizedUserId], normalizedUserId, userName)
        const now = Date.now()

        profiles[normalizedUserId] = {
            ...existing,
            userId: normalizedUserId,
            userName: trimString(userName || existing.userName || `用户${normalizedUserId}`, 64) || `用户${normalizedUserId}`,
            totalMessages: (existing.totalMessages || 0) + 1,
            messagesSinceUpdate: (existing.messagesSinceUpdate || 0) + 1,
            lastActiveTime: now
        }

        this._saveGroupProfilesDebounced(safeGroupId)
        return profiles[normalizedUserId]
    }

    getGenerationEligibility(entry) {
        const minMessages = clampPositiveInt(config.aiProfileMinMessages, 30)
        const updateInterval = clampPositiveInt(config.aiProfileUpdateInterval, 50)
        return {
            minMessages,
            updateInterval,
            shouldGenerate: shouldGenerateProfile(entry, { minMessages, updateInterval })
        }
    }

    async maybeScheduleProfileUpdate(groupId, userId, userName, contextService, vectorMemoryService) {
        if (String(groupId).startsWith('private_')) return false
        if (!userId) return false
        const safeGroupId = this._validateGroupId(groupId)
        if (!config.getGroupConfig(safeGroupId, 'aiProfileEnabled')) return false

        const profiles = await this._loadGroupProfiles(safeGroupId)
        const normalizedUserId = String(userId)
        const entry = normalizeProfileEntry(profiles[normalizedUserId], normalizedUserId, userName)
        profiles[normalizedUserId] = entry
        const eligibility = this.getGenerationEligibility(entry)
        if (!eligibility.shouldGenerate) return false

        const pendingKey = `${safeGroupId}:${normalizedUserId}`
        if (this._pendingUpdates.has(pendingKey)) {
            storeLog('debug', 'profile-generate-skipped', {
                groupId: safeGroupId,
                userId: normalizedUserId,
                reason: 'already_in_progress'
            })
            return false
        }

        this._pendingUpdates.add(pendingKey)
        entry.generationStatus = 'running'
        entry.lastGenerationAttemptAt = Date.now()
        entry.lastGenerationError = null
        this._saveGroupProfilesDebounced(safeGroupId)

        try {
            storeLog('info', 'profile-generate-start', {
                groupId: safeGroupId,
                userId: normalizedUserId,
                totalMessages: entry.totalMessages,
                messagesSinceUpdate: entry.messagesSinceUpdate
            })
            await this._generateProfile(safeGroupId, normalizedUserId, userName, entry, contextService, vectorMemoryService)
            return true
        } finally {
            this._pendingUpdates.delete(pendingKey)
        }
    }

    async maybeUpdateProfile(groupId, userId, userName, contextService, vectorMemoryService) {
        return this.maybeScheduleProfileUpdate(groupId, userId, userName, contextService, vectorMemoryService)
    }

    _collectContextMessages(groupId, userId, contextService) {
        const context = (contextService && typeof contextService.getContext === 'function') ? contextService.getContext(groupId) || [] : []
        return context
            .filter(message => {
                if (!message || message.role !== 'user') return false
                const speakerId = message.speakerId || message.userId
                return speakerId != null && String(speakerId) === String(userId)
            })
            .map(message => ({
                text: trimString(message.content, 600),
                timestamp: normalizeTimestamp(message.timestamp),
                source: 'context'
            }))
            .filter(message => message.text)
    }

    async _collectProfileMessages(groupId, userId, contextService, vectorMemoryService) {
        const messages = []
        const contextMessages = this._collectContextMessages(groupId, userId, contextService)
        messages.push(...contextMessages)

        let vectorMessages = []
        if (messages.length < 20 && vectorMemoryService && typeof vectorMemoryService.getMemoriesByUser === 'function') {
            try {
                vectorMessages = await vectorMemoryService.getMemoriesByUser(groupId, String(userId), 120)
                messages.push(...vectorMessages.map(message => ({
                    text: trimString(message.text, 600),
                    timestamp: normalizeTimestamp(message.timestamp),
                    source: 'vector_memory'
                })).filter(message => message.text))
            } catch (e) {
                storeLog('warn', 'profile-memory-fetch-failed', {
                    groupId,
                    userId: String(userId),
                    error: logger.getErrorMessage(e)
                })
            }
        }

        const deduped = []
        const seen = new Set()
        for (const message of messages) {
            const dedupeKey = `${message.source}:${message.timestamp || 0}:${message.text}`
            if (seen.has(dedupeKey)) continue
            seen.add(dedupeKey)
            deduped.push(message)
        }

        deduped.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
        const recentMessages = deduped.slice(-PROFILE_GENERATION_SAMPLE_LIMIT)
        const evidence = recentMessages
            .slice(-PROFILE_EVIDENCE_LIMIT)
            .map(message => ({
                source: message.source,
                timestamp: message.timestamp,
                excerpt: trimString(message.text, 120)
            }))
            .filter(item => item.excerpt)

        return {
            messages: recentMessages,
            evidence,
            sourceStats: {
                contextMessages: contextMessages.length,
                vectorMessages: vectorMessages.length,
                totalMessages: recentMessages.length,
                lastGeneratedFromMessageCount: recentMessages.length
            }
        }
    }

    _buildGenerationPrompt({ entry, userName, profileData, recentMessages, maxLength }) {
        const profileJson = profileData ? JSON.stringify(profileData, null, 2) : '无'
        const messageList = recentMessages.map(message => {
            const time = message.timestamp ? new Date(message.timestamp).toLocaleDateString('zh-CN') : '未知日期'
            const sourceLabel = message.source === 'vector_memory' ? '向量记忆' : '上下文'
            return `[${time}][${sourceLabel}] ${message.text}`
        }).join('\n')

        return [
            `请基于同一位群成员自己的历史发言，生成结构化用户画像。`,
            `严格要求：只能依据提供的该用户本人发言，不要引入其他群成员信息，不要猜测无证据内容。`,
            `请输出 JSON 对象，不要输出额外解释。字段要求：`,
            `- summary: 不超过${maxLength}字的兼容摘要，适合直接注入聊天 prompt`,
            `- topics: 数组，列出常聊/常关心的话题`,
            `- traits: 数组，列出可观察到的性格或互动特点`,
            `- speakingStyle: 数组，列出说话风格`,
            `- personalFacts: 数组，列出明确提到过的个人信息或长期偏好`,
            `- notes: 数组，列出其它稳定观察，避免重复`,
            `如果信息不足，请保守输出，宁缺毋滥。`,
            `用户昵称：${trimString(userName || entry.userName, 64) || '用户'}`,
            `已有画像摘要：${summarizeProfileText(entry) || '无'}`,
            `已有结构化画像：${profileJson}`,
            `该用户可用发言：\n${messageList}`
        ].join('\n')
    }

    async _generateProfile(groupId, userId, userName, entry, contextService, vectorMemoryService) {
        const collected = await this._collectProfileMessages(groupId, userId, contextService, vectorMemoryService)
        const recentMessages = collected.messages
        const baselineMessagesSinceUpdate = clampPositiveInt(entry.messagesSinceUpdate, 0)
        const applyGenerationFailure = async (lastGenerationError) => {
            const profiles = await this._loadGroupProfiles(groupId)
            const currentEntry = normalizeProfileEntry(profiles[userId], userId, userName)
            const remainingMessagesSinceUpdate = Math.max(0, (currentEntry.messagesSinceUpdate || 0) - baselineMessagesSinceUpdate)
            currentEntry.userName = trimString(userName || currentEntry.userName, 64) || currentEntry.userName
            currentEntry.messagesSinceUpdate = remainingMessagesSinceUpdate
            currentEntry.generationStatus = 'failed'
            currentEntry.lastGenerationError = lastGenerationError
            currentEntry.sourceStats = normalizeSourceStats(collected.sourceStats)
            profiles[userId] = currentEntry
            this._saveGroupProfilesDebounced(groupId)
            return currentEntry
        }

        if (recentMessages.length === 0) {
            await applyGenerationFailure('no_messages')
            storeLog('warn', 'profile-generate-skipped', {
                groupId,
                userId: String(userId),
                reason: 'no_messages'
            })
            return
        }

        const maxLength = clampPositiveInt(config.aiProfileMaxLength, 200)
        const prompt = this._buildGenerationPrompt({
            entry,
            userName,
            profileData: entry.profileData,
            recentMessages,
            maxLength
        })

        try {
            const apiUrl = config.aiChatApiUrl || config.aiApiUrl
            const apiKey = config.aiChatApiKey || config.aiApiKey
            const model = config.aiChatModel || config.aiModel
            const proxyConfig = getAxiosProxyConfig(config.aiChatProxy)
            const response = await axios.post(apiUrl, {
                model,
                messages: [
                    { role: 'system', content: '你是一个严谨的用户画像整理助手，只能根据给定用户自己的发言生成客观、保守、结构化的画像。输出必须是 JSON。' },
                    { role: 'user', content: prompt }
                ],
                max_tokens: maxLength * 4,
                temperature: 0.2
            }, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                proxy: proxyConfig,
                timeout: 30000
            })

            const rawContent = response.data?.choices?.[0]?.message?.content
            const normalizedPayload = normalizeGeneratedPayload(rawContent, maxLength)
            if (!normalizedPayload || !normalizedPayload.profileSummary) {
                await applyGenerationFailure('empty_profile')
                storeLog('warn', 'profile-generate-empty', {
                    groupId,
                    userId: String(userId)
                })
                return
            }

            const profiles = await this._loadGroupProfiles(groupId)
            const currentEntry = normalizeProfileEntry(profiles[userId], userId, userName)
            const remainingMessagesSinceUpdate = Math.max(0, (currentEntry.messagesSinceUpdate || 0) - baselineMessagesSinceUpdate)
            currentEntry.userName = trimString(userName || currentEntry.userName, 64) || currentEntry.userName
            currentEntry.profileVersion = PROFILE_SCHEMA_VERSION
            currentEntry.profile = normalizedPayload.profileSummary
            currentEntry.profileSummary = normalizedPayload.profileSummary
            currentEntry.profileData = normalizedPayload.profileData
            currentEntry.evidence = collected.evidence
            currentEntry.sourceStats = normalizeSourceStats(collected.sourceStats)
            currentEntry.lastUpdated = Date.now()
            currentEntry.messagesSinceUpdate = remainingMessagesSinceUpdate
            currentEntry.generationStatus = 'idle'
            currentEntry.lastGenerationError = null
            profiles[userId] = currentEntry
            this._saveGroupProfilesDebounced(groupId)
            storeLog('info', 'profile-updated', {
                groupId,
                userId: String(userId),
                summaryLength: normalizedPayload.profileSummary.length,
                sourceStats: currentEntry.sourceStats
            })
        } catch (e) {
            await applyGenerationFailure(trimString(logger.getErrorMessage(e), 200) || 'generate_failed')
            storeLog('error', 'profile-generate-failed', {
                groupId,
                userId: String(userId),
                error: logger.getErrorMessage(e)
            })
        }
    }

    async getActiveProfiles(groupId, activeUserIds) {
        if (!activeUserIds || activeUserIds.length === 0) return []
        if (String(groupId).startsWith('private_')) return []
        const safeGroupId = this._validateGroupId(groupId)
        const profiles = await this._loadGroupProfiles(safeGroupId)
        return activeUserIds
            .map(uid => normalizeProfileEntry(profiles[String(uid)], String(uid)))
            .filter(entry => !!summarizeProfileText(entry))
    }

    async deleteProfile(groupId, userId) {
        const safeGroupId = this._validateGroupId(groupId)
        const profiles = await this._loadGroupProfiles(safeGroupId)
        const normalizedUserId = String(userId)
        if (profiles[normalizedUserId]) {
            const entry = normalizeProfileEntry(profiles[normalizedUserId], normalizedUserId)
            entry.profile = null
            entry.profileSummary = null
            entry.profileData = null
            entry.profileVersion = null
            entry.lastUpdated = null
            entry.messagesSinceUpdate = 0
            entry.generationStatus = 'idle'
            entry.lastGenerationError = null
            entry.evidence = []
            entry.sourceStats = normalizeSourceStats({})
            profiles[normalizedUserId] = entry
            this._saveGroupProfilesDebounced(safeGroupId)
        }
    }

    async getAllProfiles(groupId) {
        const safeGroupId = this._validateGroupId(groupId)
        return await this._loadGroupProfiles(safeGroupId)
    }

    summarizeProfileText(entry) {
        return summarizeProfileText(entry)
    }

    buildPromptProfileLine(entry) {
        return buildPromptProfileLine(entry)
    }
}

const service = new UserProfileService()

module.exports = service
module.exports.UserProfileService = UserProfileService
module.exports.normalizeProfileEntry = normalizeProfileEntry
module.exports.shouldGenerateProfile = shouldGenerateProfile
module.exports.summarizeProfileText = summarizeProfileText
module.exports.buildPromptProfileLine = buildPromptProfileLine
module.exports.normalizeGeneratedPayload = normalizeGeneratedPayload
module.exports.PROFILE_SCHEMA_VERSION = PROFILE_SCHEMA_VERSION
