import { Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { Button, ToggleSwitch } from '../../../../components/ui';

const TogglePanel = ({ title, description, checked, disabled = false, onChange }) => (
  <div className={clsx('rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3 sm:p-4', disabled && 'opacity-55')}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-[var(--fg)]">{title}</div>
        {description && <div className="mt-1 text-xs leading-relaxed text-[var(--muted)]">{description}</div>}
      </div>
      <ToggleSwitch checked={!!checked} disabled={disabled} onChange={onChange} label={title} />
    </div>
  </div>
);

const ToggleLine = ({ title, meta, checked, disabled = false, onChange }) => (
  <div className={clsx('flex items-center justify-between gap-3 border-b border-[var(--border)] px-3 py-2 last:border-b-0', disabled && 'opacity-55')}>
    <div className="min-w-0">
      <div className="truncate text-sm font-medium text-[var(--fg)]">{title}</div>
      {meta && <div className="mt-0.5 truncate font-mono text-xs text-[var(--muted)]">{meta}</div>}
    </div>
    <ToggleSwitch checked={!!checked} disabled={disabled} onChange={onChange} label={title} />
  </div>
);

const SyncTab = ({
  formData,
  setFormData,
  atAllRules,
  atAllCategoryItems,
  toggleAtAllSource,
  toggleAtAllCategory,
  setAllAtAllIdsEnabled,
  atAllTargetsLoading,
  atAllTargets,
  isAtAllUserEnabled,
  toggleAtAllUser,
  isCookieUserInSelectedSyncGroups,
  globalBiliStatus,
  biliGroupsLoading,
  biliGroups,
  toggleSyncGroup
}) => {
  const subscriptionAtAllEnabled = !!formData.subscriptionAtAll;
  const cookieSyncEnabled = !!formData.enableCookieSync;

  return (
    <div className="space-y-6 md:space-y-8 focus:outline-none">
      <TogglePanel
        title="订阅推送 @全体成员"
        description="开启后，订阅与关注同步推送会附带 @全体成员（需机器人具备权限）"
        checked={subscriptionAtAllEnabled}
        onChange={(checked) => setFormData({ ...formData, subscriptionAtAll: checked })}
      />

      <div className={clsx('rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 sm:p-4', !subscriptionAtAllEnabled && 'opacity-55')}>
        <div>
          <div className="text-sm font-semibold text-[var(--fg)]">`@全体` 细粒度规则</div>
          <div className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
            命中规则：总开关开启 AND 来源开启 AND 分类开启 AND 该来源下 UID 未被关闭
          </div>
          <div className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
            仅对订阅推送类型生效；收藏夹、音频、话题、文集等链接解析卡片不在此范围内。
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <section>
            <div className="mb-2 text-sm font-medium text-[var(--fg)]">来源开关</div>
            <div className="overflow-hidden rounded-lg border border-[var(--border)]">
              <ToggleLine
                title="手动订阅"
                checked={!!atAllRules.sources.manual}
                disabled={!subscriptionAtAllEnabled}
                onChange={(checked) => toggleAtAllSource('manual', checked)}
              />
              <ToggleLine
                title="关注同步"
                checked={!!atAllRules.sources.cookieSync}
                disabled={!subscriptionAtAllEnabled}
                onChange={(checked) => toggleAtAllSource('cookieSync', checked)}
              />
            </div>
          </section>

          <section>
            <div className="mb-2 text-sm font-medium text-[var(--fg)]">分类开关</div>
            <div className="grid overflow-hidden rounded-lg border border-[var(--border)] sm:grid-cols-2">
              {atAllCategoryItems.map((item) => (
                <ToggleLine
                  key={item.key}
                  title={item.label}
                  checked={!!atAllRules.categories[item.key]}
                  disabled={!subscriptionAtAllEnabled}
                  onChange={(checked) => toggleAtAllCategory(item.key, checked)}
                />
              ))}
            </div>
          </section>
        </div>

        <div className="mt-5 space-y-4">
          <section className="rounded-lg border border-[var(--border)]">
            <div className="flex flex-col gap-3 border-b border-[var(--border)] px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm font-medium text-[var(--fg)]">手动订阅用户</div>
              <div className="flex items-center gap-2">
                <Button type="button" size="sm" variant="secondary" onClick={() => setAllAtAllIdsEnabled('manual', true)} disabled={!subscriptionAtAllEnabled}>全开</Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => setAllAtAllIdsEnabled('manual', false)} disabled={!subscriptionAtAllEnabled}>全关</Button>
              </div>
            </div>
            {atAllTargetsLoading ? (
              <div className="flex items-center gap-2 px-3 py-4 text-sm text-[var(--muted)]">
                <Loader2 size={14} className="animate-spin" />
                正在加载 UID 列表...
              </div>
            ) : atAllTargets.manualUsers.length === 0 ? (
              <div className="px-3 py-4 text-sm italic text-[var(--muted)]">暂无手动订阅用户</div>
            ) : (
              <div className="grid sm:grid-cols-2">
                {atAllTargets.manualUsers.map((user) => (
                  <ToggleLine
                    key={`manual-${user.uid}`}
                    title={user.name}
                    meta={user.uid}
                    checked={isAtAllUserEnabled('manual', user.uid)}
                    disabled={!subscriptionAtAllEnabled}
                    onChange={(checked) => toggleAtAllUser('manual', user.uid, checked)}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-[var(--border)]">
            <div className="flex flex-col gap-3 border-b border-[var(--border)] px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm font-medium text-[var(--fg)]">关注同步用户</div>
              <div className="flex items-center gap-2">
                <Button type="button" size="sm" variant="secondary" onClick={() => setAllAtAllIdsEnabled('cookieSync', true)} disabled={!subscriptionAtAllEnabled}>全开</Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => setAllAtAllIdsEnabled('cookieSync', false)} disabled={!subscriptionAtAllEnabled}>全关</Button>
              </div>
            </div>
            {atAllTargetsLoading ? (
              <div className="flex items-center gap-2 px-3 py-4 text-sm text-[var(--muted)]">
                <Loader2 size={14} className="animate-spin" />
                正在加载 UID 列表...
              </div>
            ) : atAllTargets.cookieUsers.length === 0 ? (
              <div className="px-3 py-4 text-sm italic text-[var(--muted)]">暂无关注同步用户</div>
            ) : (
              <div className="grid sm:grid-cols-2">
                {atAllTargets.cookieUsers.map((user) => {
                  const matched = isCookieUserInSelectedSyncGroups(user);
                  return (
                    <ToggleLine
                      key={`cookie-${user.uid}`}
                      title={`${user.name}${matched ? ' · 命中同步分组' : ' · 不在当前同步分组'}`}
                      meta={user.uid}
                      checked={isAtAllUserEnabled('cookieSync', user.uid)}
                      disabled={!subscriptionAtAllEnabled}
                      onChange={(checked) => toggleAtAllUser('cookieSync', user.uid, checked)}
                    />
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>

      {!globalBiliStatus.isLoggedIn && (
        <div className="rounded-lg border border-[color-mix(in_oklch,var(--warn)_38%,var(--border))] bg-[var(--warn-soft)] p-4">
          <p className="mb-2 text-sm font-medium text-[color-mix(in_oklch,var(--warn)_88%,var(--fg))]">未检测到全局 B 站登录</p>
          <p className="mb-3 text-sm text-[var(--muted)]">
            关注列表同步需要先在系统设置中登录B站账号
          </p>
          <Link
            to="/settings"
            className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--fg)] transition-colors hover:bg-[var(--surface-muted)]"
          >
            前往系统设置
          </Link>
        </div>
      )}

      {globalBiliStatus.isLoggedIn && (
        <div>
          <div className="mb-4 rounded-lg border border-[color-mix(in_oklch,var(--success)_34%,var(--border))] bg-[var(--success-soft)] p-3">
            <div className="flex items-center gap-2 text-sm text-[color-mix(in_oklch,var(--success)_88%,var(--fg))]">
              <div className="h-2 w-2 rounded-sm bg-current" />
              <span className="break-all">已使用全局B站账号：{globalBiliStatus.username} (UID: {globalBiliStatus.uid})</span>
            </div>
          </div>

          <TogglePanel
            title="启用关注列表同步"
            description="自动同步所选分组的 UP 主更新"
            checked={cookieSyncEnabled}
            onChange={(checked) => setFormData({ ...formData, enableCookieSync: checked })}
          />

          <div className={clsx('mt-4 transition-opacity', !cookieSyncEnabled && 'opacity-55 pointer-events-none')}>
            <h4 className="mb-3 text-sm font-medium text-[var(--fg)]">选择要同步的关注分组</h4>

            {biliGroupsLoading ? (
              <div className="flex items-center gap-2 text-[var(--muted)]">
                <Loader2 size={16} className="animate-spin" />
                正在获取分组...
              </div>
            ) : biliGroups.length === 0 ? (
              <div className="text-sm italic text-[var(--muted)]">
                未找到关注分组，请先登录 Bilibili 账号。
              </div>
            ) : (
              <div className="grid overflow-hidden rounded-lg border border-[var(--border)] sm:grid-cols-2 md:grid-cols-3">
                {biliGroups.map((group) => {
                  const groupName = typeof group === 'string' ? group : group.name;
                  return (
                    <ToggleLine
                      key={groupName}
                      title={groupName}
                      checked={formData.cookieSyncGroupNames.includes(groupName)}
                      onChange={() => toggleSyncGroup(groupName)}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SyncTab;
