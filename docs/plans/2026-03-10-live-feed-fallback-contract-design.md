# Live Feed/Fallback Contract Design

## 背景

当前直播订阅链路采用 `feed -> manual fallback` 的两阶段模型：

- `processLiveFeed()` 先基于 cookie 关注列表处理直播 feed
- `checkAll()` 再对 manual 用户逐个执行 `checkUserLive()`
- 如果某个 UID 被记入 `feedCoverage.liveUids`，manual live fallback 会被跳过

线上问题已经证明，当前 `liveUids` 的语义不可靠：

- `51628309` 在定时轮询中持续只有 `POST /user_info`，没有 `POST /live_room`
- 同一容器内直接执行 `checkUserLive(51628309)` 时，能够立即进入 `/live_room` 并进入通知分支
- 这说明 `checkUserLive()` 本身可用，故障点在于 feed 过早宣称“该 UID 已被覆盖”，导致 manual fallback 被错误跳过

## 目标

- 将直播订阅稳定收敛到 `feed-first, fallback-second`
- 严格区分“feed 看到了某个 UID”和“feed 已经可靠处理完 manual 侧”
- 让 fallback 的跳过条件基于处理结果，而不是基于 feed 命中
- 为后续动态、视频、专栏统一 `feed/fallback` 契约打基础

## 非目标

- 本轮不把视频、专栏立即改造成 feed-first
- 本轮不重构整个订阅调度框架
- 本轮不引入持久化的 feed 结果状态

## 方案对比

### 方案 A：继续补条件判断

在现有 `coveredUids` 逻辑上继续加 if 条件，避免明显的误覆盖。

优点：

- 改动最小
- 可快速缓解单一分支问题

缺点：

- `coveredUids` 的语义仍然模糊
- 后续仍会反复出现“看见了但没真正处理完”的误跳过问题

### 方案 B：显式定义 feed 结果契约

将直播 feed 的输出改成明确语义的“manual 已覆盖结果”，只在 manual 分支被可靠处理后才允许跳过 fallback。

优点：

- 能直接解决这次线上问题
- 结果语义清晰，日志和测试都更容易写
- 可作为后续统一 `feed/fallback` 模式的基线

缺点：

- 比补 if 略大一层改动
- 需要同步调整测试和日志

### 方案 C：彻底统一直播检查

取消 feed/live 与 manual/live 的双路径，改成统一用户列表单点查询。

优点：

- 架构最干净
- 调试路径最简单

缺点：

- 偏结构性改造，不适合当前线上问题窗口
- 会放弃 feed-first 的优势

## 推荐方案

采用方案 B。

直播继续保持 `feed-first, fallback-second`，但将跳过 fallback 的依据改为“feed 是否可靠处理了 manual 侧”，而不是“feed 是否见过这个 UID”。

## 设计要点

### 1. 重新定义 live coverage

当前 `feedCoverage.liveUids` 的真实用途不是“feed 看过的 UID”，而是“manual live fallback 可以安全跳过的 UID”。

因此语义必须收紧为：

> 只有当本轮 feed 的处理结果与后续 manual `checkUserLive()` 等价时，才能加入 live coverage。

可以继续保留集合结构，但语义上应视为：

- `manualLiveCoveredUids`

而不是泛化的 `liveUids`。

### 2. 将 seen 和 covered 分离

在 `processLiveFeed()` 内部，至少要区分三种状态：

- `seen`: feed 列表里看到了这个 UID
- `resolved`: feed 已得出可靠结论
- `covered`: manual fallback 已不需要再跑

其中只有 `covered` 才能影响 `checkAll()` 的 manual live 跳过逻辑。

### 3. manual coverage 的判定规则

对每个 manual 订阅用户，只有以下情况允许加入 `manualLiveCoveredUids`：

#### 在线场景

- manual 订阅本来就已经 `lastLiveStatus === 1`，并且本轮 feed 明确认定在线
- 或者本轮 feed 成功发送了 manual 侧开播通知，并把 manual 的 `lastLiveStatus` 从 `0 -> 1`

#### 下播场景

- manual 订阅本来是 `lastLiveStatus === 1`
- 本轮 feed 通过明确的离线确认逻辑，将 manual 的 `lastLiveStatus` 从 `1 -> 0`

#### 禁止覆盖的场景

- feed 里只是出现了这个 UID
- `live_room` 获取失败
- 通知失败或 dedup/发送决策未允许推进
- 状态是 `unknown`
- 仅完成了 cookie follower 侧状态推进，manual 侧没有完成等价处理

### 4. checkFeedUpdate 只消费显式结果

`checkFeedUpdate()` 不应再根据 `collectFeedCoveredUids()` 把 live 候选 UID 全量提交给 coverage。

直播覆盖提交必须只依赖 `processLiveFeed()` 的显式结果，例如：

- `manualCoveredUids`

动态可以暂时保持原有语义，但直播必须立即收紧。

### 5. 生命周期层只依赖 manual coverage

`checkAll()` 的 live fallback 跳过条件应继续保留在 `lifecycle.js`，但它消费的集合必须是“manual 已可靠覆盖”的结果集，而不是 feed 候选集。

这样可以保证：

- feed 真正处理完的 UID 不会重复调用 manual 查询
- feed 没处理完的 UID 必然会进入 `checkUserLive()`

### 6. 日志增强

为了避免再次靠 `/user_info` 和 `/live_room` 反推，补充明确日志：

- feed 覆盖 manual fallback：
  - `manual_already_online`
  - `manual_online_advanced`
  - `manual_offline_reset`
- feed 未覆盖 manual fallback：
  - `notify_failed`
  - `live_room_failed`
  - `unknown_state`
  - `cookie_only_resolved`

这些日志至少要带 UID、用户名和 reason。

## 代码落点

- `src/services/subscription/updateChecker/modules/feed.js`
  - 重构 live coverage 计算
  - 将 `coveredUids` 改为明确的 manual coverage 语义
  - 补充 coverage reason 日志
- `src/services/subscription/updateChecker/modules/lifecycle.js`
  - 消费新的 manual live coverage 结果
- `test/unit/updateChecker-feedCoverageSplit.test.js`
  - 补 coverage 契约测试
- `test/unit/updateChecker-manual-feed-state-advance.test.js`
  - 补 both 来源场景下的 manual 状态推进/复位测试

## 测试策略

必须覆盖以下场景：

1. feed 命中 UID，但这轮未真正完成 manual online 处理，不应覆盖 fallback
2. feed 命中 UID，manual 已在线且当前仍在线，可以覆盖 fallback
3. both 来源下 cookie 已在线、manual 未在线，feed 成功补推后应覆盖 fallback
4. both 来源下完成下播复位后，应覆盖 fallback
5. `live_room` 获取失败时，不应覆盖 fallback
6. notify 失败时，不应覆盖 fallback
7. `checkAll()` 集成场景下，只有 manual coverage 命中的 UID 才会跳过 `checkUserLive()`

## 风险与回滚

### 风险

- 如果 coverage 收紧过度，会导致更多 manual `user_info/live_room` 请求
- 如果 coverage 收紧不足，仍会出现静默漏推

### 回滚

本次仅涉及调度层和结果契约，不涉及数据结构迁移。若上线后异常，可回滚到上一个稳定提交。

## 后续演进

等直播链路稳定后，再评估是否把动态、视频、专栏也统一到相同的 `feed result -> fallback` 契约模型；但在此之前，不建议为了“统一形式”而把视频/专栏仓促迁移到 feed-first。
