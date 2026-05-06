import { useEffect, useMemo, useRef, useState } from 'react'
import GlassCard from '../../../components/GlassCard'
import SettingRow from '../../../components/SettingRow'
import GradientColorPickerPopover from './GradientColorPickerPopover'
import PreviewGradientModal from './PreviewGradientModal'
import { Palette, RotateCcw, Settings as SettingsIcon, Eye } from 'lucide-react'
import {
    DEFAULT_PREVIEW_ATMOSPHERE_COLOR1,
    DEFAULT_PREVIEW_ATMOSPHERE_COLOR2,
    FIELD_DESCRIPTIONS,
    FIELD_LABELS,
    resolveEffectivePreviewGradientColors
} from './previewGradientModel'

const HEX_COLOR_PATTERN = /^#([0-9A-F]{6})$/i

function normalizeHexColor(value) {
    return String(value || '').trim().toUpperCase()
}

function isValidHexColor(value) {
    return HEX_COLOR_PATTERN.test(normalizeHexColor(value))
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max)
}

function hexToRgb(hex) {
    const normalized = normalizeHexColor(hex).replace('#', '')
    return {
        r: parseInt(normalized.slice(0, 2), 16),
        g: parseInt(normalized.slice(2, 4), 16),
        b: parseInt(normalized.slice(4, 6), 16)
    }
}

