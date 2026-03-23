import GlassModal from '../../../components/GlassModal'
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
                <button
                    type="button"
                    onClick={onClose}
                    className="rounded-lg bg-white/8 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/12"
                >
                    关闭
                </button>
            )}
        >
            <p className="text-sm text-white/70">
                这是固定底板与当前氛围色合成后的卡片效果，不等于原始选色本身。
            </p>

            <div
                className="mt-4 rounded-[28px] border border-white/14 p-5 shadow-[0_24px_80px_rgba(2,6,23,0.32)]"
                style={previewStyle}
            >
                <div className="inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/55 px-3 py-2 text-xs font-semibold tracking-[0.12em] text-slate-700 shadow-[0_8px_24px_rgba(148,163,184,0.24)] backdrop-blur-md">
                    <span className="text-sm">▶</span>
                    <span>视频</span>
                </div>

                <div className="mt-4 rounded-[24px] border border-white/35 bg-white/58 p-5 shadow-[0_20px_48px_rgba(148,163,184,0.24)] backdrop-blur-xl">
                    <div className="flex items-center gap-3">
                        <div className="h-14 w-14 rounded-full border border-white/60 bg-gradient-to-br from-white/90 to-slate-200/70 shadow-[0_10px_28px_rgba(148,163,184,0.22)]" />
                        <div className="min-w-0 flex-1">
                            <div className="h-4 w-28 rounded-full bg-slate-700/80" />
                            <div className="mt-2 h-3 w-20 rounded-full bg-slate-500/45" />
                        </div>
                    </div>

                    <div className="mt-5 h-40 rounded-[20px] border border-white/30 bg-gradient-to-br from-white/70 via-white/20 to-slate-200/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]" />

                    <div className="mt-5 h-5 w-[78%] rounded-full bg-slate-800/90" />
                    <div className="mt-3 h-3 w-[52%] rounded-full bg-slate-500/45" />
                    <div className="mt-5 space-y-2.5">
                        <div className="h-3 rounded-full bg-slate-600/30" />
                        <div className="h-3 w-[92%] rounded-full bg-slate-600/22" />
                    </div>
                </div>
            </div>
        </GlassModal>
    )
}

export default PreviewGradientModal
