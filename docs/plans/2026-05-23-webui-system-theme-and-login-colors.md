# WebUI 系统主题跟随、登录页配色与局部视觉修正方案

## 背景

当前 Dashboard 已有浅色和深色 token：

- `dashboard/src/index.css` 在 `:root` 定义浅色变量。
- `[data-theme='dark']` 定义深色变量。
- `dashboard/src/components/Layout.jsx` 读取 `localStorage` 中的 `bili-qq-bot.dashboard.theme`，只接受 `light` 或 `dark`。
- `Layout` 在 effect 中写入 `document.documentElement.dataset.theme = theme`。

这导致两个问题：

1. 主题偏好只有 `light/dark`，没有“跟随系统”这个用户可选模式。
2. `/login` 路由不经过 `Layout`，所以登录页不会执行主题初始化，默认只使用 `:root` 的浅色变量；即使用户之前在主界面选了深色，登录页也不会同步。

结合当前页面截图与实现，再补充三个局部问题：

3. 左上角品牌位仍是文字方块 `BQ`，和项目调性不够贴合，可以替换为本项目生成的专用 bot 图标。
4. 运行状态页的内存卡片同时展示 `used / total` 和百分比，信息重复；本次要求去掉内存占用百分比。
5. 系统日志页筛选器是普通页面内容，滚动到日志底部后筛选器不可见；日志作为诊断工具页，应保持筛选器栏在页面内固定可用。

## 目标

- WebUI 主题选择支持三种模式：`system`、`light`、`dark`。
- 默认值改为 `system`，未保存偏好的用户按系统主题显示。
- 当选择 `system` 时，系统颜色模式变化后 WebUI 自动跟随，无需刷新。
- 登录页和登录后主界面使用同一套主题初始化逻辑。
- 登录页所有背景、卡片、输入框、按钮、Toast 相关视觉都通过主题 token 适配浅色/深色。
- 左上角品牌位使用项目专属图标，替代纯 `BQ` 字符块，同时兼容深色和浅色模式。
- 运行状态页内存卡片只展示 `已用 / 总量`，不再展示百分比。
- 系统日志页筛选器在页面滚动时保持可见，避免滚到底部后需要回到顶部才能调整过滤条件。

## 非目标

- 不改后端 API。
- 不引入服务端保存主题偏好。
- 不重做整套 WebUI 视觉系统。
- 不改变现有 `light/dark` 存储值的含义，确保旧用户偏好继续生效。
- 不引入复杂品牌系统或整套 logo 规范，本次只替换 WebUI 侧边栏品牌图标。
- 不改变日志流获取、过滤参数、滚动跟随算法和接口契约。

## 总体设计

把主题控制从 `Layout` 提升到 App 级别，拆成“用户偏好”和“实际生效主题”两层。

```text
themePreference: 'system' | 'light' | 'dark'
effectiveTheme:  'light' | 'dark'
```

- `themePreference`：用户选择，写入 `localStorage`。
- `effectiveTheme`：当前真正应用到 DOM 的主题。
- 当 `themePreference === 'system'` 时，`effectiveTheme` 来自 `window.matchMedia('(prefers-color-scheme: dark)')`。
- 当 `themePreference === 'light' | 'dark'` 时，`effectiveTheme` 等于用户显式选择。

DOM 上建议同时写两个属性：

```html
<html data-theme="dark" data-theme-preference="system">
```

- `data-theme` 继续作为 CSS token 切换依据，减少改动面。
- `data-theme-preference` 方便后续做 UI 状态、调试或选择器扩展。

## 实施方案

### 1. 新增 Theme Provider

新增文件：

- `dashboard/src/context/ThemeContext.js`
- `dashboard/src/hooks/useTheme.js`
- `dashboard/src/components/ThemeProvider.jsx`

核心职责：

- 读取 `localStorage`。
- 兼容旧值：`light`、`dark` 原样保留；无值或非法值使用 `system`。
- 监听系统主题变化。
- 计算 `effectiveTheme`。
- 在 `document.documentElement` 写入 `data-theme`、`data-theme-preference` 和 `style.colorScheme`。
- 容错 `localStorage` 读写异常，避免隐私模式或存储不可用时阻断渲染。
- 监听系统主题变化时同时兼容 `matchMedia.addEventListener/removeEventListener` 与旧版 `addListener/removeListener`。
- 暴露：
  - `themePreference`
  - `effectiveTheme`
  - `setThemePreference(next)`
  - `cycleThemePreference()`

建议常量：

```js
export const THEME_STORAGE_KEY = 'bili-qq-bot.dashboard.theme'
export const THEME_PREFERENCES = ['system', 'light', 'dark']
```

