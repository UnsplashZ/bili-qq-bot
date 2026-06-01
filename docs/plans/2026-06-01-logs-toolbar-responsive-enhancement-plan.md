# 2026-06-01 Logs Toolbar and Responsive Enhancement Plan

## 背景

当前 `系统日志` 页已修复日志滚动时与筛选栏重叠的问题，但仍有四个体验点需要继续优化：

1. `去底部 / 回顶部` 浮动按钮位于页面右下角，容易贴近浏览器边缘，也可能与日志面板滚动条或页面底部空间产生视觉冲突。
2. 日志窗口高度目前由 `h-[calc(100dvh-7rem)]` / `md:h-[calc(100dvh-8rem)]` 粗略估算，能解决重叠，但不完全等同于“占满当前内容区域的剩余高度”。
3. 筛选栏内缺少导出日志按钮。
4. 筛选栏内缺少日志数量筛选器；当前前端 `useLogsStream` 固定最多保留 `1000` 条，后端 `/api/logs/recent` 已支持 `limit` 参数，后端 log buffer 默认来自 `LOG_BUFFER_SIZE`，默认 `2000`。

相关现状：

- 页面：`dashboard/src/pages/Logs.jsx`
- 日志 hook：`dashboard/src/pages/logs/useLogsStream.js`
- 后端最近日志接口：`src/dashboard/routes/api/modules/logs.js`
- 日志 buffer：`src/dashboard/logBuffer.js`
- 全站布局：`dashboard/src/components/Layout.jsx`

## 目标

1. 浮动滚动按钮更靠近日志窗口，不遮挡内容，不依赖页面右下角。
2. 日志窗口高度按网页可视区域自适配，正常桌面尽量吃满剩余高度，小高度仍保留可操作空间。
3. 筛选栏提供“导出日志”操作，导出当前筛选后的日志。
4. 筛选栏提供“数量”筛选，控制历史加载条数和前端实时日志保留条数。
5. 不改变日志字段结构、WebSocket 协议和日志 buffer 存储结构。

## 非目标

1. 不引入虚拟列表。
2. 不做后端文件下载接口；一期导出走浏览器端生成文件。
3. 不改变日志级别、Channel、关键字匹配语义。
4. 不扩大后端 buffer 默认容量；数量上限受 `LOG_BUFFER_SIZE` 约束。

## 方案总览

把日志页继续收敛为“控制台式工作区”：

```text
Logs shell: fill available viewport area
├─ page header
├─ filter toolbar
│  ├─ level
│  ├─ keyword
│  ├─ limit
│  ├─ export current view
│  ├─ connection status
│  └─ channel chips
└─ log panel: relative positioning
   ├─ stream summary
   ├─ table header
   ├─ log list: vertical scroll container
   └─ scroll jump button anchored to panel/list viewport
```

## 1. 滚动按钮位置优化

### 当前问题

`去底部 / 回顶部` 目前使用：

```jsx
className="fixed bottom-5 right-4 md:bottom-7 md:right-8 ..."
```

这会把按钮绑定到 viewport 右下角，而不是日志窗口。用户在桌面宽屏或小高度视口下，按钮容易看起来像全局悬浮控件，不属于日志面板。

### 建议设计

把按钮从 viewport 右下角收回到日志面板语境内，但不能简单改成面板底部 `absolute`。当前日志页仍保留 `page` fallback：小高度兜底下 `.logs-shell` 会 `height:auto; overflow:visible`，按钮如果固定在面板底部，首屏可能看不到“去底部”入口。

建议采用“日志列表/面板可视区域内锚定”的策略。实现可选：

1. 日志列表内部 `sticky bottom-*`。
2. 日志列表外层 `relative`，按钮 `absolute bottom-* right-*`，锚定在日志面板当前可视区域。

两种实现都必须满足：小高度 page fallback 下，只要用户滚到日志面板，按钮就在可见的日志区域内，而不是藏在面板内容末尾或漂到整个 viewport 右下角。

