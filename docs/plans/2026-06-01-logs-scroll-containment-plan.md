# 2026-06-01 Logs Scroll Containment Plan

## 背景

WebUI `系统日志` 页面在日志滚动后，日志行会从顶部搜索 / 筛选栏下方穿过去，视觉上与筛选栏重叠。用户截图显示筛选面板悬浮在日志内容之上，日志文本仍可从面板后方透出。

当前实现位于 `dashboard/src/pages/Logs.jsx`：

1. 页面根节点使用 `min-h-[calc(100vh-7rem)]`，允许页面整体继续增高。
2. 筛选栏 `GlassCard` 使用 `sticky top-16 z-20`。
3. 日志卡片内的日志列表本身有 `overflow-y-auto`，但滚动逻辑还支持 `page` fallback。
4. `getScrollTargetMode` 会在容器和页面之间切换滚动目标。

这导致某些视口高度、日志行高度或顶部内容高度组合下，页面滚动和日志容器滚动同时参与布局，`sticky` 筛选栏覆盖在日志内容上。

## 目标

把日志页改成一个确定的控制台布局：

```text
Logs page fixed-height shell
├─ header
├─ filter toolbar
└─ log panel
   ├─ stream summary
   ├─ table header
   └─ log list: the only vertical scroll container
```

完成后：

1. 日志内容不能再从搜索 / 筛选栏背后穿过。
2. 页面主体不应因为日志增长而产生 page scroll。
3. 日志列表是唯一滚动容器。
4. `暂停 / 继续`、`清空`、等级筛选、关键字筛选、Channel 筛选继续工作。
5. `回顶部 / 去底部` 继续工作。
6. 不改日志 WebSocket、日志过滤数据协议、后端接口。

## 非目标

1. 不重做日志页面的信息架构。
2. 不改变日志行字段和显示顺序。
3. 不修改 `useLogsStream`、后端 `/ws/logs` 或日志 buffer。
4. 不引入虚拟列表。
5. 不重构全站布局。

## 方案

### 1. 根容器改为固定高度 flex shell

把 `Logs.jsx` 根节点从“最小高度 + 页面可增长”改为“确定高度 + 内部滚动”：

```jsx
<div className="flex h-[calc(100dvh-7rem)] min-h-0 flex-col space-y-3 overflow-hidden pb-5 md:h-[calc(100dvh-8rem)] md:space-y-4 md:pb-6">
```

关键点：

1. `h-[calc(...)]` 替代 `min-h-[calc(...)]`，阻止日志增长撑开页面。
2. `min-h-0` 允许子级 flex item 正确收缩。
3. `overflow-hidden` 禁止日志内容在页面层滚动到筛选栏下方。
4. 优先使用 `100dvh` 而不是 `100vh`，降低移动浏览器地址栏和横屏小高度导致的可视高度误判。

保守策略：先保持现有 `calc` 数值，避免和全站 `Layout` 高度假设冲突。

小高度兜底：当视口高度低于 `520px` 时，日志页 shell 降级为 `height: auto` + `overflow: visible`，并给日志面板保留最小可操作高度。此时页面可以整体滚动，但筛选栏仍不是 sticky，因此不会再覆盖日志内容。

### 2. 筛选栏取消 sticky

把筛选栏从悬浮遮罩改为普通占位工具栏：

```jsx
<GlassCard className="shrink-0 bg-[var(--surface)] p-3 sm:p-4">
```

原因：

1. 日志列表内部滚动后，筛选栏天然固定在日志列表上方。
2. 不再需要 `sticky`、`top-*`、`z-20`。
3. 消除半透明覆盖造成的穿透感。

### 3. 日志卡片补强 flex 收缩

把日志卡片改成：

```jsx
<GlassCard className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--surface)] p-0">
```

关键点：

1. `min-h-0` 是让内部 `overflow-y-auto` 生效的关键。
2. `flex-1` 让日志卡片吃掉剩余高度。
3. `overflow-hidden` 把日志行裁切在日志卡片内部。

### 4. 日志列表保持唯一滚动容器

现有日志列表保留并确认具备：

```jsx
className="min-h-0 flex-1 overflow-y-auto ..."
```

如需要，只调整 class 顺序，不改行为。

### 5. 筛选控件紧凑化

等级和关键字输入从 `sm` 断点起并排展示，`lg` 断点恢复更宽的等级列：

```jsx
<div className="grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)] lg:grid-cols-[180px_minmax(0,1fr)]">
```

原因：

1. 侧边栏存在时，中等宽度桌面视口仍应避免筛选栏纵向过高。
2. 不改变控件语义和交互。
3. 配合小高度兜底，保证日志面板不会被压到不可操作。

### 6. Channel 区域改为横向单行滚动

当前 Channel chip 使用 `flex-wrap`，小高度或窄屏下可能折成多行，导致 `header + 筛选栏` 占满固定 shell，日志列表被压到不可用。

