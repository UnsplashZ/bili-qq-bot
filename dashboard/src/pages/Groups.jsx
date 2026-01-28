import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../utils/auth';
import { Tab } from '@headlessui/react';
import GlassCard from '../components/GlassCard';
import GlassModal from '../components/GlassModal';
import { useToast } from '../hooks/useToast';
import { Save, Power, Settings, Cpu, RefreshCw, MessageSquare, Bell, Ban, Trash2, Plus, QrCode, Loader2, LogOut, Shield } from 'lucide-react';
import { clsx } from 'clsx';
import QRCode from 'qrcode';

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
    cookieSyncGroupNames: [], // Array of strings
    blacklistedQQs: [],
    admins: [], // 群组管理员列表
    // AI配置覆盖（null表示使用全局默认）
    aiProbability: null,
    aiContextLimit: null
  });

  // Subscriptions State
  const [subscriptions, setSubscriptions] = useState([]);
  const [subsLoading, setSubsLoading] = useState(false);
  const [isSubModalOpen, setIsSubModalOpen] = useState(false);
  const [subForm, setSubForm] = useState({ type: 'user', value: '' });

  // Blacklist State
  const [blacklistInput, setBlacklistInput] = useState('');

  // Admin State
  const [adminInput, setAdminInput] = useState('');

  // Login State
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [loginQrCode, setLoginQrCode] = useState('');
  const [loginKey, setLoginKey] = useState('');
  const [loginStatus, setLoginStatus] = useState('idle'); // idle, waiting, success, expired
  const checkLoginTimerRef = useRef(null);

  // Bilibili User Info State
  const [biliUserInfo, setBiliUserInfo] = useState(null); // { mid, name, face }

  // Bilibili Groups State (Follow Groups)
  const [biliGroups, setBiliGroups] = useState([]);
  const [biliGroupsLoading, setBiliGroupsLoading] = useState(false);

  // 全局配置（包括AI配置和系统配置）
  const [globalConfig, setGlobalConfig] = useState({
    aiProbability: 0.1,
    aiContextLimit: 10,
    adminQQ: undefined
  });
  const [globalConfigLoading, setGlobalConfigLoading] = useState(true);

  useEffect(() => {
    fetchGroups();
  }, []);

  // 在 useEffect 中加载全局配置
  useEffect(() => {
    const fetchGlobalConfig = async () => {
      setGlobalConfigLoading(true);
      try {
        const res = await api.get('/api/config');
        if (res.data) {
          setGlobalConfig({
            aiProbability: res.data.aiProbability || 0.1,
            aiContextLimit: res.data.aiContextLimit || 10,
            adminQQ: res.data.adminQQ
          });
        }
      } catch (err) {
        console.error('Failed to fetch global config:', err);
      } finally {
        setGlobalConfigLoading(false);
      }
    };
    fetchGlobalConfig();
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

  const fetchBiliGroups = useCallback(async (groupId) => {
      if (!groupId) return;
      setBiliGroupsLoading(true);
      try {
          const res = await api.get(`/api/groups/${groupId}/bili-groups`);
          // API returns array of objects usually, or strings?
          // Python backend usually returns list of dicts or list of strings?
          // Assumption: returns array of { name: "TagName", id: 123 } or just strings.
          // Let's assume strings based on "cookieSyncGroupNames (Array of strings)" requirement.
          // Or if it returns objects, we extract names.
          // Let's check api.js: res.json(result.data).
          // If result.data is [ { tagid: 0, name: 'Main' } ], we need to handle it.
          // Plan says "Render checkboxes... Value binding: cookieSyncGroupNames (Array of strings)".
          // So we need names.
          // Handle both direct array (if changed later) and wrapped response
          const responseData = res.data;
          const listData = Array.isArray(responseData) ? responseData : (responseData?.data || []);
          const safeList = Array.isArray(listData) ? listData : [];
          setBiliGroups(safeList);
      } catch (error) {
          console.error("Failed to fetch Bili groups", error);
      } finally {
          setBiliGroupsLoading(false);
      }
  }, []);

  // Check existing Bilibili login
  const checkExistingLogin = useCallback(async (groupId) => {
      try {
          const res = await api.get(`/api/bili/my-info?groupId=${groupId}`);
          if (res.data && res.data.status === 'success' && res.data.data) {
              setBiliUserInfo({
                  mid: res.data.data.mid,
                  name: res.data.data.name,
                  face: res.data.data.face
              });
          } else {
              // Not logged in or cookie expired
              setBiliUserInfo(null);
          }
      } catch (err) {
          // API call failed, treat as not logged in
          setBiliUserInfo(null);
      }
  }, []); // No dependencies needed since it doesn't use any props/state

  useEffect(() => {
    if (selectedGroupId) {
      // 切换群组时重置B站登录状态
      setBiliUserInfo(null);

      const group = groups.find(g => g.id === selectedGroupId);
      if (group) {
        const config = group.config || {};
        const labels = config.labelConfig || {};

        let syncGroups = [];
        if (Array.isArray(config.cookieSyncGroupNames)) {
            syncGroups = config.cookieSyncGroupNames;
        } else if (typeof config.cookieSyncGroupNames === 'string') {
            syncGroups = config.cookieSyncGroupNames.split(',').map(s => s.trim()).filter(Boolean);
        }

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
          cookieSyncGroupNames: syncGroups,
          blacklistedQQs: Array.isArray(config.blacklistedQQs) ? config.blacklistedQQs : [],
          admins: Array.isArray(config.admins) ? config.admins : [],
          // 加载AI配置（可能为 null）- 使用 ?? null 保留null值
          aiProbability: config.aiProbability ?? null,
          aiContextLimit: config.aiContextLimit ?? null
        });

        // Reset sub state
        setSubscriptions([]);
        // If on subs tab, fetch immediately
        if (selectedTabIndex === 1) {
            fetchSubscriptions(selectedGroupId);
        }
        // If on sync tab, fetch bili groups (index changed from 4 to 5 after adding Admin tab)
        if (selectedTabIndex === 5) {
            fetchBiliGroups(selectedGroupId);
            // Check Bilibili login status
            checkExistingLogin(selectedGroupId);
        }
      }
    }
  }, [selectedGroupId, groups, selectedTabIndex, fetchSubscriptions, fetchBiliGroups, checkExistingLogin]);

  // Fetch subscriptions when tab changes to index 1 (Subscriptions)
  useEffect(() => {
      if (selectedTabIndex === 1 && selectedGroupId) {
          fetchSubscriptions(selectedGroupId);
      }
  }, [selectedTabIndex, selectedGroupId, fetchSubscriptions]);

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

  const handleDeleteConfig = async (e, group) => {
    e.stopPropagation();

    if (!window.confirm(`确认删除群组 ${group.name} (${group.id}) 的所有配置和订阅数据？\n\n此操作不可恢复。`)) {
      return;
    }

    try {
      await api.delete(`/api/groups/${group.id}`);
      show('配置已删除', 'success');

      // Remove from groups list
      setGroups(prev => prev.filter(g => g.id !== group.id));

      // Clear selection if deleted group was selected
      if (selectedGroupId === group.id) {
        setSelectedGroupId(null);
      }
    } catch (err) {
      console.error('Failed to delete group config', err);
      show(err.response?.data?.error || '删除失败', 'error');
    }
  };

  const handleSave = async () => {
    if (!selectedGroupId) return;
    setSaving(true);
    try {
      const payload = {
        ...formData,
        // Ensure cookieSyncGroupNames is saved as array (it already is in state)
        cookieSyncGroupNames: formData.cookieSyncGroupNames
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
          setSubForm({ type: 'user', value: '' });
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

  // Admin Handlers
  const handleAddAdmin = () => {
      if (!adminInput) return;

      // 验证 QQ 号格式（只能是数字）
      if (!/^\d+$/.test(adminInput)) {
          show('请输入有效的 QQ 号（纯数字）', 'error');
          return;
      }

      // 验证 QQ 号长度（通常是 5-11 位）
      if (adminInput.length < 5 || adminInput.length > 11) {
          show('QQ 号长度不正确（应为 5-11 位）', 'error');
          return;
      }

      if (formData.admins?.includes(adminInput)) {
          show('该 QQ 已是管理员', 'error');
          return;
      }

      const newAdmins = [...(formData.admins || []), adminInput];
      handleUpdateAdmins(newAdmins);
      setAdminInput('');
      show('管理员已添加', 'success');
  };

  const handleRemoveAdmin = (qq) => {
      const newAdmins = (formData.admins || []).filter(a => a !== qq);
      handleUpdateAdmins(newAdmins);
      show('管理员已移除', 'success');
  };

  const handleUpdateAdmins = async (newAdmins) => {
      try {
          // Optimistic update UI
          setFormData(prev => ({ ...prev, admins: newAdmins }));

          // API Call
          await api.post(`/api/groups/${selectedGroupId}/config`, { admins: newAdmins });

          // Update global groups state
          setGroups(prev => prev.map(g =>
              g.id === selectedGroupId
                  ? { ...g, config: { ...g.config, admins: newAdmins } }
                  : g
          ));
      } catch (err) {
          console.error(err);
          show('更新管理员失败', 'error');
          // Revert on error
          const group = groups.find(g => g.id === selectedGroupId);
          if (group && group.config) {
              setFormData(prev => ({ ...prev, admins: group.config.admins || [] }));
          }
      }
  };

  const categories = [
    { name: '常规', icon: Settings },
    { name: '订阅', icon: Bell },
    { name: '黑名单', icon: Ban },
    { name: '管理员', icon: Shield },
    { name: 'AI 设置', icon: Cpu },
    { name: '关注列表同步', icon: RefreshCw },
  ];

  const subTypes = [
      { value: 'user', label: 'UP主' },
      { value: 'bangumi', label: '番剧' },
  ];

  // Login Handlers
  const startLogin = async () => {
      try {
          setLoginStatus('waiting');
          setIsLoginModalOpen(true);
          const res = await api.get('/api/bili/login-url');

          // 检查返回的状态
          if (res.data && res.data.status === 'error') {
              // 后端返回了错误信息
              show(`获取登录二维码失败: ${res.data.message || '未知错误'}`, 'error');
              setIsLoginModalOpen(false);
              return;
          }

          if (res.data && res.data.data && res.data.data.url) {
              setLoginKey(res.data.data.key); // Save key for checking
              // Generate QR Code
              const qrDataUrl = await QRCode.toDataURL(res.data.data.url);
              setLoginQrCode(qrDataUrl);

              // Start polling
              if (checkLoginTimerRef.current) clearInterval(checkLoginTimerRef.current);
              checkLoginTimerRef.current = setInterval(() => checkLoginStatus(res.data.data.key), 3000);
          } else {
              show('获取登录二维码失败: 响应格式错误', 'error');
              setIsLoginModalOpen(false);
          }
      } catch (err) {
          console.error('Login error:', err);
          const errorMsg = err.response?.data?.error || err.message || '未知错误';
          show(`启动登录失败: ${errorMsg}`, 'error');
          setIsLoginModalOpen(false);
      }
  };

  const checkLoginStatus = async (key) => {
      try {
          const res = await api.post('/api/bili/check-login', { key, groupId: selectedGroupId });
          // Check status in response
          // Python script usually returns: { status: 'success'/'waiting'/'expired', ... }
          // Or data: { status: ... } depending on biliApi wrapper

          const status = res.data.data ? res.data.data.status : res.data.status;

          if (status === 'success') {
              clearInterval(checkLoginTimerRef.current);
              setLoginStatus('success');
              show('登录成功！', 'success');

              // Fetch user info
              try {
                  const userRes = await api.get(`/api/bili/my-info?groupId=${selectedGroupId}`);
                  if (userRes.data && userRes.data.status === 'success' && userRes.data.data) {
                      setBiliUserInfo({
                          mid: userRes.data.data.mid,
                          name: userRes.data.data.name,
                          face: userRes.data.data.face
                      });
                  }
              } catch (err) {
                  console.error('Failed to fetch user info:', err);
              }

              // Maybe reload bili groups?
              setTimeout(() => {
                  setIsLoginModalOpen(false);
                  fetchBiliGroups(selectedGroupId);
              }, 1500);
          } else if (status === 'expired') { // Or whatever code Bili returns
               // handle expiry
          }
      } catch (err) {
          console.error('Check login error', err);
      }
  };

  const closeLoginModal = () => {
      if (checkLoginTimerRef.current) clearInterval(checkLoginTimerRef.current);
      setIsLoginModalOpen(false);
      setLoginStatus('idle');
  };

  const handleLogout = async () => {
      if (!window.confirm('确定要登出吗？这将清除该群组的B站登录信息。')) {
          return;
      }

      try {
          await api.post(`/api/bili/logout`, { groupId: selectedGroupId });
          setBiliUserInfo(null);
          setBiliGroups([]);
          setFormData({
              ...formData,
              enableCookieSync: false,
              cookieSyncGroupNames: []
          });
          show('已登出', 'success');
      } catch (err) {
          console.error('Logout error:', err);
          const errorMsg = err.response?.data?.error || err.message || '未知错误';
          show(`登出失败: ${errorMsg}`, 'error');
      }
  };

  // Cleanup timer on component unmount
  useEffect(() => {
      return () => {
          // 组件卸载时清理定时器
          if (checkLoginTimerRef.current) {
              clearInterval(checkLoginTimerRef.current);
          }
      };
  }, []);

  // Sync Group Checkbox Handler
  const toggleSyncGroup = (groupName) => {
      setFormData(prev => {
          const current = prev.cookieSyncGroupNames;
          if (current.includes(groupName)) {
              return { ...prev, cookieSyncGroupNames: current.filter(n => n !== groupName) };
          } else {
              return { ...prev, cookieSyncGroupNames: [...current, groupName] };
          }
      });
  };

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
                  'flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all',
                  'hover:bg-white/5',
                  selectedGroupId === group.id
                    ? 'bg-blue-500/20 ring-2 ring-blue-500'
                    : 'bg-white/5',
                  !group.isEnabled && 'opacity-50',  // 禁用时半透明
                  !group.isInGroup && 'opacity-60 grayscale'  // 已退群时灰色半透明
                )}
              >
                {group.isInGroup ? (
                  <button
                    type="button"
                    onClick={(e) => handleToggleGroup(e, group)}
                    className="p-1 rounded hover:bg-white/10 transition-colors"
                    title={group.isEnabled ? '禁用群组' : '启用群组'}
                  >
                    <Power
                      className={clsx(
                        'w-4 h-4',
                        group.isEnabled ? 'text-green-400' : 'text-gray-400'
                      )}
                    />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => handleDeleteConfig(e, group)}
                    className="p-1 rounded hover:bg-red-500/20 transition-colors"
                    title="删除配置"
                  >
                    <Trash2 className="w-4 h-4 text-red-400" />
                  </button>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="font-medium truncate text-white">{group.name || `Group ${group.id}`}</div>
                    {!group.isInGroup && (
                      <span className="text-xs text-red-400 px-2 py-0.5 bg-red-500/20 rounded flex-shrink-0">
                        已退群
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-white/50">ID: {group.id}</div>
                </div>
                {group.isInGroup && !group.isEnabled && (
                  <span className="text-xs text-white/40 px-2 py-1 bg-white/5 rounded">
                    已禁用
                  </span>
                )}
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
                            <span className="text-gray-300 text-sm font-medium mb-2 block">预览卡片标签开关</span>
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
                                        <th className="p-3">用户</th>
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
                                            <td className="p-3 text-white">
                                                {sub.name ? (
                                                    <div>
                                                        <div className="font-medium">{sub.name}</div>
                                                        <div className="text-xs text-gray-400 font-mono">{sub.value}</div>
                                                    </div>
                                                ) : (
                                                    <div className="font-mono">{sub.value}</div>
                                                )}
                                            </td>
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

                {/* Admin Tab */}
                <Tab.Panel className="focus:outline-none">
                  <div className="space-y-6">
                    <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
                      <p className="text-sm text-white/70">
                        群组管理员可以使用所有机器人指令，不受其他限制。
                        {globalConfig.adminQQ && (
                          <span className="block mt-2 text-yellow-300">
                            根管理员: {globalConfig.adminQQ}
                          </span>
                        )}
                      </p>
                    </div>

                    {/* 添加管理员 */}
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="输入 QQ 号..."
                        value={adminInput}
                        onChange={(e) => setAdminInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddAdmin()}
                        className="flex-1 bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-yellow-500 focus:outline-none"
                      />
                      <button
                        onClick={handleAddAdmin}
                        disabled={!adminInput}
                        className="px-4 py-2 bg-yellow-600/20 text-yellow-300 border border-yellow-500/30 hover:bg-yellow-600/30 rounded-lg transition-colors disabled:opacity-50"
                      >
                        添加
                      </button>
                    </div>

                    {/* 管理员列表 */}
                    <div className="space-y-2">
                      {formData.admins && formData.admins.length > 0 ? (
                        formData.admins.map((qq) => (
                          <div key={qq} className="flex items-center justify-between bg-white/5 border border-white/10 rounded-lg p-3">
                            <div className="flex items-center gap-3">
                              <Shield className="w-5 h-5 text-yellow-400" />
                              <span className="font-mono text-white">{qq}</span>
                            </div>
                            <button
                              onClick={() => handleRemoveAdmin(qq)}
                              className="text-gray-400 hover:text-red-400 transition-colors"
                            >
                              <Trash2 size={18} />
                            </button>
                          </div>
                        ))
                      ) : (
                        <div className="text-center text-gray-500 py-4">
                          暂无管理员
                        </div>
                      )}
                    </div>
                  </div>
                </Tab.Panel>

                {/* AI Settings Tab */}
                <Tab.Panel className="focus:outline-none">
                    {/* AI 响应配置 */}
                    <div className="space-y-4">
                      <div className="flex items-center gap-2">
                        <Cpu className="w-5 h-5 text-purple-400" />
                        <h3 className="text-lg font-semibold text-white">AI 响应配置</h3>
                      </div>

                      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                        <p className="text-sm text-white/70">
                          配置此群组专属的AI响应行为。留空则使用全局默认值。
                        </p>
                      </div>

                      {/* 响应概率 */}
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
                                if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
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

                      {/* 上下文限制 */}
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
                              if (!isNaN(parsed) && parsed >= 1 && parsed <= 100) {
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
                    </div>
                </Tab.Panel>

                {/* Sync Tab */}
                <Tab.Panel className="space-y-8 focus:outline-none">
                     {/* Bilibili Login Section */}
                     <div className="space-y-4">
                         <h3 className="text-lg font-medium text-white mb-2 flex items-center gap-2">
                             <QrCode size={20} className="text-pink-400" />
                             Bilibili 账号
                         </h3>
                         <p className="text-gray-400 text-sm mb-4">
                             登录 Bilibili 账号以获取关注列表和更高清的视频解析。Cookie 将仅用于此群组（或同步）。
                         </p>

                         {biliUserInfo ? (
                             /* Logged in state */
                             <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
                                 <div className="flex items-center gap-3">
                                     {/* <img
                                         src={biliUserInfo.face}
                                         alt={biliUserInfo.name}
                                         className="w-12 h-12 rounded-full border-2 border-green-400"
                                     /> */}
                                     <div className="flex-1">
                                         <div className="flex items-center gap-2">
                                             <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                                             <span className="text-green-400 text-sm font-medium">已登录</span>
                                         </div>
                                         <div className="text-white font-medium mt-1">{biliUserInfo.name}</div>
                                         <div className="text-white/50 text-xs">UID: {biliUserInfo.mid}</div>
                                     </div>
                                     <button
                                         onClick={handleLogout}
                                         className="px-3 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition-colors flex items-center gap-2"
                                     >
                                         <LogOut className="w-4 h-4" />
                                         <span className="text-sm">登出</span>
                                     </button>
                                 </div>
                             </div>
                         ) : (
                             /* Not logged in state */
                             <button
                                 onClick={startLogin}
                                 className="w-full px-4 py-3 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded-lg transition-colors flex items-center justify-center gap-2"
                             >
                                 <QrCode className="w-5 h-5" />
                                 <span>扫码登录 Bilibili</span>
                             </button>
                         )}
                     </div>

                     {/* Sync Config Section - Only show when logged in */}
                     {biliUserInfo && (
                         <div>
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
                                            onChange={(e) => setFormData({...formData, enableCookieSync: e.target.checked})}
                                            className="sr-only peer"
                                        />
                                        <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                                     </div>
                                 </label>
                             </div>

                             <div className={clsx("transition-opacity", !formData.enableCookieSync && "opacity-50 pointer-events-none")}>
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
                                            // group is likely { tagid, name, count, tip } or just string
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

      {/* Login Modal */}
      <GlassModal
        isOpen={isLoginModalOpen}
        onClose={closeLoginModal}
        title="扫码登录 Bilibili"
        footer={
            <button onClick={closeLoginModal} className="px-4 py-2 text-gray-300 hover:text-white transition-colors">
                关闭
            </button>
        }
      >
        <div className="flex flex-col items-center justify-center p-4">
            {loginStatus === 'success' ? (
                <div className="text-green-400 font-medium text-lg flex flex-col items-center">
                    <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mb-4 text-3xl">
                        ✓
                    </div>
                    登录成功！
                </div>
            ) : (
                <>
                    <div className="bg-white p-2 rounded-lg mb-4">
                        {loginQrCode ? (
                            <img src={loginQrCode} alt="Login QR" className="w-48 h-48" />
                        ) : (
                            <div className="w-48 h-48 flex items-center justify-center text-gray-400">
                                <Loader2 size={32} className="animate-spin" />
                            </div>
                        )}
                    </div>
                    <p className="text-gray-300 text-center mb-2">
                        请使用 Bilibili 手机客户端扫码登录
                    </p>
                    <p className="text-sm text-gray-500">
                        {loginStatus === 'waiting' ? '等待扫码...' : '已过期，请重试'}
                    </p>
                </>
            )}
        </div>
      </GlassModal>

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
                    placeholder={subForm.type === 'user' ? '请输入用户UID' : '请输入SSID'}
                    className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                />
            </div>
        </div>
      </GlassModal>
    </div>
  );
}

export default Groups;
