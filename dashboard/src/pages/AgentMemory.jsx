import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Brain, MessageSquareText, RefreshCw, Search, Trash2, UserRound } from 'lucide-react';
import GlassCard from '../components/GlassCard';
import { Button } from '../components/ui';
import api from '../utils/auth';
import { useToast } from '../hooks/useToast';

function formatTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

function compactList(value) {
  return Array.isArray(value) && value.length > 0 ? value.join(', ') : '-';
}

function compactSignals(signals) {
  if (!signals || typeof signals !== 'object') return '-';
  return Object.entries(signals)
    .filter(([, value]) => Boolean(value))
    .map(([key]) => key)
    .join(', ') || '-';
}

function statusTextClass(scope) {
  if (scope === 'user') return 'text-blue-200';
  if (scope === 'group') return 'text-emerald-200';
  if (scope === 'topic') return 'text-purple-200';
  if (scope === 'positive') return 'text-emerald-200';
  if (scope === 'negative') return 'text-rose-200';
  return 'text-slate-200';
}

const TABS = [
  { key: 'memories', label: '长期记忆', icon: Brain },
  { key: 'profiles', label: '人物画像', icon: UserRound },
  { key: 'expressions', label: '表达习惯', icon: MessageSquareText },
  { key: 'effects', label: '回复效果', icon: Activity },
];