把 Channel 容器从多行换行改为单行横向滚动：

```jsx
<div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 custom-scrollbar">
```

Channel button 补充不可收缩：

```jsx
className="shrink-0 ..."
```

关键点：

1. Channel 只占一行高度，不随选项数量继续撑高。
2. 小屏仍可横向滑动访问全部 channel。
3. 不改变选中 / 取消选中逻辑。
4. 桌面端也可使用同一结构；12 个 channel 在宽屏下通常不需要滚动，在窄屏下横滚。

### 7. 滚动逻辑保守处理

第一阶段不删除 `page` fallback 相关函数，降低风险。

布局修复后，正常情况下：

1. `pageHasOverflow` 应为 false。
2. `containerHasOverflow` 在日志超过一屏后为 true。
3. `getScrollTargetMode` 应稳定返回 container 模式。

后续如果仍出现 page mode，可再单独简化 `scrollBehavior`：

1. 删除 page fallback。
2. `jumpToTop / jumpToBottom` 永远作用于 `scrollContainerRef.current`。
3. 移除 window scroll listener。

本次不做这一步，除非测试证明仅 CSS/flex 修复不足。

### 8. 视觉微调

不做大视觉改版，只做必要稳定性调整：

1. 筛选栏用实色 `bg-[var(--surface)]`。
2. 不新增遮罩或半透明层。
3. 保留现有间距、按钮、Channel chip 样式。

## 文件范围

必须修改：

1. `dashboard/src/pages/Logs.jsx`

可选修改：

1. `dashboard/src/index.css`：用于小高度视口兜底，避免固定 shell 在移动横屏或矮窗口下把日志列表压到不可操作。
2. `dashboard/src/pages/logs/scrollBehavior.js`：仅当验证发现 page fallback 仍触发导致问题复现时修改。

## 风险与回退

### 风险 1：小屏高度不足

固定高度可能让顶部 header + 筛选栏占据过多空间，日志列表过矮。

缓解：

1. 保持现有紧凑间距。
2. 使用 `min-h-0` 确保日志列表至少能滚动。
3. 使用 `100dvh` 而不是 `100vh`。
4. Channel chip 改为单行横向滚动，避免筛选栏纵向无限增高。
5. 浏览器 smoke 覆盖桌面和窄屏 / 小高度视口。

### 风险 2：回顶部 / 去底部按钮逻辑依赖 page mode

如果布局修复后 page mode 不再出现，按钮会走 container mode；这是期望行为。

验证：

1. 有大量日志时出现按钮。
2. 点击 `去底部` 后日志列表滚到底。
3. 向上滚动后出现 `回顶部` 并能回到顶部。

### 风险 3：全站 Layout 外层仍可滚

如果全站 layout 额外 padding 或浏览器工具栏高度导致页面仍有少量 overflow，需进一步收紧根容器高度或让日志页外层使用 `max-h`。

本次先以实测为准。

## 审核点

方案 review 重点检查：

1. 是否真正消除日志和筛选栏重叠，而不是只靠 z-index 掩盖。
2. 是否保持现有日志筛选、暂停、清空、Channel、滚动按钮行为。
3. 是否避免重构后端或日志协议。
4. 是否需要同步调整 `scrollBehavior.js`。
5. 是否已用 `100dvh` 和 Channel 单行横滚收住移动端高度风险。

## 实施步骤

1. 修改 `Logs.jsx` 根容器高度和 overflow。
2. 取消筛选栏 sticky。
3. 给日志卡片补 `min-h-0`。
4. Channel chip 容器改为单行横向滚动，button 补 `shrink-0`。
5. 运行前端构建。
6. 浏览器打开 `/logs`，制造或等待超过一屏日志。
7. 验证日志只在日志列表内部滚动，筛选栏不遮挡日志。
8. 验证滚动按钮、暂停、清空、筛选仍可用。

## 验证命令

至少运行：

```bash
npm --prefix dashboard run build
```

建议补充：

```bash
npm --prefix dashboard run lint
node test/unit/preview/preview-lab-ui-state.test.js
```

其中 `preview-lab-ui-state` 不是日志页直接测试，只作为轻量前端相关单测 smoke；如果耗时可省略。

## 浏览器验收

验收路径：

```text
/logs
```

验收清单：

1. 页面加载后筛选栏位于日志列表上方，不悬浮遮挡日志。
2. 日志超过一屏时，滚动发生在日志列表内部。
3. 搜索 / 筛选栏下方没有日志文字穿透。
4. `暂停 / 继续` 可点击。
5. `清空当前视图` 可点击，清空后空状态展示正常。
6. Channel chip 可选中和取消。
7. 浮动 `去底部 / 回顶部` 可用。
8. 小高度或移动横屏视口下，Channel 不换成多行撑高，日志列表仍保留可操作高度。
