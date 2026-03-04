import GlassCard from '../../../components/GlassCard'

const VideoDownloadSection = ({
    videoDownloadConfig,
    savingVideoDownload,
    onVideoDownloadChange,
    onSaveVideoDownload
}) => {
    return (
        <section>
            <h2 className="text-xl font-semibold text-white mb-4">视频下载</h2>
            <GlassCard>
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-white font-medium">启用视频下载</p>
                            <p className="text-sm text-white/60">识别到视频链接时自动下载并发送（合并转发）</p>
                        </div>
                        <button
                            onClick={() => onVideoDownloadChange('videoDownloadEnabled', !videoDownloadConfig.videoDownloadEnabled)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${videoDownloadConfig.videoDownloadEnabled ? 'bg-purple-500' : 'bg-white/20'}`}
                        >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${videoDownloadConfig.videoDownloadEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                    </div>

                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-white font-medium">默认分辨率</p>
                            <p className="text-sm text-white/60">DASH 流画质上限</p>
                        </div>
                        <select
                            value={videoDownloadConfig.videoDownloadResolution}
                            onChange={e => onVideoDownloadChange('videoDownloadResolution', e.target.value)}
                            className="bg-white/10 text-white border border-white/20 rounded-lg px-3 py-1.5 text-sm"
                        >
                            {['360p', '480p', '720p', '1080p', '1080p+'].map(r => (
                                <option key={r} value={r} className="bg-gray-800">{r}</option>
                            ))}
                        </select>
                    </div>

                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-white font-medium">最大时长限制（秒）</p>
                            <p className="text-sm text-white/60">0 表示不限制</p>
                        </div>
                        <input
                            type="number"
                            min="0"
                            value={videoDownloadConfig.videoDownloadMaxDuration}
                            onChange={e => onVideoDownloadChange('videoDownloadMaxDuration', parseInt(e.target.value) || 0)}
                            className="bg-white/10 text-white border border-white/20 rounded-lg px-3 py-1.5 text-sm w-24 text-right"
                        />
                    </div>

                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-white font-medium">发送后自动删除</p>
                            <p className="text-sm text-white/60">发送成功后立即删除本地文件</p>
                        </div>
                        <button
                            onClick={() => onVideoDownloadChange('videoDownloadAutoClean', !videoDownloadConfig.videoDownloadAutoClean)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${videoDownloadConfig.videoDownloadAutoClean ? 'bg-purple-500' : 'bg-white/20'}`}
                        >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${videoDownloadConfig.videoDownloadAutoClean ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                    </div>

                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-white font-medium">文件清理超时（小时）</p>
                            <p className="text-sm text-white/60">超过此时间的未清理文件将自动删除</p>
                        </div>
                        <input
                            type="number"
                            min="1"
                            max="168"
                            value={videoDownloadConfig.videoDownloadCleanTimeout}
                            onChange={e => onVideoDownloadChange('videoDownloadCleanTimeout', parseInt(e.target.value) || 6)}
                            className="bg-white/10 text-white border border-white/20 rounded-lg px-3 py-1.5 text-sm w-20 text-right"
                        />
                    </div>

                    <div className="flex justify-end pt-2">
                        <button
                            onClick={onSaveVideoDownload}
                            disabled={savingVideoDownload}
                            className="px-4 py-2 bg-purple-500/80 hover:bg-purple-500 text-white rounded-lg text-sm transition-colors disabled:opacity-50"
                        >
                            {savingVideoDownload ? '保存中...' : '保存'}
                        </button>
                    </div>
                </div>
            </GlassCard>
        </section>
    )
}

export default VideoDownloadSection
