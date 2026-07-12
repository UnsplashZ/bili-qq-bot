import React, { useCallback, useEffect, useRef, useState } from 'react';
import GlassCard from '../components/GlassCard';
import { Terminal, Pause, Play, Trash2, ArrowDown, ArrowUp, Download } from 'lucide-react';
import { Button } from '../components/ui';
import { useLogsStream } from './logs/useLogsStream';
import { downloadLogExport, getLogMessageText } from './logs/logExport';
import { DEFAULT_LOG_LIMIT, LOG_LIMIT_OPTIONS, normalizeLogLimit } from './logs/logLimits';
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

function getLevelBadgeClass(level) {
  const normalized = String(level || '').toUpperCase();
  if (normalized.includes('FTL')) return 'text-rose-200 border-rose-400/40';
  if (normalized.includes('ERR')) return 'text-rose-300 border-rose-500/30';
  if (normalized.includes('WRN')) return 'text-amber-300 border-amber-500/30';
  if (normalized.includes('DBG') || normalized.includes('TRC')) return 'text-sky-300 border-sky-500/30';
  return 'text-emerald-300 border-emerald-500/30';
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
    limit: DEFAULT_LOG_LIMIT,
  });
  const scrollContainerRef = useRef(null);
  const autoFollowRef = useRef(autoFollow);
  const scrollTargetModeRef = useRef(scrollTargetMode);
  const hasMeasuredInitialLogsRef = useRef(false);
  const { logs, clearLogs } = useLogsStream(filters, isPaused);
  const currentLimit = normalizeLogLimit(filters.limit);

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

  const handleExportLogs = () => {
    downloadLogExport(logs);
  };

  const floatingButtonMode = getFloatingButtonMode({
    hasLogs: logs.length > 0,
    hasOverflow: hasScrollableOverflow,
    isNearBottomPosition,
  });

  return (
    <div className="admin-page logs-shell flex min-h-0 flex-col space-y-3 overflow-hidden pb-5 md:space-y-4 md:pb-6">
      <header className="flex shrink-0 justify-between items-start sm:items-center flex-wrap gap-3">
        <div>
          <div className="font-mono text-xs font-semibold uppercase text-[var(--accent)]">Diagnostics</div>
          <h1 className="mt-1 text-3xl font-semibold text-[var(--fg)]">系统日志</h1>
          <p className="mt-1.5 text-xs text-[var(--muted)]">实时查看、筛选和导出运行日志。</p>
        </div>
        <div className="flex w-full sm:w-auto justify-end gap-2">
          <button
            onClick={clearLogs}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border-muted)] text-[var(--muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]"
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

      <GlassCard className="logs-filter shrink-0 py-4">
        <div className="grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)] lg:grid-cols-[160px_minmax(0,1fr)_120px_auto]">
          <label className="block space-y-2">
            <span className="block text-xs uppercase tracking-[0.28em] text-gray-500">等级</span>
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
          </label>

          <label className="block space-y-2">
            <span className="block text-xs uppercase tracking-[0.28em] text-gray-500">关键字</span>
            <input
              value={filters.keyword}
              onChange={(event) => setFilters((prev) => ({ ...prev, keyword: event.target.value }))}
              placeholder="搜索 action / scope / fields"
              className="field-control w-full px-3 py-2 text-sm"
            />
          </label>

          <label className="block space-y-2">
            <span className="block text-xs uppercase tracking-[0.28em] text-gray-500">数量</span>
            <select
              value={currentLimit}
              onChange={(event) => setFilters((prev) => ({ ...prev, limit: normalizeLogLimit(event.target.value) }))}
              className="field-control w-full px-3 py-2 text-sm"
            >
              {LOG_LIMIT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-end">
            <Button
              onClick={handleExportLogs}
              icon={Download}
              className="w-full lg:w-auto"
              disabled={logs.length === 0}
              title={logs.length === 0 ? '当前无可导出日志' : '导出当前视图日志'}
              aria-label="导出当前视图日志"
            >
              导出
            </Button>
          </div>
        </div>

        <div className="mt-4">
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 custom-scrollbar">
            {CHANNEL_OPTIONS.map((channel) => {
              const active = filters.channels.includes(channel);
              return (
                <button
                  key={channel}
                  type="button"
                  onClick={() => toggleChannel(channel)}
                  className={`shrink-0 border-b-2 px-2 py-1.5 text-[11px] font-semibold transition-colors ${active ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'}`}
                >
                  {channel}
                </button>
              );
            })}
          </div>
        </div>
      </GlassCard>

      <GlassCard className="logs-panel flex min-h-0 flex-1 flex-col overflow-hidden border-x border-[var(--border)] bg-[var(--surface)] p-0">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-quiet)] px-3 py-2 font-mono text-xs text-[var(--muted)] sm:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <Terminal size={12} />
            <span className="truncate">root@bot-server:~/logs/stream</span>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span>{logs.length} / {currentLimit} lines</span>
            <span>{isPaused ? 'paused' : 'live'}</span>
          </div>
        </div>

        <div className="grid grid-cols-[92px_52px_minmax(0,1fr)] gap-3 border-b border-[var(--border-subtle)] px-3 py-2 text-[10px] font-semibold uppercase text-[var(--muted)] sm:px-4 md:grid-cols-[170px_64px_76px_minmax(180px,220px)_minmax(0,1fr)]">
          <span>Timestamp</span>
          <span>Level</span>
          <span className="hidden md:block">Channel</span>
          <span className="hidden md:block">Scope</span>
          <span>Message</span>
        </div>

        <div className="relative flex min-h-0 flex-1">
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="min-h-0 flex-1 overflow-y-auto p-3 pb-16 font-mono text-xs sm:p-4 sm:pb-16 sm:text-sm space-y-1 custom-scrollbar"
          >
            {logs.length === 0 && (
              <div className="mt-10 text-center italic text-[var(--muted)]">等待日志数据...</div>
            )}
            {logs.map((log, index) => (
              <div
                key={`${log.timestamp}-${log.channel}-${log.action}-${index}`}
                data-log-row
                className="grid grid-cols-[92px_52px_minmax(0,1fr)] items-start gap-3 rounded px-2 py-1.5 hover:bg-[var(--surface-hover)] md:grid-cols-[170px_64px_76px_minmax(180px,220px)_minmax(0,1fr)]"
              >
                <span className="text-gray-500 whitespace-nowrap truncate">{log.timestampText}</span>
                <span className={`inline-flex w-fit border-l pl-2 text-[10px] font-bold uppercase tracking-[0.18em] ${getLevelBadgeClass(log.level)}`}>
                  {log.level}
                </span>
                <span className="hidden text-sky-200 md:block">{log.channel || '-'}</span>
                <span className="hidden text-gray-500 break-all md:block">{log.scope || '-'}</span>
                <span className="text-gray-300 whitespace-pre-wrap break-all leading-relaxed">
                  {getLogMessageText(log)}
                </span>
              </div>
            ))}
          </div>

          {floatingButtonMode && (
            <button
              type="button"
              onClick={floatingButtonMode === 'top' ? jumpToTop : jumpToBottom}
              className="absolute bottom-4 right-3 z-10 inline-flex items-center gap-2 rounded-lg border border-[var(--border-muted)] bg-[var(--surface-raised)] px-3 py-2 text-xs font-semibold text-[var(--accent-muted)] shadow-[var(--shadow-floating)] transition-colors hover:bg-[var(--surface-hover)] sm:right-4"
              title={floatingButtonMode === 'top' ? '回顶部' : '去底部'}
              aria-label={floatingButtonMode === 'top' ? '回顶部' : '去底部'}
            >
              {floatingButtonMode === 'top' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
              <span className="hidden sm:inline">{floatingButtonMode === 'top' ? '回顶部' : '去底部'}</span>
            </button>
          )}
        </div>

      </GlassCard>
    </div>
  );
};

export default Logs;
