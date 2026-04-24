import React, { useCallback, useEffect, useState } from 'react';
import { Brain, RefreshCw, Search, Trash2 } from 'lucide-react';
import GlassCard from '../components/GlassCard';
import api from '../utils/auth';
import { useToast } from '../hooks/useToast';

function formatTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

function badgeClass(scope) {
  if (scope === 'user') return 'bg-blue-500/15 text-blue-200 border-blue-400/30';
  if (scope === 'group') return 'bg-emerald-500/15 text-emerald-200 border-emerald-400/30';
  if (scope === 'topic') return 'bg-purple-500/15 text-purple-200 border-purple-400/30';
  return 'bg-slate-500/15 text-slate-200 border-slate-400/30';
}

const AgentMemory = () => {
  const { show } = useToast();
  const [memories, setMemories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [groupId, setGroupId] = useState('');
  const [userId, setUserId] = useState('');

  const loadMemories = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (groupId.trim()) params.set('groupId', groupId.trim());
      if (userId.trim()) params.set('userId', userId.trim());
      params.set('limit', '100');
      const response = await api.get(`/api/agent/memories?${params.toString()}`);
      setMemories(response.data.memories || []);
    } catch (error) {
      console.error('Failed to load agent memories:', error);
      show('加载 Agent 记忆失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [groupId, userId, show]);

  useEffect(() => {
    loadMemories();
  }, [loadMemories]);

  const deleteMemory = async (memoryId) => {
    if (!window.confirm(`确认删除记忆 ${memoryId}？`)) return;
    try {
      await api.delete(`/api/agent/memories/${encodeURIComponent(memoryId)}`);
      setMemories((prev) => prev.filter((memory) => memory.id !== memoryId));
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
      loadMemories();
    } catch (error) {
      console.error('Failed to clear memories:', error);
      show('清理记忆失败', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <Brain className="text-purple-300" />
          Agent 记忆
        </h1>
        <p className="text-gray-400 mt-2">
          查看长期记忆、来源、置信度、重要性和访问次数；错误记忆可直接删除。
        </p>
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
              placeholder="按用户 QQ 筛选"
              className="w-full bg-black/20 border border-white/10 rounded-lg py-2.5 pl-10 pr-3 text-white placeholder:text-gray-500"
            />
          </div>
          <button
            onClick={loadMemories}
            disabled={loading}
            className="px-4 py-2.5 rounded-lg bg-blue-500/20 text-blue-100 hover:bg-blue-500/30 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            刷新
          </button>
          <button
            onClick={clearFiltered}
            className="px-4 py-2.5 rounded-lg bg-rose-500/20 text-rose-100 hover:bg-rose-500/30 flex items-center justify-center gap-2"
          >
            <Trash2 size={18} />
            清理筛选
          </button>
        </div>
      </GlassCard>

      <div className="grid gap-4">
        {memories.length === 0 && (
          <GlassCard>
            <div className="text-gray-400 text-center py-8">
              {loading ? '加载中...' : '暂无 Agent 记忆'}
            </div>
          </GlassCard>
        )}

        {memories.map((memory) => (
          <GlassCard key={memory.id}>
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`px-2.5 py-1 rounded-full text-xs border ${badgeClass(memory.scope)}`}>
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
                  <div>来源：{Array.isArray(memory.sourceMessageIds) && memory.sourceMessageIds.length > 0 ? memory.sourceMessageIds.join(', ') : '-'}</div>
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
        ))}
      </div>
    </div>
  );
};

export default AgentMemory;
