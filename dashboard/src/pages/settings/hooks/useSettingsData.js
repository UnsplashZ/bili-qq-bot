import { useEffect, useState } from 'react'
import api from '../../../utils/auth'

const GENERAL_CONFIG_DEFAULTS = {
    subscriptionCheckInterval: 300,
    linkCacheTimeout: 600,
    showId: true
}

function extractGeneralConfig(source) {
    const result = {}
    for (const [key, def] of Object.entries(GENERAL_CONFIG_DEFAULTS)) {
        result[key] = source[key] ?? def
    }
    return result
}

const DEFAULT_AI_CONFIG = {
    aiProbability: 0,
    aiContextLimit: 0,
    aiTemperature: 1.0,
    aiHistoryMaxSize: 0,
    aiEnableVectorCache: false,
    aiVectorSimilarityThreshold: 0.4,
    aiVectorSearchLimit: 3,
    aiMemorySafetyLimit: 5000,
    aiChatApiUrl: '',
    aiChatApiKey: '',
    aiChatModel: 'gpt-3.5-turbo',
    aiChatProxy: '',
    aiChatSystemPrompt: '你是一个有用的助手',
    aiChatBaseTimeoutSeconds: 30,
    aiChatToolTimeoutSeconds: 2,
    aiChatMaxTimeoutSeconds: 45,
    aiEmbeddingApiUrl: '',
    aiEmbeddingApiKey: '',
    aiEmbeddingModel: 'text-embedding-3-small',
    aiEmbeddingProxy: '',
    aiEnabled: true,
    aiRagEnabled: true,
    aiProfileEnabled: false
}

const DEFAULT_VIDEO_DOWNLOAD_CONFIG = {
    videoDownloadEnabled: false,
    videoDownloadResolution: '1080p',
    videoDownloadMaxDuration: 600,
    videoDownloadAutoClean: true,
    videoDownloadCleanTimeout: 6
}

function createDefaultBiliStatus() {
    return {
        isLoggedIn: false,
        uid: null,
        username: '',
        timestamp: null
    }
}

