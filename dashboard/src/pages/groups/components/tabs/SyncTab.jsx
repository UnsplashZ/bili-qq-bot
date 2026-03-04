import { Tab } from '@headlessui/react';
import { Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';

const SyncTab = ({
  formData,
  setFormData,
  atAllRules,
  atAllCategoryItems,
  toggleAtAllSource,
  toggleAtAllCategory,
  setAllAtAllIdsEnabled,
  atAllTargetsLoading,
  atAllTargets,
  isAtAllUserEnabled,
  toggleAtAllUser,
  isCookieUserInSelectedSyncGroups,
  globalBiliStatus,
  biliGroupsLoading,
  biliGroups,
  toggleSyncGroup
}) => {
  return (
    <Tab.Panel className="space-y-8 focus:outline-none">
      <div className="p-4 bg-white/5 rounded-lg border border-white/10">
        <label className="flex items-center justify-between cursor-pointer">
          <div>
            <span className="text-white font-medium block">订阅推送 @全体成员</span>
            <span className="text-gray-400 text-sm">开启后，订阅与关注同步推送会附带 @全体成员（需机器人具备权限）</span>
          </div>
          <div className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={formData.subscriptionAtAll}
              onChange={(e) => setFormData({ ...formData, subscriptionAtAll: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600" />
          </div>
        </label>
      </div>

      <div className={clsx('p-4 bg-white/5 rounded-lg border border-white/10 space-y-5', !formData.subscriptionAtAll && 'opacity-50')}>
        <div>
          <div className="text-white font-medium">`@全体` 细粒度规则</div>
          <div className="text-sm text-gray-400 mt-1">
            命中规则：总开关开启 AND 来源开启 AND 分类开启 AND 该来源下 UID 未被关闭
          </div>
        </div>

        <div className="space-y-3">
          <div className="text-sm text-gray-300 font-medium">来源开关</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex items-center gap-2 p-3 bg-black/20 border border-white/5 rounded-lg cursor-pointer">
              <input
                type="checkbox"
                checked={!!atAllRules.sources.manual}
                onChange={(e) => toggleAtAllSource('manual', e.target.checked)}
                disabled={!formData.subscriptionAtAll}
                className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500 disabled:opacity-50"
              />
              <span className="text-gray-200 text-sm">手动订阅</span>
            </label>
            <label className="flex items-center gap-2 p-3 bg-black/20 border border-white/5 rounded-lg cursor-pointer">
              <input
                type="checkbox"
                checked={!!atAllRules.sources.cookieSync}
                onChange={(e) => toggleAtAllSource('cookieSync', e.target.checked)}
                disabled={!formData.subscriptionAtAll}
                className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500 disabled:opacity-50"
              />
              <span className="text-gray-200 text-sm">关注同步</span>
            </label>
          </div>
        </div>

        <div className="space-y-3">
          <div className="text-sm text-gray-300 font-medium">分类开关</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {atAllCategoryItems.map((item) => (
              <label key={item.key} className="flex items-center gap-2 p-3 bg-black/20 border border-white/5 rounded-lg cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!atAllRules.categories[item.key]}
                  onChange={(e) => toggleAtAllCategory(item.key, e.target.checked)}
                  disabled={!formData.subscriptionAtAll}
                  className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500 disabled:opacity-50"
                />
                <span className="text-gray-200 text-sm">{item.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="text-sm text-gray-300 font-medium">逐个 UID 开关</div>

          <div className="space-y-3 p-3 bg-black/20 border border-white/5 rounded-lg">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm text-gray-200">手动订阅用户</div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAllAtAllIdsEnabled('manual', true)}
                  disabled={!formData.subscriptionAtAll}
                  className="px-2 py-1 text-xs rounded bg-white/10 hover:bg-white/20 disabled:opacity-50"
                >
                  全开
                </button>
                <button
                  type="button"
                  onClick={() => setAllAtAllIdsEnabled('manual', false)}
                  disabled={!formData.subscriptionAtAll}
                  className="px-2 py-1 text-xs rounded bg-white/10 hover:bg-white/20 disabled:opacity-50"
                >
                  全关
                </button>
              </div>
            </div>

            {atAllTargetsLoading ? (
              <div className="flex items-center gap-2 text-gray-400 text-sm">
                <Loader2 size={14} className="animate-spin" />
                正在加载 UID 列表...
              </div>
            ) : atAllTargets.manualUsers.length === 0 ? (
              <div className="text-gray-500 text-sm italic">暂无手动订阅用户</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {atAllTargets.manualUsers.map((user) => {
                  const enabled = isAtAllUserEnabled('manual', user.uid);
                  return (
                    <label key={`manual-${user.uid}`} className="flex items-center gap-2 p-2 rounded bg-white/5">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(e) => toggleAtAllUser('manual', user.uid, e.target.checked)}
                        disabled={!formData.subscriptionAtAll}
                        className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500 disabled:opacity-50"
                      />
                      <span className="text-sm text-gray-200">{user.name}</span>
                      <span className="text-xs text-gray-500 font-mono">{user.uid}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-3 p-3 bg-black/20 border border-white/5 rounded-lg">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm text-gray-200">关注同步用户</div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAllAtAllIdsEnabled('cookieSync', true)}
                  disabled={!formData.subscriptionAtAll}
                  className="px-2 py-1 text-xs rounded bg-white/10 hover:bg-white/20 disabled:opacity-50"
                >
                  全开
                </button>
                <button
                  type="button"
                  onClick={() => setAllAtAllIdsEnabled('cookieSync', false)}
                  disabled={!formData.subscriptionAtAll}
                  className="px-2 py-1 text-xs rounded bg-white/10 hover:bg-white/20 disabled:opacity-50"
                >
                  全关
                </button>
              </div>
            </div>

            {atAllTargetsLoading ? (
              <div className="flex items-center gap-2 text-gray-400 text-sm">
                <Loader2 size={14} className="animate-spin" />
                正在加载 UID 列表...
              </div>
            ) : atAllTargets.cookieUsers.length === 0 ? (
              <div className="text-gray-500 text-sm italic">暂无关注同步用户</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {atAllTargets.cookieUsers.map((user) => {
                  const enabled = isAtAllUserEnabled('cookieSync', user.uid);
                  const matched = isCookieUserInSelectedSyncGroups(user);
                  return (
                    <label key={`cookie-${user.uid}`} className="flex items-center gap-2 p-2 rounded bg-white/5">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(e) => toggleAtAllUser('cookieSync', user.uid, e.target.checked)}
                        disabled={!formData.subscriptionAtAll}
                        className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500 disabled:opacity-50"
                      />
                      <span className="text-sm text-gray-200">{user.name}</span>
                      <span className="text-xs text-gray-500 font-mono">{user.uid}</span>
                      <span className={clsx('text-[10px] px-1.5 py-0.5 rounded', matched ? 'bg-green-500/20 text-green-300' : 'bg-gray-500/20 text-gray-400')}>
                        {matched ? '命中同步分组' : '不在当前同步分组'}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {!globalBiliStatus.isLoggedIn && (
        <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
          <p className="text-sm text-yellow-300 mb-2">
            ⚠️ 未检测到全局B站登录
          </p>
          <p className="text-sm text-white/70 mb-3">
            关注列表同步需要先在系统设置中登录B站账号
          </p>
          <Link
            to="/settings"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors text-sm"
          >
            前往系统设置
          </Link>
        </div>
      )}

      {globalBiliStatus.isLoggedIn && (
        <div>
          <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg mb-4">
            <div className="flex items-center gap-2 text-green-400 text-sm">
              <div className="w-2 h-2 rounded-full bg-green-400" />
              <span>已使用全局B站账号：{globalBiliStatus.username} (UID: {globalBiliStatus.uid})</span>
            </div>
          </div>

          <div className="p-4 bg-white/5 rounded-lg border border-white/10 mb-4">
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <span className="text-white font-medium block">启用关注列表同步</span>
                <span className="text-gray-400 text-sm">自动同步所选分组的 UP 主更新</span>
              </div>
              <div className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.enableCookieSync}
                  onChange={(e) => setFormData({ ...formData, enableCookieSync: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600" />
              </div>
            </label>
          </div>

          <div className={clsx('transition-opacity', !formData.enableCookieSync && 'opacity-50 pointer-events-none')}>
            <h4 className="text-sm font-medium text-gray-300 mb-3">选择要同步的关注分组</h4>

            {biliGroupsLoading ? (
              <div className="flex items-center gap-2 text-gray-400">
                <Loader2 size={16} className="animate-spin" />
                正在获取分组...
              </div>
            ) : biliGroups.length === 0 ? (
              <div className="text-gray-500 text-sm italic">
                未找到关注分组，请先登录 Bilibili 账号。
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {biliGroups.map((group) => {
                  const groupName = typeof group === 'string' ? group : group.name;
                  return (
                    <label key={groupName} className="flex items-center gap-2 p-3 bg-black/20 border border-white/5 rounded-lg cursor-pointer hover:bg-white/5 transition-colors">
                      <input
                        type="checkbox"
                        checked={formData.cookieSyncGroupNames.includes(groupName)}
                        onChange={() => toggleSyncGroup(groupName)}
                        className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500"
                      />
                      <span className="text-gray-200 text-sm">{groupName}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </Tab.Panel>
  );
};

export default SyncTab;
