# WebUI 色彩体系与视觉减重优化方案

## 背景

当前 WebUI 已完成浅色 / 深色主题 token 化，并逐步把旧的 dark-tailwind 样式迁移到 `dashboard/src/index.css` 中的 CSS 变量。最近的日志页和预览编辑器改造后，功能结构已经更清楚，但从实际页面观感看仍有两个明显问题：

1. 页面“重”：卡片、面板、表头、设置行、tab、表格都在使用实线边框，多个容器叠加后分割线密度过高。
2. 页面“不够高级”：主色和状态色比较直给，旧页面还残留大量 `text-cyan-*`、`bg-black/20`、`border-white/10` 等历史样式，再由兼容 CSS 强行映射，导致颜色语义不够克制。

本方案聚焦 WebUI 的视觉系统升级，不改变现有业务功能、接口和页面信息架构。

## 当前颜色现状

### 全局 token

当前主要 token 定义在 `dashboard/src/index.css`。

浅色模式：

| token | 当前用途 | 当前观感 |
| --- | --- | --- |
| `--bg` | 页面背景 | 接近冷白，干净但层次较少 |
| `--surface` | 卡片 / 面板背景 | 纯白，和边框一起容易显硬 |
| `--surface-muted` | 次级背景 / hover | 冷灰，承担较多区分任务 |
| `--surface-raised` | 品牌图标、轻微浮层 | 和 `surface` 差异不明显 |
| `--fg` | 主文本 | 稳定 |
| `--muted` | 次文本 | 稳定 |
| `--subtle` | 弱文本 / placeholder | 稳定 |
| `--border` | 默认边框 / 分割线 | 在浅色下偏明显，使用过多会显重 |
| `--border-strong` | 强边框 | 适合 focus / 强区分，不适合作常规容器 |
| `--accent` | 主操作 / 当前项 | 蓝色饱和度偏高 |
| `--success` / `--warn` / `--danger` / `--info` | 状态色 | 色相丰富，容易抢主视觉 |
| `--purple` / `--pink` | 辅助语义色 | 在诊断 / Agent 页面中出现较多，容易显杂 |
| `--field-bg` | 输入控件背景 | 接近白，边框承担了过多层级表达 |
| `--shadow-card` | 卡片阴影 | 对普通工具页略重 |

深色模式：

| token | 当前用途 | 当前观感 |
| --- | --- | --- |
| `--bg` | 页面背景 | 深蓝灰，整体稳定 |
| `--surface` / `--surface-muted` | 卡片和次级背景 | 层级可用，但边框叠加后线感明显 |
| `--border` / `--border-strong` | 默认边框 | 深色下比浅色更容易显“框” |
| `--accent` | 主色 | 深色下比浅色更舒服，但仍偏功能蓝 |
| `--shadow-card` | 卡片阴影 | 深色下可保留，但不应所有组件都强阴影 |

### 历史兼容颜色

`dashboard/src/index.css` 末尾存在一段兼容桥，用于把旧页面的 Tailwind literal color 映射到 token，例如：

- `text-white` / `text-gray-300` / `text-slate-500`
- `bg-black/20` / `bg-white/5`
- `border-white/10`
- `text-cyan-*` / `text-purple-*` / `text-emerald-*` / `text-amber-*` / `text-rose-*`

这段兼容桥有必要保留到迁移完成，但它也是当前视觉不统一的来源之一。旧页面看起来像“深色设计被翻译成浅色”，而不是从 token 体系出发重新设计。

## 问题诊断

### 1. 边框职责过载

当前这些位置都大量使用 `border-[var(--border)]`：

- `dashboard/src/components/ui.jsx`
  - `Card`
  - `PanelHeader`
  - `DataTable`
  - `Button secondary`
  - `StatusPill`
- `dashboard/src/components/SettingRow.jsx`
  - 每个设置行 `border-b`
- `dashboard/src/components/ModernTabs.jsx`
  - tab 容器 `border-b`
- `dashboard/src/components/Surface.jsx`
  - `SurfaceHeader` `border-b`
- `dashboard/src/pages/Logs.jsx`
  - filter 卡片、日志 panel、日志表头、浮动按钮
- `dashboard/src/pages/PreviewLayoutEditor.jsx`
  - 顶部筛选、三栏编辑区、子 panel header、属性块
