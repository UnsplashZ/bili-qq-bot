import { useCallback, useEffect, useState } from 'react'
import api from '../../../utils/auth'
import {
    DEFAULT_PREVIEW_ATMOSPHERE_COLOR1,
    DEFAULT_PREVIEW_ATMOSPHERE_COLOR2
} from '../components/previewGradientModel'

const PREVIEW_GRADIENT_DEFAULTS = {
    previewGradientColor1: DEFAULT_PREVIEW_ATMOSPHERE_COLOR1,
    previewGradientColor2: DEFAULT_PREVIEW_ATMOSPHERE_COLOR2
}

function extractConfig(source = {}) {
    return {
        previewGradientColor1: source.previewGradientColor1 ?? PREVIEW_GRADIENT_DEFAULTS.previewGradientColor1,
        previewGradientColor2: source.previewGradientColor2 ?? PREVIEW_GRADIENT_DEFAULTS.previewGradientColor2
    }
}

export default function usePreviewGradientSettings(show, configGenerationRef) {
    const [previewGradientConfig, setPreviewGradientConfig] = useState(PREVIEW_GRADIENT_DEFAULTS)
    const [loadingPreviewGradient, setLoadingPreviewGradient] = useState(true)
    const [savingPreviewGradient, setSavingPreviewGradient] = useState(false)

    const loadPreviewGradientSettings = useCallback(async () => {
        setLoadingPreviewGradient(true)
        try {
            const response = await api.get('/api/config')
            setPreviewGradientConfig(extractConfig(response.data))
            const generation = Number(response.data.generation)
            if (Number.isSafeInteger(generation) && configGenerationRef) configGenerationRef.current = generation
        } catch (error) {
            console.error('Failed to load preview gradient settings:', error)
            show('加载预览图氛围色失败', 'error')
        } finally {
            setLoadingPreviewGradient(false)
        }
    }, [show, configGenerationRef])

    useEffect(() => {
        loadPreviewGradientSettings()
    }, [loadPreviewGradientSettings])

    const handlePreviewGradientChange = (field, value) => {
        setPreviewGradientConfig(prev => ({ ...prev, [field]: value }))
    }

    const savePreviewGradientSettings = async () => {
        setSavingPreviewGradient(true)
        try {
            if (!Number.isSafeInteger(configGenerationRef?.current)) throw new Error('配置 generation 尚未就绪，请刷新后重试')
            const response = await api.post('/api/config', {
                expectedGeneration: configGenerationRef.current,
                values: previewGradientConfig
            })
            configGenerationRef.current = response.data.documentGeneration ?? response.data.generation
            show('预览图氛围色已保存！', 'success')
        } catch (error) {
            console.error('Failed to save preview gradient settings:', error)
            const errorMsg = error.response?.data?.error || '保存预览图氛围色失败'
            show(errorMsg, 'error')
        } finally {
            setSavingPreviewGradient(false)
        }
    }

    const resetPreviewGradientSettings = () => {
        setPreviewGradientConfig({ ...PREVIEW_GRADIENT_DEFAULTS })
        show('已恢复默认氛围色，保存后生效', 'success')
    }

    return {
        previewGradientConfig,
        loadingPreviewGradient,
        savingPreviewGradient,
        handlePreviewGradientChange,
        savePreviewGradientSettings,
        resetPreviewGradientSettings,
        reloadPreviewGradientSettings: loadPreviewGradientSettings
    }
}
