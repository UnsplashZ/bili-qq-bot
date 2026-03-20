import { useEffect, useMemo, useRef, useState } from 'react'

const FALLBACK_COLOR = '#FB7299'

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max)
}

function normalizeHexColor(value) {
    return String(value || '').trim().toUpperCase()
}

function isValidHexColor(value) {
    return /^#([0-9A-F]{6})$/i.test(normalizeHexColor(value))
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
    const toHex = (value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0')
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase()
}

function rgbToHsv({ r, g, b }) {
    const red = r / 255
    const green = g / 255
    const blue = b / 255
    const max = Math.max(red, green, blue)
    const min = Math.min(red, green, blue)
    const delta = max - min

    let h = 0
    if (delta !== 0) {
        if (max === red) {
            h = 60 * (((green - blue) / delta) % 6)
        } else if (max === green) {
            h = 60 * (((blue - red) / delta) + 2)
        } else {
            h = 60 * (((red - green) / delta) + 4)
        }
    }

    if (h < 0) h += 360

    return {
        h,
        s: max === 0 ? 0 : delta / max,
        v: max
    }
}

function hsvToRgb({ h, s, v }) {
    const hue = ((h % 360) + 360) % 360
    const chroma = v * s
    const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1))
    const match = v - chroma

    let red = 0
    let green = 0
    let blue = 0

    if (hue < 60) {
        red = chroma
        green = x
    } else if (hue < 120) {
        red = x
        green = chroma
    } else if (hue < 180) {
        green = chroma
        blue = x
    } else if (hue < 240) {
        green = x
        blue = chroma
    } else if (hue < 300) {
        red = x
        blue = chroma
    } else {
        red = chroma
        blue = x
    }

    return {
        r: (red + match) * 255,
        g: (green + match) * 255,
        b: (blue + match) * 255
    }
}

function hexToHsv(hex) {
    const safeColor = isValidHexColor(hex) ? hex : FALLBACK_COLOR
    return rgbToHsv(hexToRgb(safeColor))
}

function mixHexColors(left, right, ratio = 0.5) {
    const weight = clamp(ratio, 0, 1)
    const leftRgb = hexToRgb(left)
    const rightRgb = hexToRgb(right)
    return rgbToHex({
        r: leftRgb.r + (rightRgb.r - leftRgb.r) * weight,
        g: leftRgb.g + (rightRgb.g - leftRgb.g) * weight,
        b: leftRgb.b + (rightRgb.b - leftRgb.b) * weight
    })
}

function buildPreviewStyle(color) {
    const lighter = mixHexColors(color, '#FFFFFF', 0.28)
    const darker = mixHexColors(color, '#000000', 0.16)
    return {
        backgroundImage: `radial-gradient(circle at 74% 24%, rgba(255,255,255,0.18), transparent 24%), linear-gradient(135deg, ${lighter} 0%, ${color} 52%, ${darker} 100%)`
    }
}

