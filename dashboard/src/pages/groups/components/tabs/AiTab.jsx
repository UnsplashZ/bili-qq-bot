import { Tab } from '@headlessui/react';
import { Cpu } from 'lucide-react';
import AiConfigSection from '../../../../components/AiConfigSection';

const AiTab = ({
  formData,
  setFormData,
  globalConfig,
  globalConfigLoading,
  actionLoading,
  onAiToggle,
  onAiReset
}) => {
  return (
    <Tab.Panel className="focus:outline-none">
      <div className="space-y-6">
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Cpu className="w-5 h-5 text-purple-400" />
            <h3 className="text-lg font-semibold text-white">AI 功能开关</h3>
          </div>
          <AiConfigSection
            config={{
              aiEnabled: formData.aiEnabled,
              aiRagEnabled: formData.aiRagEnabled,
              aiProfileEnabled: formData.aiProfileEnabled
            }}
            globalConfig={{
              aiEnabled: globalConfig.aiEnabled,
              aiRagEnabled: globalConfig.aiRagEnabled,
              aiProfileEnabled: globalConfig.aiProfileEnabled
            }}
            onToggle={onAiToggle}
            onReset={onAiReset}
            disabled={actionLoading.aiConfig}
            isGroup={true}
          />
        </div>

        <div className="space-y-4 pt-6 border-t border-white/10">
          <div className="flex items-center gap-2">
            <Cpu className="w-5 h-5 text-purple-400" />
            <h3 className="text-lg font-semibold text-white">AI 响应参数</h3>
          </div>

          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
            <p className="text-sm text-white/70">
              配置此群组专属的AI响应行为。留空则使用全局默认值。
            </p>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-white/90">
              响应概率 (留空使用全局默认)
            </label>
            <div className="flex items-center gap-4">
              <input
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={formData.aiProbability ?? ''}
                placeholder={globalConfigLoading ? '加载中...' : `全局默认: ${Math.round(globalConfig.aiProbability * 100)}%`}
                disabled={globalConfigLoading}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === '') {
                    setFormData({ ...formData, aiProbability: null });
                  } else {
                    const parsed = parseFloat(value);
                    if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 1) {
                      setFormData({ ...formData, aiProbability: parsed });
                    }
                  }
                }}
                className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/30 disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <span className="text-white/70 min-w-[60px]">
                {formData.aiProbability !== null
                  ? `${Math.round(formData.aiProbability * 100)}%`
                  : '使用默认'}
              </span>
            </div>
            <p className="text-xs text-white/50">
              AI响应普通消息的概率 (0.0-1.0)，设置为0则完全不响应
            </p>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-white/90">
              上下文对话轮数 (留空使用全局默认)
            </label>
            <input
              type="number"
              min="1"
              max="100"
              value={formData.aiContextLimit ?? ''}
              placeholder={globalConfigLoading ? '加载中...' : `全局默认: ${globalConfig.aiContextLimit}`}
              disabled={globalConfigLoading}
              onChange={(e) => {
                const value = e.target.value;
                if (value === '') {
                  setFormData({ ...formData, aiContextLimit: null });
                } else {
                  const parsed = parseInt(value, 10);
                  if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= 100) {
                    setFormData({ ...formData, aiContextLimit: parsed });
                  }
                }
              }}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/30 disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <p className="text-xs text-white/50">
              AI对话时记忆的上下文轮数，影响token消耗
            </p>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-white/90">
              温度参数 (留空使用全局默认)
            </label>
            <input
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={formData.aiTemperature ?? ''}
              placeholder={globalConfigLoading ? '加载中...' : `全局默认: ${globalConfig.aiTemperature}`}
              disabled={globalConfigLoading}
              onChange={(e) => {
                const value = e.target.value;
                if (value === '') {
                  setFormData({ ...formData, aiTemperature: null });
                } else {
                  const parsed = parseFloat(value);
                  if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 2) {
                    setFormData({ ...formData, aiTemperature: parsed });
                  }
                }
              }}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/30 disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <p className="text-xs text-white/50">
              AI 回复的随机性 (0.0-2.0)，0 为完全确定性，2 为最大创造性
            </p>
          </div>
        </div>
      </div>
    </Tab.Panel>
  );
};

export default AiTab;
