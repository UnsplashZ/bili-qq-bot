# Bilibili Emoji Rendering Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为仓库现有全部预览卡片类型建立统一的 Bilibili 官方表情渲染链路，优先显示表情图片，失败时回退原始文本。

**Architecture:** 方案将“正文提取”“富文本标准化”“表情资源缓存/兜底”“HTML 渲染”分层处理。先修复已经确认的 `user` 卡片漏走富文本渲染问题，再把动态共享链路抽成通用入口，最后把其他卡片接入统一的正文标准化路径。

**Tech Stack:** Node.js (CommonJS), Puppeteer 预览图渲染, 本地 Node 单元测试脚本, Python Bilibili 数据服务（只读复用）

---

### Task 1: 为用户卡片最近动态的 emoji 漏渲染建立回归测试

**Files:**
- Create: `test/unit/user-card-emoji-rendering.test.js`
- Modify: `src/services/imageGenerator/renderers/user.js`
- Reference: `src/services/imageGenerator/renderers/components/richtext.js`

**Step 1: Write the failing test**

创建最小用户卡片数据，最近动态中包含：

- 一个 `RICH_TEXT_NODE_TYPE_TEXT`
- 一个 `RICH_TEXT_NODE_TYPE_EMOJI`

断言生成的 HTML：

- 包含 `<img class="emoji"`
- 不再只出现裸文本 `[星星眼]`

**Step 2: Run test to verify it fails**

Run: `node test/unit/user-card-emoji-rendering.test.js`

Expected: FAIL，原因是当前 `user.js` 只输出 `escapeHtml(dynText)`。

**Step 3: Write minimal implementation**

在 `src/services/imageGenerator/renderers/user.js` 中：

- 为最近动态复用共享富文本解析入口
- 优先使用动态节点，而不是直接只读 `desc.text`
- 保持无节点时的纯文本回退

**Step 4: Run test to verify it passes**

Run: `node test/unit/user-card-emoji-rendering.test.js`

Expected: PASS

**Step 5: Commit**

```bash
git add test/unit/user-card-emoji-rendering.test.js src/services/imageGenerator/renderers/user.js
git commit -F - <<'EOF'
fix: 修复用户卡片最近动态表情未渲染

- 让用户卡片最近动态复用富文本渲染链路
- 为 emoji 节点渲染建立回归测试
EOF
```

执行前置条件：先获得用户明确批准。当前任务先不要执行 git。

### Task 2: 抽取共享的正文标准化入口

**Files:**
- Create: `src/services/imageGenerator/renderers/components/contentNodes.js`
- Create: `test/unit/content-nodes-normalization.test.js`
- Modify: `src/services/imageGenerator/renderers/dynamic.js`
- Modify: `src/services/imageGenerator/renderers/user.js`

**Step 1: Write the failing test**

为共享标准化入口写测试，覆盖：

- 直接传入 `rich_text_nodes` 时保留 emoji 节点
- 只有纯文本时输出 `TEXT` 节点
- 动态 `desc` / `summary` 优先级保持与现有行为一致

**Step 2: Run test to verify it fails**

Run: `node test/unit/content-nodes-normalization.test.js`

Expected: FAIL，原因是共享标准化入口尚不存在。

**Step 3: Write minimal implementation**

在新文件中实现最小 API，例如：

- `normalizeRichTextNodes(nodes, fallbackText)`
- `resolveDynamicContentNodes(dynamicModule, hasImages)`

要求：

- 不改变现有动态图片、话题、链接逻辑
- 先只抽出共享节点产物，避免一次改太多

**Step 4: Run tests to verify they pass**

Run:

- `node test/unit/content-nodes-normalization.test.js`
- `node test/unit/user-card-emoji-rendering.test.js`

Expected: PASS

**Step 5: Commit**

