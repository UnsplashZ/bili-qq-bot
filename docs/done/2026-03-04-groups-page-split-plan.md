# `dashboard/src/pages/Groups.jsx` 结构拆分方案（零行为回归）

日期：2026-03-04  
作者：Codex

## 1. 目标

将 `dashboard/src/pages/Groups.jsx` 从单文件大组件拆分为「页面容器 + 领域 hooks + 展示组件 + 常量工具」结构，同时确保：

1. 不改变任何接口路径、请求方法、请求载荷和响应处理。
2. 不改变任何用户可见行为（按钮、开关、弹窗、文案、提示、加载态）。
3. 不改变关键副作用时序（选群加载、Tab 切换加载、锁机制、保存刷新）。
4. 不改变路由与页面导出方式（仍由 `Groups.jsx` 对外导出）。

## 2. 现状摘要（职责耦合）

`Groups.jsx` 当前约 1840 行，混合了以下职责：

1. 群组主列表加载、选择、启停、删除配置。
2. 表单主状态初始化与保存（常规配置、夜间模式、标签开关等）。
3. 订阅 CRUD（列表、添加、删除、modal 状态）。
4. 权限域（管理员、黑名单）及并发锁。
5. AI 配置开关/重置与参数编辑。
6. 关注同步域（B 站登录状态、分组、`@全体` 细粒度规则、目标 UID）。
7. 视频下载配置（拉取、保存、重置）。
8. 6 个 Tab 的大型 JSX 渲染与交互。

## 3. 不可破坏约束（拆分守则）

1. `runLockedAction` 语义必须保持一致（防重入 + 超时兜底解锁）。
2. `selectedTabIndex` 驱动的延迟拉取逻辑保持一致：
   - 订阅 Tab 拉订阅列表。
   - 关注同步 Tab 拉 B 站分组 + `@all` 目标 + 全局登录状态。
   - 视频下载 Tab 拉视频下载配置。
3. `handleSave` 的夜间模式校验规则保持一致（格式/范围）。
4. 选中群组后的 `formData` 归一化逻辑保持一致（含 `null` 继承语义）。
5. `subscriptionAtAllRules` 的 normalize 逻辑保持一致（非法 UID 过滤、去重）。
6. `VIDEO_DOWNLOAD_TAB_INDEX` 继续动态计算，避免硬编码索引回归。

## 4. 目标结构

```text
dashboard/src/pages/
├── Groups.jsx                                  # 页面容器（组合 hooks + 组件）
└── groups/
    ├── constants/
    │   ├── atAll.js                            # AT_ALL_SOURCE_KEYS / AT_ALL_CATEGORY_ITEMS
    │   └── tabs.js                             # categories 与索引辅助
    ├── utils/
    │   ├── atAllRules.js                       # createDefault/normalize/toggle 辅助
    │   ├── groupForm.js                        # formData 默认值与 group->form 映射
    │   └── validators.js                       # nightMode / QQ 等校验
    ├── hooks/
    │   ├── useGroupList.js                     # groups 列表、选中、启停、删除
    │   ├── useGroupForm.js                     # formData、保存、全局配置、初始化同步
    │   ├── useSubscriptions.js                 # 订阅列表 + modal + CRUD
    │   ├── useGroupPermissions.js              # 黑名单/管理员 + 锁动作
    │   ├── useGroupAiConfig.js                 # AI 开关/重置 + 参数状态
    │   ├── useGroupSyncConfig.js               # B站状态/分组/@all规则/目标列表
    │   └── useGroupVideoDownloadConfig.js      # 视频下载拉取/保存/重置
    └── components/
        ├── GroupListPanel.jsx
        ├── GroupDetailShell.jsx
        ├── AddSubscriptionModal.jsx
        └── tabs/
            ├── GeneralTab.jsx
            ├── SubscriptionsTab.jsx
            ├── PermissionsTab.jsx
            ├── AiTab.jsx
            ├── SyncTab.jsx
            └── VideoDownloadTab.jsx
```

## 5. 分阶段实施计划

## Phase 0：基线冻结

1. 记录当前关键交互路径（手工用例）。
2. 记录当前构建基线：`npm --prefix dashboard run lint`、`npm --prefix dashboard run build`。
3. 保留 `Groups.jsx` 现有行为日志关键点（失败提示文本、成功提示文本）。

## Phase 1：纯 UI 拆分（零逻辑迁移）

