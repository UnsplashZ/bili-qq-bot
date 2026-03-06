# 2026-03-05 WebUI 移动端拥挤优化方案（仅移动端）

## 背景
当前 WebUI 在手机端（尤其 320-390px 宽度）存在内容密度过高的问题，主要表现为：
1. 头部与容器双层内边距叠加，可视高度被过度占用。
2. 卡片、Tab、按钮沿用桌面级间距，导致一屏信息量低且阅读拥挤。
3. 部分两列布局在手机端仍并排，文本与控件压缩明显。
4. 群组页 Tab 区与操作区过高，编辑区域可见空间不足。

本方案目标是只优化移动端体验，保持桌面端视觉与交互不变。

## 目标
1. 仅在移动端（`< md`）调整布局与间距，`md` 及以上不改动。
2. 缩短首屏头部占用，提升可编辑区域高度。
3. 消除手机端主要拥挤点（Tab 挤压、双列压缩、按钮换行冲突）。
4. 不改变现有信息架构与功能路径，不新增业务逻辑。

## 非目标
1. 不重构页面结构，不重做视觉主题。
2. 不修改桌面端断点下的字号、间距和组件布局。
3. 不变更 API、状态管理、数据流逻辑。

## 约束与策略
1. 断点约束：所有变更限定在 `mobile/base` 或 `max-width: 768px`，并用 `md:*` 保持桌面现状。
2. 风险控制：避免全局激进改动，优先对高频页面做局部类名收敛。
3. 可回滚性：每个页面独立提交点，出现回归时可单文件回退。

## 现状问题定位（文件级）
1. `dashboard/src/components/Layout.jsx`
   - `main` 区域与子页面容器叠加内边距，手机端顶部和左右留白偏大。
2. `dashboard/src/pages/Dashboard.jsx`
   - 多个指标卡使用 `p-6` + 大字号，卡片内部元素横向拥挤。
3. `dashboard/src/pages/Groups.jsx`
   - 顶部“标题 + 保存按钮 + Tab”区域过高；`Tab.Panels` 用 `p-6`，手机端编辑区偏窄。
4. `dashboard/src/pages/groups/components/tabs/GeneralTab.jsx`
   - 多处 `grid-cols-2` 在手机端并排，时间与标签开关区域拥挤。
5. `dashboard/src/pages/groups/components/tabs/SyncTab.jsx`
   - 分类/分组开关在手机端 2 列并排，标签名与状态信息挤压。
6. `dashboard/src/pages/groups/components/tabs/AiTab.jsx`
   - “输入框 + 状态文字”同一行布局，窄屏下挤压明显。
7. `dashboard/src/pages/Logs.jsx`
   - 头部按钮区在小屏有换行冲突，日志正文首屏高度不足。

## 设计方案（仅移动端）

### 1) 全局密度收敛（不动桌面）
1. 统一页面外层间距：`px-4 md:px-6` 收敛为 `px-3 sm:px-4 md:px-6`。
2. 统一段落间距：`space-y-6` 收敛为 `space-y-4 md:space-y-6`。
3. 统一标题节奏：主标题 `text-2xl md:text-3xl` 保持不变，但下方 `mb` 在移动端减小。

### 2) 卡片内边距与信息层级
1. `GlassCard` 默认内边距从 `p-4 md:p-6` 调整为 `p-3 sm:p-4 md:p-6`。
2. 指标卡（Dashboard）内部 `p-6` 调整为 `p-4 md:p-6`。
3. 指标主数字移动端收敛一级字号，避免文本截断与换行抖动。

### 3) 群组页可编辑空间优化（核心）
1. 顶部操作区（群名 + 保存按钮）在移动端改为纵向堆叠，按钮全宽或自适应换行。
2. `Tab.List` 保留横向滚动，但降低单项最小高度与左右内边距。
3. `Tab.Panels` 从 `p-6` 收敛为 `p-3 sm:p-4 md:p-6`，显著增加可见内容高度。
4. 左侧群列表卡片在移动端最大高度适度下调，避免挤压右侧编辑区。

### 4) 表单网格在移动端单列化
1. `GeneralTab` 中移动端所有 `grid-cols-2` 调整为 `grid-cols-1 sm:grid-cols-2`。
2. `SyncTab` 中分类与同步分组区域由 `grid-cols-2` 调整为 `grid-cols-1 sm:grid-cols-2 md:grid-cols-3`。
3. `AiTab` 中“输入框 + 右侧状态文本”改为移动端纵向，`sm` 及以上恢复横向。

### 5) 日志页头部与正文高度
1. 头部按钮改为移动端紧凑尺寸（图标按钮固定尺寸，主按钮短文案）。
2. 日志容器最小高度调整为移动端更保守值，保证首屏至少显示更多日志行。

## 实施清单（预期改动文件）
1. `dashboard/src/components/GlassCard.jsx`
2. `dashboard/src/components/Layout.jsx`
3. `dashboard/src/pages/Dashboard.jsx`
4. `dashboard/src/pages/Groups.jsx`
5. `dashboard/src/pages/Logs.jsx`
6. `dashboard/src/pages/groups/components/tabs/GeneralTab.jsx`
7. `dashboard/src/pages/groups/components/tabs/SyncTab.jsx`
8. `dashboard/src/pages/groups/components/tabs/AiTab.jsx`
9. （可选）`dashboard/src/index.css`：补充移动端通用 spacing/tap area 微调规则

## 验收标准
1. 在 320/360/390/414 宽度下无横向滚动条。
2. 群组页移动端可在首屏看到“Tab + 主要配置项”，无需频繁上下切换。
3. Dashboard 指标卡在手机端无严重截断，信息层级清晰。
4. 日志页头部按钮不挤压标题，日志区首屏可见行数提升。
5. 桌面端（>=768px）页面布局与视觉对比无明显变化。

## 验证步骤
1. 本地构建：`cd dashboard && npm run build`。
2. 本地运行后使用浏览器设备模拟：
   - iPhone SE（375x667）
   - iPhone 12/13（390x844）
   - Android 小屏（360x740）
3. 页面逐项检查：`/`、`/groups`、`/settings`、`/logs`。
4. 重点检查交互：Tab 滚动、保存按钮可点击区域、表单输入聚焦、日志滚动。

## 风险与回避
1. 风险：全局卡片内边距调整可能影响部分弹窗体感。
   - 回避：如出现问题，对弹窗组件单独覆盖 `p-*`，不回退全局移动端优化。
2. 风险：移动端单列化导致纵向长度增加。
   - 回避：仅对拥挤区单列化，保留 `sm` 以上双列，平衡阅读与滚动成本。
3. 风险：Tab 压缩后可点击区域不足。
   - 回避：保持最小触控高度约 40-44px。

## 执行顺序建议
1. 先改容器/卡片密度（Layout + GlassCard + 各页面外层）。
2. 再改群组页（Tabs + 面板 + 各 tab 子组件）。
3. 最后微调日志页与个别文本截断。
4. 全页面移动端回归后再做一次桌面端快速比对。