const AgentMemory = () => {
  const { show } = useToast();
  const [activeTab, setActiveTab] = useState('memories');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [groupId, setGroupId] = useState('');
  const [userId, setUserId] = useState('');

  const activeTabConfig = useMemo(() => TABS.find((tab) => tab.key === activeTab) || TABS[0], [activeTab]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (groupId.trim()) params.set('groupId', groupId.trim());
      if (userId.trim() && activeTab !== 'expressions' && activeTab !== 'effects') {
        params.set('userId', userId.trim());
      }
      params.set('limit', '100');
      const endpoint = {
        memories: '/api/agent/memories',
        profiles: '/api/agent/profiles',
        expressions: '/api/agent/expressions',
        effects: '/api/agent/reply-effects',
      }[activeTab];
      const response = await api.get(`${endpoint}?${params.toString()}`);
      setItems(response.data[activeTab] || []);
    } catch (error) {
      console.error('Failed to load agent memory data:', error);
      show(`加载 ${activeTabConfig.label} 失败`, 'error');
    } finally {
      setLoading(false);
    }
  }, [activeTab, activeTabConfig.label, groupId, userId, show]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const deleteMemory = async (memoryId) => {
    if (!window.confirm(`确认删除记忆 ${memoryId}？`)) return;
    try {
      await api.delete(`/api/agent/memories/${encodeURIComponent(memoryId)}`);
      setItems((prev) => prev.filter((memory) => memory.id !== memoryId));
      show('记忆已删除', 'success');
    } catch (error) {
      console.error('Failed to delete memory:', error);
      show('删除记忆失败', 'error');
    }
  };

  const clearFiltered = async () => {
    const nextGroupId = groupId.trim();
    const nextUserId = userId.trim();
    if (!nextGroupId && !nextUserId) {
      show('请输入群号或用户 QQ 后再清理', 'error');
      return;
    }
    if (!window.confirm('确认清理当前筛选范围内的 Agent 记忆？')) return;
    try {
      const response = await api.post('/api/agent/memories/clear', {
        groupId: nextGroupId,
        userId: nextUserId,
      });
      show(`已清理 ${response.data.removed || 0} 条记忆`, 'success');
      loadItems();
    } catch (error) {
      console.error('Failed to clear memories:', error);
      show('清理记忆失败', 'error');
    }
  };

  const renderMemory = (memory) => (
    <GlassCard key={memory.id}>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-xs font-medium ${statusTextClass(memory.scope)}`}>
              {memory.scope}/{memory.type}
            </span>
            <span className="text-xs text-gray-400 font-mono">{memory.id}</span>
          </div>
          <div className="text-lg text-white break-words">{memory.content}</div>
          <div className="grid gap-2 text-sm text-gray-400 md:grid-cols-2">
            <div>群号：{memory.groupId || '-'}</div>
            <div>用户：{memory.userId || '-'}</div>
            <div>置信度：{memory.confidence ?? '-'}</div>
            <div>重要性：{memory.importance ?? '-'}</div>
            <div>访问次数：{memory.accessCount || 0}</div>
            <div>过期时间：{formatTime(memory.expiresAt)}</div>
            <div>更新时间：{formatTime(memory.updatedAt)}</div>
            <div>来源：{compactList(memory.sourceMessageIds)}</div>
          </div>
          {Array.isArray(memory.supersedes) && memory.supersedes.length > 0 && (
            <div className="text-xs text-amber-300">
              已覆盖旧记忆：{memory.supersedes.join(', ')}
            </div>
          )}
        </div>
        <button
          onClick={() => deleteMemory(memory.id)}
          className="shrink-0 px-3 py-2 rounded-lg bg-rose-500/20 text-rose-100 hover:bg-rose-500/30 flex items-center justify-center gap-2"
        >
          <Trash2 size={16} />
          删除
        </button>
      </div>
    </GlassCard>
  );

  const renderProfile = (profile) => (
    <GlassCard key={profile.id}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-xs font-medium ${statusTextClass('user')}`}>profile</span>
          <span className="text-xs text-gray-400 font-mono">{profile.id}</span>
        </div>
        <div className="grid gap-2 text-sm text-gray-400 md:grid-cols-2">
          <div>群号：{profile.groupId || '-'}</div>
          <div>用户：{profile.userId || '-'}</div>
          <div>昵称：{compactList(profile.displayNames)}</div>
          <div>置信度：{profile.confidence ?? '-'}</div>
          <div>更新时间：{formatTime(profile.updatedAt)}</div>
          <div>来源记忆：{compactList(profile.sourceMemoryIds)}</div>
        </div>
        <div className="grid gap-3 text-sm md:grid-cols-2">
          <div className="text-blue-100/90">偏好：{compactList(profile.preferences)}</div>
          <div className="text-purple-100/90">表达风格：{compactList(profile.communicationStyle)}</div>
          <div className="text-amber-100/90">边界：{compactList(profile.boundaries)}</div>
          <div className="text-emerald-100/90">关系备注：{compactList(profile.relationshipNotes)}</div>
        </div>
      </div>
    </GlassCard>
  );

  const renderExpression = (expression) => (
    <GlassCard key={expression.id}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-xs font-medium ${statusTextClass('topic')}`}>expression</span>
          <span className="text-xs text-gray-400 font-mono">{expression.id}</span>
        </div>
        <div className="text-lg text-white break-words">{expression.situation}</div>
        <div className="text-sm text-gray-300 break-words">{expression.style}</div>
        <div className="grid gap-2 text-sm text-gray-400 md:grid-cols-2">
          <div>群号：{expression.groupId || '-'}</div>
          <div>置信度：{expression.confidence ?? '-'}</div>
          <div>次数：{expression.count || 0}</div>
          <div>最近使用：{formatTime(expression.lastUsedAt)}</div>
          <div>更新时间：{formatTime(expression.updatedAt)}</div>
          <div>来源：{compactList(expression.sourceMessageIds)}</div>
        </div>
      </div>
    </GlassCard>
  );

  const renderEffect = (effect) => (
    <GlassCard key={effect.id}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-xs font-medium ${statusTextClass(effect.label)}`}>
            {effect.label || 'effect'}
          </span>
          <span className="text-xs text-gray-400 font-mono">{effect.id}</span>
        </div>
        <div className="text-sm text-gray-300 break-words">{effect.text || '-'}</div>
        <div className="grid gap-2 text-sm text-gray-400 md:grid-cols-2">
          <div>群号：{effect.groupId || '-'}</div>
          <div>用户：{effect.targetUserId || '-'}</div>
          <div>动作：{effect.action || '-'}</div>
          <div>分数：{effect.score ?? '-'}</div>
          <div>发送时间：{formatTime(effect.sentAt)}</div>
          <div>观察时间：{formatTime(effect.observedAt)}</div>
          <div>来源消息：{effect.sourceMessageId || '-'}</div>
          <div>信号：{compactSignals(effect.signals)}</div>
        </div>
      </div>
    </GlassCard>
  );

  const renderItem = (item) => {
    if (activeTab === 'profiles') return renderProfile(item);
    if (activeTab === 'expressions') return renderExpression(item);
    if (activeTab === 'effects') return renderEffect(item);
    return renderMemory(item);
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="font-mono text-xs font-semibold uppercase text-[var(--accent)]">Automation</div>
        <h1 className="mt-1 flex items-center gap-3 text-3xl font-semibold text-[var(--fg)]">
          <Brain className="text-[var(--accent)]" />
          Agent 记忆
        </h1>
      </div>

      <GlassCard>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto_auto]">
          <div className="relative">
            <Search className="absolute left-3 top-3 text-gray-500" size={18} />
            <input
              value={groupId}
              onChange={(event) => setGroupId(event.target.value)}
              placeholder="按群号筛选"
              className="w-full bg-black/20 border border-white/10 rounded-lg py-2.5 pl-10 pr-3 text-white placeholder:text-gray-500"
            />
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-3 text-gray-500" size={18} />
            <input
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              placeholder={activeTab === 'expressions' || activeTab === 'effects' ? '当前页不使用用户筛选' : '按用户 QQ 筛选'}
              disabled={activeTab === 'expressions' || activeTab === 'effects'}
              className="w-full bg-black/20 border border-white/10 rounded-lg py-2.5 pl-10 pr-3 text-white placeholder:text-gray-500 disabled:opacity-50"
            />
          </div>
          <Button
            onClick={loadItems}
            disabled={loading}
            variant="primary"
            icon={RefreshCw}
          >
            刷新
          </Button>
          <Button
            onClick={clearFiltered}
            disabled={activeTab !== 'memories'}
            variant="danger"
            icon={Trash2}
          >
            清理记忆
          </Button>
        </div>
      </GlassCard>

      <div className="flex overflow-x-auto border-b border-white/10">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex shrink-0 items-center justify-center gap-2 border-b px-4 py-3 text-sm transition-colors ${
                active
                  ? 'border-purple-300 text-purple-100'
                  : 'border-transparent text-gray-300 hover:text-white'
              }`}
            >
              <Icon size={18} />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="grid gap-4">
        {items.length === 0 && (
          <GlassCard>
            <div className="text-gray-400 text-center py-8">
              {loading ? '加载中...' : `暂无 ${activeTabConfig.label}`}
            </div>
          </GlassCard>
        )}

        {items.map((item) => renderItem(item))}
      </div>
    </div>
  );
};

export default AgentMemory;
