import { Tab } from '@headlessui/react';
import GlassCard from '../../../../components/GlassCard';

const VideoDownloadTab = ({
  videoDownloadConfig,
  setVideoDownloadConfig,
  actionLoading,
  onResetVideoDownloadConfig,
  onSaveVideoDownloadConfig
}) => {
  return (
    <Tab.Panel className="focus:outline-none">
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-white">视频下载配置</h3>
        <GlassCard>
          <div className="space-y-4">
            <div>
              <p className="text-white font-medium mb-2">启用视频下载</p>
              <div className="flex gap-3">
                {[{ label: '跟随全局', value: null }, { label: '开', value: true }, { label: '关', value: false }].map((option) => (
                  <button
                    key={String(option.value)}
                    onClick={() => setVideoDownloadConfig((prev) => ({ ...prev, videoDownloadEnabled: option.value }))}
                    className={`px-3 py-1.5 rounded-lg text-sm ${videoDownloadConfig.videoDownloadEnabled === option.value ? 'bg-purple-500 text-white' : 'bg-white/10 text-white/70 hover:bg-white/20'}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <p className="text-white font-medium">默认分辨率</p>
              <div className="flex gap-2 items-center">
                <button
                  onClick={() => setVideoDownloadConfig((prev) => ({ ...prev, videoDownloadResolution: null }))}
                  className={`px-3 py-1.5 rounded-lg text-sm ${videoDownloadConfig.videoDownloadResolution === null ? 'bg-purple-500 text-white' : 'bg-white/10 text-white/70 hover:bg-white/20'}`}
                >
                  跟随全局
                </button>
                <select
                  value={videoDownloadConfig.videoDownloadResolution ?? ''}
                  onChange={(e) => setVideoDownloadConfig((prev) => ({ ...prev, videoDownloadResolution: e.target.value || null }))}
                  className="bg-white/10 text-white border border-white/20 rounded-lg px-3 py-1.5 text-sm"
                >
                  <option value="" className="bg-gray-800">（跟随全局）</option>
                  {['360p', '480p', '720p', '1080p', '1080p+'].map((resolution) => (
                    <option key={resolution} value={resolution} className="bg-gray-800">{resolution}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <p className="text-white font-medium">最大时长限制（秒）</p>
              <div className="flex gap-2 items-center">
                <button
                  onClick={() => setVideoDownloadConfig((prev) => ({ ...prev, videoDownloadMaxDuration: null }))}
                  className={`px-3 py-1.5 rounded-lg text-sm ${videoDownloadConfig.videoDownloadMaxDuration === null ? 'bg-purple-500 text-white' : 'bg-white/10 text-white/70 hover:bg-white/20'}`}
                >
                  跟随全局
                </button>
                <input
                  type="number"
                  min="0"
                  value={videoDownloadConfig.videoDownloadMaxDuration ?? ''}
                  onChange={(e) => setVideoDownloadConfig((prev) => ({ ...prev, videoDownloadMaxDuration: e.target.value === '' ? null : parseInt(e.target.value, 10) || 0 }))}
                  placeholder="秒"
                  className="bg-white/10 text-white border border-white/20 rounded-lg px-3 py-1.5 text-sm w-24 text-right"
                />
              </div>
            </div>

            <div className="flex justify-between pt-2">
              <button
                onClick={onResetVideoDownloadConfig}
                disabled={actionLoading.videoConfig}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {actionLoading.videoConfig ? '处理中...' : '重置为全局默认'}
              </button>
              <button
                onClick={onSaveVideoDownloadConfig}
                disabled={actionLoading.videoConfig}
                className="px-4 py-2 bg-purple-500/80 hover:bg-purple-500 text-white rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {actionLoading.videoConfig ? '处理中...' : '保存'}
              </button>
            </div>
          </div>
        </GlassCard>
      </div>
    </Tab.Panel>
  );
};

export default VideoDownloadTab;