- Groups / Agent 页面
  - 仍有 `border-white/10`、`divide-white/10`、`bg-black/20`

结果是外层容器有线，内层标题有线，行与行还有线。信息密度高的页面尤其明显。

### 2. 色彩语义太分散

当前主色、info 色、诊断页 channel 色、Agent 行为色、状态色都在争夺注意力。对于一个控制台类产品，颜色应该优先服务三个目的：

1. 当前上下文：当前导航、当前 tab、主按钮。
2. 状态风险：成功、警告、错误。
3. 数据分类：日志等级、Agent 决策类型等。

现在分类色和状态色混用较多，容易显得“彩”而不是“精致”。

### 3. Surface 层级表达依赖边框

目前层级主要靠：

- 外层卡片边框
- 内部 `border-b`
- 阴影
- `surface-muted` 背景

更高级的控制台通常会减少显式线条，用更细的背景层级、留白、字体权重和局部强调来表达结构。

### 4. 基础组件没有“视觉密度”开关

`Card`、`PanelHeader`、`SettingRow` 都是单一风格。页面想变轻时只能在各处手写 className 覆盖，长期会导致风格继续分叉。

## 目标

- 降低页面整体线条密度，让控制台更轻、更安静。
- 保持工具型页面的信息密度，不做营销页式的大留白和装饰。
- 主色更克制，减少强蓝、强绿、强红对页面的占用。
- 状态色用于状态，不用于普通装饰。
- 统一基础组件，让大多数页面通过组件自然变轻，而不是逐页打补丁。
- 保留当前浅色 / 深色主题能力。
- 不改变现有 API、数据结构、交互流程和权限逻辑。

## 非目标

- 不重做导航结构。
- 不重做所有页面布局。
- 不移除现有功能。
- 不引入新的 UI 框架。
- 不引入复杂品牌规范。
- 不要求一次性清空所有旧 Tailwind literal color，但要给出迁移顺序。

## 设计原则

### 色彩原则

1. 页面基底只使用中性色。
2. 主色只用于当前态、主操作、重要 focus。
3. 状态色降低饱和度和面积，只保留必要提示。
4. 分类色优先用文本色或细左线，不使用大面积背景。
5. hover 背景使用极淡 surface 变化，不用强色块。

### 分割原则

1. 外层容器可有边框，内部行尽量不用完整实线。
2. 表格和日志可以保留横线，但线条降到 `--border-subtle`。
3. 设置页、配置页优先用间距和标题层级表达分组。
4. 同一卡片内部避免同时出现 `border-b`、`divide-y`、nested card。

### 层级原则

1. 背景层级优先级：`bg` -> `surface` -> `surface-muted` -> `surface-raised`。
2. 浅色模式减少阴影强度，深色模式减少边框亮度。
3. 普通卡片不需要强投影；可交互浮层才使用更明显 shadow。

## 新色彩体系建议

### Token 分层

在 `dashboard/src/index.css` 增补这些 token：

```css
--surface-quiet: ...;
--surface-hover: ...;
--border-subtle: ...;
--border-muted: ...;
--shadow-soft: ...;
--shadow-floating: ...;
--accent-muted: ...;
--accent-surface: ...;
```

推荐语义：

| token | 用途 |
| --- | --- |
| `--surface-quiet` | 大页面内的轻背景带、日志 header、table head |
| `--surface-hover` | hover 行、ghost button hover、nav hover |
| `--border-subtle` | 内部分割线、表格行线、设置行分隔 |
| `--border-muted` | 普通卡片外框 |
| `--shadow-soft` | 默认 Card 阴影 |
| `--shadow-floating` | modal、popover、悬浮按钮 |
| `--accent-muted` | 主色文本在浅色/深色下的克制版本 |
| `--accent-surface` | 当前态背景、active nav、轻强调背景 |

### 浅色模式建议值