export default function GradientColorPickerPopover({
    fieldLabel,
    value,
    onApply,
    onClose,
    popoverRef,
    style,
    arrowLeft = 56
}) {
    const [hsv, setHsv] = useState(() => hexToHsv(value))
    const [dragTarget, setDragTarget] = useState(null)
    const saturationRef = useRef(null)
    const hueRef = useRef(null)

    useEffect(() => {
        setHsv(hexToHsv(value))
    }, [value])

    useEffect(() => {
        if (!dragTarget) return undefined

        const handlePointerMove = (event) => {
            if (dragTarget === 'saturation') {
                const rect = saturationRef.current?.getBoundingClientRect()
                if (!rect) return
                const nextS = clamp((event.clientX - rect.left) / rect.width, 0, 1)
                const nextV = clamp(1 - ((event.clientY - rect.top) / rect.height), 0, 1)
                setHsv(prev => ({ ...prev, s: nextS, v: nextV }))
                return
            }

            const rect = hueRef.current?.getBoundingClientRect()
            if (!rect) return
            const nextH = clamp((event.clientY - rect.top) / rect.height, 0, 1) * 360
            setHsv(prev => ({ ...prev, h: nextH }))
        }

        const handlePointerUp = () => {
            setDragTarget(null)
        }

        window.addEventListener('pointermove', handlePointerMove)
        window.addEventListener('pointerup', handlePointerUp)

        return () => {
            window.removeEventListener('pointermove', handlePointerMove)
            window.removeEventListener('pointerup', handlePointerUp)
        }
    }, [dragTarget])

    const draftHex = useMemo(() => rgbToHex(hsvToRgb(hsv)), [hsv])
    const saturationCursorStyle = {
        left: `${hsv.s * 100}%`,
        top: `${(1 - hsv.v) * 100}%`
    }
    const hueCursorStyle = {
        top: `${(hsv.h / 360) * 100}%`
    }

    const startSaturationDrag = (event) => {
        event.preventDefault()
        const rect = saturationRef.current?.getBoundingClientRect()
        if (!rect) return
        const nextS = clamp((event.clientX - rect.left) / rect.width, 0, 1)
        const nextV = clamp(1 - ((event.clientY - rect.top) / rect.height), 0, 1)
        setHsv(prev => ({ ...prev, s: nextS, v: nextV }))
        setDragTarget('saturation')
    }

    const startHueDrag = (event) => {
        event.preventDefault()
        const rect = hueRef.current?.getBoundingClientRect()
        if (!rect) return
        const nextH = clamp((event.clientY - rect.top) / rect.height, 0, 1) * 360
        setHsv(prev => ({ ...prev, h: nextH }))
        setDragTarget('hue')
    }

    return (
        <div
            ref={popoverRef}
            style={style}
            className="absolute z-30 w-[408px] max-w-[calc(100%-1rem)] overflow-hidden rounded-[24px] border border-white/18 bg-gray-900/95 shadow-[0_30px_90px_rgba(2,6,23,0.46)] backdrop-blur-sm"
        >
            <span
                className="absolute top-full h-4 w-4 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b border-r border-white/18 bg-gray-900/95"
                style={{ left: `${arrowLeft}px` }}
            />

            <div className="border-b border-white/10 bg-white/[0.03] px-5 py-4">
                <h3 className="whitespace-nowrap text-sm font-semibold text-white">选择{fieldLabel}</h3>
                <p className="mt-1 whitespace-nowrap text-xs text-white/60">颜色代码仍在外部输入。</p>
            </div>

            <div className="space-y-5 px-5 py-5">
                <div className="grid grid-cols-[1fr_32px] gap-4">
                    <div
                        ref={saturationRef}
                        onPointerDown={startSaturationDrag}
                        className="relative h-60 cursor-crosshair overflow-hidden rounded-[20px] border border-white/15"
                        style={{
                            backgroundColor: `hsl(${hsv.h} 100% 50%)`,
                            backgroundImage: 'linear-gradient(to top, black, transparent), linear-gradient(to right, white, transparent)'
                        }}
                    >
                        <span
                            className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_2px_rgba(0,0,0,0.18)]"
                            style={saturationCursorStyle}
                        />
                    </div>

                    <div
                        ref={hueRef}
                        onPointerDown={startHueDrag}
                        className="relative cursor-row-resize overflow-hidden rounded-[20px] border border-white/15"
                        style={{
                            backgroundImage: 'linear-gradient(to bottom, #ff004c, #ff8a00, #ffe500, #3adf6d, #00d4ff, #3a6dff, #b248ff, #ff004c)'
                        }}
                    >
                        <span
                            className="absolute left-1/2 h-2 w-[22px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_2px_12px_rgba(0,0,0,0.24)]"
                            style={hueCursorStyle}
                        />
                    </div>
                </div>

                <div className="flex items-center justify-between gap-4">
                    <div className="h-16 flex-1 rounded-2xl border border-white/15" style={buildPreviewStyle(draftHex)} />
                    <div className="min-w-[120px] text-right text-xs text-white/60">
                        当前颜色
                        <strong className="mt-1 block text-sm text-white">{draftHex}</strong>
                    </div>
                </div>

                <div className="flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className="h-11 whitespace-nowrap rounded-lg border border-white/15 bg-white/5 px-5 text-sm font-semibold text-white/80 transition-colors hover:bg-white/10"
                    >
                        取消
                    </button>
                    <button
                        type="button"
                        onClick={() => onApply(draftHex)}
                        className="h-11 whitespace-nowrap rounded-lg bg-emerald-500 px-5 text-sm font-semibold text-white transition-colors hover:bg-emerald-400"
                    >
                        应用颜色
                    </button>
                </div>
            </div>
        </div>
    )
}
