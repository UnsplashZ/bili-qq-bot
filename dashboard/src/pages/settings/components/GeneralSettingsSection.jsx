import GlassCard from '../../../components/GlassCard'
import SettingRow from '../../../components/SettingRow'
import { ToggleSwitch } from '../../../components/ui'
import { Settings as SettingsIcon } from 'lucide-react'

const GeneralSettingsSection = ({
    generalConfig,
    onGeneralChange
}) => {
    return (
        <section>
            <div className="flex items-center gap-2 mb-4">
                <SettingsIcon className="text-[var(--accent)]" />
                <h2 className="text-xl font-semibold text-[var(--fg)]">常规设置</h2>
            </div>
            <GlassCard>
                <div className="divide-y divide-[var(--border-subtle)]">
                    <SettingRow
                        title="订阅检查间隔"
                        description="系统检查订阅更新的频率，建议不少于 60 秒。"
                        status="秒"
                        control={
                            <input
                                type="number"
                                min="10"
                                value={generalConfig.subscriptionCheckInterval}
                                onChange={(event) => onGeneralChange('subscriptionCheckInterval', parseInt(event.target.value, 10) || 0)}
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
                                onChange={(event) => onGeneralChange('linkCacheTimeout', parseInt(event.target.value, 10) || 0)}
                                className="field-control w-full px-3 py-2 md:w-40"
                            />
                        }
                    />

                    <SettingRow
                        title="显示 UID"
                        description="控制用户类卡片与订阅列表是否显示 UID。"
                        control={
                            <ToggleSwitch
                                checked={!!generalConfig.showId}
                                onChange={(checked) => onGeneralChange('showId', checked)}
                                label="显示 UID"
                            />
                        }
                    />
                </div>
            </GlassCard>
        </section>
    )
}

export default GeneralSettingsSection