```css
:root {
  --bg: oklch(98.2% 0.004 255);
  --surface: oklch(99.6% 0.002 255);
  --surface-muted: oklch(96.4% 0.006 255);
  --surface-quiet: oklch(97.4% 0.004 255);
  --surface-raised: oklch(100% 0 0);
  --surface-hover: color-mix(in oklch, var(--accent) 5%, var(--surface-muted));

  --fg: oklch(20% 0.012 255);
  --muted: oklch(48% 0.012 255);
  --subtle: oklch(65% 0.01 255);

  --border-subtle: oklch(93.5% 0.005 255);
  --border: oklch(89.8% 0.007 255);
  --border-muted: oklch(91.5% 0.006 255);
  --border-strong: oklch(80.5% 0.01 255);

  --accent: oklch(55% 0.125 252);
  --accent-muted: oklch(48% 0.11 252);
  --accent-soft: color-mix(in oklch, var(--accent) 9%, transparent);
  --accent-surface: color-mix(in oklch, var(--accent) 7%, var(--surface));
  --accent-contrast: #ffffff;

  --success: oklch(53% 0.105 150);
  --warn: oklch(64% 0.115 74);
  --danger: oklch(56% 0.14 28);
  --info: oklch(52% 0.11 235);
  --purple: oklch(52% 0.10 300);
  --pink: oklch(54% 0.11 335);

  --shadow-card: 0 10px 28px color-mix(in oklch, var(--fg) 4.5%, transparent);
  --shadow-soft: 0 8px 22px color-mix(in oklch, var(--fg) 4%, transparent);
  --shadow-floating: 0 18px 44px color-mix(in oklch, var(--fg) 12%, transparent);
}
```

### 深色模式建议值

```css
[data-theme='dark'] {
  --bg: oklch(15.5% 0.01 255);
  --surface: oklch(19.5% 0.012 255);
  --surface-muted: oklch(23% 0.012 255);
  --surface-quiet: oklch(21.5% 0.011 255);
  --surface-raised: oklch(22.5% 0.012 255);
  --surface-hover: color-mix(in oklch, var(--accent) 9%, var(--surface-muted));

  --fg: oklch(93.5% 0.004 255);
  --muted: oklch(70% 0.01 255);
  --subtle: oklch(57% 0.01 255);

  --border-subtle: oklch(27% 0.012 255);
  --border: oklch(31% 0.014 255);
  --border-muted: oklch(29% 0.013 255);
  --border-strong: oklch(39% 0.014 255);

  --accent: oklch(66% 0.13 252);
  --accent-muted: oklch(72% 0.11 252);
  --accent-soft: color-mix(in oklch, var(--accent) 12%, transparent);
  --accent-surface: color-mix(in oklch, var(--accent) 10%, var(--surface));
  --accent-contrast: oklch(14% 0.01 255);

  --success: oklch(70% 0.11 150);
  --warn: oklch(75% 0.11 74);
  --danger: oklch(69% 0.13 28);
  --info: oklch(70% 0.11 235);
  --purple: oklch(73% 0.11 300);
  --pink: oklch(73% 0.11 335);

  --shadow-card: 0 14px 34px rgba(0, 0, 0, 0.18);
  --shadow-soft: 0 10px 26px rgba(0, 0, 0, 0.16);
  --shadow-floating: 0 22px 52px rgba(0, 0, 0, 0.34);
}
```

说明：

- 主色从高饱和蓝降低 chroma，保留科技感但减少“系统默认蓝”的廉价感。
- 状态色 chroma 整体下调，避免大面积抢视觉。
- `border-subtle` 用于内部线，`border-muted` 用于普通外框。
- `shadow-card` 下调，减少卡片浮起感。

## 组件级改造方案

### 1. Card

文件：`dashboard/src/components/ui.jsx`

当前：

```jsx
rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-card)]
```

建议：

- 默认卡片使用 `border-[var(--border-muted)]`。
- 默认 shadow 换成 `--shadow-soft`。
- 新增 `tone` 或 `variant` 可选值：
  - `default`：普通卡片
  - `quiet`：无强阴影，适合设置页大模块
  - `floating`：popover / modal / 悬浮操作

建议 API：

```jsx
<Card variant="default" />
<Card variant="quiet" />
<Card variant="floating" />
```

第一阶段可先不扩 API，只调整默认值：

```jsx
'rounded-lg border border-[var(--border-muted)] bg-[var(--surface)] text-[var(--fg)] shadow-[var(--shadow-soft)]'
```

### 2. PanelHeader / SurfaceHeader

文件：