`cycleThemePreference()` 顺序建议为：

```text
system -> light -> dark -> system
```

这个顺序能把“跟随系统”作为默认主路径，也便于用户发现。

### 2. App 入口挂载 Provider

调整 `dashboard/src/App.jsx`：

```jsx
<ThemeProvider>
  <ToastProvider>
    <Router>...</Router>
  </ToastProvider>
</ThemeProvider>
```

`ThemeProvider` 必须包住 `/login` 和所有受保护路由，这样登录页也能拿到同一套主题状态。

如果 Toast 组件依赖 token，放在 `ThemeProvider` 内可以保证 Toast 在登录页也正确适配。

### 3. Layout 只消费主题，不再拥有主题状态

调整 `dashboard/src/components/Layout.jsx`：

- 删除本地 `THEME_STORAGE_KEY`、`getInitialTheme()`、`useState(getInitialTheme)` 和写 DOM 的 effect。
- 使用 `useTheme()` 获取：
  - `themePreference`
  - `effectiveTheme`
  - `cycleThemePreference`
- 主题按钮文案和图标根据偏好显示，而不是只看 `dark/light`。

推荐展示：

| 偏好 | 图标 | 文案 |
| --- | --- | --- |
| `system` | `Monitor` | `跟随系统` |
| `light` | `Sun` | `浅色模式` |
| `dark` | `Moon` | `深色模式` |

点击按钮执行 `cycleThemePreference()`。

### 4. MobileMenu 同步三态主题

调整 `dashboard/src/components/MobileMenu.jsx`：

- props 从 `theme` 改为 `themePreference` 或直接在组件内 `useTheme()`。
- 使用同一套 `Monitor/Sun/Moon` 图标和文案。
- 点击同样执行 `cycleThemePreference()`。

建议优先让 `MobileMenu` 自己调用 `useTheme()`，减少 `Layout` 传参。

### 5. 登录页主题适配

`dashboard/src/pages/Login.jsx` 当前主要使用 token，但外层容器没有明确背景，整体靠 `body/#root`。建议补一个登录页专用背景层，让浅色/深色都有稳定视觉。

建议结构：

```jsx
<main className="login-page flex min-h-screen items-center justify-center p-4">
  <div className="login-panel w-full max-w-md">
    ...
  </div>
</main>
```

新增 CSS token 或类：

```css
.login-page {
  background:
    radial-gradient(circle at 18% 12%, color-mix(in oklch, var(--accent) 14%, transparent), transparent 32rem),
    linear-gradient(180deg, var(--bg), color-mix(in oklch, var(--surface-muted) 62%, var(--bg)));
  color: var(--fg);
}

.login-panel {
  color: var(--fg);
}
```

注意事项：

- 不使用固定 `gray-*` 作为登录页关键颜色。
- 当前输入框 `placeholder-gray-500` 建议移除，交给 `.field-control::placeholder`。
- 锁图标块已经使用 `var(--info)` 和 `var(--info-soft)`，可以保留。
- 登录按钮继续使用 `Button variant="primary"`，由 token 决定浅深色。

### 6. CSS 层补齐系统主题兜底

现有 `:root` 是浅色，`[data-theme='dark']` 是深色。为了减少首屏闪烁，可以增加一个仅在没有 `data-theme` 时生效的系统兜底：

```css
@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) {
    color-scheme: dark;
    /* 复用深色变量 */
  }
}
```

但这里有重复深色变量的维护成本。更稳妥的实现是：

- 在 `dashboard/src/main.jsx` 或 `ThemeProvider` 首次渲染前加一段极小初始化脚本不现实，因为当前是 Vite SPA。
- 第一阶段可以接受极短暂浅色首屏；如果实测闪烁明显，再把深色变量抽成可复用 CSS 层或在 `index.html` 内加内联初始化脚本。

推荐第一阶段不复制整套变量，避免双份 token 漂移。

### 7. 左上角 bot 图标替换

当前 `dashboard/src/components/Layout.jsx` 的侧边栏品牌位使用固定文字块：

```jsx
<div className="grid h-9 w-9 ...">BQ</div>
```

建议用 `gpt-image-2` 生成一个项目专属图标，然后作为静态资源接入 WebUI。

#### 图标方向

图标需要贴合 `bili-qq-bot` 的定位：Bilibili 内容解析、QQ 群机器人、自动化推送和 WebUI 控制台。建议视觉元素：

- 小型 bot 头像或控制台机器人轮廓。
- 播放按钮、消息气泡、信号波纹等抽象元素。
- 蓝色/青色为主，少量粉色点缀即可。
- 不直接复刻 Bilibili 或 QQ 官方 logo，避免商标化风险；不得出现 Bilibili 小电视轮廓、QQ 企鹅、官方 wordmark 或高度近似组合。
- 图形要能在 `36px` 左右仍清楚，不依赖小字。
- 输出透明背景 PNG，另保留源图或高分辨率版本。

