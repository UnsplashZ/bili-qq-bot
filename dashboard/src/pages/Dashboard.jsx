import React, { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import GlassCard from '../components/GlassCard';
import { formatBytes, formatUptime, formatNetSpeed } from '../utils/format';
import api from '../utils/auth';

const HISTORY_STORAGE_KEY = 'bili-qq-bot.dashboard.history.v1';
const HISTORY_LIMIT = 60;

const PROCESS_ROWS = [
  { key: 'linkParsing', label: '链接解析' },
  { key: 'previewGeneration', label: '预览生成' },
  { key: 'subscriptionPush', label: '订阅推送' },
  { key: 'videoDownload', label: '视频下载' },
  { key: 'aiReply', label: 'AI 回复' },
  { key: 'toolCall', label: '工具调用' },
  { key: 'retryFailure', label: '失败重试' }
];

function normalizeProcessMetric(metric) {
  if (!metric) {
    return {
      total: '-',
      success: '-',
      failed: '-',
      latest: '暂无过程指标'
    };
  }
  return {
    total: metric.total ?? '-',
    success: metric.success ?? metric.ok ?? '-',
    failed: metric.failed ?? metric.error ?? '-',
    latest: metric.latest || metric.status || '-'
  };
}

function normalizeHistoryEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (!Number.isFinite(Number(entry.cpu)) || !Number.isFinite(Number(entry.memory))) return null;
  return {
    time: entry.time || new Date(entry.timestamp || Date.now()).toLocaleTimeString(),
    timestamp: Number(entry.timestamp || Date.now()),
    cpu: Number(entry.cpu),
    memory: Number(entry.memory),
    memoryFormatted: entry.memoryFormatted || formatBytes(Number(entry.memory))
  };
}

function readPersistedHistory() {
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeHistoryEntry).filter(Boolean).slice(-HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function persistHistory(history) {
  try {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history.slice(-HISTORY_LIMIT)));
  } catch {
    // Ignore storage failures; the live chart can still render from in-memory state.
  }
}

const Dashboard = () => {
  const [stats, setStats] = useState(null);
  const [history, setHistory] = useState(() => readPersistedHistory());

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await api.get('/api/monitor');
        const data = response.data;

        setStats(data);
        setHistory(prev => {
          const now = Date.now();
          const newEntry = {
            time: new Date(now).toLocaleTimeString(),
            timestamp: now,
            cpu: data.cpu,
            memory: data.memory.used,
            memoryFormatted: formatBytes(data.memory.used) // For tooltip
          };
          const newHistory = [...prev, newEntry].slice(-HISTORY_LIMIT);
          persistHistory(newHistory);
          return newHistory;
        });
      } catch (error) {
        console.error('Failed to fetch stats:', error);
      }
    };

    // Initial fetch
    fetchData();

    // Polling interval
    const interval = setInterval(fetchData, 2000);

    return () => clearInterval(interval);
  }, []);

  if (!stats) {
    return (
      <div className="flex items-center justify-center min-h-screen text-white">
        <div className="text-xl animate-pulse">正在加载系统状态...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-white">运行状态</h1>
      </header>

      <GlassCard className="overflow-hidden p-0">
        <div className="border-b border-white/10 px-4 py-3 text-sm font-medium text-slate-200">系统资源</div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <tbody className="divide-y divide-white/10">
              <tr>
                <th className="w-48 px-4 py-3 font-medium text-slate-400">CPU 负载</th>
                <td className="px-4 py-3 text-white">{stats.cpu.toFixed(1)}%</td>
              </tr>
              <tr>
                <th className="px-4 py-3 font-medium text-slate-400">内存使用</th>
                <td className="px-4 py-3 text-white">
                  {formatBytes(stats.memory.used)} / {formatBytes(stats.memory.total)}
                  {stats.memory.total ? ` (${((stats.memory.used / stats.memory.total) * 100).toFixed(1)}%)` : ''}
                </td>
              </tr>
              <tr>
                <th className="px-4 py-3 font-medium text-slate-400">网络流量</th>
                <td className="px-4 py-3 text-white">↑ {formatNetSpeed(stats.network.up)} / ↓ {formatNetSpeed(stats.network.down)}</td>
              </tr>
              <tr>
                <th className="px-4 py-3 font-medium text-slate-400">运行时间</th>
                <td className="px-4 py-3 text-white">{formatUptime(stats.uptime)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </GlassCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 mt-4 md:mt-6">
        <GlassCard className="p-4 md:p-5">
          <h3 className="mb-3 text-sm font-medium text-slate-200 md:mb-4">CPU 趋势</h3>
          <div className="h-56 md:h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history}>
                <defs>
                  <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.45}/>
                    <stop offset="95%" stopColor="#22d3ee" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff0d" />
                <XAxis dataKey="time" stroke="#9ca3af" fontSize={12} tick={{fill: '#9ca3af'}} />
                <YAxis domain={[0, 100]} stroke="#9ca3af" fontSize={12} tick={{fill: '#9ca3af'}} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: 8, color: '#fff' }}
                  itemStyle={{ color: '#fff' }}
                />
                <Area
                  type="monotone"
                  dataKey="cpu"
                  stroke="#22d3ee"
                  fillOpacity={1}
                  fill="url(#colorCpu)"
                  name="CPU %"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </GlassCard>

        <GlassCard className="p-4 md:p-5">
          <h3 className="mb-3 text-sm font-medium text-slate-200 md:mb-4">内存趋势</h3>
          <div className="h-56 md:h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history}>
                <defs>
                  <linearGradient id="colorMemory" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.38}/>
                    <stop offset="95%" stopColor="#38bdf8" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff0d" />
                <XAxis dataKey="time" stroke="#9ca3af" fontSize={12} tick={{fill: '#9ca3af'}} />
                <YAxis stroke="#9ca3af" fontSize={12} tickFormatter={(value) => formatBytes(value, 0)} tick={{fill: '#9ca3af'}} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: 8, color: '#fff' }}
                  itemStyle={{ color: '#fff' }}
                  formatter={(value) => [formatBytes(value), 'Memory']}
                />
                <Area
                  type="monotone"
                  dataKey="memory"
                  stroke="#38bdf8"
                  fillOpacity={1}
                  fill="url(#colorMemory)"
                  name="Memory"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </GlassCard>
      </div>

      <GlassCard className="overflow-hidden p-0">
        <div className="border-b border-white/10 px-4 py-3 text-sm font-medium text-slate-200">过程报表</div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-white/10 text-xs uppercase tracking-[0.18em] text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">流程</th>
                <th className="px-4 py-3 font-medium">总量</th>
                <th className="px-4 py-3 font-medium">成功</th>
                <th className="px-4 py-3 font-medium">失败</th>
                <th className="px-4 py-3 font-medium">最近状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {PROCESS_ROWS.map((row) => {
                const metric = normalizeProcessMetric(stats.processReport?.[row.key]);
                return (
                  <tr key={row.key}>
                    <td className="px-4 py-3 text-slate-200">{row.label}</td>
                    <td className="px-4 py-3 text-slate-400">{metric.total}</td>
                    <td className="px-4 py-3 text-slate-400">{metric.success}</td>
                    <td className="px-4 py-3 text-slate-400">{metric.failed}</td>
                    <td className="px-4 py-3 text-slate-500">{metric.latest}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </GlassCard>
    </div>
  );
};

export default Dashboard;
