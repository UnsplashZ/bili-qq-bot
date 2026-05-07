import GlassCard from '../../../components/GlassCard'
import SettingRow from '../../../components/SettingRow'
import { ToggleSwitch } from '../../../components/ui'

const VideoDownloadSection = ({
    videoDownloadConfig,
    onVideoDownloadChange
}) => {
    return (
        <section>
            <h2 className="text-xl font-semibold text-[var(--fg)] mb-4">视频下载</h2>
            <GlassCard>
                <div className="divide-y divide-[var(--border)]">
                    <SettingRow
                        title="启用视频下载"
                        description="识别到视频链接时自动下载并发送（合并转发）。"
                        control={
                        <ToggleSwitch
                            checked={!!videoDownloadConfig.videoDownloadEnabled}
                            onChange={(checked) => onVideoDownloadChange('videoDownloadEnabled', checked)}
                            label="启用视频下载"
                        />
                        }
                    />

                    <SettingRow
                        title="默认分辨率"
                        description="DASH 流画质上限。"
                        control={
                        <select
                            value={videoDownloadConfig.videoDownloadResolution}
                            onChange={e => onVideoDownloadChange('videoDownloadResolution', e.target.value)}
                            className="field-control px-3 py-1.5 text-sm"
                        >
                            {['360p', '480p', '720p', '1080p', '1080p+'].map(r => (
                                <option key={r} value={r}>{r}</option>
                            ))}
                        </select>
                        }
                    />

                    <SettingRow
                        title="最大时长限制"
                        description="单位秒，0 表示不限制。"
                        status="秒"
                        control={
                        <input
                            type="number"
                            min="0"
                            value={videoDownloadConfig.videoDownloadMaxDuration}
                            onChange={e => onVideoDownloadChange('videoDownloadMaxDuration', parseInt(e.target.value) || 0)}
                            className="field-control w-24 px-3 py-1.5 text-right text-sm"
                        />
                        }
                    />

                    <SettingRow
                        title="发送后自动删除"
                        description="发送成功后立即删除本地文件。"
                        control={
                        <ToggleSwitch
                            checked={!!videoDownloadConfig.videoDownloadAutoClean}
                            onChange={(checked) => onVideoDownloadChange('videoDownloadAutoClean', checked)}
                            label="发送后自动删除"
                        />
                        }
                    />

                    <SettingRow
                        title="文件清理超时"
                        description="超过此时间的未清理文件将自动删除。"
                        status="小时"
                        control={
                        <input
                            type="number"
                            min="1"
                            max="168"
                            value={videoDownloadConfig.videoDownloadCleanTimeout}
                            onChange={e => onVideoDownloadChange('videoDownloadCleanTimeout', parseInt(e.target.value) || 6)}
                            className="field-control w-20 px-3 py-1.5 text-right text-sm"
                        />
                        }
                    />

                </div>
            </GlassCard>
        </section>
    )
}

export default VideoDownloadSection
