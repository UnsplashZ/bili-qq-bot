import React, { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Cpu, HardDrive, Network, Clock } from 'lucide-react';
import GlassCard from '../components/GlassCard';
import { formatBytes, formatUptime, formatNetSpeed } from '../utils/format';
import api from '../utils/auth';

const Dashboard = () => {
  const [stats, setStats] = useState(null);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await api.get('/api/monitor');
        const data = response.data;

        setStats(data);
        setHistory(prev => {
          const newEntry = {
            time: new Date().toLocaleTimeString(),
            cpu: data.cpu,
            memory: data.memory.used,
            memoryFormatted: formatBytes(data.memory.used) // For tooltip
          };
          const newHistory = [...prev, newEntry];
          return newHistory.slice(-60); // Keep last 60 items
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
    <div className="p-0 md:p-6 space-y-4 md:space-y-6">
      <h1 className="text-2xl md:text-3xl font-bold text-white mb-4 md:mb-8">系统监控</h1>

      {/* Summary Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 md:gap-6">
        <GlassCard className="p-4 md:p-6 flex items-center gap-3 md:gap-4">
          <div className="p-2.5 md:p-3 bg-blue-500/20 rounded-lg">
            <Cpu className="w-6 h-6 md:w-8 md:h-8 text-blue-400" />
          </div>
          <div className="min-w-0">
            <p className="text-gray-400 text-sm truncate">CPU 负载</p>
            <p className="text-xl md:text-2xl font-bold text-white truncate">{stats.cpu.toFixed(1)}%</p>
          </div>
        </GlassCard>

        <GlassCard className="p-4 md:p-6 flex items-center gap-3 md:gap-4">
          <div className="p-2.5 md:p-3 bg-purple-500/20 rounded-lg">
            <HardDrive className="w-6 h-6 md:w-8 md:h-8 text-purple-400" />
          </div>
          <div className="min-w-0">
            <p className="text-gray-400 text-sm truncate">内存使用</p>
            <p className="text-xl md:text-2xl font-bold text-white truncate">
              {formatBytes(stats.memory.used)}
            </p>
            <p className="text-sm text-gray-500">
              / {formatBytes(stats.memory.total)}
            </p>
          </div>
        </GlassCard>

        <GlassCard className="p-4 md:p-6 flex items-center gap-3 md:gap-4">
          <div className="p-2.5 md:p-3 bg-green-500/20 rounded-lg">
            <Network className="w-6 h-6 md:w-8 md:h-8 text-green-400" />
          </div>
          <div className="min-w-0">
            <p className="text-gray-400 text-sm truncate">网络流量 (上/下)</p>
            <div className="text-white">
              <span className="text-base md:text-lg font-bold whitespace-nowrap">↑ {formatNetSpeed(stats.network.up)}</span>
              <br />
              <span className="text-base md:text-lg font-bold whitespace-nowrap">↓ {formatNetSpeed(stats.network.down)}</span>
            </div>
          </div>
        </GlassCard>

        <GlassCard className="p-4 md:p-6 flex items-center gap-3 md:gap-4">
          <div className="p-2.5 md:p-3 bg-orange-500/20 rounded-lg">
            <Clock className="w-6 h-6 md:w-8 md:h-8 text-orange-400" />
          </div>
          <div className="min-w-0">
            <p className="text-gray-400 text-sm truncate">运行时间</p>
            <p className="text-lg md:text-xl font-bold text-white truncate">{formatUptime(stats.uptime)}</p>
          </div>
        </GlassCard>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 mt-4 md:mt-6">
        <GlassCard className="p-4 md:p-6">
          <h3 className="text-lg md:text-xl font-semibold text-white mb-3 md:mb-4">CPU 历史趋势</h3>
          <div className="h-56 md:h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history}>
                <defs>
                  <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                <XAxis dataKey="time" stroke="#9ca3af" fontSize={12} tick={{fill: '#9ca3af'}} />
                <YAxis domain={[0, 100]} stroke="#9ca3af" fontSize={12} tick={{fill: '#9ca3af'}} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1f2937', borderColor: '#374151', color: '#fff' }}
                  itemStyle={{ color: '#fff' }}
                />
                <Area
                  type="monotone"
                  dataKey="cpu"
                  stroke="#3b82f6"
                  fillOpacity={1}
                  fill="url(#colorCpu)"
                  name="CPU %"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </GlassCard>

        <GlassCard className="p-4 md:p-6">
          <h3 className="text-lg md:text-xl font-semibold text-white mb-3 md:mb-4">内存历史趋势</h3>
          <div className="h-56 md:h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history}>
                <defs>
                  <linearGradient id="colorMemory" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#a855f7" stopOpacity={0.8}/>
                    <stop offset="95%" stopColor="#a855f7" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                <XAxis dataKey="time" stroke="#9ca3af" fontSize={12} tick={{fill: '#9ca3af'}} />
                <YAxis stroke="#9ca3af" fontSize={12} tickFormatter={(value) => formatBytes(value, 0)} tick={{fill: '#9ca3af'}} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1f2937', borderColor: '#374151', color: '#fff' }}
                  itemStyle={{ color: '#fff' }}
                  formatter={(value) => [formatBytes(value), 'Memory']}
                />
                <Area
                  type="monotone"
                  dataKey="memory"
                  stroke="#a855f7"
                  fillOpacity={1}
                  fill="url(#colorMemory)"
                  name="Memory"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </GlassCard>
      </div>
    </div>
  );
};

export default Dashboard;