- `dashboard/src/components/ui.jsx`
- `dashboard/src/components/Surface.jsx`

建议：

- `border-b border-[var(--border)]` 改为 `border-b border-[var(--border-subtle)]`。
- 背景可选加 `bg-[var(--surface-quiet)]`，只在日志、表格、数据面板使用。
- 普通卡片 header 不需要强分割线时，可以只保留下方 padding。

第一阶段：

```jsx
border-b border-[var(--border-subtle)]
```

第二阶段：

- 为 `PanelHeader` 增加 `divided = true`。
- 只有表格、日志、数据面板设置 `divided`。
- 设置类模块不显示 header 分割线。

### 3. SettingRow

文件：`dashboard/src/components/SettingRow.jsx`

当前每行：

```jsx
border-b border-[var(--border)]
```

建议：

- 默认改为 `border-b border-[var(--border-subtle)]`。
- 行内上下 padding 从 `py-4` 调整为 `py-4` 保持不变，避免因为去线导致信息过散。
- 新增 `density` 或 `divided` 选项后续控制。

第一阶段：

```jsx
border-b border-[var(--border-subtle)]
```

第二阶段：

- 设置页顶层模块：保留极淡分割线。
- 同一小分组内密集配置：改为 `gap` + hover 背景，不再每行画线。

### 4. Button

文件：`dashboard/src/components/ui.jsx`

问题：

- secondary 按钮边框明显。
- primary 主色偏强。
- ghost hover 有时和当前态差异不够细。

建议：

```js
primary:
  border var(--accent)
  bg var(--accent)
  hover color-mix accent 88%, fg

secondary:
  border var(--border-muted)
  bg var(--surface)
  hover bg var(--surface-hover)

ghost:
  border transparent
  hover bg var(--surface-hover)
```

导出、重载、查看预览这类次操作优先用 secondary；危险操作继续用 danger，但 danger 背景面积要克制。

### 5. StatusPill

文件：`dashboard/src/components/ui.jsx`

当前 `StatusPill` 每个都有边框和圆点。建议：

- 常规状态 pill 使用极淡边框：`border-[var(--border-subtle)]`。
- `success/warn/danger` 只改变文字和圆点颜色，不使用强背景。
- 如果页面里 pill 数量多，优先把部分 pill 退化成普通 text meta。

第一阶段只降边框：

```js
neutral: 'border-[var(--border-subtle)] text-[var(--muted)]'
```

### 6. ModernTabs

文件：`dashboard/src/components/ModernTabs.jsx`

建议：

- 外层 `border-b` 改为 `border-[var(--border-subtle)]`。
- active underline 从 `h-px` 保留，但 active text 用 `--accent-muted`。
- hover 使用 `surface-hover`。

### 7. DataTable

文件：`dashboard/src/components/ui.jsx`

建议：

- `thead border-b` 和 `tr border-b` 改为 `--border-subtle`。
- row hover 使用 `--surface-hover`。
- 表头背景可选 `bg-[var(--surface-quiet)]`，让表格结构靠背景层级表达。

### 8. Modal / Popover

文件：

- `dashboard/src/components/GlassModal.jsx`
- `dashboard/src/pages/settings/components/GradientColorPickerPopover.jsx`
- `dashboard/src/pages/settings/components/PreviewGradientModal.jsx`

问题：

- 仍有 `bg-gray-900/95`、`border-white/10`、`text-white` 等历史深色写法。
- 浅色模式下依赖兼容桥转换，视觉不是原生浅色设计。

建议：

- Modal 容器改为 `bg-[var(--surface-raised)] border-[var(--border-muted)] text-[var(--fg)] shadow-[var(--shadow-floating)]`。
- Backdrop 保留 `bg-black/40`，浅色和深色都可接受。
- Popover 内部的色板区域可以保留真实颜色，但外围控件使用 token。

## 页面级优化方案

### 系统日志页

文件：`dashboard/src/pages/Logs.jsx`

建议：

- filter 卡片外框保留，但内部 Channel button 边框降为 `--border-subtle`。
- 日志 panel header 使用 `--surface-quiet`。
- 表头和日志行分割改为 `--border-subtle`。
- 日志等级细左线保留，不要改成大色块。
- `timestamp/scope/message` 继续用弱文本层级，channel 使用 `--info` 或后续 `--accent-muted`。

