import { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import api from '../utils/auth';
import GlassCard from '../components/GlassCard';
import GlassModal from '../components/GlassModal';
import AiConfigSection from '../components/AiConfigSection';
import { useToast } from '../hooks/useToast';
import { Save, Server, Plus, Trash2, Power, Cpu, Activity, AlertTriangle, X, Terminal, Shield, Settings as SettingsIcon, Clock, MessageSquare, Edit } from 'lucide-react';

const GENERAL_CONFIG_DEFAULTS = {
    subscriptionCheckInterval: 300,
};

function extractGeneralConfig(source) {
    const result = {};
    for (const [key, def] of Object.entries(GENERAL_CONFIG_DEFAULTS)) {
        result[key] = source[key] ?? def;
    }
    return result;
}

const Settings = () => {
  const [loading, setLoading] = useState(true);
  const { show } = useToast();

  // Modal States
  const [isRestartModalOpen, setIsRestartModalOpen] = useState(false);
  const [mcpToRemove, setMcpToRemove] = useState(null); // Index of server to remove

  // General Settings State
  const [generalConfig, setGeneralConfig] = useState({
    subscriptionCheckInterval: 300
  });
  const [savingGeneral, setSavingGeneral] = useState(false);

  // Global Blacklist State
  const [blacklist, setBlacklist] = useState([]);
  const [newBlacklistQQ, setNewBlacklistQQ] = useState('');
  const [addingBlacklist, setAddingBlacklist] = useState(false);

  // AI State
  const [aiConfig, setAiConfig] = useState({
    aiProbability: 0,
    aiContextLimit: 0,
    aiTemperature: 1.0,
    aiHistoryMaxSize: 0,
    aiEnableVectorCache: false,
    aiVectorSimilarityThreshold: 0.4,
    aiVectorSearchLimit: 3,
    aiMemorySafetyLimit: 5000,
    // Chat Service
    aiChatApiUrl: '',
    aiChatApiKey: '',
    aiChatModel: 'gpt-3.5-turbo',
    aiChatProxy: '',
    aiChatSystemPrompt: '你是一个有用的助手',
    // Embedding Service
    aiEmbeddingApiUrl: '',
    aiEmbeddingApiKey: '',
    aiEmbeddingModel: 'text-embedding-3-small',
    aiEmbeddingProxy: '',
    // AI Toggles
    aiEnabled: true,
    aiRagEnabled: true
  });
  const [savingAi, setSavingAi] = useState(false);
  const [resettingAi, setResettingAi] = useState(false);

  // MCP State
  const [mcpConfig, setMcpConfig] = useState({ mcpServers: [] });
  const [savingMcp, setSavingMcp] = useState(false);
  const [isAddMcpModalOpen, setIsAddMcpModalOpen] = useState(false);
  const [newMcp, setNewMcp] = useState({
    name: '',
    type: 'stdio',
    url: '',
    command: '',
    args: '',
    env: '{}'
  });
  const [editingMcpIndex, setEditingMcpIndex] = useState(null);
  const [isEditMcpModalOpen, setIsEditMcpModalOpen] = useState(false);
  const [editMcp, setEditMcp] = useState({
    name: '',
    type: 'stdio',
    url: '',
    command: '',
    args: '',
    env: '{}'
  });
  const [mcpVersion, setMcpVersion] = useState(0);

  // B站全局Cookie状态
  const [biliGlobalStatus, setBiliGlobalStatus] = useState({
    isLoggedIn: false,
    uid: null,
    username: '',
    timestamp: null
  });
  const [biliLoading, setBiliLoading] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [qrPollInterval, setQrPollInterval] = useState(null);

  // Fetch Data
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [configRes, mcpRes, blacklistRes, biliStatusRes] = await Promise.all([
          api.get('/api/config'),
          api.get('/api/mcp'),
          api.get('/api/blacklist/global'),
          api.get('/api/bili/global-status')
        ]);

        // Setup General Config
        setGeneralConfig(extractGeneralConfig(configRes.data));

        // Setup AI Config
        const {
          aiProbability,
          aiContextLimit,
          aiTemperature,
          aiHistoryMaxSize,
          aiEnableVectorCache,
          aiVectorSimilarityThreshold,
          aiVectorSearchLimit,
          aiMemorySafetyLimit,
          aiChatApiUrl,
          aiChatApiKey,
          aiChatModel,
          aiChatProxy,
          aiChatSystemPrompt,
          aiEmbeddingApiUrl,
          aiEmbeddingApiKey,
          aiEmbeddingModel,
          aiEmbeddingProxy,
          aiEnabled,
          aiRagEnabled
        } = configRes.data;

        setAiConfig({
            aiProbability: aiProbability ?? 0.1,
            aiContextLimit: aiContextLimit ?? 10,
            aiTemperature: aiTemperature ?? 1.0,
            aiHistoryMaxSize: aiHistoryMaxSize ?? (200 * 1024 * 1024),
            aiEnableVectorCache: aiEnableVectorCache ?? true,
            aiVectorSimilarityThreshold: aiVectorSimilarityThreshold ?? 0.4,
            aiVectorSearchLimit: aiVectorSearchLimit ?? 3,
            aiMemorySafetyLimit: aiMemorySafetyLimit ?? 5000,
            // Chat Service
            aiChatApiUrl: aiChatApiUrl || '',
            aiChatApiKey: aiChatApiKey || '',
            // AI Toggles
            aiEnabled: aiEnabled ?? true,
            aiRagEnabled: aiRagEnabled ?? true,
            aiChatModel: aiChatModel || 'gpt-3.5-turbo',
            aiChatProxy: aiChatProxy || '',
            aiChatSystemPrompt: aiChatSystemPrompt || '你是一个有用的助手',
            // Embedding Service
            aiEmbeddingApiUrl: aiEmbeddingApiUrl || '',
            aiEmbeddingApiKey: aiEmbeddingApiKey || '',
            aiEmbeddingModel: aiEmbeddingModel || 'text-embedding-3-small',
            aiEmbeddingProxy: aiEmbeddingProxy || ''
        });

        // Setup Blacklist
        setBlacklist(blacklistRes.data || []);

        // Setup MCP Config
        const servers = mcpRes.data.mcpServers || (Array.isArray(mcpRes.data) ? mcpRes.data : []);
        setMcpConfig({ mcpServers: servers });

        // Save version for concurrent control
        if (mcpRes.data.version !== undefined) {
            setMcpVersion(mcpRes.data.version);
        }

        // 设置B站全局状态
        if (biliStatusRes.data.isLoggedIn) {
          setBiliGlobalStatus({
            isLoggedIn: true,
            uid: biliStatusRes.data.uid,
            username: biliStatusRes.data.username,
            timestamp: biliStatusRes.data.timestamp
          });
        } else {
          setBiliGlobalStatus({
            isLoggedIn: false,
            uid: null,
            username: '',
            timestamp: null
          });
        }

      } catch (error) {
        console.error("Failed to load settings:", error);
        show("加载设置失败", "error");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [show]);

  // General Settings Handlers
  const handleGeneralChange = (field, value) => {
    setGeneralConfig(prev => ({ ...prev, [field]: value }));
  };

  const saveGeneralSettings = async () => {
    setSavingGeneral(true);
    try {
      await api.post('/api/config', generalConfig);
      // Re-fetch to confirm persisted state
      const { data: freshConfig } = await api.get('/api/config');
      setGeneralConfig(extractGeneralConfig(freshConfig));
      show("常规设置已保存！", "success");
    } catch (error) {
      console.error("Failed to save general settings:", error);
      const errorMsg = error.response?.data?.error || '保存常规设置失败';
      show(errorMsg, "error");
    } finally {
      setSavingGeneral(false);
    }
  };

  // Blacklist Handlers
  const handleAddBlacklist = async () => {
    if (!newBlacklistQQ) return;
    setAddingBlacklist(true);
    try {
        await api.post('/api/blacklist/global', { qq: newBlacklistQQ });
        // Optimistically update or refetch? The API returns the new list.
        // Let's rely on API return or manual update
        setBlacklist(prev => [...prev, newBlacklistQQ]); // Optimistic-ish, though we should parse number if API does
        setNewBlacklistQQ('');
        show("已添加至黑名单", "success");

        // Refresh list to be sure (optional)
        const res = await api.get('/api/blacklist/global');
        setBlacklist(res.data);
    } catch (error) {
        console.error("Failed to add to blacklist:", error);
        show("添加黑名单失败", "error");
    } finally {
        setAddingBlacklist(false);
    }
  };

  const handleRemoveBlacklist = async (qq) => {
    try {
        await api.delete(`/api/blacklist/global/${qq}`);
        setBlacklist(prev => prev.filter(item => String(item) !== String(qq)));
        show("已从黑名单移除", "success");
    } catch (error) {
        console.error("Failed to remove from blacklist:", error);
        show("移除黑名单失败", "error");
    }
  };

  // AI Handlers
  const handleAiChange = (field, value) => {
    setAiConfig(prev => ({ ...prev, [field]: value }));
  };

  const handleGlobalAiToggle = async (field, value) => {
    try {
      await api.post('/api/config', { [field]: value });
      setAiConfig(prev => ({ ...prev, [field]: value }));
      show('全局AI配置已更新', 'success');
    } catch (error) {
      console.error('Failed to update global AI config:', error);
      show('更新全局AI配置失败', 'error');
    }
  };

  const saveAiSettings = async () => {
    setSavingAi(true);
    try {
      await api.post('/api/ai', aiConfig);
      show("AI 设置已保存！", "success");
    } catch (error) {
      console.error("Failed to save AI settings:", error);
      // Extract detailed error message from API response
      const errorMsg = error.response?.data?.error || error.response?.data?.details || '保存 AI 设置失败';
      const field = error.response?.data?.field;
      const expected = error.response?.data?.expected;

      // Show detailed error if available
      if (field && expected) {
        show(`${errorMsg} (${field}: ${expected})`, "error");
      } else {
        show(errorMsg, "error");
      }
    } finally {
      setSavingAi(false);
    }
  };

  const resetAiSettings = async () => {
    if (!window.confirm("确定要重置 AI 设置为默认值 (.env) 吗？此操作将覆盖当前的自定义设置。")) {
        return;
    }
    setResettingAi(true);
    try {
        const res = await api.post('/api/ai/reset');
        // Update local state with the returned config (which contains defaults)
        const newConfig = res.data.config;

        setAiConfig(prev => ({
            ...prev,
            aiProbability: newConfig.aiProbability ?? 0.1,
            aiContextLimit: newConfig.aiContextLimit ?? 10,
            aiTemperature: newConfig.aiTemperature ?? 1.0,
            aiHistoryMaxSize: newConfig.aiHistoryMaxSize ?? 200 * 1024 * 1024,
            aiEnableVectorCache: newConfig.aiEnableVectorCache ?? true,
            aiVectorSimilarityThreshold: newConfig.aiVectorSimilarityThreshold ?? 0.4,
            aiVectorSearchLimit: newConfig.aiVectorSearchLimit ?? 3,
            aiMemorySafetyLimit: newConfig.aiMemorySafetyLimit ?? 5000,
            // Chat Service
            aiChatApiUrl: newConfig.aiChatApiUrl || '',
            aiChatApiKey: newConfig.aiChatApiKey || '',
            aiChatModel: newConfig.aiChatModel || 'gpt-3.5-turbo',
            aiChatProxy: newConfig.aiChatProxy || '',
            aiChatSystemPrompt: newConfig.aiChatSystemPrompt || '你是一个有用的助手',
            // Embedding Service
            aiEmbeddingApiUrl: newConfig.aiEmbeddingApiUrl || '',
            aiEmbeddingApiKey: newConfig.aiEmbeddingApiKey || '',
            aiEmbeddingModel: newConfig.aiEmbeddingModel || 'text-embedding-3-small',
            aiEmbeddingProxy: newConfig.aiEmbeddingProxy || ''
        }));

        show("AI 设置已重置为默认值", "success");
    } catch (error) {
        console.error("Failed to reset AI settings:", error);
        show("重置 AI 设置失败", "error");
    } finally {
        setResettingAi(false);
    }
  };

  // MCP Handlers
  const handleAddMcp = async () => {
    try {
      const selectedType = newMcp.type || 'stdio';
      if (selectedType !== 'stdio' && !newMcp.url.trim()) {
        show("URL 不能为空", "error");
        return;
      }

      let env = {};
      if (selectedType === 'stdio') {
        try {
          env = JSON.parse(newMcp.env);
        } catch {
          show("环境变量 JSON 格式无效", "error");
          return;
        }
      }

      const args = selectedType === 'stdio'
        ? newMcp.args.split(',').map(s => s.trim()).filter(Boolean)
        : [];

      const newServer = {
        name: newMcp.name,
        type: selectedType,
        url: selectedType === 'stdio' ? '' : newMcp.url.trim(),
        command: selectedType === 'stdio' ? newMcp.command : '',
        args,
        env: selectedType === 'stdio' ? env : {},
        enabled: true
      };

      const updatedServers = [...mcpConfig.mcpServers, newServer];

      // Optimistic update
      setMcpConfig({ mcpServers: updatedServers });
      setIsAddMcpModalOpen(false);
      setNewMcp({ name: '', type: 'stdio', url: '', command: '', args: '', env: '{}' });

      // Save to backend
      setSavingMcp(true);
      const response = await api.post('/api/mcp', { mcpServers: updatedServers, version: mcpVersion });

      // Handle conflict
      if (response.data.conflict) {
          show('配置已被其他用户修改，请刷新后重试', 'error');
          return;
      }

      // Handle reload failure warning
      if (!response.data.reloadSuccess) {
          show(response.data.warning || '配置已保存但服务可能未更新', 'warning');
      } else {
          show("MCP 服务器已添加并生效", "success");
      }

      // Update version
      if (response.data.version !== undefined) {
          setMcpVersion(response.data.version);
      }

    } catch (error) {
      console.error("Failed to add MCP server:", error);
      show("添加 MCP 服务器失败", "error");
      // Could revert here if needed
    } finally {
        setSavingMcp(false);
    }
  };

  const removeMcpServer = (index) => {
    setMcpToRemove(index);
  };

  const confirmRemoveMcp = async () => {
    if (mcpToRemove === null) return;

    const index = mcpToRemove;
    const updatedServers = mcpConfig.mcpServers.filter((_, i) => i !== index);
    setMcpConfig({ mcpServers: updatedServers });
    setMcpToRemove(null);

    try {
        setSavingMcp(true);
        const response = await api.post('/api/mcp', { mcpServers: updatedServers, version: mcpVersion });

        // Handle conflict
        if (response.data.conflict) {
            show('配置已被其他用户修改，请刷新后重试', 'error');
            return;
        }

        // Handle reload failure warning
        if (!response.data.reloadSuccess) {
            show(response.data.warning || '配置已保存但服务可能未更新', 'warning');
        } else {
            show("MCP 服务器已移除", "success");
        }

        // Update version
        if (response.data.version !== undefined) {
            setMcpVersion(response.data.version);
        }
    } catch (error) {
        if (error.response?.status === 409) {
            show('配置已被其他用户修改，请刷新后重试', 'error');
            return;
        }
        console.error("Failed to remove MCP server:", error);
        show("保存更改失败", "error");
    } finally {
        setSavingMcp(false);
    }
  };

  const toggleMcpServer = async (index) => {
    const updatedServers = [...mcpConfig.mcpServers];
    const previousEnabled = updatedServers[index].enabled;
    updatedServers[index].enabled = !previousEnabled;
    setMcpConfig({ mcpServers: updatedServers });

    try {
        setSavingMcp(true);
        const response = await api.post('/api/mcp', { mcpServers: updatedServers, version: mcpVersion });

        if (!response.data.reloadSuccess) {
            show(response.data.warning || '配置已保存但服务可能未更新', 'warning');
        } else {
            show(updatedServers[index].enabled ? '已启用 MCP 服务器' : '已禁用 MCP 服务器', 'success');
        }

        if (response.data.version !== undefined) {
            setMcpVersion(response.data.version);
        }
    } catch (error) {
        if (error.response?.status === 409) {
            show('配置已被其他用户修改，请刷新后重试', 'error');
            try {
                const res = await api.get('/api/mcp');
                const servers = res.data.mcpServers || (Array.isArray(res.data) ? res.data : []);
                setMcpConfig({ mcpServers: servers });
                if (res.data.version !== undefined) {
                    setMcpVersion(res.data.version);
                }
            } catch (fetchError) {
                console.error('Failed to refresh MCP config:', fetchError);
            }
            return;
        }
        console.error("Failed to toggle MCP server:", error);
        const revertedServers = [...updatedServers];
        revertedServers[index].enabled = previousEnabled;
        setMcpConfig({ mcpServers: revertedServers });
        show('切换 MCP 服务器失败', 'error');
    } finally {
        setSavingMcp(false);
    }
  };

  const openEditMcpModal = (index) => {
    const server = mcpConfig.mcpServers[index];
    setEditingMcpIndex(index);
    setEditMcp({
        name: server.name,
        type: server.type || 'stdio',
        url: server.url || '',
        command: server.command,
        args: server.args?.join(', ') || '',
        env: JSON.stringify(server.env || {}, null, 2)
    });
    setIsEditMcpModalOpen(true);
  };

  const handleEditMcp = async () => {
    try {
        const oldName = mcpConfig.mcpServers[editingMcpIndex].name;
        const newName = editMcp.name.trim();
        const selectedType = editMcp.type || 'stdio';

        if (selectedType !== 'stdio' && !editMcp.url.trim()) {
            show('URL 不能为空', 'error');
            return;
        }

        // Frontend validation: name cannot be empty
        if (!newName) {
            show('服务器名称不能为空', 'error');
            return;
        }

        // Frontend validation: name format
        if (!/^[a-zA-Z0-9_-]+$/.test(newName)) {
            show('服务器名称只能包含字母、数字、下划线和短横线', 'error');
            return;
        }

        // Frontend validation: environment variables JSON
        let env = {};
        if (selectedType === 'stdio') {
            try {
                env = JSON.parse(editMcp.env);
            } catch {
                show('环境变量 JSON 格式无效', 'error');
                return;
            }
        }

        const args = selectedType === 'stdio'
            ? editMcp.args.split(',').map(s => s.trim()).filter(Boolean)
            : [];

        const updatedServers = [...mcpConfig.mcpServers];
        updatedServers[editingMcpIndex] = {
            ...updatedServers[editingMcpIndex],
            name: newName,
            type: selectedType,
            url: selectedType === 'stdio' ? '' : editMcp.url.trim(),
            command: selectedType === 'stdio' ? editMcp.command : '',
            args: selectedType === 'stdio' ? args : [],
            env: selectedType === 'stdio' ? env : {},
            enabled: updatedServers[editingMcpIndex].enabled
        };

        // Detect rename
        const isRename = oldName !== newName;

        // Optimistic update
        setMcpConfig({ mcpServers: updatedServers });
        setIsEditMcpModalOpen(false);
        setEditMcp({ name: '', type: 'stdio', url: '', command: '', args: '', env: '{}' });
        setEditingMcpIndex(null);

        // Save to backend with version control
        setSavingMcp(true);
        const response = await api.post('/api/mcp', {
            mcpServers: updatedServers,
            version: mcpVersion,
            renameOperation: isRename ? { from: oldName, to: newName } : undefined
        });

        // Handle conflict
        if (response.data.conflict) {
            show('配置已被其他用户修改，请刷新后重试', 'error');
            return;
        }

        // Handle reload failure warning
        if (!response.data.reloadSuccess) {
            show(response.data.warning || '配置已保存但服务可能未更新', 'warning');
        } else {
            show("MCP 服务器已更新并生效", "success");
        }

        // Update version
        if (response.data.version !== undefined) {
            setMcpVersion(response.data.version);
        }

    } catch (error) {
        if (error.response?.status === 409) {
            show('配置已被其他用户修改，请刷新后重试', 'error');
            return;
        }
        if (error.response?.status === 400) {
            const errorMsg = error.response.data?.error || '更新失败';
            if (error.response.data.details && Array.isArray(error.response.data.details)) {
                show(`${errorMsg}: ${error.response.data.details[0]}`, 'error');
            } else {
                show(errorMsg, 'error');
            }
            return;
        }
        console.error("Failed to update MCP server:", error);
        show("更新 MCP 服务器失败", "error");
    } finally {
        setSavingMcp(false);
    }
  };

  // B站全局Cookie Handlers
  const handleBiliGlobalLogin = async () => {
    setBiliLoading(true);
    try {
      // 获取二维码 (不传groupId)
      const res = await api.get('/api/bili/login-url');

      // 检查返回状态
      if (res.data && res.data.status === 'error') {
        show(`获取登录二维码失败: ${res.data.message || '未知错误'}`, 'error');
        setBiliLoading(false);
        return;
      }

      if (res.data && res.data.data && res.data.data.url) {
        const qrDataUrl = await QRCode.toDataURL(res.data.data.url);
        setQrCodeUrl(qrDataUrl);
        setIsQrModalOpen(true);

        // 开始轮询登录状态
        startQrPolling(res.data.data.key);
      } else {
        show('获取登录二维码失败: 响应格式错误', 'error');
        setBiliLoading(false);
      }
    } catch (error) {
      console.error('Failed to get QR code:', error);
      show('获取二维码失败', 'error');
      setBiliLoading(false);
    }
  };

  const startQrPolling = (key) => {
    let attempts = 0;
    const maxAttempts = 30; // 60秒超时 (2秒间隔)

    const interval = setInterval(async () => {
      attempts++;

      if (attempts > maxAttempts) {
        clearInterval(interval);
        setIsQrModalOpen(false);
        setBiliLoading(false);
        show('登录超时，请重试', 'error');
        return;
      }

      try {
        const statusRes = await api.post('/api/bili/check-login', {
          key
          // 不传groupId，表示全局登录
        });

        if (statusRes.data.status === 'success') {
          clearInterval(interval);
          setIsQrModalOpen(false);
          setBiliLoading(false);
          show('B站全局登录成功！', 'success');

          // 刷新登录状态
          const newStatus = await api.get('/api/bili/global-status?refresh=1');
          if (newStatus.data.isLoggedIn) {
            setBiliGlobalStatus({
              isLoggedIn: true,
              uid: newStatus.data.uid,
              username: newStatus.data.username,
              timestamp: newStatus.data.timestamp
            });
          } else {
            setBiliGlobalStatus({
              isLoggedIn: false,
              uid: null,
              username: '',
              timestamp: null
            });
            show(newStatus.data.message || '登录状态获取失败', 'error');
          }
        } else if (statusRes.data.status === 'expired') {
          clearInterval(interval);
          setBiliLoading(false);
          show('二维码已过期', 'error');
          setIsQrModalOpen(false);
        }
      } catch (error) {
        clearInterval(interval);
        setBiliLoading(false);
        console.error('Login polling error:', error);
        setIsQrModalOpen(false);
        show('登录检查失败', 'error');
      }
    }, 2000);

    setQrPollInterval(interval);
  };

  const handleBiliGlobalLogout = async () => {
    if (!window.confirm('确定要退出全局B站登录吗？这将影响所有未单独登录的群组。')) {
      return;
    }

    setBiliLoading(true);
    try {
      await api.post('/api/bili/logout', {});  // 不传groupId表示退出全局登录
      setBiliGlobalStatus({
        isLoggedIn: false,
        uid: null,
        username: '',
        timestamp: null
      });
      show('已退出B站全局登录', 'success');
    } catch (error) {
      console.error('Failed to logout:', error);
      show('退出登录失败', 'error');
    } finally {
      setBiliLoading(false);
    }
  };

  // 清理轮询（组件卸载时）
  useEffect(() => {
    return () => {
      if (qrPollInterval) {
        clearInterval(qrPollInterval);
      }
    };
  }, [qrPollInterval]);

  // System Handlers
  const handleRestart = () => {
    setIsRestartModalOpen(true);
  };

  const confirmRestart = async () => {
    setIsRestartModalOpen(false);
    try {
      await api.post('/api/restart');
      show("系统重启已启动。", "success");
    } catch (error) {
      console.error("Failed to restart:", error);
      show("重启系统失败", "error");
    }
  };

  if (loading) {
    return <div className="text-white p-8 text-center">正在加载设置...</div>;
  }

  return (
    <div className="px-6 pt-6 space-y-8 pb-12">
      <header>
        <h1 className="text-3xl font-bold text-white mb-2">系统设置</h1>
        <p className="text-gray-400">管理全局 AI 配置、常规选项和系统扩展。</p>
      </header>

      {/* General Settings Section */}
      <section>
        <div className="flex items-center gap-2 mb-4">
            <SettingsIcon className="text-green-400" />
            <h2 className="text-xl font-semibold text-white">常规设置</h2>
        </div>
        <GlassCard>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                        <div className="flex items-center gap-2">
                            <Clock size={16} />
                            订阅检查间隔 (秒)
                        </div>
                    </label>
                    <input
                        type="number"
                        min="10"
                        value={generalConfig.subscriptionCheckInterval}
                        onChange={(e) => handleGeneralChange('subscriptionCheckInterval', parseInt(e.target.value) || 0)}
                        className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-green-500 focus:outline-none"
                    />
                    <p className="text-xs text-gray-500 mt-1">系统检查订阅更新的频率，建议不少于 60 秒。</p>
                </div>
            </div>

            <div className="mt-6 flex justify-end">
                <button
                    onClick={saveGeneralSettings}
                    disabled={savingGeneral}
                    className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-white font-medium transition-colors disabled:opacity-50"
                >
                    <Save size={18} />
                    {savingGeneral ? '保存中...' : '保存常规设置'}
                </button>
            </div>
        </GlassCard>
      </section>

      {/* B站全局Cookie Section */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <svg
            className="w-5 h-5 text-pink-400"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M17.813 4.653h.854c1.51.054 2.769.578 3.773 1.574 1.004.995 1.524 2.249 1.56 3.76v7.36c-.036 1.51-.556 2.769-1.56 3.773s-2.262 1.524-3.773 1.56H5.333c-1.51-.036-2.769-.556-3.773-1.56S.036 18.858 0 17.347v-7.36c.036-1.511.556-2.765 1.56-3.76 1.004-.996 2.262-1.52 3.773-1.574h.774l-1.174-1.12a1.234 1.234 0 0 1-.373-.906c0-.356.124-.658.373-.907l.027-.027c.267-.249.573-.373.92-.373.347 0 .653.124.92.373L9.653 4.44c.071.071.134.142.187.213h4.267a.836.836 0 0 1 .16-.213l2.853-2.747c.267-.249.573-.373.92-.373.347 0 .662.151.929.4.267.249.391.551.391.907 0 .355-.124.657-.373.906zM5.333 7.24c-.746.018-1.373.276-1.88.773-.506.498-.769 1.13-.786 1.894v7.52c.017.764.28 1.395.786 1.893.507.498 1.134.756 1.88.773h13.334c.746-.017 1.373-.275 1.88-.773.506-.498.769-1.129.786-1.893v-7.52c-.017-.765-.28-1.396-.786-1.894-.507-.497-1.134-.755-1.88-.773zM8 11.107c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c0-.373.129-.689.386-.947.258-.257.574-.386.947-.386zm8 0c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c.017-.391.15-.711.4-.96.249-.249.56-.373.933-.373z"/>
          </svg>
          <h2 className="text-xl font-semibold text-white">B站全局Cookie</h2>
        </div>
        <GlassCard>
          {biliGlobalStatus.isLoggedIn ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-green-400 animate-pulse" />
                  <div>
                    <p className="text-white font-medium">
                      {biliGlobalStatus.username}{' '}
                      <span className="text-gray-400">
                        (UID: {biliGlobalStatus.uid})
                      </span>
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      更新时间：{biliGlobalStatus.timestamp
                        ? new Date(biliGlobalStatus.timestamp * 1000).toLocaleString('zh-CN')
                        : '未知'
                      }
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleBiliGlobalLogout}
                    disabled={biliLoading}
                    className="px-3 py-1.5 bg-red-500/20 text-red-300 hover:bg-red-500/30 border border-red-500/30 rounded-lg text-sm transition-colors disabled:opacity-50"
                  >
                    退出登录
                  </button>
                  <button
                    onClick={handleBiliGlobalLogin}
                    disabled={biliLoading}
                    className="px-3 py-1.5 bg-pink-500/20 text-pink-300 hover:bg-pink-500/30 border border-pink-500/30 rounded-lg text-sm transition-colors disabled:opacity-50"
                  >
                    重新登录
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between bg-gray-500/10 border border-gray-500/20 rounded-lg p-4">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-gray-500" />
                <p className="text-gray-400">未登录</p>
              </div>
              <button
                onClick={handleBiliGlobalLogin}
                disabled={biliLoading}
                className="px-4 py-2 bg-pink-600 hover:bg-pink-500 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {biliLoading ? '加载中...' : '扫码登录'}
              </button>
            </div>
          )}
        </GlassCard>
      </section>

      {/* Global Blacklist Section */}
      <section>
        <div className="flex items-center gap-2 mb-4">
            <Shield className="text-red-400" />
            <h2 className="text-xl font-semibold text-white">全局黑名单</h2>
        </div>
        <GlassCard>
            <div className="mb-4">
                <p className="text-sm text-gray-400 mb-4">在此列表中的 QQ 号将无法触发机器人的任何指令。</p>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={newBlacklistQQ}
                        onChange={(e) => setNewBlacklistQQ(e.target.value)}
                        placeholder="输入 QQ 号"
                        className="flex-1 bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                        onKeyDown={(e) => e.key === 'Enter' && handleAddBlacklist()}
                    />
                    <button
                        onClick={handleAddBlacklist}
                        disabled={addingBlacklist || !newBlacklistQQ}
                        className="px-4 py-2 bg-red-600/20 text-red-300 border border-red-500/30 hover:bg-red-600/30 rounded-lg transition-colors disabled:opacity-50"
                    >
                        添加
                    </button>
                </div>
            </div>

            <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
                {blacklist.length === 0 ? (
                    <div className="text-center text-gray-500 py-4">黑名单为空</div>
                ) : (
                    <div className="flex flex-wrap gap-2">
                        {blacklist.map((qq) => (
                            <div key={qq} className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 px-3 py-1.5 rounded-full text-red-200">
                                <span>{qq}</span>
                                <button
                                    onClick={() => handleRemoveBlacklist(qq)}
                                    className="hover:text-white transition-colors"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </GlassCard>
      </section>

      {/* AI Settings Section */}
      <section>
        <div className="flex items-center gap-2 mb-4">
            <Cpu className="text-blue-400" />
            <h2 className="text-xl font-semibold text-white">AI 配置</h2>
        </div>
        <GlassCard>
            {/* Global AI Toggle Section */}
            <div className="mb-6 pb-6 border-b border-white/10">
                <h3 className="text-lg font-semibold text-white mb-4">全局AI功能</h3>
                <AiConfigSection
                    config={{
                        aiEnabled: aiConfig.aiEnabled,
                        aiRagEnabled: aiConfig.aiRagEnabled
                    }}
                    globalConfig={null}
                    onToggle={handleGlobalAiToggle}
                    onReset={null}
                    isGroup={false}
                />
            </div>

            <h3 className="text-lg font-semibold text-white mb-4">AI 参数设置</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                        响应概率 ({Math.round(aiConfig.aiProbability * 100)}%)
                    </label>
                    <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={aiConfig.aiProbability}
                        onChange={(e) => handleAiChange('aiProbability', parseFloat(e.target.value))}
                        className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                    />
                    <p className="text-xs text-gray-500 mt-1">AI 回复随机消息的概率。</p>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                        上下文限制 (对话轮数)
                    </label>
                    <input
                        type="number"
                        value={aiConfig.aiContextLimit}
                        onChange={(e) => handleAiChange('aiContextLimit', parseInt(e.target.value))}
                        className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
                    />
                    <p className="text-xs text-gray-500 mt-1">保留在上下文中的最近对话轮数（1轮 = 1问1答）。</p>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                        温度参数 ({aiConfig.aiTemperature})
                    </label>
                    <input
                        type="range"
                        min="0"
                        max="2"
                        step="0.1"
                        value={aiConfig.aiTemperature}
                        onChange={(e) => handleAiChange('aiTemperature', parseFloat(e.target.value))}
                        className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                    />
                    <p className="text-xs text-gray-500 mt-1">控制 AI 回复的随机性（0=确定性，2=创造性）。</p>
                </div>

                <div className="space-y-2">
                    <label className="block text-sm font-medium text-white/90">
                        历史记录最大体积
                    </label>
                    <div className="flex items-center gap-2">
                        <input
                            type="number"
                            min="1"
                            max="10000"
                            step="1"
                            value={Math.round(aiConfig.aiHistoryMaxSize / (1024 * 1024))}
                            onChange={(e) => {
                                const mb = Math.max(1, parseInt(e.target.value, 10) || 1);
                                handleAiChange('aiHistoryMaxSize', mb * 1024 * 1024);
                            }}
                            className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white"
                        />
                        <span className="text-white/70 font-medium">MB</span>
                    </div>
                    <p className="text-xs text-white/50">
                        默认: 200 MB (用于存储AI对话历史，范围: 1-10000 MB)
                    </p>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                        向量相似度阈值 ({aiConfig.aiVectorSimilarityThreshold})
                    </label>
                    <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={aiConfig.aiVectorSimilarityThreshold}
                        onChange={(e) => handleAiChange('aiVectorSimilarityThreshold', parseFloat(e.target.value))}
                        className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                    />
                    <p className="text-xs text-gray-500 mt-1">相关性判断标准，值越高越严格。</p>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                        向量搜索结果数量
                    </label>
                    <input
                        type="number"
                        min="1"
                        max="10"
                        value={aiConfig.aiVectorSearchLimit}
                        onChange={(e) => handleAiChange('aiVectorSearchLimit', parseInt(e.target.value))}
                        className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
                    />
                    <p className="text-xs text-gray-500 mt-1">每次回顾的记忆条数。</p>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                        记忆安全限制 (消息条数)
                    </label>
                    <input
                        type="number"
                        value={aiConfig.aiMemorySafetyLimit}
                        onChange={(e) => handleAiChange('aiMemorySafetyLimit', parseInt(e.target.value))}
                        className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
                    />
                    <p className="text-xs text-gray-500 mt-1">防止记忆过大导致上下文溢出。</p>
                </div>

                <div className="flex items-center justify-between bg-white/5 p-4 rounded-lg">
                    <div>
                        <span className="block text-sm font-medium text-white">向量缓存</span>
                        <span className="text-xs text-gray-400">启用向量数据库缓存以支持长期记忆</span>
                    </div>
                    <div className="relative inline-flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            checked={aiConfig.aiEnableVectorCache}
                            onChange={(e) => handleAiChange('aiEnableVectorCache', e.target.checked)}
                            className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    </div>
                </div>
            </div>

            {/* === 对话服务配置 === */}
            <div className="space-y-4 pt-6 border-t border-white/10">
                <div className="flex items-center gap-2">
                    <MessageSquare className="w-5 h-5 text-blue-400" />
                    <h3 className="text-lg font-semibold text-white">对话服务配置</h3>
                </div>

                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                    <p className="text-sm text-white/70">
                        配置AI对话API。留空则使用通用AI配置 (aiApiUrl/aiApiKey)。
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            API端点
                        </label>
                        <input
                            type="text"
                            value={aiConfig.aiChatApiUrl}
                            onChange={(e) => handleAiChange('aiChatApiUrl', e.target.value)}
                            placeholder="https://api.openai.com/v1/chat/completions"
                            className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
                        />
                        <p className="text-xs text-gray-500 mt-1">对话服务的API地址</p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            API密钥
                        </label>
                        <input
                            type="password"
                            value={aiConfig.aiChatApiKey}
                            onChange={(e) => handleAiChange('aiChatApiKey', e.target.value)}
                            placeholder="sk-..."
                            className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
                        />
                        <p className="text-xs text-gray-500 mt-1">对话服务的密钥</p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            模型
                        </label>
                        <input
                            type="text"
                            value={aiConfig.aiChatModel}
                            onChange={(e) => handleAiChange('aiChatModel', e.target.value)}
                            placeholder="gpt-3.5-turbo"
                            className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
                        />
                        <p className="text-xs text-gray-500 mt-1">使用的对话模型名称</p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            代理地址
                        </label>
                        <input
                            type="text"
                            value={aiConfig.aiChatProxy}
                            onChange={(e) => handleAiChange('aiChatProxy', e.target.value)}
                            placeholder="http://proxy.example.com:8080"
                            className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
                        />
                        <p className="text-xs text-gray-500 mt-1">HTTP代理（可选）</p>
                    </div>

                    <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            系统提示词
                        </label>
                        <textarea
                            rows={4}
                            value={aiConfig.aiChatSystemPrompt}
                            onChange={(e) => handleAiChange('aiChatSystemPrompt', e.target.value)}
                            placeholder="你是一个有用的助手"
                            className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-blue-500 focus:outline-none resize-none"
                        />
                        <p className="text-xs text-gray-500 mt-1">定义AI的角色和行为</p>
                    </div>
                </div>
            </div>

            {/* === 向量化服务配置 === */}
            <div className="space-y-4 pt-6 border-t border-white/10">
                <div className="flex items-center gap-2">
                    <Cpu className="w-5 h-5 text-purple-400" />
                    <h3 className="text-lg font-semibold text-white">向量化服务配置</h3>
                </div>

                <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-4">
                    <p className="text-sm text-white/70">
                        配置文本向量化API（用于相似度搜索）。留空则使用对话服务配置。
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            API端点
                        </label>
                        <input
                            type="text"
                            value={aiConfig.aiEmbeddingApiUrl}
                            onChange={(e) => handleAiChange('aiEmbeddingApiUrl', e.target.value)}
                            placeholder="https://api.openai.com/v1/embeddings"
                            className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                        />
                        <p className="text-xs text-gray-500 mt-1">向量化服务的API地址</p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            API密钥
                        </label>
                        <input
                            type="password"
                            value={aiConfig.aiEmbeddingApiKey}
                            onChange={(e) => handleAiChange('aiEmbeddingApiKey', e.target.value)}
                            placeholder="sk-..."
                            className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                        />
                        <p className="text-xs text-gray-500 mt-1">向量化服务的密钥</p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            模型
                        </label>
                        <input
                            type="text"
                            value={aiConfig.aiEmbeddingModel}
                            onChange={(e) => handleAiChange('aiEmbeddingModel', e.target.value)}
                            placeholder="text-embedding-3-small"
                            className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                        />
                        <p className="text-xs text-gray-500 mt-1">使用的向量化模型名称</p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            代理地址
                        </label>
                        <input
                            type="text"
                            value={aiConfig.aiEmbeddingProxy}
                            onChange={(e) => handleAiChange('aiEmbeddingProxy', e.target.value)}
                            placeholder="http://proxy.example.com:8080"
                            className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                        />
                        <p className="text-xs text-gray-500 mt-1">HTTP代理（可选）</p>
                    </div>
                </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
                <button
                    onClick={resetAiSettings}
                    disabled={resettingAi || savingAi}
                    className="px-4 py-2 bg-white/5 hover:bg-white/10 text-gray-300 rounded-lg transition-colors disabled:opacity-50"
                >
                    {resettingAi ? '重置中...' : '重置为默认值 (.env)'}
                </button>
                <button
                    onClick={saveAiSettings}
                    disabled={savingAi || resettingAi}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white font-medium transition-colors disabled:opacity-50"
                >
                    <Save size={18} />
                    {savingAi ? '保存中...' : '保存 AI 设置'}
                </button>
            </div>
        </GlassCard>
      </section>

      {/* MCP Servers Section */}
      <section>
        <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
                <Server className="text-purple-400" />
                <h2 className="text-xl font-semibold text-white">MCP 扩展</h2>
            </div>
            <button
                onClick={() => setIsAddMcpModalOpen(true)}
                className="flex items-center gap-2 px-3 py-1.5 bg-purple-600/20 text-purple-300 hover:bg-purple-600/30 border border-purple-500/30 rounded-lg text-sm transition-colors"
            >
                <Plus size={16} />
                添加服务器
            </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {mcpConfig.mcpServers.map((server, idx) => (
                <GlassCard key={idx} className="relative group">
                    <div className="flex justify-between items-start mb-3">
                        <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${server.enabled ? 'bg-green-400' : 'bg-gray-500'}`} />
                            <h3 className="font-semibold text-lg">{server.name}</h3>
                        </div>
                        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                             <button
                                onClick={() => toggleMcpServer(idx)}
                                className="p-1.5 hover:bg-white/10 rounded-md text-gray-300 hover:text-white"
                                title={server.enabled ? "禁用" : "启用"}
                             >
                                <Power size={16} />
                             </button>
                             <button
                                onClick={() => openEditMcpModal(idx)}
                                className="p-1.5 hover:bg-blue-500/20 rounded-md text-gray-300 hover:text-blue-400"
                                title="编辑"
                             >
                                <Edit size={16} />
                             </button>
                             <button
                                onClick={() => removeMcpServer(idx)}
                                className="p-1.5 hover:bg-red-500/20 rounded-md text-gray-300 hover:text-red-400"
                                title="移除"
                             >
                                <Trash2 size={16} />
                             </button>
                        </div>
                    </div>

                    <div className="space-y-2 text-sm text-gray-400">
                        <div className="flex items-center gap-2 bg-black/20 p-2 rounded font-mono text-xs truncate">
                            <Terminal size={12} />
                            {server.type && server.type !== 'stdio' ? (
                                <span className="truncate" title={server.url || ''}>
                                    {server.url || '-'}
                                </span>
                            ) : (
                                <span className="truncate" title={`${server.command} ${server.args?.join(' ')}`}>
                                    {server.command} {server.args?.join(' ')}
                                </span>
                            )}
                        </div>
                        <div className="flex justify-between text-xs">
                             {server.type && server.type !== 'stdio' ? (
                                <>
                                    <span>类型: {server.type}</span>
                                    <span>URL: {server.url ? '已配置' : '未配置'}</span>
                                </>
                             ) : (
                                <>
                                    <span>参数: {server.args?.length || 0}</span>
                                    <span>环境变量: {Object.keys(server.env || {}).length} 个</span>
                                </>
                             )}
                        </div>
                    </div>
                </GlassCard>
            ))}

            {mcpConfig.mcpServers.length === 0 && (
                <div className="col-span-full py-8 text-center text-gray-500 border border-dashed border-white/10 rounded-xl">
                    未安装 MCP 服务器。添加一个以扩展功能。
                </div>
            )}
        </div>
      </section>

      {/* System Actions */}
      <section className="pt-8 border-t border-white/10">
         <div className="flex items-center justify-between">
            <div>
                <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                    <Activity className="text-red-400" />
                    系统控制
                </h2>
                <p className="text-gray-400 text-sm mt-1">影响整个机器人的系统级操作。</p>
            </div>
            <button
                onClick={handleRestart}
                className="flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30 rounded-lg transition-colors"
            >
                <AlertTriangle size={18} />
                重启系统
            </button>
         </div>
      </section>

      {/* Add MCP Modal */}
      {isAddMcpModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-gray-900 border border-white/20 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden">
                <div className="flex justify-between items-center p-4 border-b border-white/10 bg-white/5">
                    <h3 className="text-lg font-bold text-white">添加 MCP 服务器</h3>
                    <button onClick={() => setIsAddMcpModalOpen(false)} className="text-gray-400 hover:text-white">
                        <X size={20} />
                    </button>
                </div>
                <div className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">服务器名称</label>
                        <input
                            type="text"
                            value={newMcp.name}
                            onChange={e => setNewMcp({...newMcp, name: e.target.value})}
                            placeholder="例如：Filesystem"
                            className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">类型</label>
                        <select
                            value={newMcp.type}
                            onChange={e => setNewMcp({...newMcp, type: e.target.value})}
                            className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                        >
                            <option value="stdio">stdio</option>
                            <option value="sse">sse</option>
                            <option value="streamable_http">streamable_http</option>
                        </select>
                    </div>
                    {newMcp.type !== 'stdio' && (
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">URL</label>
                            <input
                                type="text"
                                value={newMcp.url}
                                onChange={e => setNewMcp({...newMcp, url: e.target.value})}
                                placeholder="http://localhost:port/mcp"
                                className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                            />
                        </div>
                    )}
                    {newMcp.type === 'stdio' && (
                        <>
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">命令</label>
                            <input
                                type="text"
                                value={newMcp.command}
                                onChange={e => setNewMcp({...newMcp, command: e.target.value})}
                                placeholder="npx, python 等"
                                className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                            />
                        </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">参数 (逗号分隔)</label>
                        <input
                            type="text"
                            value={newMcp.args}
                            onChange={e => setNewMcp({...newMcp, args: e.target.value})}
                            placeholder="-y, @modelcontextprotocol/server-filesystem, /path/to/dir"
                            className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">环境变量 (JSON)</label>
                        <textarea
                            value={newMcp.env}
                            onChange={e => setNewMcp({...newMcp, env: e.target.value})}
                            rows={3}
                            className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white font-mono text-xs focus:border-purple-500 focus:outline-none"
                        />
                    </div>
                        </>
                    )}
                </div>
                <div className="p-4 border-t border-white/10 bg-white/5 flex justify-end gap-3">
                    <button
                        onClick={() => setIsAddMcpModalOpen(false)}
                        className="px-4 py-2 text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                    >
                        取消
                    </button>
                    <button
                        onClick={handleAddMcp}
                        disabled={savingMcp || !newMcp.name || (newMcp.type === 'stdio' ? !newMcp.command : !newMcp.url)}
                        className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {savingMcp ? '添加中...' : '添加服务器'}
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* Edit MCP Modal */}
      {isEditMcpModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-gray-900 border border-white/20 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden">
                <div className="flex justify-between items-center p-4 border-b border-white/10 bg-white/5">
                    <h3 className="text-lg font-bold text-white">编辑 MCP 服务器</h3>
                    <button onClick={() => setIsEditMcpModalOpen(false)} className="text-gray-400 hover:text-white">
                        <X size={20} />
                    </button>
                </div>
                <div className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">服务器名称</label>
                        <input
                            type="text"
                            value={editMcp.name}
                            onChange={e => setEditMcp({...editMcp, name: e.target.value})}
                            placeholder="例如：Filesystem"
                            className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                        />
                        <p className="text-xs text-gray-500 mt-1">只能包含字母、数字、下划线和短横线</p>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">类型</label>
                        <select
                            value={editMcp.type}
                            onChange={e => setEditMcp({...editMcp, type: e.target.value})}
                            className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                        >
                            <option value="stdio">stdio</option>
                            <option value="sse">sse</option>
                            <option value="streamable_http">streamable_http</option>
                        </select>
                    </div>
                    {editMcp.type !== 'stdio' && (
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">URL</label>
                            <input
                                type="text"
                                value={editMcp.url}
                                onChange={e => setEditMcp({...editMcp, url: e.target.value})}
                                placeholder="http://localhost:port/mcp"
                                className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                            />
                        </div>
                    )}
                    {editMcp.type === 'stdio' && (
                        <>
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">命令</label>
                            <input
                                type="text"
                                value={editMcp.command}
                                onChange={e => setEditMcp({...editMcp, command: e.target.value})}
                                placeholder="npx, python 等"
                                className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                            />
                        </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">参数 (逗号分隔)</label>
                        <input
                            type="text"
                            value={editMcp.args}
                            onChange={e => setEditMcp({...editMcp, args: e.target.value})}
                            placeholder="-y, @modelcontextprotocol/server-filesystem, /path/to/dir"
                            className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">环境变量 (JSON)</label>
                        <textarea
                            value={editMcp.env}
                            onChange={e => setEditMcp({...editMcp, env: e.target.value})}
                            rows={3}
                            className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white font-mono text-xs focus:border-purple-500 focus:outline-none"
                        />
                    </div>
                        </>
                    )}
                </div>
                <div className="p-4 border-t border-white/10 bg-white/5 flex justify-end gap-3">
                    <button
                        onClick={() => setIsEditMcpModalOpen(false)}
                        className="px-4 py-2 text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                    >
                        取消
                    </button>
                    <button
                        onClick={handleEditMcp}
                        disabled={savingMcp || !editMcp.name || (editMcp.type === 'stdio' ? !editMcp.command : !editMcp.url)}
                        className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {savingMcp ? '保存中...' : '保存更改'}
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* Restart Confirmation Modal */}
      <GlassModal
        isOpen={isRestartModalOpen}
        onClose={() => setIsRestartModalOpen(false)}
        title="系统重启 (System Restart)"
        footer={
          <>
            <button
              onClick={() => setIsRestartModalOpen(false)}
              className="px-4 py-2 text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
            >
              取消
            </button>
            <button
              onClick={confirmRestart}
              className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
            >
              确认重启
            </button>
          </>
        }
      >
        <p className="text-gray-300">
          确定要重启机器人吗？重启期间服务将暂时不可用。
        </p>
      </GlassModal>

      {/* Remove MCP Confirmation Modal */}
      <GlassModal
        isOpen={mcpToRemove !== null}
        onClose={() => setMcpToRemove(null)}
        title="移除服务器"
        footer={
          <>
            <button
              onClick={() => setMcpToRemove(null)}
              className="px-4 py-2 text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
            >
              取消
            </button>
            <button
              onClick={confirmRemoveMcp}
              className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
            >
              移除
            </button>
          </>
        }
      >
        <p className="text-gray-300">
            确定要移除此 MCP 服务器吗？此操作无法撤销。
        </p>
      </GlassModal>

      {/* QR Code Modal for Global Login */}
      <GlassModal
        isOpen={isQrModalOpen}
        onClose={() => {
          setIsQrModalOpen(false);
          setBiliLoading(false);
          if (qrPollInterval) {
            clearInterval(qrPollInterval);
            setQrPollInterval(null);
          }
        }}
        title="扫码登录 B 站（全局）"
      >
        <div className="flex flex-col items-center space-y-4">
          <p className="text-gray-300 text-sm text-center">
            请使用 B 站 App 扫描下方二维码完成登录
          </p>
          {qrCodeUrl && (
            <img
              src={qrCodeUrl}
              alt="QR Code"
              className="w-64 h-64 border-2 border-white/20 rounded-lg"
            />
          )}
          <div className="flex items-center gap-2 text-blue-400">
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-400 border-t-transparent" />
            <span className="text-sm">等待扫码...</span>
          </div>
          <p className="text-xs text-gray-500">
            二维码有效期60秒，超时请重新获取
          </p>
        </div>
      </GlassModal>
    </div>
  );
};

export default Settings;
