# WebUI 视觉现代化设计方案

## 背景

当前 Dashboard 使用深色玻璃拟态风格（glassmorphism），整体可用但存在两个明显问题：

1. **Tab 切换生硬**：`@headlessui/react` 的 `Tab` 组件切换时无过渡动画，内容区瞬间跳变
2. **视觉层次平淡**：GlassCard、侧边栏 active 状态、卡片边框缺乏精致感

## 设计决策

### 整体风格：C 混合现代风

保留深色背景，不引入毛玻璃模糊效果，改用以下视觉语言：

- 背景色：`#0f1117` → `#131520` 渐变（现有基础微调）
- 卡片边框：`#1e2030`，顶部加一条 `linear-gradient(90deg, transparent, rgba(99,102,241,0.35), transparent)` 高光线
- 主色调：蓝紫 `#6366f1` / `#a78bfa`，用于 active 状态、进度条、高光

### Tab 组件：C3 分段控件 + 方案 2 动画

**样式（C3 分段控件）：**
- 整体一个 `border: 1px solid #1e2030; border-radius: 8px` 边框包住所有 tab
- 选中项：`background: #1e2040; color: #a5b4fc; border: 1px solid rgba(99,102,241,0.3)`
- 未选中：`color: #4a5080`，hover 时 `color: #7c85c0`
- tab 之间用 `border-right: 1px solid #1e2030` 分隔

**动画（方案 2 滑块 + 淡入）：**
- 一个绝对定位的 `.slider` 元素跟随选中 tab 平滑移动
- 过渡：`left/width 0.22s cubic-bezier(0.4, 0, 0.2, 1)`
- 内容区面板：`opacity` 淡入淡出，`transition: opacity 0.2s ease`
- 实现方式：用受控 `useState` 替换 `@headlessui/react Tab`，手动管理 active index

## 改造范围（选项 2）

改动约 5-6 个文件，不破坏现有布局和功能：

### 1. `dashboard/src/components/GlassCard.jsx`

在现有 `bg-white/10 backdrop-blur-md border border-white/20` 基础上：
- 改为 `bg-[#0d0f1a] border border-[#1e2030]`（减少模糊，更清晰）
- 用 `::before` 伪元素或内联 `div` 加顶部渐变高光线
- 保持 `rounded-xl shadow-lg` 不变

### 2. `dashboard/src/components/Layout.jsx`（侧边栏）

`SidebarItem` active 状态改造：
- 现在：`bg-white/10 text-white`
- 改为：左侧加 `border-l-2 border-[#6366f1]`，背景 `bg-[#1e2040]/60`，文字 `text-[#a5b4fc]`
- 过渡：`transition-all duration-200`

### 3. `dashboard/src/pages/Groups.jsx`（Tab 组件）

- 移除 `@headlessui/react Tab` 依赖（仅在此文件使用）
- 改用自定义 `useState` 控制 active index
- Tab 列表换成 C3 分段控件样式
- 内容区用 `opacity` 淡入淡出动画
- 加滑块 `.slider` 元素，用 `useRef` + `useEffect` 计算位置

### 4. `dashboard/src/index.css`

新增全局动画工具类：
```css
.tab-panel-enter { opacity: 0; }
.tab-panel-enter-active { opacity: 1; transition: opacity 0.2s ease; }
.tab-panel-exit { opacity: 1; }
.tab-panel-exit-active { opacity: 0; transition: opacity 0.15s ease; }
```

### 5. `dashboard/src/pages/Settings.jsx`（如有 Tab）

检查是否使用 Tab 组件，如有则同步改造。

### 6. `dashboard/src/pages/AgentSettings.jsx` / `AgentDecisions.jsx` / `AgentMemory.jsx`

检查是否使用 Tab 组件，如有则同步改造。

## 不改动的内容

- 页面布局结构（flex/grid、响应式断点）
- 所有功能逻辑、hooks、API 调用
- 颜色系统中的蓝色主色（`blue-600`、`blue-400`）保持兼容
- 移动端适配逻辑

## 验证方式

1. `cd dashboard && npm run build` 确认无编译错误
2. 本地启动后手动验证：
   - Groups 页面 tab 切换有滑块动画和内容淡入
   - 侧边栏 active 状态有左侧蓝紫指示条
   - GlassCard 顶部有渐变高光线
   - 移动端布局不受影响

## 风险

- `@headlessui/react Tab` 移除后需确认无其他页面依赖（grep 确认）
- 滑块位置计算依赖 DOM，需在 `useEffect` 中处理，避免 SSR 问题（本项目无 SSR，风险低）
