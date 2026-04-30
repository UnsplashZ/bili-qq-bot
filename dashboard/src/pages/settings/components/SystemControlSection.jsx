import { Activity, AlertTriangle } from 'lucide-react'

const SystemControlSection = ({ onRestart }) => {
    return (
        <section className="pt-8 border-t border-white/10">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                        <Activity className="text-red-400" />
                        系统控制
                    </h2>
                    <p className="text-red-300/80 text-sm mt-1">重启会短暂中断当前服务。</p>
                </div>
                <button
                    onClick={onRestart}
                    className="flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30 rounded-lg transition-colors"
                >
                    <AlertTriangle size={18} />
                    重启系统
                </button>
            </div>
        </section>
    )
}

export default SystemControlSection