```bash
git add src/services/imageGenerator/renderers/components/contentNodes.js test/unit/content-nodes-normalization.test.js src/services/imageGenerator/renderers/dynamic.js src/services/imageGenerator/renderers/user.js
git commit -F - <<'EOF'
refactor: 抽取统一正文节点标准化入口

- 统一动态与用户卡片的正文节点解析
- 为后续表情缓存与其他卡片接入建立共享基础
EOF
```

执行前置条件：先获得用户明确批准。当前任务先不要执行 git。

### Task 3: 为官方表情建立轻量缓存与文本补图能力

**Files:**
- Create: `src/services/imageGenerator/renderers/components/biliEmojiRegistry.js`
- Create: `test/unit/bili-emoji-registry.test.js`
- Modify: `src/services/imageGenerator/renderers/components/richtext.js`

**Step 1: Write the failing test**

测试覆盖：

- 已有 `icon_url` 的 emoji 节点直接渲染图片
- 只有标准 `[星星眼]` 文本时，缓存命中可补图
- 缓存未命中时回退原始文本

**Step 2: Run test to verify it fails**

Run: `node test/unit/bili-emoji-registry.test.js`

Expected: FAIL，原因是 registry 与文本补图逻辑尚不存在。

**Step 3: Write minimal implementation**

实现一个轻量表情注册表：

- 从已见过的 emoji 节点写入内存缓存
- 允许按 `rawText` 读取最近可用 `iconUrl`
- `parseRichText()` 渲染时优先使用节点资源，缺失时查缓存

注意：

- 本阶段先做进程内缓存即可
- 不做 OCR，不做宽松文本猜测
- 只对标准官方 `[表情名]` 文本进行保守匹配

**Step 4: Run tests to verify they pass**

Run:

- `node test/unit/bili-emoji-registry.test.js`
- `node test/unit/content-nodes-normalization.test.js`
- `node test/unit/user-card-emoji-rendering.test.js`

Expected: PASS

**Step 5: Commit**

```bash
git add src/services/imageGenerator/renderers/components/biliEmojiRegistry.js test/unit/bili-emoji-registry.test.js src/services/imageGenerator/renderers/components/richtext.js
git commit -F - <<'EOF'
feat: 为 B 站表情渲染增加轻量缓存与文本补图

- 建立官方表情图片资源注册表
- 在安全匹配下支持标准表情文本补图
EOF
```

执行前置条件：先获得用户明确批准。当前任务先不要执行 git。

### Task 4: 让动态主卡与转发原文统一走共享节点与表情注册

**Files:**
- Modify: `src/services/imageGenerator/renderers/dynamic.js`
- Modify: `test/unit/dynamic-richtext-source-selection.test.js`
- Create: `test/unit/dynamic-emoji-registry-integration.test.js`

**Step 1: Write the failing test**

新增集成测试，覆盖：

- 动态正文中的 emoji 节点能注册到 registry
- 转发动态原文中的 emoji 同样走统一渲染链路
- 资源不可用时回退文本，不影响其他内容

**Step 2: Run test to verify it fails**

Run: `node test/unit/dynamic-emoji-registry-integration.test.js`

Expected: FAIL

**Step 3: Write minimal implementation**

在动态渲染入口中：

- 使用共享标准化节点
- 在渲染前注册当前批次 emoji 资源
- 保持现有链接、话题、图片、投票等逻辑不回归

**Step 4: Run tests to verify they pass**

Run:

- `node test/unit/dynamic-emoji-registry-integration.test.js`
- `node test/unit/dynamic-richtext-source-selection.test.js`
- `node test/unit/bili-emoji-registry.test.js`

Expected: PASS

**Step 5: Commit**

```bash
git add src/services/imageGenerator/renderers/dynamic.js test/unit/dynamic-emoji-registry-integration.test.js test/unit/dynamic-richtext-source-selection.test.js
git commit -F - <<'EOF'
refactor: 统一动态卡片的表情渲染链路

- 让动态正文与转发原文共享表情注册与渲染
- 保持现有来源选择逻辑并补充回归测试
EOF
```

