import { useCallback, useEffect, useRef, useState } from 'react'
import api from '../../../utils/auth'
import {
    createHydratedSettingsState,
    DEFAULT_QQ_PROVIDER_CONFIG,
    DEFAULT_VIDEO_DOWNLOAD_CONFIG,
    fetchConsistentSettingsSnapshot,
    GENERAL_CONFIG_DEFAULTS
} from './settingsSnapshot.js'
import {
    createSettingsRecoveryCoordinator,
    isRecoveryRequiredResponse,
    toPublicRecoveryFailure
} from './settingsRecovery.js'

function createDefaultBiliStatus() {
    return {
        isLoggedIn: false,
        uid: null,
        username: '',
        timestamp: null
    }
}

export default function useSettingsData(show) {
    const mountedRef = useRef(false)
    const [loading, setLoading] = useState(true)

    const [generalConfig, setGeneralConfig] = useState(GENERAL_CONFIG_DEFAULTS)
    const [savingGeneral, setSavingGeneral] = useState(false)

    const [blacklist, setBlacklist] = useState([])
    const [newBlacklistQQ, setNewBlacklistQQ] = useState('')
    const [addingBlacklist, setAddingBlacklist] = useState(false)

    const [videoDownloadConfig, setVideoDownloadConfig] = useState(DEFAULT_VIDEO_DOWNLOAD_CONFIG)
    const [savingVideoDownload, setSavingVideoDownload] = useState(false)
    const [qqProviderConfig, setQqProviderConfig] = useState(DEFAULT_QQ_PROVIDER_CONFIG)
    const [qqProviderStatus, setQqProviderStatus] = useState(null)
    const [configStatus, setConfigStatus] = useState(null)
    const [migrationStatus, setMigrationStatus] = useState(null)
    const [lastApplyResult, setLastApplyResult] = useState(null)
    const [reloadingConfig, setReloadingConfig] = useState(false)
    const [recoveringConfig, setRecoveringConfig] = useState(false)
    const [recoveryResult, setRecoveryResult] = useState(null)
    const recoveryCoordinatorRef = useRef(null)

    const [biliGlobalStatus, setBiliGlobalStatus] = useState(createDefaultBiliStatus())

    const hydrateConfigSnapshot = useCallback((snapshot, status = null) => {
        const hydrated = createHydratedSettingsState(snapshot, status || {})
        setGeneralConfig(hydrated.generalConfig)
        setVideoDownloadConfig(hydrated.videoDownloadConfig)
        setQqProviderConfig(hydrated.qqProviderConfig)
        setConfigStatus(prev => {
            if (status) return hydrated.configStatus
            try {
                return createHydratedSettingsState(snapshot, prev || {}).configStatus
            } catch {
                return hydrated.configStatus
            }
        })
    }, [])

    useEffect(() => {
        mountedRef.current = true
        return () => {
            mountedRef.current = false
        }
    }, [])

    useEffect(() => {
        let active = true
        const fetchData = async () => {
            try {
                setLoading(true)
                const configSnapshot = await fetchConsistentSettingsSnapshot(
                    () => api.get('/api/config').then(response => response.data),
                    () => api.get('/api/config/status').then(response => response.data)
                )
                const recoveryBootstrap = configSnapshot.status?.recoveryRequired?.required === true
                const [blacklistRes, biliStatusRes, providerStatusRes, migrationStatusRes] = await Promise.all([
                    api.get('/api/blacklist/global').catch(error => {
                        if (recoveryBootstrap) return { data: [] }
                        throw error
                    }),
                    api.get('/api/bili/global-status').catch(error => {
                        if (recoveryBootstrap) return { data: createDefaultBiliStatus() }
                        throw error
                    }),
                    api.get('/api/qq-provider/status').catch(() => ({ data: { provider: null } })),
                    api.get('/api/config/migrations').catch(() => ({ data: { migration: null } }))
                ])

                if (!active) return
                hydrateConfigSnapshot(configSnapshot.snapshot, configSnapshot.status)
                setBlacklist(blacklistRes.data || [])
                setQqProviderStatus(providerStatusRes.data?.provider || null)
                setMigrationStatus(migrationStatusRes.data?.migration || null)

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
                if (!active) return
                console.error('Failed to load settings:', error)
                show('加载设置失败', 'error')
            } finally {
                if (active) setLoading(false)
            }
        }
        fetchData()
        return () => {
            active = false
        }
    }, [hydrateConfigSnapshot, show])

    const handleGeneralChange = (field, value) => {
        setGeneralConfig(prev => ({ ...prev, [field]: value }))
    }

    const syncConfigStatusFromResult = (result) => {
        setConfigStatus(prev => ({
            ...(prev || {}),
            documentGeneration: result.documentGeneration ?? result.generation,
            effectiveGeneration: result.effectiveGeneration,
            generation: result.generation,
            pendingDeploymentApply: result.deploymentApplyRequired || []
        }))
    }

    const requireExpectedGeneration = () => {
        if (configStatus?.recoveryRequired?.required) throw new Error('配置处于恢复模式，请先完成运行时恢复')
        const expectedGeneration = configStatus?.documentGeneration ?? configStatus?.generation
        if (!Number.isSafeInteger(expectedGeneration)) throw new Error('配置 generation 尚未就绪')
        return expectedGeneration
    }

    const captureRecoveryRequired = (error) => {
        if (!isRecoveryRequiredResponse(error)) return false
        const payload = error.response.data
        setConfigStatus(prev => ({
            ...(prev || {}),
            degraded: true,
            documentGeneration: payload.generation ?? prev?.documentGeneration,
            fingerprint: payload.fingerprint ?? prev?.fingerprint,
            recoveryRequired: payload.recoveryRequired,
            pendingRuntimeRecovery: payload.pendingRuntimeRecovery || null
        }))
        return true
    }

    const applyConfig = async (values = {}, secretActions = undefined) => {
        const expectedGeneration = requireExpectedGeneration()
        const sanitized = { ...values }
        delete sanitized.qqOfficialClientSecretConfigured
        if (!sanitized.qqOfficialClientSecret) delete sanitized.qqOfficialClientSecret
        let response
        try {
            response = await api.post('/api/config', {
                expectedGeneration,
                values: sanitized,
                ...(secretActions ? { secretActions } : {})
            })
        } catch (error) {
            captureRecoveryRequired(error)
            throw error
        }
        setLastApplyResult(response.data)
        syncConfigStatusFromResult(response.data)
        if (response.data.config) hydrateConfigSnapshot(response.data.config)
        return response
    }

    const saveGeneralSettings = async () => {
        setSavingGeneral(true)
        try {
            await applyConfig(generalConfig)
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
            const response = await api.post('/api/blacklist/global', {
                qq: newBlacklistQQ,
                expectedGeneration: requireExpectedGeneration()
            })
            setBlacklist(response.data.blacklist || [])
            syncConfigStatusFromResult(response.data)
            setNewBlacklistQQ('')
            show('已添加至黑名单', 'success')
        } catch (error) {
            console.error('Failed to add to blacklist:', error)
            show('添加黑名单失败', 'error')
        } finally {
            setAddingBlacklist(false)
        }
    }

    const handleRemoveBlacklist = async (qq) => {
        try {
            const response = await api.delete(`/api/blacklist/global/${qq}`, {
                data: { expectedGeneration: requireExpectedGeneration() }
            })
            setBlacklist(response.data.blacklist || [])
            syncConfigStatusFromResult(response.data)
            show('已从黑名单移除', 'success')
        } catch (error) {
            console.error('Failed to remove from blacklist:', error)
            show('移除黑名单失败', 'error')
        }
    }

    const saveVideoDownloadSettings = async () => {
        setSavingVideoDownload(true)
        try {
            await applyConfig(videoDownloadConfig)
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
        setSavingVideoDownload(true)
        try {
            await applyConfig({
                ...generalConfig,
                ...videoDownloadConfig,
                ...qqProviderConfig
            })
            show('设置已保存并完成配置应用。', 'success')
        } catch (error) {
            console.error('Failed to save settings:', error)
            const errorMsg = error.response?.data?.error || '保存设置失败'
            show(errorMsg, 'error')
        } finally {
            setSavingGeneral(false)
            setSavingVideoDownload(false)
        }
    }

    const clearOfficialSecret = async () => {
        try {
            await applyConfig({}, { qqOfficialClientSecret: 'clear' })
            show('QQ Official Secret 已清除。', 'success')
        } catch (error) {
            console.error('Failed to clear Official Secret:', error)
            show(error.response?.data?.error || '清除 Secret 失败', 'error')
        }
    }

    const reloadConfig = async () => {
        if (configStatus?.recoveryRequired?.required) {
            show('配置处于恢复模式，请先执行恢复。', 'warning')
            return
        }
        setReloadingConfig(true)
        try {
            const response = await api.post('/api/config/reload')
            if (!mountedRef.current) return
            setLastApplyResult(response.data)
            const [configSnapshot, migrationResponse] = await Promise.all([
                fetchConsistentSettingsSnapshot(
                    () => api.get('/api/config').then(result => result.data),
                    () => api.get('/api/config/status').then(result => result.data)
                ),
                api.get('/api/config/migrations').catch(() => ({ data: { migration: null } }))
            ])
            if (!mountedRef.current) return
            hydrateConfigSnapshot(configSnapshot.snapshot, configSnapshot.status)
            setMigrationStatus(migrationResponse.data?.migration || null)
            show(response.data.rejected ? '磁盘配置无效，已继续使用上一有效快照。' : '配置已重新加载。', response.data.rejected ? 'warning' : 'success')
        } catch (error) {
            if (!mountedRef.current) return
            captureRecoveryRequired(error)
            console.error('Failed to reload config:', error)
            show(error.response?.data?.error || '重新加载配置失败', 'error')
        } finally {
            if (mountedRef.current) setReloadingConfig(false)
        }
    }

    const recoverConfig = async () => {
        if (!configStatus?.recoveryRequired?.required || recoveringConfig) return
        if (!recoveryCoordinatorRef.current) {
            recoveryCoordinatorRef.current = createSettingsRecoveryCoordinator({
                recover: () => api.post('/api/config/recover').then(response => response.data),
                fetchConfig: () => api.get('/api/config').then(response => response.data),
                fetchStatus: () => api.get('/api/config/status').then(response => response.data)
            })
        }
        setRecoveringConfig(true)
        setRecoveryResult(null)
        try {
            const result = await recoveryCoordinatorRef.current.run()
            if (!mountedRef.current) return
            hydrateConfigSnapshot(result.snapshot, result.status)
            setLastApplyResult(result.recoveryResult)
            setRecoveryResult({
                ok: true,
                recovered: result.recoveryResult.recovered !== false,
                handlers: Array.isArray(result.recoveryResult.handlers) ? result.recoveryResult.handlers : [],
                documentGeneration: result.status.documentGeneration ?? result.status.generation,
                effectiveGeneration: result.status.effectiveGeneration
            })
            show(result.recoveryResult.recovered === false ? '当前不需要恢复。' : '配置运行时恢复完成。', 'success')
        } catch (error) {
            if (!mountedRef.current) return
            const failure = toPublicRecoveryFailure(error)
            setRecoveryResult({ ok: false, ...failure })
            show(`恢复失败（${failure.code}），可安全重试。`, 'error')
        } finally {
            if (mountedRef.current) setRecoveringConfig(false)
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
        videoDownloadConfig,
        setVideoDownloadConfig,
        savingVideoDownload,
        saveVideoDownloadSettings,
        qqProviderConfig,
        setQqProviderConfig,
        qqProviderStatus,
        clearOfficialSecret,
        saveAllSettings,
        configStatus,
        migrationStatus,
        lastApplyResult,
        reloadingConfig,
        reloadConfig,
        recoveringConfig,
        recoveryResult,
        recoverConfig,
        biliGlobalStatus,
        setBiliGlobalStatus
    }
}
