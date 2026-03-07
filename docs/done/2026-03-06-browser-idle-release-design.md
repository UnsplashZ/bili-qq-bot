# 2026-03-06 浏览器空闲释放设计

## 背景与目标

当前 `src/services/imageGenerator/core/browser.js` 已具备页面级回收（页面超时与泄漏页清理），但缺少浏览器进程级空闲释放机制。

目标：当浏览器超过 5 分钟无新渲染请求进入，且当前无活跃渲染任务时，自动关闭 Chromium 进程以释放内存。

约束：
- 空闲阈值写死为 5 分钟（不做配置项）
- 若存在活跃渲染任务，即使超过 5 分钟也不能关闭
- 不影响下一次渲染请求自动拉起浏览器（保持懒启动）

## 需求定义

“未使用”定义为：
- 自最近一次渲染请求进入后，持续超过 5 分钟未有新请求进入

关闭触发需同时满足：
- `activeRenderCount === 0`
- `Date.now() - lastRequestAt >= 5 * 60 * 1000`
- 当前未处于关闭流程（防重入）

## 方案选型

已确认采用方案 1：定时轮询空闲检查。

对比结论：
- 轮询方案实现简单、并发语义清晰、易于日志观测
- 与单次 `setTimeout` 相比，竞态更易控制
- 对当前项目规模，30 秒一次检查开销可忽略

## 设计方案

### 1. 状态与常量

在 `BrowserManager` 新增：
- `idleTimeoutMs = 5 * 60 * 1000`
- `idleCheckIntervalMs = 30 * 1000`
- `lastRequestAt = Date.now()`（初始化为启动时刻）
- `activeRenderCount = 0`
- `idleCloseInProgress = false`
- `idleMonitorInterval = null`

### 2. 请求生命周期计数

以 `withRetry()` 作为“渲染请求进入”统一入口：

- 进入 `withRetry()` 时：
  - `lastRequestAt = Date.now()`
  - `activeRenderCount += 1`
- `withRetry()` 的 `finally` 中：
  - `activeRenderCount = Math.max(0, activeRenderCount - 1)`

说明：
- `lastRequestAt` 只在“请求进入”时更新，保持语义一致
- 计数回收必须放在 `finally`，覆盖成功、异常、重试失败等所有路径

### 3. 空闲监控与关闭

新增 `startIdleMonitor()`：
- 每 30 秒触发一次 `checkAndCloseIdleBrowser()`

新增 `checkAndCloseIdleBrowser()`：
1. 若 `!this.browser`，直接返回
2. 若 `activeRenderCount > 0`，直接返回
3. 计算空闲时长，未达 5 分钟则返回
4. 若 `idleCloseInProgress` 为真，返回
5. 置 `idleCloseInProgress = true`
6. 再次检查 `activeRenderCount === 0`（二次校验，防检查-关闭窗口竞态）
7. 执行 `this.browser.close()` 并置 `this.browser = null`
8. 清理页面池和页面超时追踪状态
9. `finally` 中 `idleCloseInProgress = false`

### 4. 与现有逻辑关系

- 保留现有页面级回收（`pageTimeout`, 泄漏页清理）
- 浏览器空闲关闭是新增进程级策略，与页面级策略并行
- `init()` 仍为懒启动，不改变调用方行为

## 日志与可观测性

建议新增日志：
- `debug`：请求进入/结束时记录 `activeRenderCount`
- `info`：触发空闲关闭时记录实际空闲时长与阈值
- `debug`：超过阈值但因活跃任务未关闭时记录原因
- `error`：空闲关闭异常

## 风险与规避

1. 竞态关闭风险
- 风险：检查通过后到执行关闭前有新请求进入
- 规避：关闭前二次校验 `activeRenderCount`

2. 计数泄漏风险
- 风险：异常路径导致 `activeRenderCount` 不归零
- 规避：统一在 `withRetry()` 的 `finally` 回收

3. 首次请求冷启动变慢
- 影响：空闲关闭后下次请求需重新拉起 Chromium
- 结论：可接受，换取长期内存释放收益

## 验证计划（最小闭环）

1. 正常关闭路径
- 触发一次渲染，等待超过 5 分钟
- 期望：日志出现空闲关闭，Chromium 进程退出

2. 长任务保护路径
- 构造一个执行超过 5 分钟的渲染任务
- 期望：任务期间不发生空闲关闭

3. 关闭后自动恢复
- 在已关闭状态再次触发渲染
- 期望：浏览器自动拉起并正常完成渲染

## 实施范围

仅涉及：
- `src/services/imageGenerator/core/browser.js`

不涉及：
- 外部调用方接口变更
- 配置文件结构变更
- Dashboard 或命令层改动