```jsx
<GlassCard className="logs-panel relative flex min-h-0 flex-1 flex-col overflow-hidden ...">
  ...
  <div ref={scrollContainerRef} className="relative flex-1 min-h-0 overflow-y-auto ...">
    ...
    {floatingButtonMode && (
      <button className="sticky bottom-4 ml-auto mr-2 z-10 ...">
```

按钮位置：

1. 桌面：按钮贴近日志列表右下角，随日志列表滚动区域保持可见，不再漂到整个 viewport 右下角。
2. 小屏：保留图标 + 短文本；如果宽度不足，可只显示图标，文本使用 `sr-only` 或 tooltip/title。
3. 当日志列表出现横向滚动条时，按钮应在滚动条上方至少 `8px`，建议 `bottom-5` 或 `bottom-6`。
4. `scrollTargetMode === 'page'` 时，按钮仍随日志列表/面板出现在用户可见的日志区域内，不应锚到整个页面末尾。

视觉：

1. 使用当前按钮暗色样式，但降低阴影强度，避免在浅色主题里过重。
2. 添加 `backdrop-blur` 可选，但不依赖半透明遮挡关键信息。
3. 保持 `aria-label` 和 `title`。

### 行为

不改 `jumpToTop / jumpToBottom` 的滚动目标逻辑。按钮只是从 viewport fixed 改为日志列表/面板可视区域内呈现。

小高度兜底下，`logs-panel` 有 `min-height: 16rem`，按钮仍在日志面板可见区域内，不随页面右下角乱漂，也不能藏到面板末尾导致用户无法跳转。

## 2. 日志窗口大小自适配网页大小

### 当前问题

当前根容器：

```jsx
<div className="logs-shell flex h-[calc(100dvh-7rem)] ... md:h-[calc(100dvh-8rem)]">
```

这解决了桌面重叠，但高度来自估算：

- mobile header 高度：`56px / 64px`
- main padding：`p-3 / p-4 / md:p-8`
- 页面自身 header、筛选栏间距

随着浏览器高度、设备地址栏、布局 padding 改变，估算可能不够精确。

### 建议设计

#### 一期：CSS 变量方式，保持低风险

在 `Layout.jsx` 的 `<main>` 或日志页 shell 上定义内容区高度变量：

```css
.app-main {
  min-height: 100dvh;
}

@media (min-width: 768px) {
  .app-main {
    min-height: 100dvh;
  }
}
```

然后 `Logs.jsx` 使用页面级 class：

```jsx
<div className="logs-shell flex min-h-0 flex-col overflow-hidden">
```

在 `index.css` 中统一描述：

```css
.logs-shell {
  height: calc(100dvh - 3.5rem - 1.5rem);
}

@media (min-width: 640px) {
  .logs-shell {
    height: calc(100dvh - 4rem - 2rem);
  }
}

@media (min-width: 768px) {
  .logs-shell {
    height: calc(100dvh - 4rem);
  }
}
```

这里的减法只表达 Layout 外壳占用：移动顶部栏 + main padding，日志页内部由 flex 自己分配。

#### 二期：测量方式，精确填满剩余空间

如果一期仍在部分视口下不够精确，再引入 `ResizeObserver`：

1. 给 `logs-shell` 一个 ref。
2. 在 layout 后测量 `shell.getBoundingClientRect().top`。
3. 设置 CSS var：`--logs-shell-height: calc(100dvh - ${top}px - bottomPadding)`。
4. shell 使用 `height: var(--logs-shell-height)`。

不建议一开始就用 JS 测量，因为当前页面不需要复杂动态布局，CSS 方案更稳定。

### 小高度策略

保留现有兜底：

```css
@media (max-height: 520px) {
  .logs-shell {
    height: auto;
    min-height: calc(100dvh - 7rem);
    overflow: visible;
  }

  .logs-panel {
    flex: none;
    height: 16rem;
    min-height: 16rem;
  }
}
```