执行前置条件：先获得用户明确批准。当前任务先不要执行 git。

### Task 5: 让 article/live/video/bangumi 接入统一正文标准化入口

**Files:**
- Modify: `src/services/imageGenerator/renderers/article.js`
- Modify: `src/services/imageGenerator/renderers/live.js`
- Modify: `src/services/imageGenerator/renderers/video.js`
- Modify: `src/services/imageGenerator/renderers/bangumi.js`
- Create: `test/unit/card-text-normalization-entry.test.js`

**Step 1: Write the failing test**

为四类卡片建立最小回归测试，覆盖：

- 当前纯文本场景输出保持不变
- 接入统一入口后不会出现 HTML 丢失、转义异常、空白正文

**Step 2: Run test to verify it fails**

Run: `node test/unit/card-text-normalization-entry.test.js`

Expected: FAIL

**Step 3: Write minimal implementation**

对四类卡片做最小接入：

- 将正文转换到共享标准化入口
- 现阶段若无 emoji 节点，仍按纯文本输出
- 为将来新增结构化正文留好入口，不增加无意义复杂度

**Step 4: Run tests to verify they pass**

Run:

- `node test/unit/card-text-normalization-entry.test.js`
- `node test/unit/user-card-emoji-rendering.test.js`
- `node test/unit/dynamic-emoji-registry-integration.test.js`

Expected: PASS

**Step 5: Commit**

```bash
git add src/services/imageGenerator/renderers/article.js src/services/imageGenerator/renderers/live.js src/services/imageGenerator/renderers/video.js src/services/imageGenerator/renderers/bangumi.js test/unit/card-text-normalization-entry.test.js
git commit -F - <<'EOF'
refactor: 为各类预览卡片接入统一正文标准化入口

- 统一 article live video bangumi 的正文处理入口
- 确保纯文本场景无视觉回归
EOF
```

执行前置条件：先获得用户明确批准。当前任务先不要执行 git。

### Task 6: 做最小端到端验证并补文档

**Files:**
- Modify: `README.md`（仅当需要补充渲染行为说明时）
- Optional: `docs/plans/2026-03-07-bilibili-emoji-rendering-design.md`

**Step 1: Prepare targeted verification cases**

准备最小样例数据，覆盖：

- `user` 最近动态含 emoji
- `dynamic` / 转发动态含 emoji
- 资源失效时回退文本

**Step 2: Run verification**

Run:

- `node test/unit/user-card-emoji-rendering.test.js`
- `node test/unit/content-nodes-normalization.test.js`
- `node test/unit/bili-emoji-registry.test.js`
- `node test/unit/dynamic-emoji-registry-integration.test.js`
- `node test/unit/card-text-normalization-entry.test.js`

如仓库已有更接近渲染入口的测试，也一并运行最小相关集合。

**Step 3: Optional local preview check**

如需要图片级验证，生成预览输出到：

- `test/output/`

不要写入 `test/debug/`。

**Step 4: Update docs if needed**

若 README 或设计文档需要补充：

- 表情渲染范围
- 回退策略
- 缓存策略

则做最小文档更新。

**Step 5: Commit**

```bash
git add README.md docs/plans/2026-03-07-bilibili-emoji-rendering-design.md
git commit -F - <<'EOF'
docs: 补充 B 站表情渲染方案与验证记录

- 记录统一渲染范围与回退策略
- 记录最小验证结果
EOF
```

执行前置条件：先获得用户明确批准。当前任务先不要执行 git。

## Notes

- 所有实现步骤必须先走 TDD。
- 所有非文档代码修改在本仓库规则下都需要用户明确批准后才能执行。
- 所有 git 操作都需要用户明确批准后才能执行。
- 如需隔离工作区，先单独申请用户批准，再创建 worktree。
