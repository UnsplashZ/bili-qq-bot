# Bilibili Emoji Repair Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复 Bilibili 官方表情渲染中的冷启动失效、跨请求污染和专栏 HTML 正文遗漏问题，并覆盖节点型 emoji 与纯文本 `[表情名]` 两种真实内容形态。

**Architecture:** 方案以“请求级 `RenderEmojiContext` + 进程级只读 `EmojiIndexProvider`”为核心，替换当前带副作用的全局 registry。富文本渲染改为显式依赖上下文，专栏 HTML 正文新增文本节点级替换逻辑，确保不破坏 DOM 结构。

**Tech Stack:** Node.js (CommonJS), Puppeteer 预览图渲染, 本地 Node 单元测试, Python Bilibili 数据服务（只读取样）

---

### Task 1: 为冷启动纯文本补图失败建立真实回归测试

**Files:**
- Create: `test/unit/emoji-index-cold-start.test.js`
- Reference: `docs/plans/2026-03-07-bilibili-emoji-repair-design.md`

**Step 1: Write the failing test**

测试覆盖：

- 不预热任何 registry
- 使用 `https://www.bilibili.com/opus/723219222355771425?from=search` 的最小化正文样例
- 纯文本 `[星星眼]` 在冷启动时应能通过 provider 索引补图

**Step 2: Run test to verify it fails**

Run: `node test/unit/emoji-index-cold-start.test.js`

Expected: FAIL，当前实现依赖全局预热。

**Step 3: Write minimal implementation**

暂不做完整替换，只先让新测试能调用将来的 provider / context API，并确保失败点准确。

**Step 4: Run test to verify failure is the expected one**

Run: `node test/unit/emoji-index-cold-start.test.js`

Expected: FAIL，且失败原因是 provider / context 尚不存在，而不是测试写错。

**Step 5: Commit**

```bash
git add test/unit/emoji-index-cold-start.test.js
git commit -F - <<'EOF'
test: 为冷启动表情补图失败建立回归测试

- 覆盖纯文本表情在无预热条件下的目标行为
- 为新上下文与索引提供器改造建立红灯基线
EOF
```

执行前置条件：先获得用户明确批准。当前阶段不要执行 git。

### Task 2: 引入 EmojiIndexProvider 与请求级 RenderEmojiContext

**Files:**
- Create: `src/services/imageGenerator/renderers/components/emojiIndexProvider.js`
- Create: `src/services/imageGenerator/renderers/components/renderEmojiContext.js`
- Create: `test/unit/render-emoji-context.test.js`
- Modify: `src/services/imageGenerator/renderers/components/biliEmojiRegistry.js`

**Step 1: Write the failing test**

测试覆盖：

- provider 能按官方表情名返回资源
- context 只在当前请求内可见
- 一个 context 的注册结果不会泄漏到另一个 context

**Step 2: Run test to verify it fails**

Run: `node test/unit/render-emoji-context.test.js`

Expected: FAIL

**Step 3: Write minimal implementation**

实现：

- 只读官方索引 provider（先支持内存缓存与注入式数据源）
- 请求级 context（当前卡片本地收集 + provider 查询）
- 将旧的全局 registry 降级为兼容包装或删除

**Step 4: Run tests to verify they pass**

Run:

- `node test/unit/render-emoji-context.test.js`
- `node test/unit/emoji-index-cold-start.test.js`

Expected: PASS

**Step 5: Commit**

```bash
git add src/services/imageGenerator/renderers/components/emojiIndexProvider.js src/services/imageGenerator/renderers/components/renderEmojiContext.js src/services/imageGenerator/renderers/components/biliEmojiRegistry.js test/unit/render-emoji-context.test.js test/unit/emoji-index-cold-start.test.js
git commit -F - <<'EOF'
refactor: 引入请求级表情上下文与官方索引提供器

- 替换全局副作用式表情注册表
- 为冷启动补图与跨请求隔离提供基础设施
EOF
```

执行前置条件：先获得用户明确批准。当前阶段不要执行 git。

### Task 3: 让 parseRichText 显式接入 emojiContext

**Files:**
- Modify: `src/services/imageGenerator/renderers/components/richtext.js`
- Create: `test/unit/richtext-emoji-context.test.js`

**Step 1: Write the failing test**

覆盖：

- 节点型 emoji 直接渲染
- 纯文本 `[表情名]` 通过 context 索引补图
- 未命中保持原文
- 不同 context 互不污染

**Step 2: Run test to verify it fails**

Run: `node test/unit/richtext-emoji-context.test.js`

Expected: FAIL

**Step 3: Write minimal implementation**

把接口改为：

- `parseRichText(nodes, rawText, emojiContext)`

实现规则：

- emoji 节点优先用节点自带 `icon_url`
- 纯文本 token 仅通过当前 context 查询
- 无 context 时只保守回退，不再依赖全局状态

**Step 4: Run tests to verify they pass**

Run:

- `node test/unit/richtext-emoji-context.test.js`
- `node test/unit/richtext-node-rendering.test.js`
- `node test/unit/render-emoji-context.test.js`

Expected: PASS

**Step 5: Commit**

```bash
git add src/services/imageGenerator/renderers/components/richtext.js test/unit/richtext-emoji-context.test.js
git commit -F - <<'EOF'
refactor: 让富文本表情渲染显式依赖请求级上下文

- 移除对进程级副作用状态的依赖
- 保留节点型与纯文本型表情两种渲染路径
EOF
```

执行前置条件：先获得用户明确批准。当前阶段不要执行 git。

### Task 4: 把现有卡片入口迁移到 emojiContext

