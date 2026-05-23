import React, { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Activity, Clock, Cpu, HardDrive, Network } from 'lucide-react';
import { Card, DataTable, PanelHeader, StatusPill } from '../components/ui';
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

function numericValue(value) {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function getMetricTone(value, warnAt, dangerAt) {
  const next = numericValue(value);
  if (next === null) return 'neutral';
  if (next >= dangerAt) return 'danger';
  if (next >= warnAt) return 'warn';
  return 'success';
}

function getProcessTone(metric) {
  const failed = numericValue(metric.failed);
  if (failed === null) return 'neutral';
  if (failed === 0) return 'success';
  return failed >= 5 ? 'danger' : 'warn';
}

function toneTextClass(tone) {
  switch (tone) {
    case 'success':
      return 'text-[color-mix(in_oklch,var(--success)_88%,var(--fg))]';
    case 'warn':
      return 'text-[color-mix(in_oklch,var(--warn)_88%,var(--fg))]';
    case 'danger':
      return 'text-[color-mix(in_oklch,var(--danger)_88%,var(--fg))]';
    case 'accent':
      return 'text-[var(--accent)]';
    default:
      return 'text-[var(--muted)]';
  }
}

function metricCardClass(tone) {
  switch (tone) {
    case 'warn':
      return 'border-[color-mix(in_oklch,var(--warn)_42%,var(--border))] bg-[color-mix(in_oklch,var(--warn)_5%,var(--surface))]';
    case 'danger':
      return 'border-[color-mix(in_oklch,var(--danger)_42%,var(--border))] bg-[color-mix(in_oklch,var(--danger)_5%,var(--surface))]';
    default:
      return '';
  }
}

function metricIconClass(tone) {
  switch (tone) {
    case 'warn':
      return 'border-[color-mix(in_oklch,var(--warn)_42%,var(--border))] text-[color-mix(in_oklch,var(--warn)_88%,var(--fg))]';
    case 'danger':
      return 'border-[color-mix(in_oklch,var(--danger)_42%,var(--border))] text-[color-mix(in_oklch,var(--danger)_88%,var(--fg))]';
    default:
      return 'border-[var(--border)] text-[var(--accent)]';
  }
}

function formatPercent(value) {
  const next = numericValue(value);
  return next === null ? '-' : `${next.toFixed(1)}%`;
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
      <div className="flex min-h-[60vh] items-center justify-center text-[var(--muted)]">
        <div className="text-lg animate-pulse">正在加载系统状态...</div>
      </div>
    );
  }

  const memoryUsed = stats.memory?.used ?? 0;
  const memoryTotal = stats.memory?.total ?? 0;
  const memoryPercent = memoryTotal ? (memoryUsed / memoryTotal) * 100 : null;
  const processRows = PROCESS_ROWS.map((row) => {
    const metric = normalizeProcessMetric(stats.processReport?.[row.key]);
    return { ...row, metric, tone: getProcessTone(metric) };
  });

  const kpis = [
    {
      label: 'CPU 负载',
      value: formatPercent(stats.cpu),
      meta: null,
      icon: Cpu,
      tone: getMetricTone(stats.cpu, 70, 90)
    },
    {
      label: '内存使用',
      value: memoryTotal ? `${formatBytes(memoryUsed)} / ${formatBytes(memoryTotal)}` : formatBytes(memoryUsed),
      meta: null,
      icon: HardDrive,
      tone: getMetricTone(memoryPercent, 75, 90)
    },
    {
      label: '网络流量',
      value: [
        { label: '↑', value: formatNetSpeed(stats.network?.up ?? 0) },
        { label: '↓', value: formatNetSpeed(stats.network?.down ?? 0) }
      ],
      meta: null,
      icon: Network,
      tone: 'accent'
    },
    {
      label: '运行时间',
      value: formatUptime(stats.uptime),
      meta: null,
      icon: Clock,
      tone: 'success'
    }
  ];

  const processColumns = [
    { key: 'label', title: '流程', className: 'font-medium' },
    { key: 'total', title: '总量', className: 'font-mono text-[var(--muted)]', render: (row) => row.metric.total },
    { key: 'success', title: '成功', className: 'font-mono text-[var(--muted)]', render: (row) => row.metric.success },
    { key: 'failed', title: '失败', className: 'font-mono text-[var(--muted)]', render: (row) => row.metric.failed },
    {
      key: 'latest',
      title: '最近状态',
      render: (row) => (
        <span className={`text-sm font-medium ${toneTextClass(row.tone)}`}>
          {row.metric.latest || '-'}
        </span>
      )
    }
  ];

  return (
    <div className="space-y-4 pb-6 md:space-y-6">
      <header className="flex flex-col gap-2">
        <div className="font-mono text-xs font-semibold uppercase text-[var(--accent)]">Overview</div>
        <h1 className="text-3xl font-semibold text-[var(--fg)] md:text-4xl">运行状态</h1>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <Card key={kpi.label} className={`min-h-32 ${metricCardClass(kpi.tone)}`}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm text-[var(--muted)]">{kpi.label}</div>
                  {Array.isArray(kpi.value) ? (
                    <div className="mt-5 space-y-1">
                      {kpi.value.map((item) => (
                        <div key={item.label} className="font-mono text-2xl font-semibold text-[var(--fg)]">
                          <span className="mr-2 text-[var(--muted)]">{item.label}</span>
                          {item.value}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-5 font-mono text-2xl font-semibold text-[var(--fg)]">{kpi.value}</div>
                  )}
                </div>
                <div className={`grid h-9 w-9 place-items-center rounded-lg border ${metricIconClass(kpi.tone)}`}>
                  <Icon size={18} />
                </div>
              </div>
              {kpi.meta && (
                <div className={`mt-4 text-sm font-semibold ${toneTextClass(kpi.tone)}`}>
                  {kpi.meta}
                </div>
              )}
            </Card>
          );
        })}
      </section>

      <Card className="overflow-hidden p-0">
        <PanelHeader
          icon={Activity}
          title="资源趋势"
          meta={<StatusPill tone="success">实时连接</StatusPill>}
        />
        <div className="h-72 p-4 md:h-80">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={history}>
              <defs>
                <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.28}/>
                  <stop offset="95%" stopColor="var(--accent)" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="colorMemory" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--success)" stopOpacity={0.2}/>
                  <stop offset="95%" stopColor="var(--success)" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="time" stroke="var(--muted)" fontSize={12} tick={{ fill: 'var(--muted)' }} minTickGap={24} />
              <YAxis yAxisId="cpu" domain={[0, 100]} stroke="var(--muted)" fontSize={12} tick={{ fill: 'var(--muted)' }} />
              <YAxis yAxisId="memory" orientation="right" stroke="var(--muted)" fontSize={12} tickFormatter={(value) => formatBytes(value, 0)} tick={{ fill: 'var(--muted)' }} width={58} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--surface)',
                  borderColor: 'var(--border)',
                  borderRadius: 8,
                  color: 'var(--fg)'
                }}
                itemStyle={{ color: 'var(--fg)' }}
                labelStyle={{ color: 'var(--muted)' }}
                formatter={(value, name) => (
                  name === 'Memory' ? [formatBytes(value), 'Memory'] : [`${Number(value).toFixed(1)}%`, 'CPU']
                )}
              />
              <Area
                yAxisId="cpu"
                type="monotone"
                dataKey="cpu"
                stroke="var(--accent)"
                fillOpacity={1}
                fill="url(#colorCpu)"
                name="CPU %"
                isAnimationActive={false}
              />
              <Area
                yAxisId="memory"
                type="monotone"
                dataKey="memory"
                stroke="var(--success)"
                fillOpacity={1}
                fill="url(#colorMemory)"
                name="Memory"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <PanelHeader
          title="过程报表"
          meta={<span className="font-mono">{processRows.length} flows</span>}
        />
        <DataTable columns={processColumns} rows={processRows} getRowKey={(row) => row.key} />
      </Card>
    </div>
  );
};

export default Dashboard;
