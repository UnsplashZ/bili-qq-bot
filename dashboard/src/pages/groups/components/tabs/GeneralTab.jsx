import { clsx } from 'clsx';
import SettingRow from '../../../../components/SettingRow';
import { LABEL_CONFIG_ITEMS } from '../../constants/labelConfig';

const GeneralTab = ({ formData, setFormData }) => {
  return (
    <div className="space-y-5 md:space-y-6 focus:outline-none">
      <div className="divide-y divide-white/10">
        <SettingRow
          title="链接缓存超时"
          description="同一链接重复解析的群组级冷却时间。"
          status="秒"
          control={
          <input
            type="number"
            value={formData.linkCacheTimeout}
            onChange={(e) => setFormData({ ...formData, linkCacheTimeout: parseInt(e.target.value, 10) || 0 })}
            className="field-control w-full px-3 py-2 md:w-40"
          />
          }
        />

        <SettingRow
          title="显示 UID"
          description="关闭后，用户相关卡片与列表将隐藏 UID。"
          status={formData.showId ? '开启' : '关闭'}
          control={
          <input
            type="checkbox"
            checked={!!formData.showId}
            onChange={(e) => setFormData({ ...formData, showId: e.target.checked })}
            className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-slate-950"
          />
          }
        />

        <div className="py-4">
          <span className="mb-2 block text-sm font-medium text-white">深色模式</span>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3 mb-3">
            <button
              type="button"
              onClick={() => setFormData({ ...formData, nightMode: { ...formData.nightMode, mode: 'off' } })}
              className={clsx(
                'flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
                formData.nightMode.mode === 'off'
                  ? 'border-cyan-300/40 bg-cyan-300/10 text-cyan-100'
                  : 'border-white/10 bg-transparent text-slate-400 hover:bg-white/5'
              )}
            >
              关闭
            </button>
            <button
              type="button"
              onClick={() => setFormData({ ...formData, nightMode: { ...formData.nightMode, mode: 'on' } })}
              className={clsx(
                'flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
                formData.nightMode.mode === 'on'
                  ? 'border-cyan-300/40 bg-cyan-300/10 text-cyan-100'
                  : 'border-white/10 bg-transparent text-slate-400 hover:bg-white/5'
              )}
            >
              开启
            </button>
            <button
              type="button"
              onClick={() => setFormData({ ...formData, nightMode: { ...formData.nightMode, mode: 'timed' } })}
              className={clsx(
                'flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
                formData.nightMode.mode === 'timed'
                  ? 'border-cyan-300/40 bg-cyan-300/10 text-cyan-100'
                  : 'border-white/10 bg-transparent text-slate-400 hover:bg-white/5'
              )}
            >
              定时
            </button>
          </div>

          {formData.nightMode.mode === 'timed' && (
            <div className="space-y-2 rounded-lg border border-white/10 bg-black/20 p-3">
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
                    className="field-control w-full px-3 py-2"
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
                    className="field-control w-full px-3 py-2"
                  />
                </label>
              </div>
              <p className="text-xs text-gray-500">
                支持跨天时段（例如 21:00–06:00）
              </p>
            </div>
          )}
        </div>

        <div className="py-4">
          <span className="text-gray-300 text-sm font-medium mb-2 block">预览卡片标签开关</span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {LABEL_CONFIG_ITEMS.map((item) => (
              <label key={item.key} className="flex items-start gap-2 rounded-lg border border-white/10 bg-black/20 p-3 transition-colors hover:bg-white/5">
                <input
                  type="checkbox"
                  checked={!!formData.labelConfig[item.key]}
                  onChange={(e) => setFormData({
                    ...formData,
                    labelConfig: { ...formData.labelConfig, [item.key]: e.target.checked }
                  })}
                  className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-slate-950"
                />
                <span className="capitalize">
                  {item.label}
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default GeneralTab;