**Files:**
- Modify: `src/services/imageGenerator/renderers/user.js`
- Modify: `src/services/imageGenerator/renderers/dynamic.js`
- Modify: `src/services/imageGenerator/renderers/article.js`
- Modify: `src/services/imageGenerator/renderers/live.js`
- Modify: `src/services/imageGenerator/renderers/video.js`
- Modify: `src/services/imageGenerator/renderers/bangumi.js`
- Modify: `src/services/imageGenerator/generators/previewCard.js`
- Create: `test/unit/card-emoji-context-integration.test.js`

**Step 1: Write the failing test**

覆盖：

- 单张卡片内部节点型 emoji 与纯文本补图都可用
- 当前卡片的表情上下文不会泄漏到下一张卡片
- 你给的两个真实 opus 形态都能抽象覆盖

**Step 2: Run test to verify it fails**

Run: `node test/unit/card-emoji-context-integration.test.js`

Expected: FAIL

**Step 3: Write minimal implementation**

在预览卡片生成入口为每张卡片创建一个 `emojiContext`，再把它向下传到各 renderer：

- `user`
- `dynamic`
- `article`
- `live`
- `video`
- `bangumi`

要求：

- 不破坏现有布局
- 不影响无表情场景

**Step 4: Run tests to verify they pass**

Run:

- `node test/unit/card-emoji-context-integration.test.js`
- `node test/unit/user-card-emoji-rendering.test.js`
- `node test/unit/dynamic-emoji-registry-integration.test.js`
- `node test/unit/card-text-normalization-entry.test.js`

Expected: PASS

**Step 5: Commit**

```bash
git add src/services/imageGenerator/renderers/user.js src/services/imageGenerator/renderers/dynamic.js src/services/imageGenerator/renderers/article.js src/services/imageGenerator/renderers/live.js src/services/imageGenerator/renderers/video.js src/services/imageGenerator/renderers/bangumi.js src/services/imageGenerator/generators/previewCard.js test/unit/card-emoji-context-integration.test.js
git commit -F - <<'EOF'
refactor: 让各类预览卡片接入请求级表情上下文

- 为每张卡片创建独立的表情渲染上下文
- 统一节点型与纯文本型表情的卡片接入路径
EOF
```

执行前置条件：先获得用户明确批准。当前阶段不要执行 git。

### Task 5: 为专栏 html_content 实现 DOM 文本节点级表情替换

**Files:**
- Create: `src/services/imageGenerator/renderers/components/articleHtmlEmoji.js`
- Create: `test/unit/article-html-emoji.test.js`
- Modify: `src/services/imageGenerator/renderers/article.js`

**Step 1: Write the failing test**

覆盖：

- `html_content` 中文本节点里的标准 `[表情名]` 能被替换成 emoji 图片
- 现有 `<img>`、属性值、链接地址不被破坏
- 非命中 token 保持原文

**Step 2: Run test to verify it fails**

Run: `node test/unit/article-html-emoji.test.js`

Expected: FAIL

**Step 3: Write minimal implementation**

实现轻量 HTML 文本节点替换器：

- 遍历 HTML 中的文本节点
- 对文本节点使用和 `parseRichText` 同样的 token 规则
- 仅生成安全的 inline emoji HTML

**Step 4: Run tests to verify they pass**

Run:

- `node test/unit/article-html-emoji.test.js`
- `node test/unit/card-emoji-context-integration.test.js`

Expected: PASS

**Step 5: Commit**

```bash
git add src/services/imageGenerator/renderers/components/articleHtmlEmoji.js src/services/imageGenerator/renderers/article.js test/unit/article-html-emoji.test.js
git commit -F - <<'EOF'
feat: 为专栏 html 正文补充文本节点级表情替换

- 让 html_content 纳入统一表情渲染规则
- 保证不破坏原有 HTML 结构
EOF
```

执行前置条件：先获得用户明确批准。当前阶段不要执行 git。

### Task 6: 用真实链接做最小端到端验证

**Files:**
- Use existing outputs in: `test/output/`
- Optional doc update: `docs/plans/2026-03-07-bilibili-emoji-repair-design.md`

**Step 1: Prepare real fixtures**

使用真实链接：

- `https://www.bilibili.com/opus/1175371060337442824`
- `https://www.bilibili.com/opus/723219222355771425?from=search`

分别验证：

- 节点型 emoji
- 纯文本型 `[表情名]`

**Step 2: Run targeted verification**

Run:

- `node test/unit/emoji-index-cold-start.test.js`
- `node test/unit/render-emoji-context.test.js`
- `node test/unit/richtext-emoji-context.test.js`
- `node test/unit/card-emoji-context-integration.test.js`
- `node test/unit/article-html-emoji.test.js`

**Step 3: Generate real preview outputs**

将真实案例预览图输出到：

- `test/output/`

不要写入其他目录。

**Step 4: Review visual result**

检查：

- 表情是否显示
- 表情是否与文本基线对齐
- 未命中的 token 是否仍为原文

**Step 5: Commit**

```bash
git add docs/plans/2026-03-07-bilibili-emoji-repair-design.md
git commit -F - <<'EOF'
docs: 补充 B 站表情修复设计与真实用例验证

- 记录节点型与纯文本型表情两类真实案例
- 记录请求级上下文方案的验证结果
EOF
```

执行前置条件：先获得用户明确批准。当前阶段不要执行 git。

## Notes

- 所有非文档代码修改都需要用户明确批准后执行。
- 所有 git 动作都需要单独获得用户明确批准。
- 如需 worktree，先单独申请批准。
