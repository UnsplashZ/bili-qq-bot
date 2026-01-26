import React, { useState, useEffect, useCallback } from 'react';
import api from '../utils/auth';
import { Tab } from '@headlessui/react';
import GlassCard from '../components/GlassCard';
import GlassModal from '../components/GlassModal';
import { useToast } from '../components/ToastProvider';
import { Save, Power, Settings, Cpu, RefreshCw, MessageSquare, Bell, Ban, Trash2, Plus } from 'lucide-react';
import { clsx } from 'clsx';

function Groups() {
  const [groups, setGroups] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { show } = useToast();
  const [selectedTabIndex, setSelectedTabIndex] = useState(0);

  // Form State
  const [formData, setFormData] = useState({
    linkCacheTimeout: 5,
    labelConfig: {
      video: true,
      dynamic: true,
      live: true,
      article: true,
      bangumi: true,
    },
    enableCookieSync: false,
    cookieSyncGroupNames: '',
    blacklistedQQs: [],
  });

  // Subscriptions State
  const [subscriptions, setSubscriptions] = useState([]);
  const [subsLoading, setSubsLoading] = useState(false);
  const [isSubModalOpen, setIsSubModalOpen] = useState(false);
  const [subForm, setSubForm] = useState({ type: 'video', value: '' });

  // Blacklist State
  const [blacklistInput, setBlacklistInput] = useState('');

  useEffect(() => {
    fetchGroups();
  }, []);

  const fetchGroups = async () => {
    try {
      setLoading(true);
      const res = await api.get('/api/groups');
      if (Array.isArray(res.data)) {
        setGroups(res.data);
      }
    } catch (error) {
      console.error('Failed to fetch groups', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedGroupId) {
      const group = groups.find(g => g.id === selectedGroupId);
      if (group) {
        const config = group.config || {};
        const labels = config.labelConfig || {};
        setFormData({
          linkCacheTimeout: config.linkCacheTimeout ?? 5,
          labelConfig: {
            video: labels.video ?? true,
            dynamic: labels.dynamic ?? true,
            live: labels.live ?? true,
            article: labels.article ?? true,
            bangumi: labels.bangumi ?? true,
          },
          enableCookieSync: config.enableCookieSync ?? false,
          cookieSyncGroupNames: Array.isArray(config.cookieSyncGroupNames)
            ? config.cookieSyncGroupNames.join(', ')
            : (config.cookieSyncGroupNames || ''),
          blacklistedQQs: Array.isArray(config.blacklistedQQs) ? config.blacklistedQQs : [],
        });

        // Reset sub state
        setSubscriptions([]);
        // If on subs tab, fetch immediately
        if (selectedTabIndex === 1) {
            fetchSubscriptions(selectedGroupId);
        }
      }
    }
  }, [selectedGroupId, groups]);

  // Fetch subscriptions when tab changes to index 1 (Subscriptions)
  useEffect(() => {
      if (selectedTabIndex === 1 && selectedGroupId) {
          fetchSubscriptions(selectedGroupId);
      }
  }, [selectedTabIndex, selectedGroupId, fetchSubscriptions]);

  const fetchSubscriptions = useCallback(async (groupId) => {
    if (!groupId) return;
    setSubsLoading(true);
    try {
      const res = await api.get(`/api/groups/${groupId}/subscriptions`);
      setSubscriptions(res.data || []);
    } catch (error) {
      console.error('Failed to fetch subscriptions', error);
      show('获取订阅列表失败', 'error');
    } finally {
      setSubsLoading(false);
    }
  }, [show]);

  const handleToggleGroup = async (e, group) => {
    e.stopPropagation();
    const newStatus = !group.isEnabled;
    // Optimistic update
    setGroups(prev => prev.map(g => g.id === group.id ? { ...g, isEnabled: newStatus } : g));

    try {
      await api.post(`/api/groups/${group.id}/toggle`);
    } catch (err) {
      console.error('Failed to toggle group', err);
      // Revert
      setGroups(prev => prev.map(g => g.id === group.id ? { ...g, isEnabled: !newStatus } : g));
    }
  };

  const handleSave = async () => {
    if (!selectedGroupId) return;
    setSaving(true);
    try {
      const payload = {
        ...formData,
        cookieSyncGroupNames: formData.cookieSyncGroupNames
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
      };

      await api.post(`/api/groups/${selectedGroupId}/config`, payload);

      // Update local state
      setGroups(prev => prev.map(g =>
        g.id === selectedGroupId
          ? { ...g, config: { ...g.config, ...payload } }
          : g
      ));

      show('配置保存成功', 'success');
    } catch (err) {
      console.error('Failed to save config', err);
      show('保存配置失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Subscription Handlers
  const handleAddSubscription = async () => {
      if (!subForm.value) {
          show('请输入订阅值', 'error');
          return;
      }
      try {
          await api.post(`/api/groups/${selectedGroupId}/subscriptions`, subForm);
          show('添加订阅成功', 'success');
          setIsSubModalOpen(false);
          setSubForm({ type: 'video', value: '' });
          fetchSubscriptions(selectedGroupId);
      } catch (err) {
          console.error(err);
          show('添加订阅失败', 'error');
      }
  };

  const handleDeleteSubscription = async (sub) => {
      // if (!window.confirm(`确定要删除订阅: ${sub.value}?`)) return; // Optional confirmation
      try {
          await api.delete(`/api/groups/${selectedGroupId}/subscriptions`, { data: sub });
          show('删除订阅成功', 'success');
          // Optimistic or refetch
          setSubscriptions(prev => prev.filter(s => !(s.type === sub.type && s.value === sub.value)));
      } catch (err) {
          console.error(err);
          show('删除订阅失败', 'error');
      }
  };

  // Blacklist Handlers
  const handleUpdateBlacklist = async (newBlacklist) => {
      try {
          // Optimistic update UI
          setFormData(prev => ({ ...prev, blacklistedQQs: newBlacklist }));

          // API Call (Merged into config)
          await api.post(`/api/groups/${selectedGroupId}/config`, { blacklistedQQs: newBlacklist });

          // Update global groups state
          setGroups(prev => prev.map(g =>
            g.id === selectedGroupId
              ? { ...g, config: { ...g.config, blacklistedQQs: newBlacklist } }
              : g
          ));

          show('黑名单已更新', 'success');
      } catch (err) {
          console.error(err);
          show('更新黑名单失败', 'error');
          // Revert handled by next fetch or manual fix
      }
  };

  const handleAddBlacklist = () => {
      if (!blacklistInput) return;
      if (formData.blacklistedQQs.includes(blacklistInput)) {
          show('该 QQ 已在黑名单中', 'error');
          return;
      }
      const newList = [...formData.blacklistedQQs, blacklistInput];
      handleUpdateBlacklist(newList);
      setBlacklistInput('');
  };

  const handleRemoveBlacklist = (qq) => {
      const newList = formData.blacklistedQQs.filter(q => q !== qq);
      handleUpdateBlacklist(newList);
  };

  const categories = [
    { name: '常规', icon: Settings },
    { name: '订阅', icon: Bell },
    { name: '黑名单', icon: Ban },
    { name: 'AI 设置', icon: Cpu },
    { name: '同步', icon: RefreshCw },
  ];

  const subTypes = [
      { value: 'video', label: '视频更新' },
      { value: 'live', label: '直播开播' },
      { value: 'bangumi', label: '番剧更新' },
      { value: 'dynamic', label: '动态更新' },
  ];

  return (
    <div className="h-[calc(100vh-8rem)] flex gap-6">
      {/* Left Column: Master List */}
      <GlassCard className="w-1/3 flex flex-col p-0 overflow-hidden">
        <div className="p-4 border-b border-white/10 bg-white/5">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <MessageSquare size={18} />
            群组 ({groups.length})
          </h2>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {loading ? (
             <div className="text-center p-4 text-gray-400">加载中...</div>
          ) : groups.length === 0 ? (
             <div className="text-center p-4 text-gray-400">未找到群组</div>
          ) : (
            groups.map(group => (
              <div
                key={group.id}
                onClick={() => setSelectedGroupId(group.id)}
                className={clsx(
                  'flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors',
                  selectedGroupId === group.id
                    ? 'bg-blue-500/20 border border-blue-500/30'
                    : 'hover:bg-white/5 border border-transparent'
                )}
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">{group.name || `Group ${group.id}`}</div>
                  <div className="text-xs text-gray-400">ID: {group.id}</div>
                </div>
                <button
                  onClick={(e) => handleToggleGroup(e, group)}
                  className={clsx(
                    'p-2 rounded-full transition-colors',
                    group.isEnabled ? 'text-green-400 hover:bg-green-400/10' : 'text-gray-500 hover:bg-gray-500/20'
                  )}
                  title={group.isEnabled ? '禁用群组' : '启用群组'}
                >
                  <Power size={18} />
                </button>
              </div>
            ))
          )}
        </div>
      </GlassCard>

      {/* Right Column: Detail View */}
      <div className="w-2/3 flex flex-col">
        {selectedGroupId ? (
          <GlassCard className="flex-1 flex flex-col p-0 overflow-hidden">
            <Tab.Group selectedIndex={selectedTabIndex} onChange={setSelectedTabIndex}>
              <div className="border-b border-white/10 bg-white/5 px-4 pt-4">
                 <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold">
                        {groups.find(g => g.id === selectedGroupId)?.name || '群组设置'}
                    </h2>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Save size={16} />
                        {saving ? '保存中...' : '保存更改'}
                    </button>
                 </div>
                 <Tab.List className="flex space-x-1">
                  {categories.map((category) => (
                    <Tab
                      key={category.name}
                      className={({ selected }) =>
                        clsx(
                          'w-full py-2.5 text-sm font-medium leading-5 rounded-t-lg transition-all focus:outline-none',
                          selected
                            ? 'bg-white/10 text-blue-400 border-b-2 border-blue-400'
                            : 'text-gray-400 hover:bg-white/5 hover:text-gray-200 border-b-2 border-transparent'
                        )
                      }
                    >
                      <div className="flex items-center justify-center gap-2">
                        <category.icon size={16} />
                        {category.name}
                      </div>
                    </Tab>
                  ))}
                </Tab.List>
              </div>

              <Tab.Panels className="flex-1 p-6 overflow-y-auto">
                {/* General Tab */}
                <Tab.Panel className="space-y-6 focus:outline-none">
                    <div className="space-y-4">
                        <label className="block">
                            <span className="text-gray-300 text-sm font-medium">链接缓存超时 (秒)</span>
                            <input
                                type="number"
                                value={formData.linkCacheTimeout}
                                onChange={(e) => setFormData({...formData, linkCacheTimeout: parseInt(e.target.value) || 0})}
                                className="mt-1 block w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
                            />
                        </label>

                        <div>
                            <span className="text-gray-300 text-sm font-medium mb-2 block">内容过滤 (标签配置)</span>
                            <div className="grid grid-cols-2 gap-3">
                                {Object.keys(formData.labelConfig).map(key => (
                                    <label key={key} className="flex items-center gap-2 p-3 bg-white/5 rounded-lg cursor-pointer hover:bg-white/10 transition-colors">
                                        <input
                                            type="checkbox"
                                            checked={formData.labelConfig[key]}
                                            onChange={(e) => setFormData({
                                                ...formData,
                                                labelConfig: { ...formData.labelConfig, [key]: e.target.checked }
                                            })}
                                            className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-900"
                                        />
                                        <span className="capitalize">{key === 'video' ? '视频' : key === 'live' ? '直播' : key === 'dynamic' ? '动态' : key === 'article' ? '文章' : key === 'bangumi' ? '番剧' : key}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    </div>
                </Tab.Panel>

                {/* Subscriptions Tab */}
                <Tab.Panel className="focus:outline-none h-full flex flex-col">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-lg font-medium text-white">订阅列表</h3>
                        <button
                            onClick={() => setIsSubModalOpen(true)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm transition-colors"
                        >
                            <Plus size={16} />
                            添加订阅
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto bg-black/20 rounded-lg border border-white/5">
                        {subsLoading ? (
                            <div className="p-4 text-center text-gray-400">加载订阅中...</div>
                        ) : subscriptions.length === 0 ? (
                            <div className="p-8 text-center text-gray-400 flex flex-col items-center">
                                <Bell size={32} className="mb-2 opacity-30" />
                                暂无订阅
                            </div>
                        ) : (
                            <table className="w-full text-left text-sm">
                                <thead className="bg-white/5 text-gray-400 font-medium">
                                    <tr>
                                        <th className="p-3">类型</th>
                                        <th className="p-3">值 / ID</th>
                                        <th className="p-3 text-right">操作</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {subscriptions.map((sub, idx) => (
                                        <tr key={idx} className="hover:bg-white/5">
                                            <td className="p-3 text-blue-400">
                                                {subTypes.find(t => t.value === sub.type)?.label || sub.type}
                                            </td>
                                            <td className="p-3 text-white font-mono">{sub.value}</td>
                                            <td className="p-3 text-right">
                                                <button
                                                    onClick={() => handleDeleteSubscription(sub)}
                                                    className="text-red-400 hover:text-red-300 p-1.5 hover:bg-red-500/10 rounded transition-colors"
                                                    title="删除"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </Tab.Panel>

                {/* Blacklist Tab */}
                <Tab.Panel className="focus:outline-none">
                    <div className="space-y-4">
                        <div className="flex gap-2">
                            <input
                                type="text"
                                placeholder="输入 QQ 号码..."
                                value={blacklistInput}
                                onChange={(e) => setBlacklistInput(e.target.value)}
                                className="flex-1 bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
                                onKeyDown={(e) => e.key === 'Enter' && handleAddBlacklist()}
                            />
                            <button
                                onClick={handleAddBlacklist}
                                className="px-4 py-2 bg-red-600/80 hover:bg-red-500 rounded-lg text-white font-medium transition-colors flex items-center gap-2"
                            >
                                <Plus size={16} />
                                添加黑名单
                            </button>
                        </div>

                        <div className="bg-black/20 rounded-lg border border-white/5 overflow-hidden">
                            <div className="p-3 bg-white/5 text-sm font-medium text-gray-400">已拉黑 QQ 用户 ({formData.blacklistedQQs.length})</div>
                            {formData.blacklistedQQs.length === 0 ? (
                                <div className="p-8 text-center text-gray-400">无黑名单记录</div>
                            ) : (
                                <ul className="divide-y divide-white/5">
                                    {formData.blacklistedQQs.map((qq) => (
                                        <li key={qq} className="flex justify-between items-center p-3 hover:bg-white/5 transition-colors">
                                            <span className="font-mono text-white">{qq}</span>
                                            <button
                                                onClick={() => handleRemoveBlacklist(qq)}
                                                className="text-gray-400 hover:text-red-400 text-sm flex items-center gap-1 px-2 py-1 hover:bg-white/5 rounded transition-colors"
                                            >
                                                移除
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>
                </Tab.Panel>

                {/* AI Settings Tab */}
                <Tab.Panel className="focus:outline-none">
                    <div className="flex flex-col items-center justify-center h-full text-center text-gray-400 space-y-4 py-12">
                        <Cpu size={48} className="opacity-50" />
                        <div>
                            <h3 className="text-lg font-medium text-white">AI 配置</h3>
                            <p className="max-w-md mx-auto mt-2">
                                全局 AI 设置当前应用于所有群组。每群组覆盖设置即将推出。
                            </p>
                        </div>
                    </div>
                </Tab.Panel>

                {/* Sync Tab */}
                <Tab.Panel className="space-y-6 focus:outline-none">
                     <div className="p-4 bg-white/5 rounded-lg border border-white/10">
                         <label className="flex items-center justify-between cursor-pointer">
                             <div>
                                 <span className="text-white font-medium block">启用 Cookie 同步</span>
                                 <span className="text-gray-400 text-sm">与其他群组同步 Cookie</span>
                             </div>
                             <div className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={formData.enableCookieSync}
                                    onChange={(e) => setFormData({...formData, enableCookieSync: e.target.checked})}
                                    className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                             </div>
                         </label>
                     </div>

                     <div className={clsx("transition-opacity", !formData.enableCookieSync && "opacity-50 pointer-events-none")}>
                        <label className="block">
                            <span className="text-gray-300 text-sm font-medium">同步群组 (逗号分隔)</span>
                            <input
                                type="text"
                                placeholder="群组名称 1, 群组名称 2"
                                value={formData.cookieSyncGroupNames}
                                onChange={(e) => setFormData({...formData, cookieSyncGroupNames: e.target.value})}
                                className="mt-1 block w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
                            />
                            <p className="mt-2 text-xs text-gray-500">输入要同步 Cookie 的群组的确切名称。</p>
                        </label>
                     </div>
                </Tab.Panel>
              </Tab.Panels>
            </Tab.Group>
          </GlassCard>
        ) : (
          <GlassCard className="flex-1 flex flex-col items-center justify-center text-center text-gray-400">
             <MessageSquare size={48} className="mb-4 opacity-50" />
             <h3 className="text-xl font-medium text-white mb-2">选择一个群组</h3>
             <p>从列表中选择一个群组以查看和编辑其配置。</p>
          </GlassCard>
        )}
      </div>

      {/* Add Subscription Modal */}
      <GlassModal
        isOpen={isSubModalOpen}
        onClose={() => setIsSubModalOpen(false)}
        title="添加订阅"
        footer={
            <>
                <button onClick={() => setIsSubModalOpen(false)} className="px-4 py-2 text-gray-300 hover:text-white transition-colors">
                    取消
                </button>
                <button onClick={handleAddSubscription} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors">
                    添加
                </button>
            </>
        }
      >
        <div className="space-y-4">
            <div>
                <label className="block text-sm text-gray-400 mb-1">类型</label>
                <select
                    value={subForm.type}
                    onChange={(e) => setSubForm({...subForm, type: e.target.value})}
                    className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                >
                    {subTypes.map(t => (
                        <option key={t.value} value={t.value} className="bg-gray-800 text-white">
                            {t.label}
                        </option>
                    ))}
                </select>
            </div>
            <div>
                <label className="block text-sm text-gray-400 mb-1">值 / ID (UID)</label>
                <input
                    type="text"
                    value={subForm.value}
                    onChange={(e) => setSubForm({...subForm, value: e.target.value})}
                    placeholder="请输入 UID 或房间号"
                    className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                />
            </div>
        </div>
      </GlassModal>
    </div>
  );
}

export default Groups;
