# `dashboard/src/pages/Settings.jsx` 结构拆分方案（零行为变更）

日期：2026-03-04  
作者：Codex

## 1. 目标

将 `Settings.jsx` 从单文件大组件拆分为「页面容器 + 展示组件」结构，同时确保：

1. 不改变任何接口调用路径、请求参数与响应处理。
2. 不改变任何状态字段名、默认值、更新时序与副作用顺序。
3. 不改变任何用户可见文案、按钮行为、弹窗交互和错误提示。
4. 不改变现有 UI 结构和样式类名（仅做文件拆分）。

## 2. 现状与风险

`Settings.jsx` 超 1900 行，包含以下混合职责：

1. 配置初始化加载（config/mcp/blacklist/bili status）。
2. 通用设置、AI、黑名单、视频下载等状态与保存逻辑。
3. MCP 增删改启停的并发控制与版本冲突处理。
4. B 站二维码登录轮询与清理逻辑。
5. 大量 section 与 modal JSX。

主要风险：拆分后 props 传递错误导致行为回归，或在子组件中意外引入新状态造成逻辑漂移。

## 3. 拆分策略

采用「逻辑留在页面层，UI 拆为纯展示组件」：

1. `Settings.jsx` 保留全部 `useState/useEffect/handlers`。
2. 将 section/modal JSX 提取到 `dashboard/src/pages/settings/components/*.jsx`。
3. 子组件只接收 props 与回调，不直接访问 API，不新增副作用。
4. 原有 `Settings.jsx` 对外导出名与路由引用保持不变。

## 4. 目标结构

```text
dashboard/src/pages/
├── Settings.jsx                              # 页面容器（状态+副作用+事件）
└── settings/
    └── components/
        ├── GeneralSettingsSection.jsx
        ├── BiliGlobalSection.jsx
        ├── GlobalBlacklistSection.jsx
        ├── AiSettingsSection.jsx
        ├── McpServersSection.jsx
        ├── VideoDownloadSection.jsx
        ├── SystemControlSection.jsx
        ├── AddMcpModal.jsx
        ├── EditMcpModal.jsx
        ├── RemoveMcpModal.jsx
        ├── RestartConfirmModal.jsx
        └── BiliQrModal.jsx
```

## 5. 实施步骤

1. 提取 section 组件（常规、B站、黑名单、AI、MCP、视频下载、系统控制）。
2. 提取 5 个 modal 组件。
3. 在 `Settings.jsx` 中替换 JSX 调用并传递原有 props。
4. 清理未使用 import，保证编译通过。

## 6. 验收清单

1. `npm --prefix dashboard run build` 通过。
2. 页面可正常渲染，打开/关闭各类弹窗无报错。
3. 所有按钮行为与拆分前一致：
   - 常规设置保存
   - 黑名单增删
   - AI 保存/重置
   - MCP 增删改启停
   - B站扫码登录轮询/退出
   - 系统重启确认
4. 无新增 ESLint 错误（如运行 lint）。

## 7. 非目标

1. 不改动 API 协议。
2. 不调整 UI 样式和交互文案。
3. 不重构业务逻辑（例如不改为 useReducer 或新增状态管理库）。
