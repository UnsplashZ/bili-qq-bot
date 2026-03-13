import { useEffect, useRef, useState } from 'react';
import api, { getToken } from '../../utils/auth';

const MAX_LOGS = 1000;

function formatTimestamp(timestamp) {
  const value = timestamp ? new Date(timestamp) : new Date();
  const pad = (input) => String(input).padStart(2, '0');
  return `${value.getFullYear()}/${pad(value.getMonth() + 1)}/${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}

function normalizeLogEntry(entry) {
  if (entry && typeof entry === 'object') {
    const timestamp = entry.timestamp ? new Date(entry.timestamp).toISOString() : new Date().toISOString();
    return {
      timestamp,
      timestampText: entry.timestampText || formatTimestamp(timestamp),
      level: String(entry.level || 'info').toUpperCase(),
      channel: entry.channel || '',
      scope: entry.scope || '',
      action: entry.action || '',
      fields: entry.fields || {},
      rendered: entry.rendered || entry.message || JSON.stringify(entry),
      message: entry.message || entry.rendered || JSON.stringify(entry),
    };
  }

  const text = String(entry || '');
  let level = 'INFO';
  if (/fatal/i.test(text)) level = 'FTL';
  else if (/error|fail|exception/i.test(text)) level = 'ERR';
  else if (/warn/i.test(text)) level = 'WRN';
  else if (/debug/i.test(text)) level = 'DBG';

  const timestamp = new Date().toISOString();
  return {
    timestamp,
    timestampText: formatTimestamp(timestamp),
    level,
    channel: '',
    scope: '',
    action: '',
    fields: {},
    rendered: text,
    message: text,
  };
}

function appendWithLimit(prev, nextItems) {
  const merged = [...prev, ...nextItems];
  if (merged.length > MAX_LOGS) {
    return merged.slice(-MAX_LOGS);
  }
  return merged;
}

function buildRecentParams(filters) {
  const params = {};
  if (filters.level) params.level = filters.level;
  if (filters.channels?.length) params.channels = filters.channels.join(',');
  if (filters.keyword?.trim()) params.keyword = filters.keyword.trim();
  params.limit = MAX_LOGS;
  return params;
}

function buildWsUrl(filters) {
  const token = getToken();
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  const params = new URLSearchParams({ token });
  if (filters.level) params.set('level', filters.level);
  if (filters.channels?.length) params.set('channels', filters.channels.join(','));
  if (filters.keyword?.trim()) params.set('keyword', filters.keyword.trim());
  return `${protocol}//${host}/ws/logs?${params.toString()}`;
}

export function useLogsStream(filters, isPaused) {
  const [logs, setLogs] = useState([]);
  const [connectionState, setConnectionState] = useState('connecting');
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const pausedRef = useRef(isPaused);
  const pendingLogsRef = useRef([]);

  useEffect(() => {
    pausedRef.current = isPaused;
    if (!isPaused && pendingLogsRef.current.length > 0) {
      setLogs((prev) => appendWithLimit(prev, pendingLogsRef.current.splice(0)));
    }
  }, [isPaused]);

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      try {
        const response = await api.get('/api/logs/recent', {
          params: buildRecentParams(filters),
        });
        if (cancelled) return;
        const history = Array.isArray(response.data?.logs)
          ? response.data.logs.map(normalizeLogEntry)
          : [];
        setLogs(history);
      } catch (error) {
        if (cancelled) return;
        setLogs((prev) =>
          appendWithLimit(prev, [{
            timestamp: new Date().toISOString(),
            timestampText: formatTimestamp(),
            level: 'ERR',
            channel: 'DASH',
            scope: 'ui:logs',
            action: 'history-load-failed',
            fields: {},
            rendered: `history-load-failed error=${error?.message || 'unknown'}`,
            message: `history-load-failed error=${error?.message || 'unknown'}`,
          }])
        );
      }
    }

    loadHistory();

    return () => {
      cancelled = true;
    };
  }, [filters]);

  useEffect(() => {
    const wsUrl = buildWsUrl(filters);

    function connect() {
      setConnectionState('connecting');
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnectionState('open');
      };

      ws.onmessage = (event) => {
        let nextEntry;
        try {
          const payload = JSON.parse(event.data);
          nextEntry = normalizeLogEntry(payload);
        } catch {
          nextEntry = normalizeLogEntry(event.data);
        }

        if (pausedRef.current) {
          pendingLogsRef.current.push(nextEntry);
          if (pendingLogsRef.current.length > MAX_LOGS) {
            pendingLogsRef.current.splice(0, pendingLogsRef.current.length - MAX_LOGS);
          }
          return;
        }

        setLogs((prev) => appendWithLimit(prev, [nextEntry]));
      };

      ws.onclose = () => {
        setConnectionState('closed');
        reconnectTimerRef.current = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        setConnectionState('error');
        ws.close();
      };
    }

    connect();

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [filters]);

  return {
    connectionState,
    logs,
    clearLogs() {
      pendingLogsRef.current = [];
      setLogs([]);
    },
  };
}