### 系统设置页

文件：

- `dashboard/src/pages/Settings.jsx`
- `dashboard/src/pages/settings/components/*`

建议：

- 大模块卡片保留外框，内部行分割降到 `--border-subtle`。
- `SystemControlSection` 的上边界从 `border-t` 改成空间分隔或更淡线。
- `BiliGlobalSection` 登录状态卡片外框改 `--border-subtle`，不要和外层 `GlassCard` 形成双重硬线。

### 预览编辑器

文件：`dashboard/src/pages/PreviewLayoutEditor.jsx`

问题：

- 三栏编辑区每一栏都有完整外框，内部 header 又有 border。
- 顶部筛选区、氛围色区块、三栏编辑区连续出现多张卡片，线条密度高。

建议：

- 顶部筛选区使用 `surface` + `border-muted`。
- 三栏容器可保持外框，但 header 分割改 `border-subtle`。
- 属性面板中“显示元素”小块外框降为 `border-subtle`。
- 右侧操作按钮组可减少次按钮边框强度。

### 运行状态页

文件：`dashboard/src/pages/Dashboard.jsx`

建议：

- KPI 卡片保留，但 tone 背景不要过彩。
- 指标 icon 方块边框降级。
- 图表面板 header 用更淡分割线。
- 表格行线降级。

### Groups / Agent 页面

文件：

- `dashboard/src/pages/Groups.jsx`
- `dashboard/src/pages/groups/components/**`
- `dashboard/src/pages/AgentSettings.jsx`
- `dashboard/src/pages/AgentDecisions.jsx`
- `dashboard/src/pages/AgentMemory.jsx`

建议：

- 这是旧色彩残留最多的区域，应作为第二阶段重点。
- 把 `bg-black/20` 替换为 `bg-[var(--surface-quiet)]` 或 `bg-[var(--surface-muted)]`。
- 把 `border-white/10` 替换为 `border-[var(--border-subtle)]` 或 `border-[var(--border-muted)]`。
- 把 `text-white`、`text-gray-*` 替换为 `text-[var(--fg)]`、`text-[var(--muted)]`、`text-[var(--subtle)]`。
- 状态色从 Tailwind literal 改为 token。

## 实施计划

### 阶段 1：低风险全局降噪

目标：用最少代码让整体视觉先轻下来。

改动：

- `dashboard/src/index.css`
  - 增加 `--border-subtle`、`--border-muted`、`--surface-quiet`、`--surface-hover`、`--shadow-soft`、`--shadow-floating`、`--accent-muted`、`--accent-surface`。
  - 调整 `--accent` 和状态色 chroma。
  - 降低 `--shadow-card` 强度。
- `dashboard/src/components/ui.jsx`
  - `Card` 使用 `border-muted` + `shadow-soft`。
  - `PanelHeader` 使用 `border-subtle`。
  - `Button secondary/ghost` hover 使用 `surface-hover`。
  - `StatusPill neutral` 使用 `border-subtle`。
  - `DataTable` 行线使用 `border-subtle`。
- `dashboard/src/components/SettingRow.jsx`
  - 行分隔改为 `border-subtle`。
- `dashboard/src/components/ModernTabs.jsx`
  - tab 分割线改为 `border-subtle`。
- `dashboard/src/components/Surface.jsx`
  - header 分割线改为 `border-subtle`。

验证：

- `npm --prefix dashboard run lint`
- `npm --prefix dashboard run build`
- 浏览器检查：
  - `/`
  - `/settings`
  - `/logs`
  - `/preview-layout`
  - 浅色和深色都检查。

风险：

- 全局 token 会影响所有页面，需重点检查对比度。
- 如果主色降饱和过多，active 状态可能不够明显，需要通过 `accent-surface` 补充。

### 阶段 2：旧页面 token 化

目标：减少兼容桥依赖。

改动重点：

- `dashboard/src/pages/AgentSettings.jsx`
- `dashboard/src/pages/AgentDecisions.jsx`
- `dashboard/src/pages/AgentMemory.jsx`
- `dashboard/src/pages/Groups.jsx`
- `dashboard/src/pages/groups/components/**`
- `dashboard/src/components/GlassModal.jsx`

替换规则：

