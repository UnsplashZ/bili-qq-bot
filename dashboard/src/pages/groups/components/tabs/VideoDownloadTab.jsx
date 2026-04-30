import SettingRow from '../../../../components/SettingRow';

const VideoDownloadTab = ({
  videoDownloadConfig,
  setVideoDownloadConfig,
  actionLoading,
  onResetVideoDownloadConfig
}) => {
  return (
    <div className="focus:outline-none">
      <div className="divide-y divide-white/10">
            <SettingRow
              title="启用视频下载"
              description="群组级覆盖配置，可跟随全局默认值。"
              status={videoDownloadConfig.videoDownloadEnabled === null ? '继承' : (videoDownloadConfig.videoDownloadEnabled ? '开启' : '关闭')}
              control={
              <div className="flex flex-wrap gap-2">
                {[{ label: '跟随全局', value: null }, { label: '开', value: true }, { label: '关', value: false }].map((option) => (
                  <button
                    key={String(option.value)}
                    onClick={() => setVideoDownloadConfig((prev) => ({ ...prev, videoDownloadEnabled: option.value }))}
                    className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${videoDownloadConfig.videoDownloadEnabled === option.value ? 'border-cyan-300/40 bg-cyan-300/10 text-cyan-100' : 'border-white/10 text-slate-400 hover:bg-white/5'}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              }
            />

            <SettingRow
              title="默认分辨率"
              description="DASH 流画质上限。"
              status={videoDownloadConfig.videoDownloadResolution === null ? '继承' : videoDownloadConfig.videoDownloadResolution}
              control={
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setVideoDownloadConfig((prev) => ({ ...prev, videoDownloadResolution: null }))}
                  className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${videoDownloadConfig.videoDownloadResolution === null ? 'border-cyan-300/40 bg-cyan-300/10 text-cyan-100' : 'border-white/10 text-slate-400 hover:bg-white/5'}`}
                >
                  跟随全局
                </button>
                <select
                  value={videoDownloadConfig.videoDownloadResolution ?? ''}
                  onChange={(e) => setVideoDownloadConfig((prev) => ({ ...prev, videoDownloadResolution: e.target.value || null }))}
                  className="field-control px-3 py-1.5 text-sm"
                >
                  <option value="" className="bg-gray-800">（跟随全局）</option>
                  {['360p', '480p', '720p', '1080p', '1080p+'].map((resolution) => (
                    <option key={resolution} value={resolution} className="bg-gray-800">{resolution}</option>
                  ))}
                </select>
              </div>
              }
            />

            <SettingRow
              title="最大时长限制"
              description="单位秒，0 表示不限制。"
              status={videoDownloadConfig.videoDownloadMaxDuration === null ? '继承' : '秒'}
              control={
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setVideoDownloadConfig((prev) => ({ ...prev, videoDownloadMaxDuration: null }))}
                  className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${videoDownloadConfig.videoDownloadMaxDuration === null ? 'border-cyan-300/40 bg-cyan-300/10 text-cyan-100' : 'border-white/10 text-slate-400 hover:bg-white/5'}`}
                >
                  跟随全局
                </button>
                <input
                  type="number"
                  min="0"
                  value={videoDownloadConfig.videoDownloadMaxDuration ?? ''}
                  onChange={(e) => setVideoDownloadConfig((prev) => ({ ...prev, videoDownloadMaxDuration: e.target.value === '' ? null : parseInt(e.target.value, 10) || 0 }))}
                  placeholder="秒"
                  className="field-control w-24 px-3 py-1.5 text-right text-sm"
                />
              </div>
              }
            />

            <div className="flex justify-end pt-4">
              <button
                onClick={onResetVideoDownloadConfig}
                disabled={actionLoading.videoConfig}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-200 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {actionLoading.videoConfig ? '处理中...' : '重置为全局默认'}
              </button>
            </div>
      </div>
    </div>
  );
};

export default VideoDownloadTab;
