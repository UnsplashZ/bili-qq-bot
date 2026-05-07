import React, { useCallback, useEffect, useState } from 'react';
import { Bot, RefreshCw, Save, ShieldCheck, Trash2 } from 'lucide-react';
import GlassCard from '../components/GlassCard';
import SettingRow from '../components/SettingRow';
import { Button, ToggleSwitch } from '../components/ui';
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
      <div>
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
        <NumberInput label="学习最少消息" min="6" max="200" value={expression?.learningMinMessages} suffix="条" disabled={disabled} onChange={(value) => updateExpression('learningMinMessages', value)} />
        <NumberInput label="学习最小间隔" min="60000" max="86400000" value={expression?.learningMinIntervalMs} suffix="ms" disabled={disabled} onChange={(value) => updateExpression('learningMinIntervalMs', value)} />
      </div>
      <Toggle label="允许引用回复" description="后续可用于 quote target。" checked={replyer?.allowQuoteReply !== false} disabled={disabled} onChange={(checked) => updateReplyer('allowQuoteReply', checked)} />
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
          className="field-control w-full px-3 py-2.5 disabled:opacity-60"
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
        className="field-control w-full px-3 py-2.5 placeholder:text-gray-500 disabled:opacity-60"
      />
    </label>
  );
}

function Toggle({ label, description, checked, onChange, disabled = false }) {
  return (
    <SettingRow
      title={label}
      description={description}
      control={(
        <ToggleSwitch
          checked={!!checked}
          onChange={onChange}
          label={label}
          disabled={disabled}
        />
      )}
    />
  );
}

function CheckboxRow({ label, checked, disabled = false, onChange, trailing }) {
  return (
    <div className={`flex items-center justify-between gap-3 border-b border-[var(--border)] py-3 last:border-b-0 ${disabled ? 'opacity-60' : ''}`}>
      <div className="min-w-0">
        <span className="text-sm font-medium text-[var(--fg)]">{label}</span>
        {trailing && <span className="ml-2 text-xs text-[var(--muted)]">{trailing}</span>}
      </div>
      <ToggleSwitch
        checked={!!checked}
        disabled={disabled}
        label={label}
        onChange={onChange}
      />
    </div>
  );
}

function FieldRow({ title, description, children, status }) {
  return (
    <SettingRow
      title={title}
      description={description}
      status={status}
      control={(
        <div className="w-full min-w-0 md:w-72">
          {children}
        </div>
      )}
    />
  );
}

function PlainStatus({ children, tone = 'slate' }) {
  const toneClass = tone === 'amber' ? 'border-amber-300/30 text-amber-200' : 'border-white/10 text-gray-400';
  return (
    <div className={`mt-4 space-y-1 border-l pl-3 text-sm ${toneClass}`}>
      {children}
    </div>
  );
}

function GroupDraftToggle({ checked, onChange, children }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] py-3 text-sm text-[var(--fg)] last:border-b-0">
      <span>{children}</span>
      <ToggleSwitch
        checked={!!checked}
        onChange={onChange}
        label={typeof children === 'string' ? children : '群级覆盖'}
      />
    </div>
  );
}

function ModeSelect({ value, disabled, onChange }) {
  return (
    <FieldRow title="活跃模式">
      <select
        value={value || 'quiet'}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2.5 text-white disabled:opacity-60"
      >
        {SOCIAL_MODES.map((mode) => (
          <option key={mode.value} value={mode.value}>{mode.label} / {mode.value}</option>
        ))}
      </select>
    </FieldRow>
  );
}