| 旧写法 | 新写法 |
| --- | --- |
| `bg-black/20` | `bg-[var(--surface-quiet)]` |
| `bg-white/5` | `bg-[var(--surface-muted)]` 或 `bg-[var(--surface-hover)]` |
| `border-white/10` | `border-[var(--border-subtle)]` |
| `text-white` | `text-[var(--fg)]` |
| `text-gray-400` | `text-[var(--muted)]` |
| `text-gray-500` | `text-[var(--subtle)]` |
| `text-cyan-*` | `text-[var(--info)]` 或 `text-[var(--accent-muted)]` |
| `text-emerald-*` | `text-[var(--success)]` |
| `text-amber-*` | `text-[var(--warn)]` |
| `text-rose-*` | `text-[var(--danger)]` |

验证：

- 浏览器检查 Groups 的各 tab。
- 浏览器检查 Agent 管理、Agent 决策、Agent 记忆。
- 确认浅色模式下没有“深色翻译感”。

### 阶段 3：减少内部实线

目标：从“细线很多”进一步变成“层级清楚但安静”。

改动：

- 为 `Card` 增加 `variant`。
- 为 `PanelHeader` 增加 `divided`。
- 为 `SettingRow` 增加 `divided` 或 `density`。
- 设置类页面内部行可逐步从分割线改为 `gap` + hover。
- 日志和表格类页面保留行线，但使用 `border-subtle`。

验证：

- 重点看 `/settings`、`/groups`、`/agent-settings`。
- 确认没有因为去线导致设置项归属不清。

## 验收标准

### 视觉验收

- 浅色模式下，卡片边框可感知但不抢眼。
- 深色模式下，面板边界不出现过亮线框。
- 主色不再显得“系统默认蓝”，当前态仍然清楚。
- 设置页行分割不再形成密集横线。
- 日志页仍然有足够结构，不因为减线影响扫描。
- Modal / Popover 在浅色模式下不再像深色组件强行反色。

### 功能验收

- 主题切换正常。
- 所有按钮、输入框、select、switch 可正常操作。
- 日志筛选、导出、滚动按钮不受影响。
- 预览编辑器布局编辑、氛围色保存不受影响。
- Groups 和 Agent 页面保存行为不受影响。

### 可访问性验收

- 主文本和背景对比度保持可读。
- muted 文本不能低到无法辨认。
- focus ring 仍明显。
- danger/warn/success 不能只靠颜色表达，仍保留文本语义。

## 测试计划

命令：

```bash
npm --prefix dashboard run lint
npm --prefix dashboard run build
```

浏览器 smoke：

```text
/settings
/logs
/preview-layout
/groups
/agent-settings
/agent-decisions
/agent-memory
/
```

建议截图输出：

```text
test/output/webui-visual-refinement-light-settings.png
test/output/webui-visual-refinement-light-logs.png
test/output/webui-visual-refinement-light-preview-layout.png
test/output/webui-visual-refinement-dark-settings.png
test/output/webui-visual-refinement-dark-logs.png
test/output/webui-visual-refinement-dark-preview-layout.png
```

## 回滚策略

阶段 1 的 token 调整是全局影响，如果视觉不满意，可以单独回滚 `dashboard/src/index.css` 和基础组件变更。

建议实施时分成至少两个提交：

1. `refactor: 优化 WebUI 视觉 token 与基础组件层级`
2. `refactor: 清理旧页面硬编码颜色`

这样如果旧页面 token 化出现局部问题，可以只回滚第二部分。

## 推荐执行顺序

1. 先执行阶段 1：全局 token + 基础组件降噪。
2. 截图对比浅色和深色的 `/settings`、`/logs`、`/preview-layout`。
3. 如果整体方向确认，再执行阶段 2：旧页面 token 化。
4. 最后执行阶段 3：逐步减少内部实线和组件 API 扩展。

## 需要用户确认的问题

实施前建议确认两点：

1. 主色方向：继续保留偏蓝控制台风格，还是向更冷静的蓝灰 / 青灰方向移动。
2. 减线程度：第一阶段只“淡化线”，还是直接在设置页尝试“减少线”。

默认建议：

- 主色保留偏蓝，但降低饱和度。
- 第一阶段只淡化线，不直接删线；确认观感后再做阶段 3。
