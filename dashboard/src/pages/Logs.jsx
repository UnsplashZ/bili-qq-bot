import React, { useEffect, useRef, useState } from 'react';
import GlassCard from '../components/GlassCard';
import { Terminal, Pause, Play, Trash2, ArrowDown } from 'lucide-react';
import { useLogsStream } from './logs/useLogsStream';
import { isNearBottom } from './logs/scrollBehavior';

const CHANNEL_OPTIONS = ['BOT', 'LINK', 'AI', 'SUB', 'SEND', 'DASH', 'AUTH', 'STORE', 'MCP', 'RPC', 'PY', 'HTTP', 'SERVICE'];
const LEVEL_OPTIONS = [
  { value: 'trace', label: 'TRC+' },
  { value: 'debug', label: 'DBG+' },
  { value: 'info', label: 'INF+' },
  { value: 'warn', label: 'WRN+' },
  { value: 'error', label: 'ERR+' },
  { value: 'fatal', label: 'FTL' },
];

function formatFields(fields = {}) {
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (entries.length === 0) return '';
  return entries
    .map(([key, value]) => {
      if (typeof value === 'string') {
        return /\s/.test(value) ? `${key}=${JSON.stringify(value)}` : `${key}=${value}`;
      }
      if (typeof value === 'object') {
        return `${key}=${JSON.stringify(value)}`;
      }
      return `${key}=${String(value)}`;
    })
    .join(' ');
}

function getMessageText(log) {
  const action = log.action || '';
  const fieldsText = formatFields(log.fields);
  if (action) {
    return `${action}${fieldsText ? ` ${fieldsText}` : ''}`;
  }
  return log.rendered || log.message || '-';
}

function getLevelBadgeClass(level) {
  const normalized = String(level || '').toUpperCase();
  if (normalized.includes('FTL')) return 'text-rose-200 bg-rose-600/40 border border-rose-400/30';
  if (normalized.includes('ERR')) return 'text-rose-300 bg-rose-500/10 border border-rose-500/20';
  if (normalized.includes('WRN')) return 'text-amber-300 bg-amber-500/10 border border-amber-500/20';
  if (normalized.includes('DBG') || normalized.includes('TRC')) return 'text-sky-300 bg-sky-500/10 border border-sky-500/20';
  return 'text-emerald-300 bg-emerald-500/10 border border-emerald-500/20';
}

function getConnectionLabel(connectionState) {
  if (connectionState === 'open') return '实时流已连接';
  if (connectionState === 'error') return '连接错误';
  if (connectionState === 'closed') return '连接断开，等待重连';
  return '连接中';
}