function OverrideSelect({ label, value, onChange }) {
  return (
    <label className="space-y-1.5">
      <span className="text-sm text-gray-300">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="field-control w-full px-3 py-2.5"
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
      <div>
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
        <ModeSelect
          value={value?.mode || 'quiet'}
          disabled={disabled}
          onChange={(nextValue) => update('mode', nextValue)}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
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

  const saveAll = async () => {
    if (!agent) return;
    const normalizedGroupId = groupId.trim();
    if (normalizedGroupId && !/^\d+$/.test(normalizedGroupId)) {
      show('请输入有效群号，或清空群号后只保存全局配置', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...agent,
        aliases: aliasesText,
      };
      const response = await api.put('/api/agent/config', payload);
      let nextAgent = response.data.agent;
      setLlmEnv(response.data.llmEnv || {});
      setAliasesText(Array.isArray(nextAgent.aliases) ? nextAgent.aliases.join('\n') : '');
      if (normalizedGroupId) {
        const groupPayload = {
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
        const groupResponse = await api.put(`/api/agent/groups/${encodeURIComponent(normalizedGroupId)}`, groupPayload);
        nextAgent = groupResponse.data.agent;
      }
      setAgent(nextAgent);
      show(normalizedGroupId ? `Agent 全局和群 ${normalizedGroupId} 覆盖配置已保存` : 'Agent 配置已保存', 'success');
    } catch (error) {
      console.error('Failed to save agent config:', error);
      show(error.response?.data?.error || '保存 Agent 配置失败', 'error');
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
          <div className="font-mono text-xs font-semibold uppercase text-[var(--accent)]">Automation</div>
          <h1 className="mt-1 flex items-center gap-3 text-3xl font-semibold text-[var(--fg)]">
            <Bot className="text-[var(--accent)]" />
            Agent 管理
          </h1>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={loadConfig}
            disabled={loading}
            variant="secondary"
            icon={RefreshCw}
          >
            刷新
          </Button>
          <Button
            onClick={saveAll}
            disabled={saving}
            variant="primary"
            icon={Save}
          >
            保存设置
          </Button>
        </div>
      </div>

      <GlassCard>
        <div>
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
              className="field-control w-full px-3 py-2.5 placeholder:text-gray-500"
            />
          </label>
        </GlassCard>

        <GlassCard>
          <h2 className="text-xl font-semibold mb-4">LLM 与预算</h2>
          <div>
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
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
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
          <PlainStatus tone={llmEnv.apiKeyConfigured ? 'slate' : 'amber'}>
            <div>API Key：{llmEnv.apiKeyConfigured ? '已配置' : '未配置'}</div>
            {(llmEnv.providerOverridden || llmEnv.baseURLOverridden || llmEnv.modelOverridden || llmEnv.apiKeyEnvOverridden) && (
              <div className="text-amber-300">部分 LLM 字段由 `.env` 覆盖，保存后运行时仍以环境变量为准。</div>
            )}
          </PlainStatus>
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
                className="field-control w-full px-3 py-2.5 placeholder:text-gray-500"
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
                className="field-control w-full px-3 py-2.5 placeholder:text-gray-500"
              />
            </label>
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
        </GlassCard>
      </div>

      <GlassCard>
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <ShieldCheck className="text-emerald-300" />
          受限工具
        </h2>
        <div>
          <Toggle
            label="允许工具执行"
            description="开启后 Agent 可输出 tool_plan，经权限和确认后执行白名单工具。"
            checked={agent.tools?.enabled}
            onChange={(value) => updateAgent((next) => { next.tools.enabled = value; })}
          />
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <NumberInput
            label="确认有效期"
            min="10000"
            max="3600000"
            value={agent.tools?.confirmationTtlMs}
            suffix="ms"
            onChange={(value) => updateAgent((next) => { next.tools.confirmationTtlMs = value; })}
          />
        </div>
        <div className="mt-4">
          {RISK_LEVELS.map((risk) => (
            <CheckboxRow
              key={risk.value}
              label={`${risk.label} 需要确认`}
              checked={risk.value === 'high' || (agent.tools?.requireConfirmationFor || []).includes(risk.value)}
              disabled={risk.value === 'high'}
              trailing={risk.value === 'high' ? '强制' : ''}
              onChange={(checked) => updateAgent((next) => {
                  const current = new Set(next.tools.requireConfirmationFor || []);
                  if (checked) current.add(risk.value);
                  else current.delete(risk.value);
                  next.tools.requireConfirmationFor = Array.from(current);
                })}
            />
          ))}
        </div>
      </GlassCard>

      <GlassCard>
        <h2 className="text-xl font-semibold mb-4">群级覆盖</h2>
        <div className="grid gap-4 md:grid-cols-4">
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
        </div>
        <div className="mt-4">
          <GroupDraftToggle
            checked={groupDraft.replyPolicyMode === 'custom'}
            onChange={(checked) => setGroupDraft((prev) => ({
              ...prev,
              replyPolicyMode: checked ? 'custom' : 'inherit',
            }))}
          >
            覆盖本群回复阈值和冷却
          </GroupDraftToggle>
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
          <GroupDraftToggle
            checked={groupDraft.socialMode === 'custom'}
            onChange={(checked) => setGroupDraft((prev) => ({
              ...prev,
              socialMode: checked ? 'custom' : 'inherit',
            }))}
          >
            覆盖本群社交插话配置
          </GroupDraftToggle>
        </div>
        <div className="mt-4">
          <SocialConfigFields
            value={groupDraft.social}
            disabled={groupDraft.socialMode !== 'custom'}
            onChange={(value) => setGroupDraft((prev) => ({ ...prev, social: value }))}
          />
        </div>

        <div className="mt-6">
          <GroupDraftToggle
            checked={groupDraft.humanlikeMode === 'custom'}
            onChange={(checked) => setGroupDraft((prev) => ({
              ...prev,
              humanlikeMode: checked ? 'custom' : 'inherit',
            }))}
          >
            覆盖本群拟人化参与配置
          </GroupDraftToggle>
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
            <div key={targetGroupId} className="flex flex-col gap-3 border-l border-white/10 py-3 pl-4 md:flex-row md:items-center md:justify-between">
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
                  className="rounded-lg border border-white/10 px-3 py-2 text-white hover:bg-white/5"
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
    </div>
  );
};

export default AgentSettings;
