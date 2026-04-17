'use strict'

const assert = require('assert')
const axios = require('axios')

const config = require('../../src/config')
const { UserProfileService, normalizeProfileEntry, shouldGenerateProfile, summarizeProfileText, buildPromptProfileLine, normalizeGeneratedPayload, PROFILE_SCHEMA_VERSION } = require('../../src/services/userProfileService')

describe('userProfileService refactor coverage', function () {
    const originals = {
        post: axios.post,
        aiProfileMaxLength: config.aiProfileMaxLength
    }

    afterEach(function () {
        axios.post = originals.post
        config.aiProfileMaxLength = originals.aiProfileMaxLength
    })

    it('旧版纯文本画像会被归一化为结构化兼容格式', function () {
        const normalized = normalizeProfileEntry({
            userId: '42',
            userName: '张三',
            profile: '喜欢二次元和游戏',
            totalMessages: 31,
            messagesSinceUpdate: 3,
            lastActiveTime: Date.now()
        }, '42')

        assert.strictEqual(normalized.profileSummary, '喜欢二次元和游戏')
        assert.strictEqual(normalized.profile, '喜欢二次元和游戏')
        assert.strictEqual(normalized.profileData.summary, '喜欢二次元和游戏')
        assert.strictEqual(normalized.profileVersion, PROFILE_SCHEMA_VERSION)
    })

    it('结构化画像仍可产出兼容摘要注入文本', function () {
        const normalized = normalizeProfileEntry({
            userId: '42',
            userName: '张三',
            profileData: {
                summary: '说话直接，常聊游戏和硬件',
                topics: ['游戏', '硬件'],
                traits: ['直接']
            }
        }, '42')

        assert.strictEqual(summarizeProfileText(normalized), '说话直接，常聊游戏和硬件')
        assert.strictEqual(buildPromptProfileLine(normalized), '张三: 说话直接，常聊游戏和硬件')
    })

    it('画像触发资格会兼顾首次生成、增量更新与失败冷却', function () {
        const eligibleFirst = shouldGenerateProfile({
            totalMessages: 30,
            messagesSinceUpdate: 1,
            generationStatus: 'idle',
            profile: null
        }, {
            minMessages: 30,
            updateInterval: 50,
            now: Date.now()
        })
        assert.strictEqual(eligibleFirst, true)

        const eligibleUpdate = shouldGenerateProfile({
            totalMessages: 120,
            messagesSinceUpdate: 50,
            generationStatus: 'idle',
            profileSummary: '旧画像'
        }, {
            minMessages: 30,
            updateInterval: 50,
            now: Date.now()
        })
        assert.strictEqual(eligibleUpdate, true)

        const blockedRecentFailure = shouldGenerateProfile({
            totalMessages: 120,
            messagesSinceUpdate: 80,
            generationStatus: 'failed',
            lastGenerationAttemptAt: Date.now(),
            profileSummary: '旧画像'
        }, {
            minMessages: 30,
            updateInterval: 50,
            now: Date.now()
        })
        assert.strictEqual(blockedRecentFailure, false)
    })

    it('模型输出可在 JSON 和纯文本摘要之间兼容回退', function () {
        const normalized = normalizeGeneratedPayload(JSON.stringify({
            summary: '喜欢直来直去，常聊番剧',
            topics: ['番剧'],
            traits: ['直接'],
            speakingStyle: ['短句'],
            personalFacts: ['会追新番'],
            notes: ['常用口头禅']
        }), 200)

        assert.strictEqual(normalized.profileSummary, '喜欢直来直去，常聊番剧')
        assert.deepStrictEqual(normalized.profileData.topics, ['番剧'])

        const fallback = normalizeGeneratedPayload('  只输出一段摘要也要兼容  ', 200)
        assert.strictEqual(fallback.profileSummary, '只输出一段摘要也要兼容')
    })

    it('生成成功时会保留请求期间新增的 messagesSinceUpdate', async function () {
        const service = new UserProfileService()
        const groupId = '10001'
        const userId = '20002'
        const baselineEntry = normalizeProfileEntry({
            userId,
            userName: '张三',
            totalMessages: 30,
            messagesSinceUpdate: 4,
            generationStatus: 'running'
        }, userId, '张三')

        service.profiles.set(groupId, {
            [userId]: baselineEntry
        })
        service._saveGroupProfilesDebounced = () => {}
        config.aiProfileMaxLength = 120

        axios.post = async () => {
            await service.recordMessage(groupId, userId, '张三')
            await service.recordMessage(groupId, userId, '张三')
            return {
                data: {
                    choices: [{
                        message: {
                            content: JSON.stringify({
                                summary: '常聊番剧和游戏',
                                topics: ['番剧', '游戏'],
                                traits: ['直接']
                            })
                        }
                    }]
                }
            }
        }

        await service._generateProfile(groupId, userId, '张三', baselineEntry, {
            getContext: () => [{
                role: 'user',
                speakerId: userId,
                content: '今天继续聊番剧',
                timestamp: Date.now() - 1000
            }]
        }, null)

        const saved = service.profiles.get(groupId)[userId]
        assert.strictEqual(saved.profileSummary, '常聊番剧和游戏')
        assert.strictEqual(saved.messagesSinceUpdate, 2)
        assert.strictEqual(saved.generationStatus, 'idle')
        assert.strictEqual(saved.totalMessages, 32)
        assert.deepStrictEqual(saved.sourceStats, {
            contextMessages: 1,
            vectorMessages: 0,
            totalMessages: 1,
            lastGeneratedFromMessageCount: 1
        })
    })

    it('生成失败时会回写当前存储条目并保留请求期间新增的 messagesSinceUpdate', async function () {
        const service = new UserProfileService()
        const groupId = '10001'
        const userId = '20002'
        const baselineEntry = normalizeProfileEntry({
            userId,
            userName: '张三',
            totalMessages: 30,
            messagesSinceUpdate: 4,
            generationStatus: 'running'
        }, userId, '张三')

        service.profiles.set(groupId, {
            [userId]: baselineEntry
        })
        service._saveGroupProfilesDebounced = () => {}

        axios.post = async () => {
            await service.recordMessage(groupId, userId, '张三')
            await service.recordMessage(groupId, userId, '张三')
            throw new Error('llm timeout')
        }

        await service._generateProfile(groupId, userId, '张三', baselineEntry, {
            getContext: () => [{
                role: 'user',
                speakerId: userId,
                content: '今天继续聊番剧',
                timestamp: Date.now() - 1000
            }]
        }, null)

        const saved = service.profiles.get(groupId)[userId]
        assert.strictEqual(saved.generationStatus, 'failed')
        assert.strictEqual(saved.lastGenerationError, 'llm timeout')
        assert.strictEqual(saved.messagesSinceUpdate, 2)
        assert.strictEqual(saved.totalMessages, 32)
        assert.deepStrictEqual(saved.sourceStats, {
            contextMessages: 1,
            vectorMessages: 0,
            totalMessages: 1,
            lastGeneratedFromMessageCount: 1
        })
    })
})
