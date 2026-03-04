import GlassCard from '../../../components/GlassCard'
import { Save, Clock, Settings as SettingsIcon } from 'lucide-react'

const GeneralSettingsSection = ({
    generalConfig,
    savingGeneral,
    onGeneralChange,
    onSaveGeneral
}) => {
    return (
        <section>
            <div className="flex items-center gap-2 mb-4">
                <SettingsIcon className="text-green-400" />
                <h2 className="text-xl font-semibold text-white">常规设置</h2>
            </div>
            <GlassCard>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            <div className="flex items-center gap-2">
                                <Clock size={16} />
                                订阅检查间隔 (秒)
                            </div>
                        </label>
                        <input
                            type="number"
                            min="10"
                            value={generalConfig.subscriptionCheckInterval}
                            onChange={(e) => onGeneralChange('subscriptionCheckInterval', parseInt(e.target.value) || 0)}
                            className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-green-500 focus:outline-none"
                        />
                        <p className="text-xs text-gray-500 mt-1">系统检查订阅更新的频率，建议不少于 60 秒。</p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            <div className="flex items-center gap-2">
                                <Clock size={16} />
                                链接冷却时间 (秒)
                            </div>
                        </label>
                        <input
                            type="number"
                            min="0"
                            value={generalConfig.linkCacheTimeout}
                            onChange={(e) => onGeneralChange('linkCacheTimeout', parseInt(e.target.value, 10) || 0)}
                            className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-green-500 focus:outline-none"
                        />
                        <p className="text-xs text-gray-500 mt-1">同一链接重复解析的全局冷却时间。</p>
                    </div>

                    <div className="md:col-span-2">
                        <label className="flex items-center justify-between p-4 bg-white/5 rounded-lg border border-white/10 cursor-pointer">
                            <div>
                                <p className="text-sm font-medium text-white">显示 UID</p>
                                <p className="text-xs text-gray-500 mt-1">控制用户类卡片与订阅列表是否显示 UID。</p>
                            </div>
                            <input
                                type="checkbox"
                                checked={!!generalConfig.showId}
                                onChange={(e) => onGeneralChange('showId', e.target.checked)}
                                className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-green-500 focus:ring-green-500 focus:ring-offset-gray-900"
                            />
                        </label>
                    </div>
                </div>

                <div className="mt-6 flex justify-end">
                    <button
                        onClick={onSaveGeneral}
                        disabled={savingGeneral}
                        className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-white font-medium transition-colors disabled:opacity-50"
                    >
                        <Save size={18} />
                        {savingGeneral ? '保存中...' : '保存常规设置'}
                    </button>
                </div>
            </GlassCard>
        </section>
    )
}

export default GeneralSettingsSection