如果采用新 CSS 变量，应把兜底同步改为：

```css
@media (max-height: 520px) {
  .logs-shell {
    height: auto;
    min-height: var(--logs-shell-min-height, calc(100dvh - 7rem));
    overflow: visible;
  }

  .logs-panel {
    flex: none;
    height: 16rem;
    min-height: 16rem;
  }
}
```

验收重点不是“页面永远不滚”，而是：

- 正常桌面：页面不滚，日志列表滚。
- 小高度：页面可以滚到日志面板，但筛选栏不遮挡日志，日志面板保持固定可操作高度，日志列表仍在面板内部滚动，不能被日志内容撑成整页高度。

## 3. 筛选栏增加导出日志按钮

### 导出范围

一期导出“当前视图日志”：

1. 已应用等级、关键字、Channel、数量筛选后的 `logs`。
2. 包含暂停状态下当前已经显示的日志，不包含 pending 队列中尚未刷到 UI 的日志。
3. 清空当前视图后导出空文件或禁用导出按钮，建议禁用按钮并提示 `当前无可导出日志`。

### 文件格式

建议默认导出 `.jsonl`，另可在后续扩展 `.txt`。

JSONL 每行一条：

```json
{"timestamp":"...","level":"INFO","channel":"HTTP","scope":"req:...","action":"recv","fields":{},"message":"..."}
```

原因：

1. 保留结构化字段，便于后续 grep / jq / 导入。
2. 不受 message 换行影响。
3. 实现简单，不需要后端参与。

文件名：

```text
bili-qq-bot-logs-YYYYMMDD-HHmmss.jsonl
```

### UI 位置

把导出按钮放在筛选栏第一行右侧或操作区：

```text
等级 | 关键字 | 数量 | [导出]
```

响应式：

1. 桌面：`grid-cols-[140px_minmax(0,1fr)_120px_auto]`
2. 中等宽度：导出按钮在同一行最右。
3. 移动窄屏：导出按钮占满一行或与数量并排。

图标：

- 使用 `lucide-react` 的 `Download`。
- 按钮文本：`导出`。
- title：`导出当前视图日志`。

### 实现函数

导出相关逻辑不要直接写在含 JSX 的 `Logs.jsx` 内作为不可测私有函数。新增无 JSX helper：

```text
dashboard/src/pages/logs/logExport.js
```

在 helper 中提供：

```jsx
export function buildLogExportContent(logs) {
  return logs.map((log) => JSON.stringify({
    timestamp: log.timestamp,
    level: log.level,
    channel: log.channel,
    scope: log.scope,
    action: log.action,
    fields: log.fields,
    message: getMessageText(log),
  })).join('\n');
}
```

导出流程：

1. `Blob([content], { type: 'application/x-ndjson;charset=utf-8' })`
2. `URL.createObjectURL(blob)`
3. 创建 `<a download=...>`，设置 `href` 和 `download`
4. 临时 append 到 `document.body`
5. 触发 `click`
6. 移除 anchor
7. 使用 `setTimeout(() => URL.revokeObjectURL(url), 0)` 延迟释放，避免部分浏览器在下载开始前 URL 被回收

空日志策略：

1. 导出按钮禁用。
2. `title` 显示 `当前无可导出日志`。
3. 不生成空文件。

### 风险

大量日志导出时浏览器内存压力可控，因为上限最多为后端 buffer 容量，默认 2000；不支持无限导出。

## 4. 筛选栏增加日志数量筛选器

### 当前数据流

`dashboard/src/pages/logs/useLogsStream.js` 当前：

```js
const MAX_LOGS = 1000;
params.limit = MAX_LOGS;
appendWithLimit(prev, nextItems)
```

后端 `/api/logs/recent` 已支持：

```js
const limit = req.query.limit ? Number.parseInt(req.query.limit, 10) : undefined
logBuffer.list({ level, channels, keyword, limit })
```