function rgbToHex({ r, g, b }) {
    const toHex = (value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase()
}

function mixHexColors(left, right, ratio = 0.5) {
    const weight = Math.min(Math.max(Number(ratio) || 0, 0), 1)
    const leftRgb = hexToRgb(left)
    const rightRgb = hexToRgb(right)
    return rgbToHex({
        r: leftRgb.r + (rightRgb.r - leftRgb.r) * weight,
        g: leftRgb.g + (rightRgb.g - leftRgb.g) * weight,
        b: leftRgb.b + (rightRgb.b - leftRgb.b) * weight
    })
}

function buildChipPreview(color) {
    const lighter = mixHexColors(color, '#FFFFFF', 0.28)
    const darker = mixHexColors(color, '#000000', 0.16)
    return {
        backgroundImage: `radial-gradient(circle at 72% 24%, rgba(255,255,255,0.18), transparent 24%), linear-gradient(135deg, ${lighter} 0%, ${color} 52%, ${darker} 100%)`
    }
}

const GRADIENT_FIELDS = ['previewGradientColor1', 'previewGradientColor2']
const DEFAULT_GRADIENT_INPUTS = {
    previewGradientColor1: DEFAULT_PREVIEW_ATMOSPHERE_COLOR1,
    previewGradientColor2: DEFAULT_PREVIEW_ATMOSPHERE_COLOR2
}
const DEFAULT_PICKER_SIZE = {
    width: 408,
    height: 420
}

const GeneralSettingsSection = ({
    generalConfig,
    onGeneralChange,
    previewGradientConfig,
    onPreviewGradientChange,
    onResetPreviewGradient
}) => {
    const [gradientInputs, setGradientInputs] = useState(previewGradientConfig)
    const [gradientErrors, setGradientErrors] = useState({})
    const [pickerState, setPickerState] = useState(null)
    const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false)
    const previewGradientSectionRef = useRef(null)
    const pickerRef = useRef(null)
    const triggerRefs = useRef({})

    useEffect(() => {
        const frameId = window.requestAnimationFrame(() => {
            setGradientInputs(previewGradientConfig)
            setGradientErrors({})
        })

        return () => window.cancelAnimationFrame(frameId)
    }, [previewGradientConfig])

    const effectivePreviewColors = useMemo(
        () => resolveEffectivePreviewGradientColors(gradientInputs, previewGradientConfig),
        [gradientInputs, previewGradientConfig]
    )

    const updatePickerPlacement = (field) => {
        const container = previewGradientSectionRef.current
        const trigger = triggerRefs.current[field]
        if (!container || !trigger) return

        const containerRect = container.getBoundingClientRect()
        const triggerRect = trigger.getBoundingClientRect()
        const pickerRect = pickerRef.current?.getBoundingClientRect()
        const pickerWidth = pickerRect?.width || DEFAULT_PICKER_SIZE.width
        const pickerHeight = pickerRect?.height || DEFAULT_PICKER_SIZE.height
        const padding = 16

        const rawLeft = triggerRect.left - containerRect.left - pickerWidth + triggerRect.width + 96
        const rawTop = triggerRect.top - containerRect.top - 64
        const maxLeft = Math.max(padding, containerRect.width - pickerWidth - padding)
        const maxTop = Math.max(padding, containerRect.height - pickerHeight - padding)
        const left = clamp(rawLeft, padding, maxLeft)
        const top = clamp(rawTop, padding, maxTop)
        const triggerCenterX = triggerRect.left - containerRect.left + (triggerRect.width / 2)
        const arrowLeft = clamp(triggerCenterX - left, 48, pickerWidth - 48)

        setPickerState(prev => (
            prev?.field === field
                ? { ...prev, top, left, arrowLeft }
                : { field, top, left, arrowLeft }
        ))
    }

    useEffect(() => {
        if (!pickerState?.field) return undefined

        const frameId = window.requestAnimationFrame(() => {
            updatePickerPlacement(pickerState.field)
        })

        const handleResize = () => updatePickerPlacement(pickerState.field)
        window.addEventListener('resize', handleResize)

        return () => {
            window.cancelAnimationFrame(frameId)
            window.removeEventListener('resize', handleResize)
        }
    }, [pickerState?.field])

    useEffect(() => {
        if (!pickerState?.field) return undefined

        const handlePointerDown = (event) => {
            const pickerElement = pickerRef.current
            const triggerElement = triggerRefs.current[pickerState.field]
            if (pickerElement?.contains(event.target) || triggerElement?.contains(event.target)) {
                return
            }
            setPickerState(null)
        }

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                setPickerState(null)
            }
        }

        document.addEventListener('pointerdown', handlePointerDown)
        window.addEventListener('keydown', handleKeyDown)

        return () => {
            document.removeEventListener('pointerdown', handlePointerDown)
            window.removeEventListener('keydown', handleKeyDown)
        }
    }, [pickerState])

    const handleGradientInputChange = (field, rawValue) => {
        const nextValue = rawValue.toUpperCase()
        setGradientInputs(prev => ({ ...prev, [field]: nextValue }))

        if (isValidHexColor(nextValue)) {
            const normalized = normalizeHexColor(nextValue)
            onPreviewGradientChange(field, normalized)
            setGradientInputs(prev => ({ ...prev, [field]: normalized }))
            setGradientErrors(prev => ({ ...prev, [field]: '' }))
        }
    }

    const handleApplyPickerColor = (field, nextColor) => {
        const normalized = normalizeHexColor(nextColor)
        setGradientInputs(prev => ({ ...prev, [field]: normalized }))
        setGradientErrors(prev => ({ ...prev, [field]: '' }))
        onPreviewGradientChange(field, normalized)
        setPickerState(null)
    }

    const handleResetPreviewGradient = () => {
        setPickerState(null)
        setIsPreviewModalOpen(false)
        setGradientInputs(DEFAULT_GRADIENT_INPUTS)
        setGradientErrors({})
        onResetPreviewGradient()
    }

    const handleTogglePicker = (field) => {
        setIsPreviewModalOpen(false)
        if (pickerState?.field === field) {
            setPickerState(null)
            return
        }

        setPickerState({ field, top: 16, left: 16, arrowLeft: 56 })
    }

    const handleOpenPreviewModal = () => {
        setPickerState(null)
        setIsPreviewModalOpen(true)
    }

    return (
        <section>
            <div className="flex items-center gap-2 mb-4">
                <SettingsIcon className="text-green-400" />
                <h2 className="text-xl font-semibold text-white">常规设置</h2>
            </div>
            <GlassCard>
                <div className="divide-y divide-white/10">
                    <SettingRow
                        title="订阅检查间隔"
                        description="系统检查订阅更新的频率，建议不少于 60 秒。"
                        status="秒"
                        control={
                        <input
                            type="number"
                            min="10"
                            value={generalConfig.subscriptionCheckInterval}
                            onChange={(e) => onGeneralChange('subscriptionCheckInterval', parseInt(e.target.value, 10) || 0)}
                            className="field-control w-full px-3 py-2 md:w-40"
                        />
                        }
                    />

                    <SettingRow
                        title="链接冷却时间"
                        description="同一链接重复解析的全局冷却时间。"
                        status="秒"
                        control={
                        <input
                            type="number"
                            min="0"
                            value={generalConfig.linkCacheTimeout}
                            onChange={(e) => onGeneralChange('linkCacheTimeout', parseInt(e.target.value, 10) || 0)}
                            className="field-control w-full px-3 py-2 md:w-40"
                        />
                        }
                    />

                    <SettingRow
                        title="显示 UID"
                        description="控制用户类卡片与订阅列表是否显示 UID。"
                        status={generalConfig.showId ? '开启' : '关闭'}
                        control={
                            <input
                                type="checkbox"
                                checked={!!generalConfig.showId}
                                onChange={(e) => onGeneralChange('showId', e.target.checked)}
                                className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-slate-950"
                            />
                        }
                    />
                </div>

                <div ref={previewGradientSectionRef} className="relative mt-8 border-t border-white/10 pt-8">
                    <div className="flex items-center gap-2 mb-4">
                        <Palette className="text-pink-300" size={18} />
                        <h3 className="text-lg font-semibold text-white">预览图氛围色</h3>
                    </div>
                    <div className="divide-y divide-white/10">
                        {GRADIENT_FIELDS.map((field) => (
                            <SettingRow
                                key={field}
                                title={FIELD_LABELS[field]}
                                description={FIELD_DESCRIPTIONS[field]}
                                control={
                                    <div>
                                        <div className="flex items-center gap-3">
                                            <button
                                                type="button"
                                                ref={(node) => {
                                                    triggerRefs.current[field] = node
                                                }}
                                                onClick={() => handleTogglePicker(field)}
                                                className={`grid h-14 w-14 place-items-center rounded-lg border bg-black/20 transition-colors ${pickerState?.field === field ? 'border-cyan-300/60' : 'border-white/20 hover:border-white/30'}`}
                                            >
                                                <span className="h-10 w-10 rounded-md shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_12px_28px_rgba(0,0,0,0.22)]" style={buildChipPreview(effectivePreviewColors[field])} />
                                            </button>
                                            <input
                                                type="text"
                                                value={gradientInputs[field]}
                                                onChange={(e) => handleGradientInputChange(field, e.target.value)}
                                                className={`h-11 w-36 rounded-lg border bg-black/30 px-4 font-mono text-sm tracking-[0.03em] text-white outline-none transition-colors ${gradientErrors[field] ? 'border-rose-400/70 focus:border-rose-300' : 'border-white/20 focus:border-cyan-300/70'}`}
                                            />
                                        </div>
                                        {gradientErrors[field] && (
                                            <p className="mt-2 text-xs text-rose-300">{gradientErrors[field]}</p>
                                        )}
                                    </div>
                                }
                            />
                        ))}

                        <SettingRow
                            title="预览效果"
                            description="查看当前氛围色合成后的卡片观感"
                            control={
                                <button
                                    type="button"
                                    onClick={handleOpenPreviewModal}
                                    className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-transparent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/5"
                                >
                                    <Eye size={16} />
                                    查看预览
                                </button>
                            }
                        />
                    </div>

                    <div className="mt-5 flex flex-wrap justify-end">
                        <button
                            type="button"
                            onClick={handleResetPreviewGradient}
                            className="flex items-center gap-2 rounded-lg border border-white/20 bg-transparent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/5 disabled:opacity-50"
                        >
                            <RotateCcw size={16} />
                            恢复默认氛围色
                        </button>
                    </div>

                    {pickerState?.field && (
                        <GradientColorPickerPopover
                            popoverRef={pickerRef}
                            style={{ top: `${pickerState.top}px`, left: `${pickerState.left}px` }}
                            arrowLeft={pickerState.arrowLeft}
                            fieldLabel={FIELD_LABELS[pickerState.field]}
                            value={effectivePreviewColors[pickerState.field]}
                            onApply={(color) => handleApplyPickerColor(pickerState.field, color)}
                            onClose={() => setPickerState(null)}
                        />
                    )}

                    <PreviewGradientModal
                        isOpen={isPreviewModalOpen}
                        onClose={() => setIsPreviewModalOpen(false)}
                        color1={effectivePreviewColors.previewGradientColor1}
                        color2={effectivePreviewColors.previewGradientColor2}
                    />
                </div>
            </GlassCard>
        </section>
    )
}

export default GeneralSettingsSection
