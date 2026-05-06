import { useEffect, useState } from 'react'
import api from '../../../utils/auth'

const GENERAL_CONFIG_DEFAULTS = {
    subscriptionCheckInterval: 300,
    linkCacheTimeout: 600,
    showId: true
}

const PREVIEW_GRADIENT_DEFAULTS = {
    previewGradientColor1: '#D8C7F1',
    previewGradientColor2: '#BFE6E2'
}

const DEFAULT_VIDEO_DOWNLOAD_CONFIG = {
    videoDownloadEnabled: false,
    videoDownloadResolution: '1080p',
    videoDownloadMaxDuration: 600,
    videoDownloadAutoClean: true,
    videoDownloadCleanTimeout: 6
}

function extractConfig(source, defaults) {
    const result = {}
    for (const [key, def] of Object.entries(defaults)) {
        result[key] = source[key] ?? def
    }
    return result
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

    const [generalConfig, setGeneralConfig] = useState(GENERAL_CONFIG_DEFAULTS)
    const [savingGeneral, setSavingGeneral] = useState(false)
    const [previewGradientConfig, setPreviewGradientConfig] = useState(PREVIEW_GRADIENT_DEFAULTS)
    const [savingPreviewGradient, setSavingPreviewGradient] = useState(false)

    const [blacklist, setBlacklist] = useState([])
    const [newBlacklistQQ, setNewBlacklistQQ] = useState('')
    const [addingBlacklist, setAddingBlacklist] = useState(false)

    const [videoDownloadConfig, setVideoDownloadConfig] = useState(DEFAULT_VIDEO_DOWNLOAD_CONFIG)
    const [savingVideoDownload, setSavingVideoDownload] = useState(false)

    const [biliGlobalStatus, setBiliGlobalStatus] = useState(createDefaultBiliStatus())

    useEffect(() => {
        const fetchData = async () => {
            try {
                setLoading(true)
                const [configRes, blacklistRes, biliStatusRes] = await Promise.all([
                    api.get('/api/config'),
                    api.get('/api/blacklist/global'),
                    api.get('/api/bili/global-status')
                ])

                setGeneralConfig(extractConfig(configRes.data, GENERAL_CONFIG_DEFAULTS))
                setPreviewGradientConfig(extractConfig(configRes.data, PREVIEW_GRADIENT_DEFAULTS))
                setVideoDownloadConfig(extractConfig(configRes.data, DEFAULT_VIDEO_DOWNLOAD_CONFIG))
                setBlacklist(blacklistRes.data || [])

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
        try {
            await api.post('/api/config', nextConfig)
            setPreviewGradientConfig(nextConfig)
            show(successMessage, 'success')
        } catch (error) {
            console.error('Failed to save preview gradient settings:', error)
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

    const resetPreviewGradientSettings = () => {
        setPreviewGradientConfig({ ...PREVIEW_GRADIENT_DEFAULTS })
        show('已恢复默认氛围色，保存后生效', 'success')
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

    const saveAllSettings = async () => {
        setSavingGeneral(true)
        setSavingPreviewGradient(true)
        setSavingVideoDownload(true)
        try {
            await api.post('/api/config', {
                ...generalConfig,
                ...previewGradientConfig,
                ...videoDownloadConfig
            })
            show('设置已保存！', 'success')
        } catch (error) {
            console.error('Failed to save settings:', error)
            const errorMsg = error.response?.data?.error || '保存设置失败'
            show(errorMsg, 'error')
        } finally {
            setSavingGeneral(false)
            setSavingPreviewGradient(false)
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
        videoDownloadConfig,
        setVideoDownloadConfig,
        savingVideoDownload,
        saveVideoDownloadSettings,
        saveAllSettings,
        biliGlobalStatus,
        setBiliGlobalStatus
    }
}