建议生成提示词：

```text
Create a compact app icon for a project named bili-qq-bot, a friendly automation bot that bridges Bilibili video updates into QQ group chats. Use a clean modern vector-like style, small robot face combined with a play triangle and chat bubble signal arcs, cyan blue with subtle pink accent, transparent background, no text, no official brand logos, readable at 36px, square composition.
```

#### 资源落点

推荐新增：

- `dashboard/src/assets/bili-qq-bot-icon.png`

接入位置：

- `dashboard/src/components/Layout.jsx`
- `dashboard/src/components/MobileMenu.jsx`
- 移动端固定顶部 header 中的品牌位也同步使用该图标，保证全端左上角一致。

实现方式：

- 必须先生成并落地 `dashboard/src/assets/bili-qq-bot-icon.png`，再修改 React 文件进行静态 import；Vite 静态 import 的缺文件风险发生在构建期，不是运行期。
- import 静态资源后渲染 `<img>`。
- 保留同尺寸容器和边框，避免侧边栏布局跳动。
- `alt` 使用 `bili-qq-bot`。
- 可以用 `<img onError>` 保留 `BQ` 运行时 fallback，但它只能处理资源加载失败，不能覆盖构建期缺文件。
- `npm run build` 必须通过，以确认图片资产已被 Vite 正常打包。

后续如果要同步浏览器 favicon，可以另行加入 `dashboard/public/` 或 `dashboard/index.html`，不放在本次必做范围。

### 8. 运行状态内存卡片去掉百分比

当前 `dashboard/src/pages/Dashboard.jsx` 中内存 KPI 同时展示：

```js
value: `${formatBytes(memoryUsed)} / ${formatBytes(memoryTotal)}`
meta: formatPercent(memoryPercent)
```

调整方案：

- 内存卡片 `value` 保持 `5.14 GB / 15.37 GB` 这类表达。
- 内存卡片 `meta` 改为 `null`，页面不再渲染百分比。
- `memoryPercent` 仍可保留用于 `tone: getMetricTone(memoryPercent, 75, 90)`，这样卡片风险色仍能基于真实占用率判断。
- 不影响资源趋势图，图里内存仍按字节数展示。

如果后续希望完全避免隐式百分比逻辑，也可以新增 `getMemoryTone(memoryUsed, memoryTotal)`，但本次没必要扩大改动面。

### 9. 系统日志筛选器页面内固定

当前 `dashboard/src/pages/Logs.jsx` 结构大致为：

```text
header
filter GlassCard
log GlassCard
floating button
```

问题是当日志内容使页面产生滚动时，筛选器会随页面滚走。建议将筛选器卡片改为 sticky：

```jsx
<GlassCard className="sticky top-16 z-20 p-3 sm:p-4 md:top-8">
  ...
</GlassCard>
```

细节要求：

- `top` 要避开移动端顶部 header：移动端可使用 `top-16`，桌面因为左侧栏布局没有顶部 header，可使用 `md:top-8`。
- sticky 容器需要实色或半透明 `bg-[var(--surface)]`，避免滚动日志穿透影响可读性。
- 加 `z-20`，但低于移动菜单和全局浮层。
- 保留现有过滤控件布局和状态，不改变 `useLogsStream(filters, isPaused)`。
- 只改筛选器 `GlassCard` 的 sticky class，不新增包裹日志页的 `overflow-hidden`、`overflow-auto`、`overflow-scroll` 或 `transform` 容器。
- sticky 元素所有祖先必须避免新增会破坏 sticky 定位的 overflow/transform；如果需要改外层布局，必须重新验证 sticky 是否仍相对页面视口生效。
- 若日志页仍出现“整页滚动 + 内部日志容器滚动”混合行为，优先只固定筛选器，不重写现有 `scrollBehavior` 算法。

如果希望体验更工具化，第二阶段可以把日志页改成单屏布局：

```text
固定标题区
sticky 筛选器
剩余高度日志流容器内部滚动
```

但这会影响当前回顶/去底部逻辑，本次建议先做 sticky 修正。

## 兼容策略

### localStorage

当前 key 继续使用：

```text
bili-qq-bot.dashboard.theme
```

兼容规则：

- `light`：保持浅色。
- `dark`：保持深色。
- `system`：跟随系统。
- 空值、其他值：按 `system`。

这样不会破坏现有已选择浅色/深色的用户。

### CSS 选择器

