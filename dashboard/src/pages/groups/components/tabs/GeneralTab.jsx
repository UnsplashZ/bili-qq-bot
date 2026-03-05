import { Tab } from '@headlessui/react';
import { clsx } from 'clsx';

const GeneralTab = ({ formData, setFormData }) => {
  return (
    <Tab.Panel className="space-y-5 md:space-y-6 focus:outline-none">
      <div className="space-y-4">
        <label className="block">
          <span className="text-gray-300 text-sm font-medium">链接缓存超时 (秒)</span>
          <input
            type="number"
            value={formData.linkCacheTimeout}
            onChange={(e) => setFormData({ ...formData, linkCacheTimeout: parseInt(e.target.value, 10) || 0 })}
            className="mt-1 block w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
          />
        </label>

        <label className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/10 cursor-pointer">
          <div>
            <span className="text-gray-300 text-sm font-medium block">显示 UID</span>
            <span className="text-xs text-gray-500">关闭后，用户相关卡片与列表将隐藏 UID。</span>
          </div>
          <input
            type="checkbox"
            checked={!!formData.showId}
            onChange={(e) => setFormData({ ...formData, showId: e.target.checked })}
            className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-900"
          />
        </label>

        <div>
          <span className="text-gray-300 text-sm font-medium mb-2 block">深色模式</span>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3 mb-3">
            <button
              type="button"
              onClick={() => setFormData({ ...formData, nightMode: { ...formData.nightMode, mode: 'off' } })}
              className={clsx(
                'flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all',
                formData.nightMode.mode === 'off'
                  ? 'bg-blue-500/20 text-blue-400 ring-2 ring-blue-500'
                  : 'bg-white/5 text-gray-400 hover:bg-white/10'
              )}
            >
              关闭
            </button>
            <button
              type="button"
              onClick={() => setFormData({ ...formData, nightMode: { ...formData.nightMode, mode: 'on' } })}
              className={clsx(
                'flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all',
                formData.nightMode.mode === 'on'
                  ? 'bg-blue-500/20 text-blue-400 ring-2 ring-blue-500'
                  : 'bg-white/5 text-gray-400 hover:bg-white/10'
              )}
            >
              开启
            </button>
            <button
              type="button"
              onClick={() => setFormData({ ...formData, nightMode: { ...formData.nightMode, mode: 'timed' } })}
              className={clsx(
                'flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all',
                formData.nightMode.mode === 'timed'
                  ? 'bg-blue-500/20 text-blue-400 ring-2 ring-blue-500'
                  : 'bg-white/5 text-gray-400 hover:bg-white/10'
              )}
            >
              定时
            </button>
          </div>

          {formData.nightMode.mode === 'timed' && (
            <div className="space-y-2 p-3 bg-white/5 rounded-lg border border-white/10">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs text-gray-400 mb-1 block">开始时间</span>
                  <input
                    type="time"
                    value={formData.nightMode.startTime}
                    onChange={(e) => setFormData({
                      ...formData,
                      nightMode: { ...formData.nightMode, startTime: e.target.value }
                    })}
                    className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-gray-400 mb-1 block">结束时间</span>
                  <input
                    type="time"
                    value={formData.nightMode.endTime}
                    onChange={(e) => setFormData({
                      ...formData,
                      nightMode: { ...formData.nightMode, endTime: e.target.value }
                    })}
                    className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
                  />
                </label>
              </div>
              <p className="text-xs text-gray-500">
                支持跨天时段（例如 21:00–06:00）
              </p>
            </div>
          )}
        </div>

        <div>
          <span className="text-gray-300 text-sm font-medium mb-2 block">预览卡片标签开关</span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {Object.keys(formData.labelConfig).map((key) => (
              <label key={key} className="flex items-start gap-2 p-3 bg-white/5 rounded-lg cursor-pointer hover:bg-white/10 transition-colors">
                <input
                  type="checkbox"
                  checked={formData.labelConfig[key]}
                  onChange={(e) => setFormData({
                    ...formData,
                    labelConfig: { ...formData.labelConfig, [key]: e.target.checked }
                  })}
                  className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-900"
                />
                <span className="capitalize">
                  {key === 'video' ? '视频'
                    : key === 'live' ? '直播'
                      : key === 'dynamic' ? '动态'
                        : key === 'article' ? '专栏'
                          : key === 'bangumi' ? '番剧'
                            : key === 'movie' ? '电影'
                              : key === 'tv' ? '电视剧'
                                : key === 'guocha' ? '国创'
                                  : key === 'doc' ? '纪录片'
                                    : key === 'variety' ? '综艺'
                                      : key}
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </Tab.Panel>
  );
};

export default GeneralTab;
