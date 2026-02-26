'use strict'

const fs = require('fs').promises
const path = require('path')
const logger = require('../utils/logger')
const config = require('../config')
const { asyncWriteWithBackup } = require('../utils/storageUtils')
const { getAxiosProxyConfig } = require('../utils/proxyUtils')

class UserProfileService {
    constructor() {
        this.dataDir = path.join(process.cwd(), 'data', 'profiles')
        this.profiles = new Map()  // groupId -> { userId -> profileEntry }
        this.saveTimers = new Map()
        this.init()
    }

    async init() {
        try {
            await fs.mkdir(this.dataDir, { recursive: true })
        } catch (e) {
            logger.error('[UserProfile] Failed to create profiles dir:', e)
        }
    }

    _profilePath(groupId) {
        return path.join(this.dataDir, `${groupId}.json`)
    }

    async _loadGroupProfiles(groupId) {
        if (this.profiles.has(groupId)) return this.profiles.get(groupId)
        try {
            const data = await fs.readFile(this._profilePath(groupId), 'utf8')
            const parsed = JSON.parse(data)
            this.profiles.set(groupId, parsed)
            return parsed
        } catch (e) {
            const empty = {}
            this.profiles.set(groupId, empty)
            return empty
        }
    }

    _saveGroupProfilesDebounced(groupId) {
        if (this.saveTimers.has(groupId)) clearTimeout(this.saveTimers.get(groupId))
        this.saveTimers.set(groupId, setTimeout(async () => {
            this.saveTimers.delete(groupId)
            const data = this.profiles.get(groupId)
            if (!data) return
            try {
                await asyncWriteWithBackup(this._profilePath(groupId), data)
            } catch (e) {
                logger.error(`[UserProfile] Failed to save profiles for ${groupId}:`, e)
            }
        }, 500))
    }

    /**
     * 记录用户发言，更新基础元数据（始终运行，无 LLM 调用）
     */
    async recordMessage(groupId, userId, userName) {
        if (String(groupId).startsWith('private_')) return
        if (!userId) return

        const profiles = await this._loadGroupProfiles(String(groupId))
        const existing = profiles[userId]
        const now = Date.now()

        profiles[userId] = {
            userId: String(userId),
            userName: userName || (existing ? existing.userName : `用户${userId}`),
            profile: existing ? existing.profile : null,
            lastUpdated: existing ? existing.lastUpdated : null,
            totalMessages: (existing ? existing.totalMessages : 0) + 1,
            messagesSinceUpdate: (existing ? existing.messagesSinceUpdate : 0) + 1,
            lastActiveTime: now
        }

        this._saveGroupProfilesDebounced(String(groupId))
    }

    /**
     * 检查并触发画像更新（fire-and-forget，调用方须加 .catch()）
     */
    async maybeUpdateProfile(groupId, userId, userName, contextService, vectorMemoryService) {
        if (String(groupId).startsWith('private_')) return
        if (!userId) return
        if (!config.getGroupConfig(String(groupId), 'aiProfileEnabled')) return

        const profiles = await this._loadGroupProfiles(String(groupId))
        const entry = profiles[userId]
        if (!entry) return

        const minMessages = config.aiProfileMinMessages
        const updateInterval = config.aiProfileUpdateInterval

        const shouldGenerate = entry.totalMessages >= minMessages &&
            (!entry.profile || entry.messagesSinceUpdate >= updateInterval)

        if (!shouldGenerate) return

        logger.info(`[UserProfile] Generating profile for user ${userId} in group ${groupId}`)
        await this._generateProfile(String(groupId), userId, userName, entry, contextService, vectorMemoryService)
    }