const Logs = () => {
  const [isPaused, setIsPaused] = useState(false);
  const [autoFollow, setAutoFollow] = useState(true);
  const [filters, setFilters] = useState({
    level: 'info',
    channels: [],
    keyword: '',
  });
  const logsEndRef = useRef(null);
  const { logs, connectionState, clearLogs } = useLogsStream(filters, isPaused);

  useEffect(() => {
    if (!isPaused && autoFollow && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, isPaused, autoFollow]);

  const handleScroll = (event) => {
    setAutoFollow(isNearBottom(event.currentTarget));
  };

  const jumpToBottom = () => {
    setAutoFollow(true);
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const toggleChannel = (channel) => {
    setFilters((prev) => {
      const nextChannels = prev.channels.includes(channel)
        ? prev.channels.filter((item) => item !== channel)
        : [...prev.channels, channel];
      return { ...prev, channels: nextChannels };
    });
  };

  return (
    <div className="px-3 sm:px-4 md:px-6 pt-3 sm:pt-4 md:pt-6 flex flex-col space-y-3 md:space-y-4 pb-5 md:pb-6 min-h-[calc(100vh-7rem)] md:min-h-[calc(100vh-8rem)]">
      <header className="flex justify-between items-start sm:items-center flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-white mb-1.5 md:mb-2">系统日志</h1>
          <p className="text-sm md:text-base text-gray-400">优先展示 docker logs 风格的摘要，并保留最近一段历史。</p>
        </div>
        <div className="flex w-full sm:w-auto justify-end gap-2">
          <button
            onClick={clearLogs}
            className="w-9 h-9 md:w-auto md:h-auto md:p-2 flex items-center justify-center hover:bg-white/10 rounded-lg text-gray-300 transition-colors"
            title="清空当前视图"
          >
            <Trash2 className="w-4 h-4 md:w-5 md:h-5" />
          </button>
          <button
            onClick={() => setIsPaused(!isPaused)}
            className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm md:text-base font-medium transition-colors ${isPaused ? 'bg-yellow-500/20 text-yellow-400' : 'bg-white/10 text-white hover:bg-white/20'}`}
          >
            {isPaused ? <Play className="w-4 h-4 md:w-[18px] md:h-[18px]" /> : <Pause className="w-4 h-4 md:w-[18px] md:h-[18px]" />}
            {isPaused ? '继续' : '暂停'}
          </button>
          {!autoFollow && (
            <button
              onClick={jumpToBottom}
              className="flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm md:text-base font-medium bg-sky-500/15 text-sky-200 hover:bg-sky-500/25 transition-colors"
            >
              <ArrowDown className="w-4 h-4 md:w-[18px] md:h-[18px]" />
              回到底部
            </button>
          )}
        </div>
      </header>

      <GlassCard className="p-3 sm:p-4 bg-[#121821]/90 border-white/10">
        <div className="grid gap-3 lg:grid-cols-[180px_minmax(0,1fr)]">
          <div className="space-y-2">
            <label className="block text-xs uppercase tracking-[0.28em] text-gray-500">等级</label>
            <select
              value={filters.level}
              onChange={(event) => setFilters((prev) => ({ ...prev, level: event.target.value }))}
              className="w-full rounded-xl bg-black/30 border border-white/10 px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
            >
              {LEVEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value} className="bg-slate-900 text-gray-100">
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="block text-xs uppercase tracking-[0.28em] text-gray-500">关键字</label>
            <input
              value={filters.keyword}
              onChange={(event) => setFilters((prev) => ({ ...prev, keyword: event.target.value }))}
              placeholder="搜索 action / scope / fields"
              className="w-full rounded-xl bg-black/30 border border-white/10 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
            />
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <label className="block text-xs uppercase tracking-[0.28em] text-gray-500">Channel</label>
            <span className="text-xs text-gray-500">{getConnectionLabel(connectionState)}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {CHANNEL_OPTIONS.map((channel) => {
              const active = filters.channels.includes(channel);
              return (
                <button
                  key={channel}
                  type="button"
                  onClick={() => toggleChannel(channel)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold tracking-[0.18em] transition-colors ${active ? 'bg-sky-500/20 text-sky-200 border border-sky-400/30' : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'}`}
                >
                  {channel}
                </button>
              );
            })}
          </div>
        </div>
      </GlassCard>

      <GlassCard className="flex-1 overflow-hidden p-0 flex flex-col bg-[#0d1117] border-white/10">
        <div className="flex items-center justify-between gap-3 px-3 sm:px-4 py-2 bg-white/5 border-b border-white/5 text-xs text-gray-500 font-mono">
          <div className="flex items-center gap-2">
            <Terminal size={12} />
            <span>root@bot-server:~/logs/stream</span>
          </div>
          <div className="hidden md:flex items-center gap-4">
            <span>{logs.length} lines</span>
            <span>{isPaused ? 'paused' : 'live'}</span>
          </div>
        </div>

        <div className="grid grid-cols-[170px_64px_76px_minmax(180px,220px)_minmax(0,1fr)] gap-3 px-3 sm:px-4 py-2 border-b border-white/5 text-[10px] uppercase tracking-[0.28em] text-gray-600 font-semibold">
          <span>Timestamp</span>
          <span>Level</span>
          <span>Channel</span>
          <span>Scope</span>
          <span>Message</span>
        </div>

        <div
          onScroll={handleScroll}
          className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 font-mono text-xs sm:text-sm space-y-1 custom-scrollbar"
        >
          {logs.length === 0 && (
            <div className="text-gray-600 italic text-center mt-10">等待日志数据...</div>
          )}
          {logs.map((log, index) => (
            <div key={`${log.timestamp}-${log.channel}-${log.action}-${index}`} className="grid grid-cols-[170px_64px_76px_minmax(180px,220px)_minmax(0,1fr)] gap-3 px-2 py-1.5 rounded hover:bg-white/5 items-start">
              <span className="text-gray-500 whitespace-nowrap">{log.timestampText}</span>
              <span className={`inline-flex w-fit rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] ${getLevelBadgeClass(log.level)}`}>
                {log.level}
              </span>
              <span className="text-sky-200">{log.channel || '-'}</span>
              <span className="text-gray-500 break-all">{log.scope || '-'}</span>
              <span className="text-gray-300 whitespace-pre-wrap break-all leading-relaxed">
                {getMessageText(log)}
              </span>
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>
      </GlassCard>
    </div>
  );
};

export default Logs;
