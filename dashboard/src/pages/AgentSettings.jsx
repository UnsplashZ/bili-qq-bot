import React, { useCallback, useEffect, useState } from 'react';
import { Bot, RefreshCw, Save, ShieldCheck, Trash2 } from 'lucide-react';
import GlassCard from '../components/GlassCard';
import api from '../utils/auth';
import { useToast } from '../hooks/useToast';

const RISK_LEVELS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

const SOCIAL_MODES = [
  { value: 'quiet', label: '安静' },
  { value: 'normal', label: '普通' },
  { value: 'active', label: '活跃' },
  { value: 'debug', label: '调试' },
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function formatBool(value) {
  return value ? '开启' : '关闭';
}

function formatOverride(value) {
  if (value === undefined) return '继承';
  return formatBool(value);
}

function toOverrideValue(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return 'inherit';
}

function fromOverrideValue(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function defaultSocialDraft(agent) {
  return {
    enabled: agent?.social?.enabled ?? false,
    mode: agent?.social?.mode || 'quiet',
    interjectProbability: agent?.social?.interjectProbability ?? 0.18,
    ambientReactProbability: agent?.social?.ambientReactProbability ?? 0.08,
    minInterjectScore: agent?.social?.minInterjectScore ?? 0.72,
    minAmbientScore: agent?.social?.minAmbientScore ?? 0.62,
    cooldownMs: agent?.social?.cooldownMs ?? 90000,
    dailyInterjectLimit: agent?.social?.dailyInterjectLimit ?? 30,
    perTopicInterjectLimit: agent?.social?.perTopicInterjectLimit ?? 2,
    avoidDuringRapidTwoPersonChat: agent?.social?.avoidDuringRapidTwoPersonChat ?? true,
    maxCasualReplyChars: agent?.social?.maxCasualReplyChars ?? 120,
  };
}


function defaultParticipationDraft(agent) {
  return {
    enabled: agent?.participation?.enabled ?? true,
    timingGateEnabled: agent?.participation?.timingGateEnabled ?? true,
    replyerEnabled: agent?.participation?.replyerEnabled ?? true,
    expressionLearningEnabled: agent?.participation?.expressionLearningEnabled ?? false,
    replyEffectTrackingEnabled: agent?.participation?.replyEffectTrackingEnabled ?? false,
    personProfileEnabled: agent?.participation?.personProfileEnabled ?? true,
  };
}

function defaultTimingDraft(agent) {
  return {
    quietWindowMs: agent?.timing?.quietWindowMs ?? 2500,
    maxWaitMs: agent?.timing?.maxWaitMs ?? 12000,
  };
}

function defaultReplyerDraft(agent) {
  return {
    maxReactChars: agent?.replyer?.maxReactChars ?? 60,
    maxReplyChars: agent?.replyer?.maxReplyChars ?? 500,
    allowQuoteReply: agent?.replyer?.allowQuoteReply ?? true,
  };
}

function defaultExpressionDraft(agent) {
  return {
    learningMinMessages: agent?.expression?.learningMinMessages ?? 20,
    learningMinIntervalMs: agent?.expression?.learningMinIntervalMs ?? 600000,
  };
}

function HumanlikeConfigFields({ participation, timing, replyer, expression, onChange, disabled = false }) {
  const updateParticipation = (key, value) => onChange({ participation: { ...participation, [key]: value } });
  const updateTiming = (key, value) => onChange({ timing: { ...timing, [key]: value } });
  const updateReplyer = (key, value) => onChange({ replyer: { ...replyer, [key]: value } });
  const updateExpression = (key, value) => onChange({ expression: { ...expression, [key]: value } });

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Toggle
          label="参与机制"
          description="总开关：保留 Agent，但可关闭拟人化参与链路。"
          checked={participation?.enabled !== false}
          disabled={disabled}
          onChange={(checked) => updateParticipation('enabled', checked)}
        />
        <Toggle
          label="Timing Gate"
          description="先判断群聊节奏，避免抢话。"
          checked={participation?.timingGateEnabled !== false}
          disabled={disabled}
          onChange={(checked) => updateParticipation('timingGateEnabled', checked)}
        />
        <Toggle
          label="Replyer"
          description="二阶段生成最终拟人化文本。"
          checked={participation?.replyerEnabled !== false}
          disabled={disabled}
          onChange={(checked) => updateParticipation('replyerEnabled', checked)}
        />
        <Toggle
          label="表达学习"
          description="从群聊中学习抽象表达习惯。"
          checked={Boolean(participation?.expressionLearningEnabled)}
          disabled={disabled}
          onChange={(checked) => updateParticipation('expressionLearningEnabled', checked)}
        />
        <Toggle
          label="回复效果观察"
          description="观察用户反馈并调整表达习惯置信度。"
          checked={Boolean(participation?.replyEffectTrackingEnabled)}
          disabled={disabled}
          onChange={(checked) => updateParticipation('replyEffectTrackingEnabled', checked)}
        />
        <Toggle
          label="人物画像"
          description="根据长期记忆聚合当前用户偏好。"
          checked={participation?.personProfileEnabled !== false}
          disabled={disabled}
          onChange={(checked) => updateParticipation('personProfileEnabled', checked)}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <NumberInput label="静默窗口" min="0" max="60000" value={timing?.quietWindowMs} suffix="ms" disabled={disabled} onChange={(value) => updateTiming('quietWindowMs', value)} />
        <NumberInput label="最长等待" min="0" max="300000" value={timing?.maxWaitMs} suffix="ms" disabled={disabled} onChange={(value) => updateTiming('maxWaitMs', value)} />
        <NumberInput label="React 最长" min="20" max="500" value={replyer?.maxReactChars} suffix="字符" disabled={disabled} onChange={(value) => updateReplyer('maxReactChars', value)} />
        <NumberInput label="Reply 最长" min="80" max="2000" value={replyer?.maxReplyChars} suffix="字符" disabled={disabled} onChange={(value) => updateReplyer('maxReplyChars', value)} />
        <Toggle label="允许引用回复" description="后续可用于 quote target。" checked={replyer?.allowQuoteReply !== false} disabled={disabled} onChange={(checked) => updateReplyer('allowQuoteReply', checked)} />
        <NumberInput label="学习最少消息" min="6" max="200" value={expression?.learningMinMessages} suffix="条" disabled={disabled} onChange={(value) => updateExpression('learningMinMessages', value)} />
        <NumberInput label="学习最小间隔" min="60000" max="86400000" value={expression?.learningMinIntervalMs} suffix="ms" disabled={disabled} onChange={(value) => updateExpression('learningMinIntervalMs', value)} />
      </div>
    </div>
  );
}

function NumberInput({ label, value, onChange, min, max, step = 1, suffix = '', disabled = false }) {
  return (
    <label className="space-y-1.5">
      <span className="text-sm text-gray-300">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value ?? ''}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2.5 text-white disabled:opacity-60"
        />
        {suffix && <span className="text-sm text-gray-500 shrink-0">{suffix}</span>}
      </div>
    </label>
  );
}