所以一期无需改后端接口，只需把 `MAX_LOGS` 变成配置输入。

### 建议选项

使用 select，而不是自由数字输入：

```js
const LOG_LIMIT_OPTIONS = [
  { value: 100, label: '100 条' },
  { value: 300, label: '300 条' },
  { value: 500, label: '500 条' },
  { value: 1000, label: '1000 条' },
  { value: 2000, label: '2000 条' },
];
```

默认值建议：`500` 或保留当前 `1000`。

保守建议选择 `1000` 作为默认，避免用户感知当前行为变少。

### 状态设计

把数量加入 `filters`：

```js
const [filters, setFilters] = useState({
  level: 'info',
  channels: [],
  keyword: '',
  limit: 1000,
});
```

动态 limit 和导出/测试相关纯函数也应拆到无 JSX helper：

```text
dashboard/src/pages/logs/logLimits.js
```

建议提供：

```js
export const DEFAULT_LOG_LIMIT = 1000;
export const MIN_LOG_LIMIT = 100;
export const MAX_LOG_LIMIT = 2000;

export function normalizeLogLimit(value) { ... }
export function appendWithLimit(prev, nextItems, maxLogs) { ... }
export function buildLogFilterKey(filters) { ... }
```

`useLogsStream(filters, isPaused)` 内：

1. `normalizeLimit(filters.limit)`，限定 `100 <= limit <= 2000`。
2. `buildRecentParams` 使用该 limit。
3. `appendWithLimit(prev, nextItems, maxLogs)` 使用该 limit。
4. pending 队列也按该 limit 截断。
5. `level`、`channels`、`keyword`、`limit` 任一变化时，清空或隔离 pending 队列，避免暂停期间旧筛选日志恢复后污染新筛选结果。

建议把原函数改成：

```js
function appendWithLimit(prev, nextItems, maxLogs) {
  const merged = [...prev, ...nextItems];
  return merged.length > maxLogs ? merged.slice(-maxLogs) : merged;
}
```

pending 队列推荐实现：

```js
const filterKey = buildLogFilterKey(filters);

useEffect(() => {
  pendingLogsRef.current = [];
}, [filterKey]);
```

或者给 pending entry 附带 filter key，只 flush 与当前 key 一致的日志。优先使用清空策略，行为简单且符合“筛选变化后当前视图只看新筛选结果”。

### 筛选变化行为

当数量变更时：

1. 重新请求 `/api/logs/recent?limit=...`。
2. 重建 WebSocket 连接，因为 `filters` 变化会触发现有 effect；虽然 WebSocket 不使用 limit，但复用当前机制风险最低。
3. 实时新增日志按新的 limit 截断。
4. 暂停状态下切换筛选后再继续，不能把切换前 pending 日志追加进新视图。

如果后续想避免数量变化重连 WebSocket，可把 WebSocket effect 依赖改为 `level/channels/keyword`，历史加载 effect 依赖 `filters` 全量。但一期不必做这个优化。

## 建议布局细节

筛选栏第一行改为：

```jsx
<div className="grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)] lg:grid-cols-[160px_minmax(0,1fr)_120px_auto]">
  <label>等级</label>
  <label>关键字</label>
  <label>数量</label>
  <Button icon={Download}>导出</Button>
</div>
```

第二行保持：

```text
Channel label + connection status
Channel chips horizontal scroll
```

日志面板 header 可补充：

```text
{logs.length} / {filters.limit} lines
```

这样用户能知道当前显示条数和上限。

## 文件范围

必须修改：

1. `dashboard/src/pages/Logs.jsx`
2. `dashboard/src/pages/logs/useLogsStream.js`
3. `dashboard/src/index.css`

建议新增测试：

1. `test/unit/dashboard/log-export.test.js` 或现有 dashboard unit 目录中的合适位置：验证导出序列化函数。
2. `test/unit/dashboard/log-limit.test.js` 或 hook helper 测试：验证 limit clamp、append 截断。

