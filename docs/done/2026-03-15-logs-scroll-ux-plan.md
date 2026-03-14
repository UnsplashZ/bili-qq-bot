# Logs Scroll UX Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复系统日志页的强制自动下滑问题，并为日志滚动区增加一个可在“回顶部/去底部”之间切换的浮动按钮。

**Architecture:** 滚动行为调整只落在日志页视图层。`scrollBehavior.js` 负责纯函数化的“底部缓冲区/接近底部”判定，`Logs.jsx` 负责滚动容器状态、首次进入不自动滚动、以及浮动按钮的顶部/底部跳转交互。后端接口和 `useLogsStream` 保持不变。

**Tech Stack:** React, Vite, lucide-react, Node.js, Mocha

---

### Task 1: 先把滚动阈值逻辑固化成失败测试

**Files:**
- Modify: `test/unit/logs-scroll-behavior.test.js`
- Test: `dashboard/src/pages/logs/scrollBehavior.js`

**Step 1: 写失败测试**

为 `scrollBehavior.js` 补至少三类断言：

- 单条日志高度已知时，底部阈值按 `rowHeight * 3` 计算
- 单条日志高度过大时，阈值被最大值夹住
- 用户明显离开底部时，`isNearBottom()` 返回 `false`

**Step 2: 运行测试验证失败**

Run:

```bash
node test/unit/logs-scroll-behavior.test.js
```

Expected:

- 新增断言先失败
- 失败原因明确指向阈值仍是固定像素或缺少阈值解析函数

### Task 2: 重构 scrollBehavior 为可测试的纯函数

**Files:**
- Modify: `dashboard/src/pages/logs/scrollBehavior.js`
- Test: `test/unit/logs-scroll-behavior.test.js`

**Step 1: 增加阈值解析函数**

新增纯函数，职责至少包括：

- 根据日志行高计算 `3 * rowHeight`
- 对结果做最小/最大值夹取
- 在行高不可用时使用保守默认值

**Step 2: 保持底部判定函数可接收动态阈值**

`isNearBottom()` 应继续接受容器滚动信息，但阈值来源改为动态计算结果，而不是只依赖固定 `48px`。

**Step 3: 运行测试验证通过**

Run:

```bash
node test/unit/logs-scroll-behavior.test.js
```

Expected:

- 阈值与底部判定相关断言全部通过

### Task 3: 让日志页首次进入不再强制自动下滑

**Files:**
- Modify: `dashboard/src/pages/Logs.jsx`

**Step 1: 拆分滚动容器 ref**

为日志滚动区增加容器 ref，用于：

- 读取 `scrollTop/clientHeight/scrollHeight`
- 执行顶部/底部平滑跳转
- 判断是否有滚动溢出

**Step 2: 收紧自动跟随触发条件**

调整现有自动滚动 effect：

- 首次进入和历史日志首屏加载时不主动滚到底部
- 只有 `autoFollow === true` 时，新增日志才允许下滑

**Step 3: 保持滚动事件驱动 auto-follow**

在 `onScroll` 中，基于动态阈值更新 `autoFollow`：

- 离开底部缓冲区：关闭
- 回到底部缓冲区：重新开启

### Task 4: 增加单个浮动按钮

**Files:**
- Modify: `dashboard/src/pages/Logs.jsx`

**Step 1: 增加按钮显示条件**

按钮仅在日志容器存在滚动溢出时显示。

**Step 2: 增加按钮模式切换**

基于当前位置切换按钮语义：

- 接近底部：显示“回顶部”
- 不接近底部：显示“去底部”

**Step 3: 实现顶部/底部跳转动作**

- 去底部：平滑滚到底部，并恢复 `autoFollow`
- 回顶部：平滑滚到顶部，并关闭 `autoFollow`

### Task 5: 保持现有顶部入口兼容

**Files:**
- Modify: `dashboard/src/pages/Logs.jsx`

**Step 1: 保留顶部“回到底部”按钮**

仅校准它与新的 `autoFollow` 语义一致：

- 点击后滚到底部
- 并恢复自动跟随

避免这次额外改动顶部操作路径。

### Task 6: 做最小相关验证

**Files:**
- Test: `test/unit/logs-scroll-behavior.test.js`
- Test: `dashboard/src/pages/Logs.jsx`

**Step 1: 跑滚动行为单测**

Run:

```bash
node test/unit/logs-scroll-behavior.test.js
```

Expected:

- 全部通过

**Step 2: 跑前端构建检查**

Run:

```bash
npm --prefix dashboard run build
```

Expected:

- 构建成功
- 没有因新按钮、图标或 Hook 依赖导致的构建错误

### Task 7: 提交变更

**Files:**
- Modify: `dashboard/src/pages/Logs.jsx`
- Modify: `dashboard/src/pages/logs/scrollBehavior.js`
- Modify: `test/unit/logs-scroll-behavior.test.js`

**Step 1: 提交**

如果当前仍在 `main`：

```bash
git add dashboard/src/pages/Logs.jsx dashboard/src/pages/logs/scrollBehavior.js test/unit/logs-scroll-behavior.test.js
git commit -F - <<'EOF'
v3.20.12 优化日志页滚动体验

- 移除日志页首次进入时的强制自动下滑
- 将自动跟随范围改为按 3 条日志高度判定
- 为日志滚动区增加顶部/底部切换浮动按钮
EOF
```

如果在非 `main` 分支：

```bash
git add dashboard/src/pages/Logs.jsx dashboard/src/pages/logs/scrollBehavior.js test/unit/logs-scroll-behavior.test.js
git commit -F - <<'EOF'
feat: 优化日志页滚动体验

- 移除日志页首次进入时的强制自动下滑
- 将自动跟随范围改为按 3 条日志高度判定
- 为日志滚动区增加顶部/底部切换浮动按钮
EOF
```

Plan complete and saved to `docs/plans/2026-03-15-logs-scroll-ux-plan.md`. Two execution options:

1. Subagent-Driven (this session) - 我在当前会话按任务逐步实现并验证
2. Parallel Session (separate) - 新开会话按计划执行

在当前仓库规则下，执行代码修改前仍需你明确授权。
