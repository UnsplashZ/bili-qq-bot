import { useEffect, useState } from 'react'
import api from '../../../utils/auth'

const GENERAL_CONFIG_DEFAULTS = {
    subscriptionCheckInterval: 300,
    linkCacheTimeout: 600,
    showId: true
}

const PREVIEW_GRADIENT_DEFAULTS = {
    previewGradientColor1: '#FB7299',
    previewGradientColor2: '#87CEEB'
}

function extractGeneralConfig(source) {
    const result = {}
    for (const [key, def] of Object.entries(GENERAL_CONFIG_DEFAULTS)) {
        result[key] = source[key] ?? def
    }
    return result
}

function extractPreviewGradientConfig(source) {
    const result = {}
    for (const [key, def] of Object.entries(PREVIEW_GRADIENT_DEFAULTS)) {
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

const DEFAULT_AI_EDITOR_META = {}
const AI_CLEARABLE_FIELDS = new Set([
    'aiApiUrl',
    'aiApiKey',
    'aiChatApiUrl',
    'aiChatApiKey',
    'aiEmbeddingApiUrl',
    'aiEmbeddingApiKey'
])

function getAiConfigFromSnapshot(source = {}) {
    return {
        aiProbability: source.aiProbability ?? 0.1,
        aiContextLimit: source.aiContextLimit ?? 10,
        aiTemperature: source.aiTemperature ?? 1.0,
        aiHistoryMaxSize: source.aiHistoryMaxSize ?? (200 * 1024 * 1024),
        aiEnableVectorCache: source.aiEnableVectorCache ?? true,
        aiVectorSimilarityThreshold: source.aiVectorSimilarityThreshold ?? 0.4,
        aiVectorSearchLimit: source.aiVectorSearchLimit ?? 3,
        aiMemorySafetyLimit: source.aiMemorySafetyLimit ?? 5000,
        aiChatApiUrl: source.aiChatApiUrl || '',
        aiChatApiKey: source.aiChatApiKey || '',
        aiEnabled: source.aiEnabled ?? true,
        aiRagEnabled: source.aiRagEnabled ?? true,
        aiProfileEnabled: source.aiProfileEnabled ?? false,
        aiChatModel: source.aiChatModel || 'gpt-3.5-turbo',
        aiChatProxy: source.aiChatProxy || '',
        aiChatSystemPrompt: source.aiChatSystemPrompt || '你是一个有用的助手',
        aiChatBaseTimeoutSeconds: source.aiChatBaseTimeoutSeconds ?? 30,
        aiChatToolTimeoutSeconds: source.aiChatToolTimeoutSeconds ?? 2,
        aiChatMaxTimeoutSeconds: source.aiChatMaxTimeoutSeconds ?? 45,
        aiEmbeddingApiUrl: source.aiEmbeddingApiUrl || '',
        aiEmbeddingApiKey: source.aiEmbeddingApiKey || '',
        aiEmbeddingModel: source.aiEmbeddingModel || 'text-embedding-3-small',
        aiEmbeddingProxy: source.aiEmbeddingProxy || ''
    }
}

function getAiEditorMetaFromSnapshot(source = {}) {
    const meta = source.aiEditorMeta
    return meta && typeof meta === 'object' ? meta : DEFAULT_AI_EDITOR_META
}

function cloneSimpleValue(value) {
    if (Array.isArray(value) || (value && typeof value === 'object')) {
        return JSON.parse(JSON.stringify(value))
    }
    return value
}

function areSimpleValuesEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right)
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
    const [previewGradientConfig, setPreviewGradientConfig] = useState(PREVIEW_GRADIENT_DEFAULTS)
    const [savingPreviewGradient, setSavingPreviewGradient] = useState(false)

    const [blacklist, setBlacklist] = useState([])
    const [newBlacklistQQ, setNewBlacklistQQ] = useState('')
    const [addingBlacklist, setAddingBlacklist] = useState(false)

    const [aiConfig, setAiConfig] = useState(DEFAULT_AI_CONFIG)
    const [aiEditorMeta, setAiEditorMeta] = useState(DEFAULT_AI_EDITOR_META)
    const [initialAiConfig, setInitialAiConfig] = useState(DEFAULT_AI_CONFIG)
    const [initialAiEditorMeta, setInitialAiEditorMeta] = useState(DEFAULT_AI_EDITOR_META)
    const [savingAi, setSavingAi] = useState(false)
    const [resettingAi, setResettingAi] = useState(false)

    const [videoDownloadConfig, setVideoDownloadConfig] = useState(DEFAULT_VIDEO_DOWNLOAD_CONFIG)
    const [savingVideoDownload, setSavingVideoDownload] = useState(false)

    const [mcpConfig, setMcpConfig] = useState({ mcpServers: [] })
    const [mcpVersion, setMcpVersion] = useState(0)

    const [biliGlobalStatus, setBiliGlobalStatus] = useState(createDefaultBiliStatus())

    const applyAiSnapshot = (snapshot) => {
        const nextAiConfig = getAiConfigFromSnapshot(snapshot)
        const nextAiEditorMeta = getAiEditorMetaFromSnapshot(snapshot)
        setAiConfig(nextAiConfig)
        setAiEditorMeta(nextAiEditorMeta)
        setInitialAiConfig(cloneSimpleValue(nextAiConfig))
        setInitialAiEditorMeta(cloneSimpleValue(nextAiEditorMeta))
    }

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
                setPreviewGradientConfig(extractPreviewGradientConfig(configRes.data))
                applyAiSnapshot(configRes.data)

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

    const handlePreviewGradientChange = (field, value) => {
        setPreviewGradientConfig(prev => ({ ...prev, [field]: value }))
    }

    const persistPreviewGradientSettings = async (nextConfig, successMessage) => {
        setSavingPreviewGradient(true)
        const previousConfig = cloneSimpleValue(previewGradientConfig)
        setPreviewGradientConfig(nextConfig)
        try {
            await api.post('/api/config', nextConfig)
            const { data: freshConfig } = await api.get('/api/config')
            setPreviewGradientConfig(extractPreviewGradientConfig(freshConfig))
            show(successMessage, 'success')
        } catch (error) {
            console.error('Failed to save preview gradient settings:', error)
            setPreviewGradientConfig(previousConfig)
            const errorMsg = error.response?.data?.error || '保存预览图渐变色失败'
            show(errorMsg, 'error')
        } finally {
            setSavingPreviewGradient(false)
        }
    }

    const savePreviewGradientSettings = async () => {
        await persistPreviewGradientSettings(
            previewGradientConfig,
            '预览图渐变色已保存！'
        )
    }

    const resetPreviewGradientSettings = async () => {
        await persistPreviewGradientSettings(
            { ...PREVIEW_GRADIENT_DEFAULTS },
            '已恢复默认渐变色！'
        )
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
            setAiConfig(prev => {
                const next = { ...prev, [field]: value }
                setInitialAiConfig(current => ({ ...current, [field]: value }))
                return next
            })
            show('全局AI配置已更新', 'success')
        } catch (error) {
            console.error('Failed to update global AI config:', error)
            show('更新全局AI配置失败', 'error')
        }
    }

    const saveAiSettings = async () => {
        setSavingAi(true)
        try {
            const payload = {}
            for (const [field, value] of Object.entries(aiConfig)) {
                if (!areSimpleValuesEqual(value, initialAiConfig[field])) {
                    if (
                        AI_CLEARABLE_FIELDS.has(field) &&
                        value === '' &&
                        initialAiEditorMeta[field]?.source === 'override' &&
                        initialAiEditorMeta[field]?.masked === false
                    ) {
                        payload[field] = null
                    } else {
                        payload[field] = value
                    }
                }
            }

            if (Object.keys(payload).length === 0) {
                show('没有需要保存的 AI 更改', 'success')
                return
            }

            const res = await api.post('/api/ai', payload)
            applyAiSnapshot(res.data.config || {})
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
        if (!window.confirm('确定要重置 AI 设置为默认值吗？这会删除当前自定义配置，并恢复为默认来源的生效值（优先 .env，其次内置默认）。')) {
            return
        }
        setResettingAi(true)
        try {
            const res = await api.post('/api/ai/reset')
            applyAiSnapshot(res.data.config || {})
            show('AI 设置已重置，当前显示为默认来源的生效值', 'success')
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
        previewGradientConfig,
        setPreviewGradientConfig,
        savingPreviewGradient,
        handlePreviewGradientChange,
        savePreviewGradientSettings,
        resetPreviewGradientSettings,
        blacklist,
        newBlacklistQQ,
        setNewBlacklistQQ,
        addingBlacklist,
        handleAddBlacklist,
        handleRemoveBlacklist,
        aiConfig,
        aiEditorMeta,
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