是否新增测试取决于当前测试栈对前端 helper 的覆盖方式；如果没有稳定 React hook 测试环境，可先把纯函数导出后做 Node 单测。

## 实施步骤

1. 在 `Logs.jsx` 增加 `LOG_LIMIT_OPTIONS`，把 `filters.limit` 纳入状态。
2. 在筛选栏第一行加入数量 select 和导出按钮。
3. 从 `lucide-react` 引入 `Download`。
4. 新增 `dashboard/src/pages/logs/logExport.js`，放置 `buildLogExportContent`、`formatExportFilename` 等无 JSX 纯函数。
5. 新增或扩展 `dashboard/src/pages/logs/logLimits.js`，放置 `normalizeLogLimit`、`appendWithLimit`、`buildLogFilterKey` 等无 JSX 纯函数。
6. 修改 `useLogsStream`：`MAX_LOGS` 改为 `DEFAULT_LOG_LIMIT`，所有 append / pending / recent params 使用动态 limit，并在 filter key 变化时清空 pending。
7. 调整日志面板和日志列表定位，浮动按钮从 `fixed` 改成日志列表/面板可视区域内锚定。
8. 调整 `.logs-shell` 高度 CSS，使其更贴合 Layout 可视区域；保留小高度兜底。
9. 运行验证。

## 验证计划

命令：

```bash
npm --prefix dashboard run lint
npm --prefix dashboard run build
```

如新增纯函数测试：

```bash
./node_modules/.bin/mocha --exit test/unit/dashboard/logs-export.test.mjs
./node_modules/.bin/mocha --exit test/unit/dashboard/logs-limit.test.mjs
```

如果测试文件不用 `describe/it`，也可直接 `node test/unit/dashboard/<file>.test.mjs`；优先按现有 dashboard 单测习惯使用无 JSX helper + Node/Mocha。

浏览器 smoke：

1. `/logs` 桌面 1280×720：页面不滚，日志列表滚；按钮在日志面板右下角。
2. `/logs` 小高度 900×390：页面可滚到日志面板；按钮仍在日志面板内；筛选栏不遮挡日志；日志列表 `scrollHeight > clientHeight` 且面板不被内容撑高。
3. 数量切换为 `100`：历史行数不超过 100，header 显示 `x / 100 lines`。
4. 数量切换为 `2000`：历史请求带 `limit=2000`，实时追加仍不超过 2000。
5. 导出：有日志时生成 `.jsonl`；内容条数等于当前 `logs.length`；筛选后导出只包含筛选结果。
6. 清空当前视图后，导出按钮禁用或提示无日志。
7. 暂停期间切换等级 / 关键字 / Channel / 数量后再继续，不会把旧筛选 pending 日志追加到新视图。
8. 暂停 / 继续、等级、关键字、Channel 仍正常。

## 风险与取舍

### 风险 1：数量变化导致 WebSocket 重连

当前 hook 依赖整个 `filters` 对象，加入 `limit` 后切数量会重连。

一期可接受，因为操作低频且实现简单；如果用户频繁切数量，再拆分 effect 依赖。

### 风险 2：导出文件格式预期

JSONL 对工程排查友好，但普通用户可能更喜欢 TXT。

一期建议只做 JSONL；如果需要更易读，可后续增加下拉：

```text
导出 JSONL / 导出 TXT
```

### 风险 3：日志窗口高度继续受 Layout padding 影响

CSS calc 仍是基于 Layout 常量，不能做到数学上完全精确。

一期优先 CSS；如果 smoke 发现某些高度仍异常，再引入 `ResizeObserver` 精确测量。

## 推荐实现优先级

1. 数量筛选器和动态 limit：收益直接，后端已有能力。
2. 导出当前视图 JSONL：纯前端实现，风险低。
3. 滚动按钮移入日志面板：视觉优化，行为不变。
4. 日志窗口高度 CSS 化：先用 CSS 变量 / class 收敛；只有实测失败再用 JS 测量。
