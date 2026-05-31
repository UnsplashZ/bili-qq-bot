import React, { useCallback, useEffect, useRef, useState } from 'react';
import GlassCard from '../components/GlassCard';
import { Terminal, Pause, Play, Trash2, ArrowDown, ArrowUp } from 'lucide-react';
import { Button, StatusPill } from '../components/ui';
import { useLogsStream } from './logs/useLogsStream';
import { getBottomThreshold, getFloatingButtonMode, getScrollTargetMode, isNearBottom } from './logs/scrollBehavior';

const CHANNEL_OPTIONS = ['BOT', 'AGENT', 'LINK', 'SUB', 'SEND', 'DASH', 'AUTH', 'STORE', 'RPC', 'PY', 'HTTP', 'SERVICE'];
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
  if (normalized.includes('FTL')) return 'text-rose-200 border-rose-400/40';
  if (normalized.includes('ERR')) return 'text-rose-300 border-rose-500/30';
  if (normalized.includes('WRN')) return 'text-amber-300 border-amber-500/30';
  if (normalized.includes('DBG') || normalized.includes('TRC')) return 'text-sky-300 border-sky-500/30';
  return 'text-emerald-300 border-emerald-500/30';
}

function getConnectionLabel(connectionState) {
  if (connectionState === 'open') return '实时流已连接';
  if (connectionState === 'error') return '连接错误';
  if (connectionState === 'closed') return '连接断开，等待重连';
  return '连接中';
}

