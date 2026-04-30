import GlassCard from '../../../components/GlassCard'
import { Shield, X } from 'lucide-react'

const GlobalBlacklistSection = ({
    blacklist,
    newBlacklistQQ,
    addingBlacklist,
    onNewBlacklistQQChange,
    onAddBlacklist,
    onRemoveBlacklist
}) => {
    return (
        <section>
            <div className="flex items-center gap-2 mb-4">
                <Shield className="text-red-400" />
                <h2 className="text-xl font-semibold text-white">全局黑名单</h2>
            </div>
            <GlassCard>
                <div className="mb-4">
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={newBlacklistQQ}
                            onChange={(e) => onNewBlacklistQQChange(e.target.value)}
                            placeholder="输入 QQ 号"
                            className="field-control flex-1 px-3 py-2"
                            onKeyDown={(e) => e.key === 'Enter' && onAddBlacklist()}
                        />
                        <button
                            onClick={onAddBlacklist}
                            disabled={addingBlacklist || !newBlacklistQQ}
                            className="px-4 py-2 text-red-300 border border-red-500/30 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
                        >
                            添加
                        </button>
                    </div>
                </div>

                <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
                    {blacklist.length === 0 ? (
                        <div className="text-center text-gray-500 py-4">黑名单为空</div>
                    ) : (
                        <div className="flex flex-wrap gap-2">
                            {blacklist.map((qq) => (
                                <div key={qq} className="flex items-center gap-2 rounded-lg border border-red-500/20 px-3 py-1.5 text-red-200">
                                    <span>{qq}</span>
                                    <button
                                        onClick={() => onRemoveBlacklist(qq)}
                                        className="hover:text-white transition-colors"
                                    >
                                        <X size={14} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </GlassCard>
        </section>
    )
}

export default GlobalBlacklistSection
