import React, { useState, useEffect, useRef } from 'react';
import GlassCard from '../components/GlassCard';
import { Terminal, Pause, Play, Trash2 } from 'lucide-react';
import { getToken } from '../utils/auth';

const Logs = () => {
  const [logs, setLogs] = useState([]);
  const [isPaused, setIsPaused] = useState(false);
  const logsEndRef = useRef(null);
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const isPausedRef = useRef(isPaused);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    const token = getToken();
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws/logs?token=${token}`;

    const connect = () => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      const addLog = (log) => {
        setLogs(prev => {
          const newLogs = [...prev, log];
          if (newLogs.length > 1000) return newLogs.slice(-1000);
          return newLogs;
        });
      };

      ws.onopen = () => {
        addLog({ level: 'INFO', message: '已连接到日志流...', timestamp: new Date().toISOString() });
      };

      ws.onmessage = (event) => {
        if (isPausedRef.current) return;

        try {
          let data;
          try {
            data = JSON.parse(event.data);
          } catch {
            data = event.data;
          }

          let logEntry;
          if (typeof data === 'object' && data !== null) {
            logEntry = {
              level: data.level || 'INFO',
              message: data.message || JSON.stringify(data),
              timestamp: data.timestamp || new Date().toISOString()
            };
          } else {
            const text = String(data);
            let level = 'INFO';
            if (text.match(/error|fail|exception/i)) level = 'ERROR';
            else if (text.match(/warn/i)) level = 'WARN';

            logEntry = {
              level,
              message: text,
              timestamp: new Date().toISOString()
            };
          }

          addLog(logEntry);
        } catch (e) {
          console.error('Error parsing log:', e);
        }
      };

      ws.onclose = () => {
        addLog({ level: 'WARN', message: '连接已断开，正在尝试重连...', timestamp: new Date().toISOString() });
        reconnectTimerRef.current = setTimeout(connect, 3000);
      };

      ws.onerror = (err) => {
        console.error("WebSocket error:", err);
        ws.close();
      };
    };

    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isPaused && logsEndRef.current) {
        // Use scrollIntoView with smooth behavior for nice effect, or auto for performance
        logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, isPaused]);

  const getLogColor = (level) => {
    const l = (level || '').toUpperCase();
    if (l.includes('ERROR') || l.includes('ERR')) return 'text-red-500';
    if (l.includes('WARN')) return 'text-yellow-400';
    if (l.includes('DEBUG')) return 'text-gray-500';
    return 'text-green-400';
  };

  return (
    <div className="px-4 md:px-6 pt-4 md:pt-6 flex flex-col space-y-4 pb-6 min-h-[calc(100vh-8rem)]">
      <header className="flex justify-between items-center flex-wrap gap-2">
        <div>
           <h1 className="text-2xl md:text-3xl font-bold text-white mb-2">系统日志</h1>
           <p className="text-sm md:text-base text-gray-400">实时监控系统运行状态</p>
        </div>
        <div className="flex gap-2">
            <button
                onClick={() => setLogs([])}
                className="p-2 hover:bg-white/10 rounded-lg text-gray-300 transition-colors"
                title="清空日志"
            >
                <Trash2 size={20} />
            </button>
            <button
                onClick={() => setIsPaused(!isPaused)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${isPaused ? 'bg-yellow-500/20 text-yellow-400' : 'bg-white/10 text-white hover:bg-white/20'}`}
            >
                {isPaused ? <Play size={18} /> : <Pause size={18} />}
                {isPaused ? '继续' : '暂停'}
            </button>
        </div>
      </header>

      <GlassCard className="flex-1 overflow-hidden p-0 flex flex-col bg-[#0d1117] border-white/10">
        <div className="flex items-center gap-2 px-4 py-2 bg-white/5 border-b border-white/5 text-xs text-gray-500 font-mono">
            <Terminal size={12} />
            <span>root@bot-server:~/logs/stream</span>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-4 font-mono text-sm space-y-1 custom-scrollbar">
            {logs.length === 0 && (
                <div className="text-gray-600 italic text-center mt-10">等待日志数据...</div>
            )}
            {logs.map((log, i) => (
                <div key={i} className="break-all hover:bg-white/5 px-2 py-0.5 rounded flex items-start">
                    <span className="text-gray-600 mr-3 text-xs pt-0.5 shrink-0">
                        {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second:'2-digit' })}
                    </span>
                    <span className={`font-bold mr-3 w-14 shrink-0 text-xs pt-0.5 ${getLogColor(log.level)}`}>
                        {log.level || 'INFO'}
                    </span>
                    <span className="text-gray-300 whitespace-pre-wrap font-mono text-sm leading-relaxed">
                        {log.message}
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
