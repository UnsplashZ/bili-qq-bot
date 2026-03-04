# Groups 页面拆分 Phase 4：Review 与本地联调验收

日期：2026-03-04  
作者：Codex

## 1. 本轮目标

在 Phase 3（hooks 拆分）完成后，执行 Phase 4：

1. 结构化 review（副作用时序、跨 hook 联动、闭包依赖）。
2. 修复 review 发现的问题，确保零行为漂移。
3. 执行本地 lint/build/dev 与 API 冒烟联调。

## 2. Review 结论与修复

### 2.1 已修复问题

1. `useActionLock` 初始对象引用风险  
   - 现象：`useState` / `useRef` 直接使用共享常量对象，理论上存在引用污染风险。  
   - 修复：改为拷贝初始化（`{ ...INITIAL_ACTION_LOADING }`、`{ ...INITIAL_ACTION_LOCKS }`）。  
   - 文件：`dashboard/src/pages/groups/hooks/useActionLock.js`

2. 订阅列表清空时序对齐  
   - 现象：为对齐旧逻辑，清空订阅列表应在容器层按 `selectedGroupId/groups/globalConfig.showId` 变化触发。  
   - 修复：
     - 在 `Groups.jsx` 容器层保留该时序清空。  
     - 从 `useSubscriptions` 中移除“切群即清空”的内部 effect，避免重复/时序漂移。  
   - 文件：
     - `dashboard/src/pages/Groups.jsx`
     - `dashboard/src/pages/groups/hooks/useSubscriptions.js`

### 2.2 Review 后状态

- `Groups.jsx` 已收敛为容器编排层（约 299 行）。
- 领域逻辑拆分到 hooks，职责边界清晰。
- 未发现新增 lint/build 回归。

## 3. 本地验证结果

### 3.1 前端构建链路

执行：

```bash
npm --prefix dashboard run lint
npm --prefix dashboard run build
timeout 12s npm --prefix dashboard run dev -- --host 127.0.0.1 --port 4173
```

结果：

1. `lint` 通过。
2. `build` 通过。
3. `dev` 正常启动（`http://127.0.0.1:4173/`），`timeout` 退出为预期。

### 3.2 Dashboard API 冒烟（本地真实代码路径）

方法：

1. 启动 `src/dashboard/server.js`（端口 `3900`）。
2. 注入最小 `global.bot.groupList` 测试上下文。
3. 调用以下接口：
   - `GET /api/status`
   - `POST /api/login`
   - `GET /api/config`（Bearer token）
   - `GET /api/groups`（Bearer token）
   - `GET /api/groups/123/subscriptions`（Bearer token）
   - `GET /api/groups/123/atall-targets`（Bearer token）

结果：

- 全部返回 200，响应结构符合预期。

备注：

- 该冒烟覆盖了 Groups 页面依赖的关键读取链路（配置/群组/订阅/@all 目标）。

## 4. 验收结论

Phase 4 通过：

1. 完成 review，并修复关键时序/状态隐患。
2. 前端编译链路可用。
3. 本地真实 dashboard API 读链路可用。
4. 拆分后 `Groups` 结构可维护性显著提升，且未发现功能性回归证据。