function TextInput({ label, value, onChange, placeholder = '', disabled = false }) {
  return (
    <label className="space-y-1.5">
      <span className="text-sm text-gray-300">{label}</span>
      <input
        value={value ?? ''}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2.5 text-white placeholder:text-gray-500 disabled:opacity-60"
      />
    </label>
  );
}

function Toggle({ label, description, checked, onChange, disabled = false }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`text-left p-4 rounded-xl border transition-colors ${
        checked
          ? 'bg-emerald-500/10 border-emerald-400/30'
          : 'bg-black/20 border-white/10 hover:bg-white/5'
      } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-white">{label}</span>
        <span className={`px-2.5 py-1 rounded-full text-xs ${checked ? 'bg-emerald-500/20 text-emerald-200' : 'bg-slate-500/20 text-slate-300'}`}>
          {formatBool(checked)}
        </span>
      </div>
      {description && <p className="text-sm text-gray-400 mt-2">{description}</p>}
    </button>
  );
}

function OverrideSelect({ label, value, onChange }) {
  return (
    <label className="space-y-1.5">
      <span className="text-sm text-gray-300">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2.5 text-white"
      >
        <option value="inherit">继承全局</option>
        <option value="true">开启</option>
        <option value="false">关闭</option>
      </select>
    </label>
  );
}

function SocialConfigFields({ value, onChange, disabled = false }) {
  const update = (key, nextValue) => onChange({ ...value, [key]: nextValue });

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Toggle
          label="允许偶尔插话"
          description="开启后，普通闲聊可由 Agent 判断是否自然参与。"
          checked={Boolean(value?.enabled)}
          disabled={disabled}
          onChange={(checked) => update('enabled', checked)}
        />
        <Toggle
          label="避开双人快聊"
          description="两个人高速对话时默认降低打断概率。"
          checked={value?.avoidDuringRapidTwoPersonChat !== false}
          disabled={disabled}
          onChange={(checked) => update('avoidDuringRapidTwoPersonChat', checked)}
        />
        <label className="space-y-1.5">
          <span className="text-sm text-gray-300">活跃模式</span>
          <select
            value={value?.mode || 'quiet'}
            disabled={disabled}
            onChange={(event) => update('mode', event.target.value)}
            className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2.5 text-white disabled:opacity-60"
          >
            {SOCIAL_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>{mode.label} / {mode.value}</option>
            ))}
          </select>
        </label>
        <NumberInput
          label="插话概率"
          min="0"
          max="1"
          step="0.01"
          value={value?.interjectProbability}
          disabled={disabled}
          onChange={(nextValue) => update('interjectProbability', nextValue)}
        />
        <NumberInput
          label="轻量附和概率"
          min="0"
          max="1"
          step="0.01"
          value={value?.ambientReactProbability}
          disabled={disabled}
          onChange={(nextValue) => update('ambientReactProbability', nextValue)}
        />
        <NumberInput
          label="插话最低分"
          min="0"
          max="1"
          step="0.01"
          value={value?.minInterjectScore}
          disabled={disabled}
          onChange={(nextValue) => update('minInterjectScore', nextValue)}
        />
        <NumberInput
          label="附和最低分"
          min="0"
          max="1"
          step="0.01"
          value={value?.minAmbientScore}
          disabled={disabled}
          onChange={(nextValue) => update('minAmbientScore', nextValue)}
        />
        <NumberInput
          label="社交冷却"
          min="0"
          max="3600000"
          value={value?.cooldownMs}
          suffix="ms"
          disabled={disabled}
          onChange={(nextValue) => update('cooldownMs', nextValue)}
        />
        <NumberInput
          label="每日插话上限"
          min="0"
          max="1000"
          value={value?.dailyInterjectLimit}
          disabled={disabled}
          onChange={(nextValue) => update('dailyInterjectLimit', nextValue)}
        />
        <NumberInput
          label="单话题上限"
          min="0"
          max="100"
          value={value?.perTopicInterjectLimit}
          disabled={disabled}
          onChange={(nextValue) => update('perTopicInterjectLimit', nextValue)}
        />
        <NumberInput
          label="社交回复最长"
          min="20"
          max="500"
          value={value?.maxCasualReplyChars}
          suffix="字符"
          disabled={disabled}
          onChange={(nextValue) => update('maxCasualReplyChars', nextValue)}
        />
      </div>
    </div>
  );
}

const AgentSettings = () => {
  const { show } = useToast();
  const [agent, setAgent] = useState(null);
  const [defaults, setDefaults] = useState(null);
  const [llmEnv, setLlmEnv] = useState({});
  const [aliasesText, setAliasesText] = useState('');
  const [groupId, setGroupId] = useState('');
  const [groupDraft, setGroupDraft] = useState({
    enabled: 'inherit',
    observeOnly: 'inherit',
    sendEnabled: 'inherit',
    replyPolicyMode: 'inherit',
    replyPolicy: {
      minReplyScore: 0.65,
      cooldownMs: 5000,
    },
    socialMode: 'inherit',
    social: defaultSocialDraft(null),
    humanlikeMode: 'inherit',
    participation: defaultParticipationDraft(null),
    timing: defaultTimingDraft(null),
    replyer: defaultReplyerDraft(null),
    expression: defaultExpressionDraft(null),
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get('/api/agent/config');
      const nextAgent = response.data.agent;
      setAgent(nextAgent);
      setDefaults(response.data.defaults || null);
      setLlmEnv(response.data.llmEnv || {});
      setAliasesText(Array.isArray(nextAgent.aliases) ? nextAgent.aliases.join('\n') : '');
    } catch (error) {
      console.error('Failed to load agent config:', error);
      show('加载 Agent 配置失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [show]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const updateAgent = (updater) => {
    setAgent((prev) => {
      if (!prev) return prev;
      const next = clone(prev);
      updater(next);
      return next;
    });
  };

  const saveGlobal = async () => {
    if (!agent) return;
    setSaving(true);
    try {
      const payload = {
        ...agent,
        aliases: aliasesText,
      };
      const response = await api.put('/api/agent/config', payload);
      setAgent(response.data.agent);
      setLlmEnv(response.data.llmEnv || {});
      setAliasesText(Array.isArray(response.data.agent.aliases) ? response.data.agent.aliases.join('\n') : '');
      show('Agent 全局配置已保存', 'success');
    } catch (error) {
      console.error('Failed to save agent config:', error);
      show(error.response?.data?.error || '保存 Agent 配置失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveGroup = async () => {
    const normalizedGroupId = groupId.trim();
    if (!/^\d+$/.test(normalizedGroupId)) {
      show('请输入有效群号', 'error');
      return;
    }
    const payload = {
      enabled: fromOverrideValue(groupDraft.enabled),
      observeOnly: fromOverrideValue(groupDraft.observeOnly),
      sendEnabled: fromOverrideValue(groupDraft.sendEnabled),
      replyPolicy: groupDraft.replyPolicyMode === 'custom' ? groupDraft.replyPolicy : null,
      social: groupDraft.socialMode === 'custom' ? groupDraft.social : null,
      participation: groupDraft.humanlikeMode === 'custom' ? groupDraft.participation : null,
      timing: groupDraft.humanlikeMode === 'custom' ? groupDraft.timing : null,
      replyer: groupDraft.humanlikeMode === 'custom' ? groupDraft.replyer : null,
      expression: groupDraft.humanlikeMode === 'custom' ? groupDraft.expression : null,
    };
    setSaving(true);
    try {
      const response = await api.put(`/api/agent/groups/${encodeURIComponent(normalizedGroupId)}`, payload);
      setAgent(response.data.agent);
      show(`群 ${normalizedGroupId} 的 Agent 覆盖配置已保存`, 'success');
    } catch (error) {
      console.error('Failed to save agent group config:', error);
      show(error.response?.data?.error || '保存群级 Agent 配置失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const deleteGroup = async (targetGroupId) => {
    if (!window.confirm(`确认删除群 ${targetGroupId} 的 Agent 覆盖配置？`)) return;
    setSaving(true);
    try {
      const response = await api.delete(`/api/agent/groups/${encodeURIComponent(targetGroupId)}`);
      setAgent(response.data.agent);
      show('群级覆盖配置已删除', 'success');
    } catch (error) {
      console.error('Failed to delete agent group config:', error);
      show(error.response?.data?.error || '删除群级 Agent 配置失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const loadGroupDraft = (targetGroupId, config) => {
    setGroupId(targetGroupId);
    setGroupDraft({
      enabled: toOverrideValue(config.enabled),
      observeOnly: toOverrideValue(config.observeOnly),
      sendEnabled: toOverrideValue(config.sendEnabled),
      replyPolicyMode: config.replyPolicy ? 'custom' : 'inherit',
      replyPolicy: {
        minReplyScore: config.replyPolicy?.minReplyScore ?? agent?.replyPolicy?.minReplyScore ?? 0.65,
        cooldownMs: config.replyPolicy?.cooldownMs ?? agent?.replyPolicy?.cooldownMs ?? 5000,
      },
      socialMode: config.social ? 'custom' : 'inherit',
      social: {
        ...defaultSocialDraft(agent),
        ...(config.social || {}),
      },
      humanlikeMode: (config.participation || config.timing || config.replyer || config.expression) ? 'custom' : 'inherit',
      participation: {
        ...defaultParticipationDraft(agent),
        ...(config.participation || {}),
      },
      timing: {
        ...defaultTimingDraft(agent),
        ...(config.timing || {}),
      },
      replyer: {
        ...defaultReplyerDraft(agent),
        ...(config.replyer || {}),
      },
      expression: {
        ...defaultExpressionDraft(agent),
        ...(config.expression || {}),
      },
    });
  };

  if (!agent) {
    return (
      <GlassCard>
        <div className="text-gray-400 text-center py-10">
          {loading ? '加载 Agent 配置中...' : 'Agent 配置不可用'}
        </div>
      </GlassCard>
    );
  }

  const groups = Object.entries(agent.groups || {}).sort(([a], [b]) => Number(a) - Number(b));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Bot className="text-cyan-300" />
            Agent 管理
          </h1>
          <p className="text-gray-400 mt-2">
            管理新 Agent 的运行模式、LLM 决策、回复闸门、预算和受限工具；不会恢复旧 AI/MCP 配置。
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={loadConfig}
            disabled={loading}
            className="px-4 py-2.5 rounded-lg bg-white/10 text-white hover:bg-white/15 disabled:opacity-50 flex items-center gap-2"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            刷新
          </button>
          <button
            onClick={saveGlobal}
            disabled={saving}
            className="px-4 py-2.5 rounded-lg bg-blue-500/20 text-blue-100 hover:bg-blue-500/30 disabled:opacity-50 flex items-center gap-2"
          >
            <Save size={18} />
            保存全局
          </button>
        </div>
      </div>

      <GlassCard>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Toggle
            label="Agent 入口"
            description="关闭后自然语言不进入 Agent。"
            checked={agent.enabled}
            onChange={(value) => updateAgent((next) => { next.enabled = value; })}
          />
          <Toggle
            label="默认群启用"
            description="未配置群覆盖时是否进入 Agent。"
            checked={agent.defaultGroupEnabled}
            onChange={(value) => updateAgent((next) => { next.defaultGroupEnabled = value; })}
          />
          <Toggle
            label="仅观察"
            description="开启后不会发送普通回复。"
            checked={agent.observeOnly}
            onChange={(value) => updateAgent((next) => { next.observeOnly = value; })}
          />
          <Toggle
            label="允许发言"
            description="普通回复闸门；工具结果不依赖它。"
            checked={agent.sendEnabled}
            onChange={(value) => updateAgent((next) => { next.sendEnabled = value; })}
          />
          <Toggle
            label="轨迹日志"
            description="记录 Agent 决策轨迹，便于审计。"
            checked={agent.logTrajectory}
            onChange={(value) => updateAgent((next) => { next.logTrajectory = value; })}
          />
        </div>
      </GlassCard>

      <div className="grid gap-6 xl:grid-cols-2">
        <GlassCard>
          <h2 className="text-xl font-semibold mb-4">决策与回复</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-sm text-gray-300">决策模式</span>
              <select
                value={agent.decisionMode}
                onChange={(event) => updateAgent((next) => { next.decisionMode = event.target.value; })}
                className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2.5 text-white"
              >
                <option value="rule_only">rule_only</option>
                <option value="llm_shadow">llm_shadow</option>
                <option value="llm_live">llm_live</option>
              </select>
            </label>
            <NumberInput
              label="最低回复置信度"
              min="0"
              max="1"
              step="0.01"
              value={agent.replyPolicy?.minReplyScore}
              onChange={(value) => updateAgent((next) => { next.replyPolicy.minReplyScore = value; })}
            />
            <NumberInput
              label="回复冷却"
              min="0"
              max="3600000"
              value={agent.replyPolicy?.cooldownMs}
              suffix="ms"
              onChange={(value) => updateAgent((next) => { next.replyPolicy.cooldownMs = value; })}
            />
            <NumberInput
              label="拥挤阈值"
              min="1"
              max="120"
              value={agent.shortTerm?.crowdedMessagesPerMinute}
              suffix="条/分钟"
              onChange={(value) => updateAgent((next) => { next.shortTerm.crowdedMessagesPerMinute = value; })}
            />
            <NumberInput
              label="上下文消息数"
              min="8"
              max="120"
              value={agent.shortTerm?.promptMaxMessages}
              suffix="条"
              onChange={(value) => updateAgent((next) => { next.shortTerm.promptMaxMessages = value; })}
            />
            <NumberInput
              label="单条上下文长度"
              min="80"
              max="1000"
              value={agent.shortTerm?.promptMaxCharsPerMessage}
              suffix="字符"
              onChange={(value) => updateAgent((next) => { next.shortTerm.promptMaxCharsPerMessage = value; })}
            />
            <NumberInput
              label="总上下文预算"
              min="1000"
              max="200000"
              value={agent.shortTerm?.promptMaxContextChars}
              suffix="字符"
              onChange={(value) => updateAgent((next) => { next.shortTerm.promptMaxContextChars = value; })}
            />
          </div>
          <label className="block mt-4 space-y-1.5">
            <span className="text-sm text-gray-300">触发昵称 / 别名</span>
            <textarea
              value={aliasesText}
              onChange={(event) => setAliasesText(event.target.value)}
              placeholder="每行一个，例如：小助手"
              rows={4}
              className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2.5 text-white placeholder:text-gray-500"
            />
          </label>
        </GlassCard>

        <GlassCard>
          <h2 className="text-xl font-semibold mb-4">LLM 与预算</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Toggle
              label="LLM 启用"
              description="关闭后只走规则/回退。"
              checked={agent.llm?.enabled}
              onChange={(value) => updateAgent((next) => { next.llm.enabled = value; })}
            />
            <Toggle
              label="预算限制"
              description="限制每群/每用户 LLM 调用频率。"
              checked={agent.budget?.enabled}
              onChange={(value) => updateAgent((next) => { next.budget.enabled = value; })}
            />
            <TextInput
              label="Provider"
              value={agent.llm?.provider}
              onChange={(value) => updateAgent((next) => { next.llm.provider = value; })}
            />
            <TextInput
              label="Base URL"
              value={agent.llm?.baseURL}
              onChange={(value) => updateAgent((next) => { next.llm.baseURL = value; })}
            />
            <TextInput
              label="模型"
              value={agent.llm?.model}
              onChange={(value) => updateAgent((next) => { next.llm.model = value; })}
            />
            <TextInput
              label="API Key 环境变量名"
              value={agent.llm?.apiKeyEnv}
              onChange={(value) => updateAgent((next) => { next.llm.apiKeyEnv = value; })}
            />
            <NumberInput
              label="超时"
              min="1000"
              max="120000"
              value={agent.llm?.timeoutMs}
              suffix="ms"
              onChange={(value) => updateAgent((next) => { next.llm.timeoutMs = value; })}
            />
            <NumberInput
              label="Temperature"
              min="0"
              max="2"
              step="0.1"
              value={agent.llm?.temperature}
              onChange={(value) => updateAgent((next) => { next.llm.temperature = value; })}
            />
            <NumberInput
              label="每群每分钟"
              min="1"
              max="1000"
              value={agent.budget?.maxLlmCallsPerGroupPerMinute}
              onChange={(value) => updateAgent((next) => { next.budget.maxLlmCallsPerGroupPerMinute = value; })}
            />
            <NumberInput
              label="每用户每分钟"
              min="1"
              max="1000"
              value={agent.budget?.maxLlmCallsPerUserPerMinute}
              onChange={(value) => updateAgent((next) => { next.budget.maxLlmCallsPerUserPerMinute = value; })}
            />
          </div>
          <div className="mt-4 p-3 rounded-lg bg-black/20 border border-white/10 text-sm text-gray-400 space-y-1">
            <div>API Key 状态：{llmEnv.apiKeyConfigured ? '已通过环境变量配置' : '未检测到环境变量'}</div>
            {(llmEnv.providerOverridden || llmEnv.baseURLOverridden || llmEnv.modelOverridden || llmEnv.apiKeyEnvOverridden) && (
              <div className="text-amber-300">部分 LLM 字段由 `.env` 覆盖，保存后运行时仍以环境变量为准。</div>
            )}
          </div>
        </GlassCard>

        <GlassCard>
          <h2 className="text-xl font-semibold mb-4">Persona</h2>
          <div className="space-y-4">
            <TextInput
              label="显示身份"
              value={agent.persona?.displayName}
              placeholder="例如：Bilibili 助手"
              onChange={(value) => updateAgent((next) => {
                next.persona = next.persona || {};
                next.persona.displayName = value;
              })}
            />
            <label className="block space-y-1.5">
              <span className="text-sm text-gray-300">表达风格</span>
              <textarea
                value={agent.persona?.style || ''}
                onChange={(event) => updateAgent((next) => {
                  next.persona = next.persona || {};
                  next.persona.style = event.target.value;
                })}
                rows={3}
                maxLength={500}
                className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2.5 text-white placeholder:text-gray-500"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm text-gray-300">参与边界</span>
              <textarea
                value={agent.persona?.boundaries || ''}
                onChange={(event) => updateAgent((next) => {
                  next.persona = next.persona || {};
                  next.persona.boundaries = event.target.value;
                })}
                rows={3}
                maxLength={500}
                className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2.5 text-white placeholder:text-gray-500"
              />
            </label>
            <div className="text-xs text-gray-500">
              Persona 会进入 Agent system prompt，但不会绕过命令、链接、权限和工具确认边界。
            </div>
          </div>
        </GlassCard>

        <GlassCard>
          <h2 className="text-xl font-semibold mb-4">社交插话</h2>
          <SocialConfigFields
            value={agent.social || defaultSocialDraft(agent)}
            onChange={(value) => updateAgent((next) => {
              next.social = value;
            })}
          />
          <div className="text-xs text-gray-500 mt-4">
            该层只控制普通闲聊的偶尔参与；明确 @、回复 Bot、命令、B 站链接仍走原有入口和工具边界。
          </div>
        </GlassCard>

        <GlassCard>
          <h2 className="text-xl font-semibold mb-4">拟人化参与</h2>
          <HumanlikeConfigFields
            participation={agent.participation || defaultParticipationDraft(agent)}
            timing={agent.timing || defaultTimingDraft(agent)}
            replyer={agent.replyer || defaultReplyerDraft(agent)}
            expression={agent.expression || defaultExpressionDraft(agent)}
            onChange={(patch) => updateAgent((next) => {
              if (patch.participation) next.participation = patch.participation;
              if (patch.timing) next.timing = patch.timing;
              if (patch.replyer) next.replyer = patch.replyer;
              if (patch.expression) next.expression = patch.expression;
            })}
          />
          <div className="text-xs text-gray-500 mt-4">
            Timing Gate 负责等一等，Replyer 负责最终口吻，表达学习和回复效果观察只影响后续拟人化，不绕过工具权限。
          </div>
        </GlassCard>
      </div>

      <GlassCard>
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <ShieldCheck className="text-emerald-300" />
          受限工具
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Toggle
            label="允许工具执行"
            description="开启后 Agent 可输出 tool_plan，经权限和确认后执行白名单工具。"
            checked={agent.tools?.enabled}
            onChange={(value) => updateAgent((next) => { next.tools.enabled = value; })}
          />
          <NumberInput
            label="确认有效期"
            min="10000"
            max="3600000"
            value={agent.tools?.confirmationTtlMs}
            suffix="ms"
            onChange={(value) => updateAgent((next) => { next.tools.confirmationTtlMs = value; })}
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          {RISK_LEVELS.map((risk) => (
            <label key={risk.value} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-black/20 border border-white/10">
              <input
                type="checkbox"
                checked={risk.value === 'high' || (agent.tools?.requireConfirmationFor || []).includes(risk.value)}
                disabled={risk.value === 'high'}
                onChange={(event) => updateAgent((next) => {
                  const current = new Set(next.tools.requireConfirmationFor || []);
                  if (event.target.checked) current.add(risk.value);
                  else current.delete(risk.value);
                  next.tools.requireConfirmationFor = Array.from(current);
                })}
              />
              <span className="text-sm text-gray-200">{risk.label} 需要确认</span>
              {risk.value === 'high' && <span className="text-xs text-gray-500">强制</span>}
            </label>
          ))}
        </div>
      </GlassCard>

      <GlassCard>
        <h2 className="text-xl font-semibold mb-4">群级覆盖</h2>
        <div className="grid gap-4 md:grid-cols-5">
          <TextInput label="群号" value={groupId} onChange={setGroupId} placeholder="例如 123456789" />
          <OverrideSelect
            label="入口"
            value={groupDraft.enabled}
            onChange={(value) => setGroupDraft((prev) => ({ ...prev, enabled: value }))}
          />
          <OverrideSelect
            label="仅观察"
            value={groupDraft.observeOnly}
            onChange={(value) => setGroupDraft((prev) => ({ ...prev, observeOnly: value }))}
          />
          <OverrideSelect
            label="发言"
            value={groupDraft.sendEnabled}
            onChange={(value) => setGroupDraft((prev) => ({ ...prev, sendEnabled: value }))}
          />
          <button
            onClick={saveGroup}
            disabled={saving}
            className="self-end px-4 py-2.5 rounded-lg bg-blue-500/20 text-blue-100 hover:bg-blue-500/30 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Save size={18} />
            保存群配置
          </button>
        </div>
        <div className="mt-4">
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={groupDraft.replyPolicyMode === 'custom'}
              onChange={(event) => setGroupDraft((prev) => ({
                ...prev,
                replyPolicyMode: event.target.checked ? 'custom' : 'inherit',
              }))}
            />
            覆盖本群回复阈值和冷却；不勾选则继承全局配置
          </label>
        </div>
        <div className="grid gap-4 mt-4 md:grid-cols-2">
          <NumberInput
            label="群级最低回复置信度"
            min="0"
            max="1"
            step="0.01"
            value={groupDraft.replyPolicy.minReplyScore}
            disabled={groupDraft.replyPolicyMode !== 'custom'}
            onChange={(value) => setGroupDraft((prev) => ({
              ...prev,
              replyPolicy: { ...prev.replyPolicy, minReplyScore: value },
            }))}
          />
          <NumberInput
            label="群级回复冷却"
            min="0"
            max="3600000"
            value={groupDraft.replyPolicy.cooldownMs}
            suffix="ms"
            disabled={groupDraft.replyPolicyMode !== 'custom'}
            onChange={(value) => setGroupDraft((prev) => ({
              ...prev,
              replyPolicy: { ...prev.replyPolicy, cooldownMs: value },
            }))}
          />
        </div>
        <div className="mt-6">
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={groupDraft.socialMode === 'custom'}
              onChange={(event) => setGroupDraft((prev) => ({
                ...prev,
                socialMode: event.target.checked ? 'custom' : 'inherit',
              }))}
            />
            覆盖本群社交插话配置；不勾选则继承全局配置
          </label>
        </div>
        <div className="mt-4">
          <SocialConfigFields
            value={groupDraft.social}
            disabled={groupDraft.socialMode !== 'custom'}
            onChange={(value) => setGroupDraft((prev) => ({ ...prev, social: value }))}
          />
        </div>

        <div className="mt-6">
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={groupDraft.humanlikeMode === 'custom'}
              onChange={(event) => setGroupDraft((prev) => ({
                ...prev,
                humanlikeMode: event.target.checked ? 'custom' : 'inherit',
              }))}
            />
            覆盖本群拟人化参与配置；不勾选则继承全局配置
          </label>
        </div>
        <div className="mt-4">
          <HumanlikeConfigFields
            participation={groupDraft.participation}
            timing={groupDraft.timing}
            replyer={groupDraft.replyer}
            expression={groupDraft.expression}
            disabled={groupDraft.humanlikeMode !== 'custom'}
            onChange={(patch) => setGroupDraft((prev) => ({ ...prev, ...patch }))}
          />
        </div>

        <div className="mt-6 grid gap-3">
          {groups.length === 0 && <div className="text-gray-500 text-sm">暂无群级 Agent 覆盖配置。</div>}
          {groups.map(([targetGroupId, config]) => (
            <div key={targetGroupId} className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between p-4 rounded-xl bg-black/20 border border-white/10">
              <div>
                <div className="font-mono text-white">{targetGroupId}</div>
                <div className="text-sm text-gray-400 mt-1">
                  入口 {formatOverride(config.enabled)} · 仅观察 {formatOverride(config.observeOnly)} · 发言 {formatOverride(config.sendEnabled)}
                  {config.replyPolicy && ` · 阈值 ${config.replyPolicy.minReplyScore ?? '-'} · 冷却 ${config.replyPolicy.cooldownMs ?? '-'}ms`}
                  {config.social && ` · 社交 ${formatBool(config.social.enabled)} / ${config.social.mode || 'quiet'}`}
                  {(config.participation || config.timing || config.replyer || config.expression) && ` · 拟人化 覆盖`}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => loadGroupDraft(targetGroupId, config)}
                  className="px-3 py-2 rounded-lg bg-white/10 text-white hover:bg-white/15"
                >
                  编辑
                </button>
                <button
                  onClick={() => deleteGroup(targetGroupId)}
                  className="px-3 py-2 rounded-lg bg-rose-500/20 text-rose-100 hover:bg-rose-500/30 flex items-center gap-2"
                >
                  <Trash2 size={16} />
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>

      {defaults && (
        <div className="text-xs text-gray-500">
          默认模式：{defaults.decisionMode}；默认工具开关：{formatBool(defaults.tools?.enabled)}。
        </div>
      )}
    </div>
  );
};

export default AgentSettings;