const Logs = () => {
  const [isPaused, setIsPaused] = useState(false);
  const [autoFollow, setAutoFollow] = useState(false);
  const [hasScrollableOverflow, setHasScrollableOverflow] = useState(false);
  const [isNearBottomPosition, setIsNearBottomPosition] = useState(false);
  const [scrollTargetMode, setScrollTargetMode] = useState(null);
  const [filters, setFilters] = useState({
    level: 'info',
    channels: [],
    keyword: '',
  });
  const scrollContainerRef = useRef(null);
  const autoFollowRef = useRef(autoFollow);
  const scrollTargetModeRef = useRef(scrollTargetMode);
  const hasMeasuredInitialLogsRef = useRef(false);
  const { logs, connectionState, clearLogs } = useLogsStream(filters, isPaused);

  useEffect(() => {
    autoFollowRef.current = autoFollow;
  }, [autoFollow]);

  useEffect(() => {
    scrollTargetModeRef.current = scrollTargetMode;
  }, [scrollTargetMode]);

  const resolveLogRowHeight = useCallback((container) => {
    const row = container?.querySelector('[data-log-row]');
    if (!row) return undefined;
    const rect = row.getBoundingClientRect();
    return rect.height || row.offsetHeight || undefined;
  }, []);

  const getPageScrollMetrics = useCallback(() => {
    const doc = document.documentElement;
    const scrollTop = window.scrollY || doc.scrollTop || 0;
    const clientHeight = window.innerHeight || doc.clientHeight || 0;
    const scrollHeight = Math.max(doc.scrollHeight, doc.offsetHeight, doc.clientHeight);
    return {
      scrollTop,
      clientHeight,
      scrollHeight,
    };
  }, []);

  const updateScrollState = useCallback((container, syncAutoFollow = false) => {
    if (!container) return;

    const threshold = getBottomThreshold(resolveLogRowHeight(container));
    const hasOverflow = container.scrollHeight > container.clientHeight + 1;
    const pageMetrics = getPageScrollMetrics();
    const pageHasOverflow = pageMetrics.scrollHeight > pageMetrics.clientHeight + 1;
    const targetMode = getScrollTargetMode({
      containerHasOverflow: hasOverflow,
      pageHasOverflow,
    });
    const nearBottom = targetMode === 'page'
      ? isNearBottom(pageMetrics, threshold)
      : isNearBottom(container, threshold);

    setHasScrollableOverflow(Boolean(targetMode));
    setIsNearBottomPosition(nearBottom);
    setScrollTargetMode(targetMode);

    if (syncAutoFollow) {
      setAutoFollow(nearBottom);
    }
  }, [getPageScrollMetrics, resolveLogRowHeight]);

  const scrollToActiveTarget = useCallback((target, behavior = 'smooth') => {
    const container = scrollContainerRef.current;
    const targetMode = scrollTargetModeRef.current;
    if (targetMode === 'page') {
      const pageMetrics = getPageScrollMetrics();
      window.scrollTo({
        top: target === 'top' ? 0 : pageMetrics.scrollHeight,
        behavior,
      });
      return;
    }
    if (!container) return;
    container.scrollTo({
      top: target === 'top' ? 0 : container.scrollHeight,
      behavior,
    });
  }, [getPageScrollMetrics]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    if (logs.length === 0) {
      const frameId = window.requestAnimationFrame(() => {
        setHasScrollableOverflow(false);
        setIsNearBottomPosition(true);
        setAutoFollow(true);
      });
      return () => window.cancelAnimationFrame(frameId);
    }

    if (!hasMeasuredInitialLogsRef.current) {
      hasMeasuredInitialLogsRef.current = true;
      updateScrollState(container, true);
      return;
    }

    if (!isPaused && autoFollowRef.current) {
      scrollToActiveTarget('bottom', 'auto');
      requestAnimationFrame(() => updateScrollState(container, true));
      return;
    }

    updateScrollState(container);
  }, [logs, isPaused, scrollToActiveTarget, updateScrollState]);

  useEffect(() => {
    const handleWindowScroll = () => {
      if (scrollTargetModeRef.current !== 'page') return;
      const container = scrollContainerRef.current;
      if (!container) return;
      updateScrollState(container, true);
    };

    const handleResize = () => {
      const container = scrollContainerRef.current;
      if (!container) return;
      updateScrollState(container);
    };

    window.addEventListener('scroll', handleWindowScroll, { passive: true });
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('scroll', handleWindowScroll);
      window.removeEventListener('resize', handleResize);
    };
  }, [updateScrollState]);

  const handleScroll = (event) => {
    updateScrollState(event.currentTarget, true);
  };

  const jumpToBottom = () => {
    setAutoFollow(true);
    setIsNearBottomPosition(true);
    scrollToActiveTarget('bottom');
  };

  const jumpToTop = () => {
    setAutoFollow(false);
    setIsNearBottomPosition(false);
    scrollToActiveTarget('top');
  };

  const toggleChannel = (channel) => {
    setFilters((prev) => {
      const nextChannels = prev.channels.includes(channel)
        ? prev.channels.filter((item) => item !== channel)
        : [...prev.channels, channel];
      return { ...prev, channels: nextChannels };
    });
  };

  const floatingButtonMode = getFloatingButtonMode({
    hasLogs: logs.length > 0,
    hasOverflow: hasScrollableOverflow,
    isNearBottomPosition,
  });

  return (
    <div className="logs-shell flex h-[calc(100dvh-7rem)] min-h-0 flex-col space-y-3 overflow-hidden pb-5 md:h-[calc(100dvh-8rem)] md:space-y-4 md:pb-6">
      <header className="flex shrink-0 justify-between items-start sm:items-center flex-wrap gap-3">
        <div>
          <div className="font-mono text-xs font-semibold uppercase text-[var(--accent)]">Diagnostics</div>
          <h1 className="mt-1 text-3xl font-semibold text-[var(--fg)]">系统日志</h1>
        </div>
        <div className="flex w-full sm:w-auto justify-end gap-2">
          <button
            onClick={clearLogs}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--fg)]"
            title="清空当前视图"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <Button
            onClick={() => setIsPaused(!isPaused)}
            variant={isPaused ? 'secondary' : 'primary'}
            icon={isPaused ? Play : Pause}
          >
            {isPaused ? '继续' : '暂停'}
          </Button>
        </div>
      </header>

      <GlassCard className="logs-filter shrink-0 bg-[var(--surface)] p-3 sm:p-4">
        <div className="grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)] lg:grid-cols-[180px_minmax(0,1fr)]">
          <div className="space-y-2">
            <label className="block text-xs uppercase tracking-[0.28em] text-gray-500">等级</label>
            <select
              value={filters.level}
              onChange={(event) => setFilters((prev) => ({ ...prev, level: event.target.value }))}
              className="field-control w-full px-3 py-2 text-sm"
            >
              {LEVEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
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
              className="field-control w-full px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <label className="block text-xs uppercase tracking-[0.28em] text-gray-500">Channel</label>
            <StatusPill tone={connectionState === 'open' ? 'success' : connectionState === 'error' ? 'danger' : 'warn'}>
              {getConnectionLabel(connectionState)}
            </StatusPill>
          </div>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 custom-scrollbar">
            {CHANNEL_OPTIONS.map((channel) => {
              const active = filters.channels.includes(channel);
              return (
                <button
                  key={channel}
                  type="button"
                  onClick={() => toggleChannel(channel)}
                  className={`shrink-0 rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${active ? 'border-[color-mix(in_oklch,var(--accent)_38%,var(--border))] bg-[var(--accent-soft)] text-[var(--accent)]' : 'border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface-muted)]'}`}
                >
                  {channel}
                </button>
              );
            })}
          </div>
        </div>
      </GlassCard>

      <GlassCard className="logs-panel flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--surface)] p-0">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 font-mono text-xs text-[var(--muted)] sm:px-4">
          <div className="flex items-center gap-2">
            <Terminal size={12} />
            <span>root@bot-server:~/logs/stream</span>
          </div>
          <div className="hidden md:flex items-center gap-4">
            <span>{logs.length} lines</span>
            <span>{isPaused ? 'paused' : 'live'}</span>
          </div>
        </div>

        <div className="grid grid-cols-[92px_52px_minmax(0,1fr)] gap-3 border-b border-[var(--border)] px-3 py-2 text-[10px] font-semibold uppercase text-[var(--muted)] sm:px-4 md:grid-cols-[170px_64px_76px_minmax(180px,220px)_minmax(0,1fr)]">
          <span>Timestamp</span>
          <span>Level</span>
          <span className="hidden md:block">Channel</span>
          <span className="hidden md:block">Scope</span>
          <span>Message</span>
        </div>

        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 font-mono text-xs sm:text-sm space-y-1 custom-scrollbar"
        >
          {logs.length === 0 && (
            <div className="mt-10 text-center italic text-[var(--muted)]">等待日志数据...</div>
          )}
          {logs.map((log, index) => (
            <div
              key={`${log.timestamp}-${log.channel}-${log.action}-${index}`}
              data-log-row
              className="grid grid-cols-[92px_52px_minmax(0,1fr)] items-start gap-3 rounded px-2 py-1.5 hover:bg-[var(--surface-muted)] md:grid-cols-[170px_64px_76px_minmax(180px,220px)_minmax(0,1fr)]"
            >
              <span className="text-gray-500 whitespace-nowrap truncate">{log.timestampText}</span>
              <span className={`inline-flex w-fit border-l pl-2 text-[10px] font-bold uppercase tracking-[0.18em] ${getLevelBadgeClass(log.level)}`}>
                {log.level}
              </span>
              <span className="hidden text-sky-200 md:block">{log.channel || '-'}</span>
              <span className="hidden text-gray-500 break-all md:block">{log.scope || '-'}</span>
              <span className="text-gray-300 whitespace-pre-wrap break-all leading-relaxed">
                {getMessageText(log)}
              </span>
            </div>
          ))}
        </div>

      </GlassCard>

      {floatingButtonMode && (
        <button
          type="button"
          onClick={floatingButtonMode === 'top' ? jumpToTop : jumpToBottom}
          className="fixed bottom-5 right-4 md:bottom-7 md:right-8 z-40 inline-flex items-center gap-2 rounded-lg border border-sky-300/20 bg-slate-950/90 px-3 py-2 text-xs font-semibold text-sky-100 shadow-[0_10px_28px_rgba(2,6,23,0.5)] transition-colors hover:bg-slate-900"
          title={floatingButtonMode === 'top' ? '回顶部' : '去底部'}
          aria-label={floatingButtonMode === 'top' ? '回顶部' : '去底部'}
        >
          {floatingButtonMode === 'top' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />}
          <span>{floatingButtonMode === 'top' ? '回顶部' : '去底部'}</span>
        </button>
      )}
    </div>
  );
};

export default Logs;