    async _generateProfile(groupId, userId, userName, entry, contextService, vectorMemoryService) {
        // 1. 收集消息（上下文优先，不足时从向量记忆补充）
        const messages = []

        const context = (contextService && contextService.getContext) ? contextService.getContext(groupId) || [] : []
        const ctxMessages = context.filter(m => m.userId && String(m.userId) === String(userId))
        messages.push(...ctxMessages.map(m => ({ text: m.content, timestamp: m.timestamp })))

        if (messages.length < 20 && vectorMemoryService) {
            try {
                const vecMessages = await vectorMemoryService.getMemoriesByUser(groupId, String(userId), 100)
                for (const m of vecMessages) {
                    if (!messages.find(x => x.text === m.text)) {
                        messages.push(m)
                    }
                }
            } catch (e) {
                logger.warn('[UserProfile] Failed to fetch vector memories for profile:', e)
            }
        }

        messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
        const recent = messages.slice(-100)

        if (recent.length === 0) {
            logger.warn(`[UserProfile] No messages found for user ${userId} in group ${groupId}, skipping profile generation`)
            return
        }

        // 2. 构建 prompt
        const maxLength = config.aiProfileMaxLength
        const messageList = recent.map(m => {
            const time = m.timestamp ? new Date(m.timestamp).toLocaleDateString('zh-CN') : '未知日期'
            return `[${time}] ${m.text}`
        }).join('\n')

        const promptParts = [
            `请根据以下群聊中某位用户的历史发言，生成一段简短的用户画像（不超过${maxLength}字）。`,
            `画像应包含：这个人感兴趣的话题、性格特征、说话风格、提到过的个人信息等。`,
            `只描述客观可观察的特征，不做主观评价。`,
        ]
        if (entry.profile) {
            promptParts.push(`如果已有旧画像，请在旧画像基础上增量更新，保留仍然有效的信息，加入新观察到的特征。`)
        }
        promptParts.push(`\n用户昵称：${userName || entry.userName}`)
        if (entry.profile) {
            promptParts.push(`\n旧画像：${entry.profile}`)
        }
        promptParts.push(`\n该用户最近的发言：\n${messageList}`)

        const prompt = promptParts.join('\n')

        // 3. 调用 LLM（复用聊天模型配置，与 aiHandler 保持一致的回退逻辑）
        try {
            const axios = require('axios')
            const apiUrl = config.aiChatApiUrl || config.aiApiUrl
            const apiKey = config.aiChatApiKey || config.aiApiKey
            const model = config.aiChatModel || config.aiModel
            const proxyConfig = getAxiosProxyConfig(config.aiChatProxy)
            const response = await axios.post(apiUrl, {
                model,
                messages: [
                    { role: 'system', content: '你是一个分析用户画像的助手，请简洁客观地描述用户特征。' },
                    { role: 'user', content: prompt }
                ],
                max_tokens: maxLength * 2,
                temperature: 0.3
            }, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                proxy: proxyConfig,
                timeout: 30000
            })

            const newProfile = response.data?.choices?.[0]?.message?.content?.trim()
            if (!newProfile) {
                logger.warn('[UserProfile] LLM returned empty profile content')
                return
            }

            // 4. 保存
            const profiles = await this._loadGroupProfiles(groupId)
            if (profiles[userId]) {
                profiles[userId].profile = newProfile
                profiles[userId].lastUpdated = Date.now()
                profiles[userId].messagesSinceUpdate = 0
                this._saveGroupProfilesDebounced(groupId)
                logger.info(`[UserProfile] Profile updated for user ${userId} in group ${groupId}`)
            }
        } catch (e) {
            logger.error('[UserProfile] LLM call failed during profile generation:', e)
        }
    }

    /**
     * 获取活跃用户的画像列表（供 aiHandler 注入 system prompt）
     */
    async getActiveProfiles(groupId, activeUserIds) {
        if (!activeUserIds || activeUserIds.length === 0) return []
        const profiles = await this._loadGroupProfiles(String(groupId))
        return activeUserIds
            .map(uid => profiles[String(uid)])
            .filter(Boolean)
    }

    /**
     * 删除某用户画像（重置）
     */
    async deleteProfile(groupId, userId) {
        const profiles = await this._loadGroupProfiles(String(groupId))
        if (profiles[String(userId)]) {
            delete profiles[String(userId)].profile
            delete profiles[String(userId)].lastUpdated
            profiles[String(userId)].messagesSinceUpdate = 0
            this._saveGroupProfilesDebounced(String(groupId))
        }
    }

    /**
     * 获取某群所有画像（供 WebUI 展示）
     */
    async getAllProfiles(groupId) {
        return await this._loadGroupProfiles(String(groupId))
    }
}

module.exports = new UserProfileService()