export default function useSettingsData(show) {
    const [loading, setLoading] = useState(true)

    const [generalConfig, setGeneralConfig] = useState({
        subscriptionCheckInterval: 300,
        linkCacheTimeout: 600,
        showId: true
    })
    const [savingGeneral, setSavingGeneral] = useState(false)

    const [blacklist, setBlacklist] = useState([])
    const [newBlacklistQQ, setNewBlacklistQQ] = useState('')
    const [addingBlacklist, setAddingBlacklist] = useState(false)

    const [aiConfig, setAiConfig] = useState(DEFAULT_AI_CONFIG)
    const [savingAi, setSavingAi] = useState(false)
    const [resettingAi, setResettingAi] = useState(false)

    const [videoDownloadConfig, setVideoDownloadConfig] = useState(DEFAULT_VIDEO_DOWNLOAD_CONFIG)
    const [savingVideoDownload, setSavingVideoDownload] = useState(false)

    const [mcpConfig, setMcpConfig] = useState({ mcpServers: [] })
    const [mcpVersion, setMcpVersion] = useState(0)

    const [biliGlobalStatus, setBiliGlobalStatus] = useState(createDefaultBiliStatus())

    const refreshMcpConfig = async () => {
        const res = await api.get('/api/mcp')
        const servers = res.data.mcpServers || (Array.isArray(res.data) ? res.data : [])
        setMcpConfig({ mcpServers: servers })
        if (res.data.version !== undefined) {
            setMcpVersion(res.data.version)
        }
    }

    useEffect(() => {
        const fetchData = async () => {
            try {
                setLoading(true)
                const [configRes, mcpRes, blacklistRes, biliStatusRes] = await Promise.all([
                    api.get('/api/config'),
                    api.get('/api/mcp'),
                    api.get('/api/blacklist/global'),
                    api.get('/api/bili/global-status')
                ])

                setGeneralConfig(extractGeneralConfig(configRes.data))

                const {
                    aiProbability,
                    aiContextLimit,
                    aiTemperature,
                    aiHistoryMaxSize,
                    aiEnableVectorCache,
                    aiVectorSimilarityThreshold,
                    aiVectorSearchLimit,
                    aiMemorySafetyLimit,
                    aiChatApiUrl,
                    aiChatApiKey,
                    aiChatModel,
                    aiChatProxy,
                    aiChatSystemPrompt,
                    aiChatBaseTimeoutSeconds,
                    aiChatToolTimeoutSeconds,
                    aiChatMaxTimeoutSeconds,
                    aiEmbeddingApiUrl,
                    aiEmbeddingApiKey,
                    aiEmbeddingModel,
                    aiEmbeddingProxy,
                    aiEnabled,
                    aiRagEnabled,
                    aiProfileEnabled
                } = configRes.data

                setAiConfig({
                    aiProbability: aiProbability ?? 0.1,
                    aiContextLimit: aiContextLimit ?? 10,
                    aiTemperature: aiTemperature ?? 1.0,
                    aiHistoryMaxSize: aiHistoryMaxSize ?? (200 * 1024 * 1024),
                    aiEnableVectorCache: aiEnableVectorCache ?? true,
                    aiVectorSimilarityThreshold: aiVectorSimilarityThreshold ?? 0.4,
                    aiVectorSearchLimit: aiVectorSearchLimit ?? 3,
                    aiMemorySafetyLimit: aiMemorySafetyLimit ?? 5000,
                    aiChatApiUrl: aiChatApiUrl || '',
                    aiChatApiKey: aiChatApiKey || '',
                    aiEnabled: aiEnabled ?? true,
                    aiRagEnabled: aiRagEnabled ?? true,
                    aiProfileEnabled: aiProfileEnabled ?? false,
                    aiChatModel: aiChatModel || 'gpt-3.5-turbo',
                    aiChatProxy: aiChatProxy || '',
                    aiChatSystemPrompt: aiChatSystemPrompt || '你是一个有用的助手',
                    aiChatBaseTimeoutSeconds: aiChatBaseTimeoutSeconds ?? 30,
                    aiChatToolTimeoutSeconds: aiChatToolTimeoutSeconds ?? 2,
                    aiChatMaxTimeoutSeconds: aiChatMaxTimeoutSeconds ?? 45,
                    aiEmbeddingApiUrl: aiEmbeddingApiUrl || '',
                    aiEmbeddingApiKey: aiEmbeddingApiKey || '',
                    aiEmbeddingModel: aiEmbeddingModel || 'text-embedding-3-small',
                    aiEmbeddingProxy: aiEmbeddingProxy || ''
                })

                setVideoDownloadConfig({
                    videoDownloadEnabled: configRes.data.videoDownloadEnabled ?? false,
                    videoDownloadResolution: configRes.data.videoDownloadResolution ?? '1080p',
                    videoDownloadMaxDuration: configRes.data.videoDownloadMaxDuration ?? 600,
                    videoDownloadAutoClean: configRes.data.videoDownloadAutoClean ?? true,
                    videoDownloadCleanTimeout: configRes.data.videoDownloadCleanTimeout ?? 6
                })

                setBlacklist(blacklistRes.data || [])

                const servers = mcpRes.data.mcpServers || (Array.isArray(mcpRes.data) ? mcpRes.data : [])
                setMcpConfig({ mcpServers: servers })

                if (mcpRes.data.version !== undefined) {
                    setMcpVersion(mcpRes.data.version)
                }

                if (biliStatusRes.data.isLoggedIn) {
                    setBiliGlobalStatus({
                        isLoggedIn: true,
                        uid: biliStatusRes.data.uid,
                        username: biliStatusRes.data.username,
                        timestamp: biliStatusRes.data.timestamp
                    })
                } else {
                    setBiliGlobalStatus(createDefaultBiliStatus())
                }
            } catch (error) {
                console.error('Failed to load settings:', error)
                show('加载设置失败', 'error')
            } finally {
                setLoading(false)
            }
        }
        fetchData()
    }, [show])

    const handleGeneralChange = (field, value) => {
        setGeneralConfig(prev => ({ ...prev, [field]: value }))
    }

    const saveGeneralSettings = async () => {
        setSavingGeneral(true)
        try {
            await api.post('/api/config', generalConfig)
            const { data: freshConfig } = await api.get('/api/config')
            setGeneralConfig(extractGeneralConfig(freshConfig))
            show('常规设置已保存！', 'success')
        } catch (error) {
            console.error('Failed to save general settings:', error)
            const errorMsg = error.response?.data?.error || '保存常规设置失败'
            show(errorMsg, 'error')
        } finally {
            setSavingGeneral(false)
        }
    }

    const handleAddBlacklist = async () => {
        if (!newBlacklistQQ) return
        setAddingBlacklist(true)
        try {
            await api.post('/api/blacklist/global', { qq: newBlacklistQQ })
            setBlacklist(prev => [...prev, newBlacklistQQ])
            setNewBlacklistQQ('')
            show('已添加至黑名单', 'success')

            const res = await api.get('/api/blacklist/global')
            setBlacklist(res.data)
        } catch (error) {
            console.error('Failed to add to blacklist:', error)
            show('添加黑名单失败', 'error')
        } finally {
            setAddingBlacklist(false)
        }
    }

    const handleRemoveBlacklist = async (qq) => {
        try {
            await api.delete(`/api/blacklist/global/${qq}`)
            setBlacklist(prev => prev.filter(item => String(item) !== String(qq)))
            show('已从黑名单移除', 'success')
        } catch (error) {
            console.error('Failed to remove from blacklist:', error)
            show('移除黑名单失败', 'error')
        }
    }

    const handleAiChange = (field, value) => {
        setAiConfig(prev => ({ ...prev, [field]: value }))
    }

    const handleGlobalAiToggle = async (field, value) => {
        try {
            await api.post('/api/config', { [field]: value })
            setAiConfig(prev => ({ ...prev, [field]: value }))
            show('全局AI配置已更新', 'success')
        } catch (error) {
            console.error('Failed to update global AI config:', error)
            show('更新全局AI配置失败', 'error')
        }
    }

    const saveAiSettings = async () => {
        setSavingAi(true)
        try {
            await api.post('/api/ai', aiConfig)
            show('AI 设置已保存！', 'success')
        } catch (error) {
            console.error('Failed to save AI settings:', error)
            const errorMsg = error.response?.data?.error || error.response?.data?.details || '保存 AI 设置失败'
            const field = error.response?.data?.field
            const expected = error.response?.data?.expected

            if (field && expected) {
                show(`${errorMsg} (${field}: ${expected})`, 'error')
            } else {
                show(errorMsg, 'error')
            }
        } finally {
            setSavingAi(false)
        }
    }

    const resetAiSettings = async () => {
        if (!window.confirm('确定要重置 AI 设置为内置默认值吗？此操作将覆盖当前的自定义设置。')) {
            return
        }
        setResettingAi(true)
        try {
            const res = await api.post('/api/ai/reset')
            const newConfig = res.data.config

            setAiConfig(prev => ({
                ...prev,
                aiProbability: newConfig.aiProbability ?? 0.1,
                aiContextLimit: newConfig.aiContextLimit ?? 10,
                aiTemperature: newConfig.aiTemperature ?? 1.0,
                aiHistoryMaxSize: newConfig.aiHistoryMaxSize ?? 200 * 1024 * 1024,
                aiEnableVectorCache: newConfig.aiEnableVectorCache ?? true,
                aiVectorSimilarityThreshold: newConfig.aiVectorSimilarityThreshold ?? 0.4,
                aiVectorSearchLimit: newConfig.aiVectorSearchLimit ?? 3,
                aiMemorySafetyLimit: newConfig.aiMemorySafetyLimit ?? 5000,
                aiChatApiUrl: newConfig.aiChatApiUrl || '',
                aiChatApiKey: newConfig.aiChatApiKey || '',
                aiChatModel: newConfig.aiChatModel || 'gpt-3.5-turbo',
                aiChatProxy: newConfig.aiChatProxy || '',
                aiChatSystemPrompt: newConfig.aiChatSystemPrompt || '你是一个有用的助手',
                aiChatBaseTimeoutSeconds: newConfig.aiChatBaseTimeoutSeconds ?? 30,
                aiChatToolTimeoutSeconds: newConfig.aiChatToolTimeoutSeconds ?? 2,
                aiChatMaxTimeoutSeconds: newConfig.aiChatMaxTimeoutSeconds ?? 45,
                aiEmbeddingApiUrl: newConfig.aiEmbeddingApiUrl || '',
                aiEmbeddingApiKey: newConfig.aiEmbeddingApiKey || '',
                aiEmbeddingModel: newConfig.aiEmbeddingModel || 'text-embedding-3-small',
                aiEmbeddingProxy: newConfig.aiEmbeddingProxy || ''
            }))

            show('AI 设置已重置为内置默认值', 'success')
        } catch (error) {
            console.error('Failed to reset AI settings:', error)
            show('重置 AI 设置失败', 'error')
        } finally {
            setResettingAi(false)
        }
    }

    const saveVideoDownloadSettings = async () => {
        setSavingVideoDownload(true)
        try {
            await api.post('/api/config', videoDownloadConfig)
            show('视频下载设置已保存！', 'success')
        } catch (error) {
            console.error('Failed to save video download settings:', error)
            const errorMsg = error.response?.data?.error || '保存视频下载设置失败'
            show(errorMsg, 'error')
        } finally {
            setSavingVideoDownload(false)
        }
    }

    return {
        loading,
        generalConfig,
        savingGeneral,
        handleGeneralChange,
        saveGeneralSettings,
        blacklist,
        newBlacklistQQ,
        setNewBlacklistQQ,
        addingBlacklist,
        handleAddBlacklist,
        handleRemoveBlacklist,
        aiConfig,
        savingAi,
        resettingAi,
        handleAiChange,
        handleGlobalAiToggle,
        saveAiSettings,
        resetAiSettings,
        videoDownloadConfig,
        setVideoDownloadConfig,
        savingVideoDownload,
        saveVideoDownloadSettings,
        mcpConfig,
        setMcpConfig,
        mcpVersion,
        setMcpVersion,
        refreshMcpConfig,
        biliGlobalStatus,
        setBiliGlobalStatus
    }
}