1. 先抽展示组件，不迁移 `useState/useEffect/API` 逻辑。
2. 按 Tab 抽离 JSX：6 个 Tab + 左侧群组列表 + 订阅弹窗。
3. 子组件只接收 props，不直接调用 API，不新增副作用。

验收：

1. `Groups.jsx` 仍持有全部状态与 handler。
2. 页面行为与拆分前一致。
3. lint/build 均通过。

## Phase 2：工具与常量下沉

1. 提取 `createDefaultAtAllRules/normalizeAtAllRules/normalizeIdList` 到 `groups/utils/atAllRules.js`。
2. 提取表单默认值、`group.config -> formData` 映射到 `groups/utils/groupForm.js`。
3. 提取夜间模式与 QQ 校验到 `groups/utils/validators.js`。
4. 提取 tab/category 常量，保留动态索引计算。

验收：

1. 单元级函数可独立调用。
2. 页面运行行为不变，输出文案不变。

## Phase 3：按领域拆 hooks（核心阶段）

1. `useGroupList`：群组列表加载、选择、启停、删除。
2. `useGroupForm`：表单状态、保存逻辑、与 `selectedGroupId` 的同步初始化。
3. `useSubscriptions`：订阅列表与 modal 交互。
4. `useGroupPermissions`：管理员与黑名单更新（保留锁语义）。
5. `useGroupAiConfig`：AI 开关/重置逻辑。
6. `useGroupSyncConfig`：B站状态、分组、`@all` 规则、目标 UID。
7. `useGroupVideoDownloadConfig`：视频下载配置拉取/保存/重置。

验收：

1. 每个 hook 职责单一，避免跨域写状态。
2. 跨域依赖在容器层显式编排（例如：删除订阅后刷新 `atAllTargets`）。
3. lint/build/dev 启动通过。

## Phase 4：容器收敛与回归

1. `Groups.jsx` 仅保留：页面组合、跨域编排、最小状态桥接。
2. 清理重复逻辑与无效 import。
3. 对照基线逐项手工回归。

验收：

1. `Groups.jsx` 建议控制在 250-400 行。
2. 无行为回归，无新增 console error。

## 6. 关键风险与缓解

1. 风险：副作用时序变化导致数据“旧值闪现”或漏刷新。  
缓解：保持 `selectedGroupId` 与 `selectedTabIndex` 两条 effect 的职责边界，不合并为单 effect。

2. 风险：拆 hook 后闭包引用旧 `selectedGroupId`。  
缓解：关键 action 使用最新依赖，必要处使用函数式 `setState`。

3. 风险：`runLockedAction` 被拆散后失去互斥。  
缓解：保留统一 lock hook（或单点实现）并复用到 blacklist/admins/ai/video。

4. 风险：`@all` 规则 normalize 漂移导致推送策略变化。  
缓解：normalize 与默认值逻辑独立成纯函数，先迁移再复用，不重写算法。

5. 风险：props 过多导致组件接线错误。  
缓解：按域聚合 props（如 `permissionsProps`、`syncProps`），避免散传 30+ 字段。

## 7. 本地联调与回归清单（精选）

## 7.1 静态检查

1. `npm --prefix dashboard run lint`
2. `npm --prefix dashboard run build`
3. `timeout 12s npm --prefix dashboard run dev -- --host 127.0.0.1 --port 4173`

## 7.2 关键联调用例

1. 群组列表：切换群组、启用/禁用、删除已退群配置。
2. 常规设置：修改夜间模式（包含非法时间）、标签开关、保存。
3. 订阅：新增/删除订阅，检查列表与 `@all` 目标联动刷新。
4. 权限：添加/删除管理员、黑名单，验证并发防重入状态。
5. AI：开关继承/重置、参数输入边界（概率/上下文/温度）。
6. 关注同步：未登录提示、已登录分组选择、`@全体` 源/分类/UID 细粒度开关。
7. 视频下载：跟随全局/显式值、保存与重置。

## 8. 非目标

1. 不调整 UI 视觉风格与交互文案。
2. 不改 API 协议，不新增后端字段。
3. 不在本次拆分引入全局状态库（Redux/Zustand 等）。
4. 不做业务逻辑重写（仅结构解耦）。

## 9. 实施顺序建议

1. 先做 Phase 1（UI 拆分），快速降低单文件体积且风险最低。
2. 再做 Phase 2（工具下沉），固定算法与默认值。
3. 最后做 Phase 3（hooks 拆分），并在每个小阶段后跑 7.1 + 7.2。

