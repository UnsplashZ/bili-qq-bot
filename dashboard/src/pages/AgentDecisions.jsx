import React, { useCallback, useEffect, useState } from 'react';
import { Activity, Filter, RefreshCw } from 'lucide-react';
import GlassCard from '../components/GlassCard';
import api from '../utils/auth';
import { useToast } from '../hooks/useToast';

const ACTIONS = [
  '',
  'observe_only',
  'short_reply',
  'full_reply',
  'ask_clarify',
  'casual_interject',
  'ambient_react',
  'tool_plan',
  'defer',
];

const SPAN_TYPES = [
  '',
  'message_received',
  'input_guardrail',
  'context_selected',
  'llm_decision',
  'decision_guardrail',
  'tool_plan',
  'tool_guardrail',
  'tool_confirmation',
  'tool_execute',
  'tool_result_reply',
  'output_guardrail',
  'reply_sent',
];

function todayKey() {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function formatTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

function badgeClass(action) {
  if (['short_reply', 'full_reply', 'ask_clarify'].includes(action)) {
    return 'bg-blue-500/15 text-blue-200 border-blue-400/30';
  }
  if (action === 'casual_interject') return 'bg-fuchsia-500/15 text-fuchsia-100 border-fuchsia-400/30';
  if (action === 'ambient_react') return 'bg-cyan-500/15 text-cyan-100 border-cyan-400/30';
  if (action === 'tool_plan') return 'bg-amber-500/15 text-amber-200 border-amber-400/30';
  if (action === 'observe_only' || action === 'defer') return 'bg-slate-500/15 text-slate-200 border-slate-400/30';
  return 'bg-purple-500/15 text-purple-200 border-purple-400/30';
}

function compactList(value) {
  return Array.isArray(value) && value.length > 0 ? value.join(', ') : '-';
}

function formatPercent(count, total) {
  if (!total) return '0%';
  return `${Math.round((Number(count || 0) / total) * 100)}%`;
}

function topReasonText(summary) {
  const reasons = summary?.topPolicyReasons || [];
  if (!Array.isArray(reasons) || reasons.length === 0) return '-';
  return reasons.slice(0, 3).map((item) => `${item.key}:${item.count}`).join(' / ');
}

function topSpanText(summary) {
  const counts = summary?.spanCounts || {};
  const spans = Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4);
  return spans.length > 0 ? spans.map(([key, count]) => `${key}:${count}`).join(' / ') : '-';
}

function spanBadgeClass(status) {
  if (status === 'blocked' || status === 'failed') return 'bg-red-500/15 text-red-200 border-red-400/25';
  if (status === 'skipped' || status === 'pending') return 'bg-slate-500/15 text-slate-200 border-slate-400/25';
  return 'bg-cyan-500/15 text-cyan-100 border-cyan-400/25';
}