继续以 `[data-theme='dark']` 作为深色入口。浅色仍由 `:root` 默认变量承载，不新增 `[data-theme='light']` 的重复变量。

## 验收标准

- 无保存偏好时，首次进入 `/login` 和 `/` 都跟随系统颜色模式。
- 选择 `浅色模式` 后，刷新 `/login` 和 `/` 都保持浅色。
- 选择 `深色模式` 后，刷新 `/login` 和 `/` 都保持深色。
- 选择 `跟随系统` 后，切换操作系统深浅色，WebUI 自动变化。
- 主题按钮在桌面侧边栏和移动菜单中显示同一状态。
- 登录页背景、卡片、输入框、按钮、错误 Toast 在浅色和深色下都有足够对比度。
- 旧 `localStorage` 值 `light/dark` 不被误清除。
- 侧边栏和移动菜单左上角显示专用 bot 图标，`36px` 左右清晰可辨，浅色/深色模式下边界清楚。
- 运行状态页内存卡片只显示已用和总量，不显示 `33.5%` 这类百分比。
- 高内存占用场景下，内存卡片仍按阈值呈现 warn/danger 风险色。
- 系统日志页滚动到日志底部时，等级、关键字和 Channel 筛选器仍可见并可操作。

## 最小验证

代码实现后建议运行：

```bash
cd dashboard
npm run lint
npm run build
```

手动检查：

1. 打开 `http://localhost:5173/login`。
2. 清空 `localStorage['bili-qq-bot.dashboard.theme']`，确认按系统主题显示。
3. 在主界面连续点击主题按钮，确认三态循环和持久化。
4. 分别刷新 `/login`、`/settings`、`/groups`，确认主题一致。
5. 在 DevTools 或系统设置切换 `prefers-color-scheme`，确认 `system` 模式实时跟随。
6. 在桌面宽度和移动宽度分别检查 `/login`、`/`、`/logs`。
7. 在 `system/light/dark` 三态下截图或人工确认主题显示。
8. 检查侧边栏、移动菜单和移动端顶部 header 的品牌图标在浅色/深色下显示正常。
9. 检查运行状态页内存卡片不再出现百分比。
10. 高内存 mock 或真实高占用状态下，确认内存卡片风险色仍按阈值变化。
11. 打开 `/logs`，产生足够页面滚动后滚到底部，确认筛选器仍固定可见。
12. 在浏览器中检查筛选器 `getBoundingClientRect().top`，确认滚动前后仍停留在预期 header 下方位置。

## 风险与注意点

- `matchMedia.addEventListener('change', ...)` 在较旧浏览器中可能需要降级到 `addListener`。如果需要兼容旧 WebView，可加 fallback。
- 登录页不经过 `ProtectedRoute`，所以主题逻辑不能继续放在 `Layout`。
- 主题按钮如果只显示 `effectiveTheme`，会看不出当前是“深色固定”还是“跟随系统且当前深色”；UI 必须显示 `themePreference`。
- 不建议把 `system` 解析后写回 `light/dark`，否则会丢失跟随语义。
- AI 生成图标可能细节过多，必须按 `36px` 实际尺寸检查；如果缩小后不可读，需要重新生成更简化版本。
- 生成图标不要包含官方品牌 logo 或可识别商标组合，降低分发风险。
- 日志筛选器 sticky 后会占据页面上方空间，需检查移动端是否遮挡日志表头或标题按钮。
- 如果 sticky 在某些父容器 overflow 场景下失效，需要检查祖先元素是否设置了影响 sticky 的 `overflow`。

## 建议改动清单

- `dashboard/src/components/ThemeProvider.jsx`：新增主题状态中心。
- `dashboard/src/context/ThemeContext.js`：新增主题 Context。
- `dashboard/src/hooks/useTheme.js`：新增消费 hook。
- `dashboard/src/App.jsx`：Provider 提升到路由外层。
- `dashboard/src/components/Layout.jsx`：改为消费主题状态，桌面按钮支持三态。
- `dashboard/src/components/MobileMenu.jsx`：移动菜单按钮支持三态，并同步显示 bot 图标。
- `dashboard/src/pages/Login.jsx`：补登录页主题背景和移除固定 placeholder 色。
- `dashboard/src/pages/Dashboard.jsx`：内存 KPI 去掉百分比 meta，保留占用率风险判断。
- `dashboard/src/pages/Logs.jsx`：筛选器卡片改为 sticky，保证滚动到底部仍可操作。
- `dashboard/src/index.css`：新增登录页背景类，必要时补 `color-scheme` 和过渡细节。
- `dashboard/src/assets/bili-qq-bot-icon.png`：新增由 `gpt-image-2` 生成的项目图标。
