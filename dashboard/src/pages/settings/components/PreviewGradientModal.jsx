import GlassModal from '../../../components/GlassModal'
import { Button } from '../../../components/ui'
import { buildGradientBackground } from './previewGradientModel'

const PreviewGradientModal = ({ isOpen, onClose, color1, color2 }) => {
    const previewStyle = buildGradientBackground(color1, color2)

    return (
        <GlassModal
            isOpen={isOpen}
            onClose={onClose}
            title="预览图效果"
            className="max-w-xl"
            footer={(
                <Button
                    type="button"
                    onClick={onClose}
                    variant="secondary"
                >
                    关闭
                </Button>
            )}
        >
            <p className="text-sm text-[var(--muted)]">
                这是固定底板与当前氛围色合成后的卡片效果，不等于原始选色本身。
            </p>

            <div
                className="mt-4 rounded-lg border border-white/14 p-5 shadow-[0_18px_48px_rgba(2,6,23,0.24)]"
                style={previewStyle}
            >
                <div className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-white/55 px-3 py-2 text-xs font-semibold tracking-[0.12em] text-slate-700 shadow-[0_8px_24px_rgba(148,163,184,0.18)]">
                    <span className="text-sm">▶</span>
                    <span>视频</span>
                </div>

                <div className="mt-4 rounded-lg border border-white/35 bg-white/58 p-5 shadow-[0_16px_36px_rgba(148,163,184,0.20)]">
                    <div className="flex items-center gap-3">
                        <div className="h-14 w-14 rounded-lg border border-white/60 bg-gradient-to-br from-white/90 to-slate-200/70 shadow-[0_10px_28px_rgba(148,163,184,0.18)]" />
                        <div className="min-w-0 flex-1">
                            <div className="h-4 w-28 rounded bg-slate-700/80" />
                            <div className="mt-2 h-3 w-20 rounded bg-slate-500/45" />
                        </div>
                    </div>

                    <div className="mt-5 h-40 rounded-lg border border-white/30 bg-gradient-to-br from-white/70 via-white/20 to-slate-200/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]" />

                    <div className="mt-5 h-5 w-[78%] rounded bg-slate-800/90" />
                    <div className="mt-3 h-3 w-[52%] rounded bg-slate-500/45" />
                    <div className="mt-5 space-y-2.5">
                        <div className="h-3 rounded bg-slate-600/30" />
                        <div className="h-3 w-[92%] rounded bg-slate-600/22" />
                    </div>
                </div>
            </div>
        </GlassModal>
    )
}

export default PreviewGradientModal
