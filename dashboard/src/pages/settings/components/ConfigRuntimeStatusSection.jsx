import GlassCard from '../../../components/GlassCard'
import SettingRow from '../../../components/SettingRow'
import { Button, StatusPill } from '../../../components/ui'
import { RefreshCw, RotateCcw, Settings2 } from 'lucide-react'

const MIGRATION_WARNING_LABELS = {
    LEGACY_INFLIGHT_DELIVERY_AMBIGUOUS: '首次旧版切换存在窄化的在途投递不确定窗口',
    LEGACY_DETACHED_OUTBOUND_AMBIGUOUS: '旧版 detached outbound 无法确定远端结果',
    LEGACY_FORCED_STOP_BEST_EFFORT: '旧版曾执行 forced stop，按 best-effort 恢复',
    LEGACY_NETWORK_FENCE_UNAVAILABLE: '旧版网络 fence 不可用'
}

function ConfigRuntimeStatusSection({ status, migration, lastApplyResult, reloading, onReload, recovering, recoveryResult, onRecover }) {
    const generation = status?.documentGeneration ?? status?.generation ?? 0
    const effectiveGeneration = status?.effectiveGeneration ?? 0
    const deploymentPaths = status?.pendingDeploymentApply ?? lastApplyResult?.deploymentApplyRequired ?? []
    const deployment = status?.deployment || null
    const warnings = migration?.warningCodes || []
    const recovery = status?.recoveryRequired?.required ? status.recoveryRequired : null
    const pendingRecovery = status?.pendingRuntimeRecovery || null
    const rollbackErrors = recovery?.rollbackErrors || pendingRecovery?.rollbackErrors || []

    return (
        <section>
            <div className="mb-4 flex flex-wrap items-center gap-2">
                <Settings2 className="text-[var(--accent)]" />
                <h2 className="text-xl font-semibold text-[var(--fg)]">配置运行状态</h2>
                <StatusPill tone={status?.valid ? 'success' : 'danger'}>{status?.valid ? '有效' : '未就绪'}</StatusPill>
                {recovery && <StatusPill tone="danger">Recovery required</StatusPill>}
                {migration?.deliveryGuarantee === 'best-effort' && <StatusPill tone="warn">Legacy best-effort</StatusPill>}
            </div>
            <GlassCard>
                <div className="divide-y divide-[var(--border-subtle)]">
                    <SettingRow
                        title="Generation"
                        description="文档 revision 与实际生效 revision 分开计数；保存冲突会返回 409。"
                        status={<StatusPill tone="accent">Doc {generation} / Effective {effectiveGeneration}</StatusPill>}
                        control={
                            <Button type="button" size="sm" icon={RefreshCw} disabled={reloading || recovering || Boolean(recovery)} onClick={onReload}>
                                {reloading ? '加载中' : '从磁盘重载'}
                            </Button>
                        }
                    />
                    {recovery && (
                        <SettingRow
                            title="运行时恢复"
                            description={`阶段：recovery-required；原因：${recovery.reason || 'CONFIG_RECOVERY_REQUIRED'}；错误码：${recovery.code || 'CONFIG_RECOVERY_REQUIRED'}${recovery.diskRestoreFailed ? '；磁盘恢复需要由运维先处理' : ''}`}
                            status={<StatusPill tone={recoveryResult?.ok ? 'success' : 'danger'}>{recovering ? '恢复中' : recoveryResult?.ok === false ? '上次失败' : '等待恢复'}</StatusPill>}
                            control={
                                <div className="max-w-xl space-y-2 text-right">
                                    {pendingRecovery?.handlers?.length > 0 && (
                                        <div className="font-mono text-xs text-[var(--muted)]">组件：{pendingRecovery.handlers.join(', ')}</div>
                                    )}
                                    {rollbackErrors.map((entry, index) => (
                                        <div key={`${entry.handlerId || 'runtime'}-${entry.phase || 'rollback'}-${index}`} className="font-mono text-xs text-[var(--danger)]">
                                            {entry.handlerId || 'runtime'} / {entry.phase || 'rollback'} / {entry.code || 'CONFIG_RECOVERY_FAILED'}
                                        </div>
                                    ))}
                                    {recoveryResult?.ok === false && (
                                        <div className="font-mono text-xs text-[var(--danger)]">{recoveryResult.phase} / {recoveryResult.code}</div>
                                    )}
                                    <Button type="button" size="sm" variant="danger" icon={RotateCcw} disabled={recovering || recovery.diskRestoreFailed} onClick={onRecover}>
                                        {recovering ? '正在恢复...' : recoveryResult?.ok === false ? '重试恢复' : '恢复运行时'}
                                    </Button>
                                </div>
                            }
                        />
                    )}
                    {!recovery && recoveryResult?.ok && (
                        <SettingRow
                            title="最近恢复"
                            description={`运行时恢复成功；Doc ${recoveryResult.documentGeneration} / Effective ${recoveryResult.effectiveGeneration}。`}
                            status={<StatusPill tone="success">已恢复</StatusPill>}
                            control={recoveryResult.handlers?.length > 0 && <span className="font-mono text-xs text-[var(--muted)]">{recoveryResult.handlers.join(', ')}</span>}
                        />
                    )}
                    <SettingRow
                        title="最近 Reload"
                        description={status?.lastFailedReloadAt
                            ? `最近失败：${status.lastFailedReloadAt}（继续使用上一有效快照）`
                            : '无已知 reload 失败。'}
                        status={<span className="text-xs text-[var(--muted)]">{status?.lastSuccessfulReloadAt || '尚无记录'}</span>}
                    />
                    <SettingRow
                        title="Migration"
                        description={migration
                            ? `${migration.checkpoint} / ${migration.phase} / ${migration.deliveryGuarantee}`
                            : '当前没有活动 migration manifest。'}
                        status={migration && <StatusPill tone={migration.appliesToCommittedRuntime ? 'success' : 'neutral'}>{migration.checkpoint}</StatusPill>}
                        control={warnings.length > 0 && (
                            <div className="max-w-xl text-right text-xs leading-relaxed text-[var(--warn)]">
                                {warnings.map((code) => <div key={code}>{MIGRATION_WARNING_LABELS[code] || code}</div>)}
                            </div>
                        )}
                    />
                    <SettingRow
                        title="Deployment Apply"
                        description={deploymentPaths.length > 0
                            ? '以下宿主机端口、挂载或网络变更需要执行 setup --apply；应用不会伪装成已热重载。'
                            : `没有等待执行的部署级变更。${deployment?.appliedGeneration ? ` 已应用基线 #${deployment.appliedGeneration}。` : ''}`}
                        status={<StatusPill tone={deploymentPaths.length > 0 ? 'warn' : 'success'}>{deploymentPaths.length} 项</StatusPill>}
                        control={deploymentPaths.length > 0 && (
                            <div className="max-w-xl text-right font-mono text-xs text-[var(--muted)]">
                                {deploymentPaths.map((item) => <div key={item}>{item}</div>)}
                            </div>
                        )}
                    />
                </div>
            </GlassCard>
        </section>
    )
}

export default ConfigRuntimeStatusSection
