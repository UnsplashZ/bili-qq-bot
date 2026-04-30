import GlassCard from '../../../components/GlassCard'
import SettingRow from '../../../components/SettingRow'

const VideoDownloadSection = ({
    videoDownloadConfig,
    onVideoDownloadChange
}) => {
    return (
        <section>
            <h2 className="text-xl font-semibold text-white mb-4">视频下载</h2>
            <GlassCard>
                <div className="divide-y divide-white/10">
                    <SettingRow
                        title="启用视频下载"
                        description="识别到视频链接时自动下载并发送（合并转发）。"
                        status={videoDownloadConfig.videoDownloadEnabled ? '开启' : '关闭'}
                        control={
                        <button
                            onClick={() => onVideoDownloadChange('videoDownloadEnabled', !videoDownloadConfig.videoDownloadEnabled)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-md transition-colors ${videoDownloadConfig.videoDownloadEnabled ? 'bg-cyan-500/70' : 'bg-white/20'}`}
                        >
                            <span className={`inline-block h-4 w-4 transform rounded bg-white transition-transform ${videoDownloadConfig.videoDownloadEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
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
                                <option key={r} value={r} className="bg-gray-800">{r}</option>
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
                        status={videoDownloadConfig.videoDownloadAutoClean ? '开启' : '关闭'}
                        control={
                        <button
                            onClick={() => onVideoDownloadChange('videoDownloadAutoClean', !videoDownloadConfig.videoDownloadAutoClean)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-md transition-colors ${videoDownloadConfig.videoDownloadAutoClean ? 'bg-cyan-500/70' : 'bg-white/20'}`}
                        >
                            <span className={`inline-block h-4 w-4 transform rounded bg-white transition-transform ${videoDownloadConfig.videoDownloadAutoClean ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
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