function DecisionCard({ item }) {
  const llmAction = item.llmDecision?.action || '-';
  const finalAction = item.policyDecision?.finalAction || '-';
  const sent = item.execution?.executed;

  return (
    <GlassCard>
      <div className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`px-2.5 py-1 rounded-full text-xs border ${badgeClass(finalAction || llmAction)}`}>
                {finalAction || llmAction}
              </span>
              <span className={`px-2.5 py-1 rounded-full text-xs ${sent ? 'bg-emerald-500/20 text-emerald-200' : 'bg-slate-500/20 text-slate-300'}`}>
                {sent ? '已发送' : '未发送'}
              </span>
              {item.llmDecision?.repaired && (
                <span className="px-2.5 py-1 rounded-full text-xs bg-amber-500/20 text-amber-200">JSON repaired</span>
              )}
              {item.tool && (
                <span className="px-2.5 py-1 rounded-full text-xs bg-orange-500/20 text-orange-200">
                  {item.tool.status || 'tool'}
                </span>
              )}
            </div>
            <div className="text-sm text-gray-400">
              {formatTime(item.recordedAt)} · 群 {item.groupId || '-'} · 用户 {item.userId || '-'} · {item.type || '-'}
            </div>
          </div>
          <div className="text-xs text-gray-500 font-mono break-all md:text-right">
            {item.traceScope || item.messageId || '-'}
          </div>
        </div>

        {item.rawTextPreview && (
          <div className="rounded-lg bg-black/20 border border-white/10 p-3 text-gray-200 break-words">
            {item.rawTextPreview}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <div className="text-sm font-medium text-gray-200">Rule</div>
            <div className="text-sm text-gray-400">动作：{item.ruleDecision?.action || '-'}</div>
            <div className="text-sm text-gray-400">分数：{item.ruleDecision?.score ?? '-'}</div>
            <div className="text-xs text-gray-500">原因：{compactList(item.ruleDecision?.reasons)}</div>
            <div className="text-xs text-gray-500">惩罚：{compactList(item.ruleDecision?.penalties)}</div>
          </div>
          <div className="space-y-2">
            <div className="text-sm font-medium text-gray-200">LLM</div>
            <div className="text-sm text-gray-400">动作：{llmAction}</div>
            <div className="text-sm text-gray-400">置信度：{item.llmDecision?.confidence ?? '-'}</div>
            <div className="text-xs text-gray-500">模型：{item.llmDecision?.model || '-'}</div>
            <div className="text-xs text-gray-500">Tokens：{item.llmDecision?.totalTokens ?? '-'}</div>
          </div>
          <div className="space-y-2">
            <div className="text-sm font-medium text-gray-200">Policy</div>
            <div className="text-sm text-gray-400">最终：{finalAction}</div>
            <div className="text-sm text-gray-400">发送：{item.policyDecision?.wouldSend ? '是' : '否'}</div>
            <div className="text-xs text-gray-500">原因：{item.policyDecision?.reason || '-'}</div>
            <div className="text-xs text-gray-500">执行：{item.execution?.reason || '-'}</div>
          </div>
        </div>

        {item.llmDecision?.reason && (
          <div className="text-sm text-gray-300">
            <span className="text-gray-500">LLM 理由：</span>
            {item.llmDecision.reason}
          </div>
        )}
        {item.llmDecision?.replyDraftPreview && (
          <div className="text-sm text-blue-100 bg-blue-500/10 border border-blue-400/20 rounded-lg p-3">
            {item.llmDecision.replyDraftPreview}
          </div>
        )}
        {item.tool && (
          <div className="text-sm text-amber-100 bg-amber-500/10 border border-amber-400/20 rounded-lg p-3 space-y-1">
            <div>
              工具：{item.tool.name || '-'} · 状态：{item.tool.status || '-'} · 风险：{item.tool.risk || '-'}
            </div>
            <div>{item.tool.summary || item.tool.reason || '-'}</div>
            {item.tool.confirmation?.shortId && (
              <div className="text-xs text-amber-200/80">
                确认码：{item.tool.confirmation.shortId} · 过期：{formatTime(item.tool.confirmation.expiresAt)}
              </div>
            )}
            {(item.tool.resultMessage || item.tool.error || item.tool.reason) && (
              <div className="text-xs text-amber-200/80">
                结果：{item.tool.resultMessage || item.tool.error || item.tool.reason}
              </div>
            )}
            {item.tool.replyDecision && (
              <div className="text-xs text-amber-100/90">
                结果回复：{item.tool.replyDecision.status || '-'} · {item.tool.replyDecision.action || '-'}
                {item.tool.replyDecision.replyDraftPreview ? ` · ${item.tool.replyDecision.replyDraftPreview}` : ''}
              </div>
            )}
          </div>
        )}
        {Array.isArray(item.spans) && item.spans.length > 0 && (
          <div className="rounded-lg bg-cyan-500/10 border border-cyan-400/20 p-3 space-y-2">
            <div className="text-sm font-medium text-cyan-100">Trace Spans</div>
            <div className="flex flex-wrap gap-2">
              {item.spans.map((span, spanIndex) => (
                <span
                  key={`${span.type}-${spanIndex}`}
                  className={`px-2.5 py-1 rounded-full text-xs border ${spanBadgeClass(span.status)}`}
                  title={span.reason || ''}
                >
                  {span.type}:{span.status || 'ok'}
                </span>
              ))}
            </div>
          </div>
        )}
        {(item.memoryWrite || item.topicSummaryWrite) && (
          <div className="text-xs text-emerald-100 bg-emerald-500/10 border border-emerald-400/20 rounded-lg p-3">
            记忆：写入 {item.memoryWrite?.stored ?? 0}，跳过 {item.memoryWrite?.skipped ?? 0}
            {item.topicSummaryWrite?.stored ? ` · 话题摘要 ${item.topicSummaryWrite.stored}` : ''}
            {item.memoryWrite?.error ? ` · 错误：${item.memoryWrite.error}` : ''}
          </div>
        )}
      </div>
    </GlassCard>
  );
}

function PendingConfirmationCard({ confirmation }) {
  return (
    <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 p-4 space-y-2">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="font-medium text-amber-100">
            {confirmation.plan?.summary || confirmation.plan?.name || '待确认工具'}
          </div>
          <div className="text-sm text-amber-200/80">
            群 {confirmation.groupId || '-'} · 用户 {confirmation.userId || '-'} · 风险 {confirmation.plan?.risk || '-'}
          </div>
        </div>
        <div className="text-sm font-mono text-amber-100">
          {confirmation.shortId}
        </div>
      </div>
      <div className="text-xs text-amber-200/70">
        请在 QQ 中 @Bot 回复「确认 {confirmation.shortId}」或「取消 {confirmation.shortId}」；过期：{formatTime(confirmation.expiresAt)}
      </div>
    </div>
  );
}

const AgentDecisions = () => {
  const { show } = useToast();
  const [items, setItems] = useState([]);
  const [confirmations, setConfirmations] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    date: todayKey(),
    groupId: '',
    userId: '',
    action: '',
    spanType: '',
    limit: 100,
  });

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.date.trim()) params.set('date', filters.date.trim());
      if (filters.groupId.trim()) params.set('groupId', filters.groupId.trim());
      if (filters.userId.trim()) params.set('userId', filters.userId.trim());
      if (filters.action.trim()) params.set('action', filters.action.trim());
      if (filters.spanType.trim()) params.set('spanType', filters.spanType.trim());
      params.set('limit', String(filters.limit || 100));
      const confirmationParams = new URLSearchParams();
      if (filters.groupId.trim()) confirmationParams.set('groupId', filters.groupId.trim());
      if (filters.userId.trim()) confirmationParams.set('userId', filters.userId.trim());
      const [trajectoryResponse, confirmationResponse] = await Promise.all([
        api.get(`/api/agent/trajectories?${params.toString()}`),
        api.get(`/api/agent/confirmations?${confirmationParams.toString()}`),
      ]);
      setItems(trajectoryResponse.data.items || []);
      setSummary(trajectoryResponse.data.summary || null);
      setConfirmations(confirmationResponse.data.items || []);
    } catch (error) {
      console.error('Failed to load agent decisions:', error);
      show(error.response?.data?.error || '加载 Agent 决策失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [filters, show]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const updateFilter = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Activity className="text-cyan-300" />
            Agent 决策
          </h1>
          <p className="text-gray-400 mt-2">
            查看 Agent 最近的 rule score、LLM decision、policy validator 和发送结果，用于调试为什么回复或不回复。
          </p>
        </div>
        <button
          onClick={loadItems}
          disabled={loading}
          className="px-4 py-2.5 rounded-lg bg-blue-500/20 text-blue-100 hover:bg-blue-500/30 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          刷新
        </button>
      </div>

      <GlassCard>
        <div className="grid gap-3 md:grid-cols-6">
          <label className="space-y-1.5">
            <span className="text-sm text-gray-300">日期</span>
            <input
              type="date"
              value={filters.date}
              onChange={(event) => updateFilter('date', event.target.value)}
              className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2.5 text-white"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-sm text-gray-300">群号</span>
            <input
              value={filters.groupId}
              onChange={(event) => updateFilter('groupId', event.target.value)}
              placeholder="可选"
              className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2.5 text-white placeholder:text-gray-500"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-sm text-gray-300">用户 QQ</span>
            <input
              value={filters.userId}
              onChange={(event) => updateFilter('userId', event.target.value)}
              placeholder="可选"
              className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2.5 text-white placeholder:text-gray-500"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-sm text-gray-300">动作</span>
            <select
              value={filters.action}
              onChange={(event) => updateFilter('action', event.target.value)}
              className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2.5 text-white"
            >
              {ACTIONS.map((action) => (
                <option key={action || 'all'} value={action}>
                  {action || '全部'}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-sm text-gray-300">Span</span>
            <select
              value={filters.spanType}
              onChange={(event) => updateFilter('spanType', event.target.value)}
              className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2.5 text-white"
            >
              {SPAN_TYPES.map((spanType) => (
                <option key={spanType || 'all'} value={spanType}>
                  {spanType || '全部'}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-sm text-gray-300">数量</span>
            <input
              type="number"
              min="1"
              max="300"
              value={filters.limit}
              onChange={(event) => updateFilter('limit', event.target.value)}
              className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2.5 text-white"
            />
          </label>
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
          <Filter size={14} />
          日期为空时会读取所有轨迹文件并返回最近记录；页面只展示已脱敏摘要。
        </div>
      </GlassCard>

      {summary && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <GlassCard>
            <div className="text-sm text-gray-400">轨迹总数</div>
            <div className="text-2xl font-semibold text-white mt-1">{summary.total || 0}</div>
            <div className="text-xs text-gray-500 mt-1">当前筛选返回范围</div>
          </GlassCard>
          <GlassCard>
            <div className="text-sm text-gray-400">发送比例</div>
            <div className="text-2xl font-semibold text-blue-100 mt-1">
              {summary.sent || 0} / {formatPercent(summary.sent, summary.total)}
            </div>
            <div className="text-xs text-gray-500 mt-1">实际发出普通/系统回复</div>
          </GlassCard>
          <GlassCard>
            <div className="text-sm text-gray-400">工具轨迹</div>
            <div className="text-2xl font-semibold text-amber-100 mt-1">{summary.toolCount || 0}</div>
            <div className="text-xs text-gray-500 mt-1">tool_plan / confirmation</div>
          </GlassCard>
          <GlassCard>
            <div className="text-sm text-gray-400">记忆写入</div>
            <div className="text-2xl font-semibold text-emerald-100 mt-1">{summary.memoryStored || 0}</div>
            <div className="text-xs text-gray-500 mt-1">跳过 {summary.memorySkipped || 0}</div>
          </GlassCard>
          <GlassCard>
            <div className="text-sm text-gray-400">主要拒绝/策略原因</div>
            <div className="text-sm text-gray-200 mt-2 break-words">{topReasonText(summary)}</div>
          </GlassCard>
          <GlassCard>
            <div className="text-sm text-gray-400">主要 Span</div>
            <div className="text-sm text-gray-200 mt-2 break-words">{topSpanText(summary)}</div>
          </GlassCard>
        </div>
      )}

      {confirmations.length > 0 && (
        <GlassCard>
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-lg font-semibold text-white">待确认工具</h2>
              <p className="text-sm text-gray-400 mt-1">
                这里只展示当前进程内仍未过期的受限工具确认，不在 WebUI 直接执行。
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs bg-amber-500/20 text-amber-200">
              {confirmations.length}
            </span>
          </div>
          <div className="grid gap-3">
            {confirmations.map((confirmation) => (
              <PendingConfirmationCard key={confirmation.id} confirmation={confirmation} />
            ))}
          </div>
        </GlassCard>
      )}

      <div className="grid gap-4">
        {items.length === 0 && (
          <GlassCard>
            <div className="text-gray-400 text-center py-8">
              {loading ? '加载中...' : '暂无 Agent 决策轨迹'}
            </div>
          </GlassCard>
        )}
        {items.map((item, index) => (
          <DecisionCard key={`${item.recordedAt}-${item.traceScope}-${index}`} item={item} />
        ))}
      </div>
    </div>
  );
};

export default AgentDecisions;
