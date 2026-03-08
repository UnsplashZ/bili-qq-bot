# WebUI Subscription Verify Badge Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 WebUI 群组管理订阅列表中的用户认证标签改为与预览卡片和 `/订阅列表` 图片一致的 SVG 图标。

**Architecture:** 仅修改 `dashboard` 前端展示层，复制服务端现有两张认证 SVG 到前端资源目录，并替换 `SubscriptionsTab` 中的 `lucide-react` 认证图标实现。后端接口、订阅数据结构、图片生成逻辑保持不变。

**Tech Stack:** React 19, Vite 7, Node.js, Mocha

---

### Task 1: 为认证标签一致性补充最小回归测试

**Files:**
- Create: `test/unit/dashboard-subscription-verify-badge-assets.test.js`
- Modify: `dashboard/src/pages/groups/components/tabs/SubscriptionsTab.jsx`

**Step 1: Write the failing test**

新增一个最小回归测试，检查 `SubscriptionsTab.jsx` 不再依赖 `BadgeCheck` 作为认证标签，并且引用两张前端侧认证 SVG 资源。

**Step 2: Run test to verify it fails**

Run: `npx mocha --exit "test/unit/dashboard-subscription-verify-badge-assets.test.js"`
Expected: FAIL，因为当前组件仍然导入并使用 `BadgeCheck`。

**Step 3: Write minimal implementation**

将两张认证 SVG 复制到 `dashboard/src/assets/verify/`，并在 `SubscriptionsTab.jsx` 中改为按认证类型渲染 `<img>`。

**Step 4: Run test to verify it passes**

Run: `npx mocha --exit "test/unit/dashboard-subscription-verify-badge-assets.test.js"`
Expected: PASS

### Task 2: 做最小有效验证

**Files:**
- Verify: `dashboard/package.json`

**Step 1: Run targeted build verification**

Run: `npm run build`
Workdir: `dashboard/`
Expected: 构建成功，说明前端资源引用和 JSX 均有效。
