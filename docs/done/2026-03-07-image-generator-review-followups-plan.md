# Image Generator Review Follow-ups Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复图片渲染链路中两个已确认问题：emoji 索引加载阻塞预览卡渲染，以及专栏 HTML 代码语义区域被错误做 emoji 替换。

**Architecture:** 对问题 2，沿用现有“请求级 `RenderEmojiContext` + 进程级 `EmojiIndexProvider`”结构，但把 provider 读取改为非阻塞后台刷新，并引入 stale-while-refresh 语义，确保渲染主路径只读取现有缓存，不等待远程接口。对问题 3，保持现有字符串级 HTML 分段算法不变，只扩大 blocklist，避免 `<pre>/<code>` 等语义区域被重写。

**Tech Stack:** Node.js (CommonJS), 本地 Node 单元测试, Puppeteer 图片渲染链路（只做静态入口适配，不在计划中引入新的浏览器测试）

---

### Task 1: 为非阻塞 emoji provider 建立红灯测试

**Files:**
- Create: `test/unit/emoji-index-provider-refresh.test.js`
- Modify: `test/unit/render-emoji-context.test.js`
- Reference: `docs/plans/2026-03-07-image-generator-review-followups-design.md`

**Step 1: Write the failing test**

覆盖两类目标行为：

1. `createRenderEmojiContext()` 在 provider loader 很慢时应立即返回，不等待远程加载完成。
2. `EmojiIndexProvider` 在已有旧缓存且 TTL 过期时，应先返回旧缓存，同时只启动一次后台刷新。

建议测试骨架：

```js
async function testCreateRenderEmojiContextDoesNotAwaitSlowProvider() {
    let releaseLoader
    const provider = new EmojiIndexProvider({
        loader: () => new Promise(resolve => { releaseLoader = resolve }),
        ttlMs: 10
    })

    const startedAt = Date.now()
    const context = await createRenderEmojiContext({ provider })
    const elapsedMs = Date.now() - startedAt

    assert.ok(context, '应立即得到 context')
    assert.ok(elapsedMs < 100, '不应等待慢 loader')

    releaseLoader([])
}

async function testProviderServesStaleCacheWhileRefreshing() {
    let loadCount = 0
    let records = [{ rawText: '[星星眼]', iconUrl: 'https://example.com/old.png' }]
    const provider = new EmojiIndexProvider({
        loader: async () => {
            loadCount += 1
            return records
        },
        ttlMs: 1,
        now: () => fakeNow
    })

    await provider.ensureLoaded()
    fakeNow += 10
    records = [{ rawText: '[星星眼]', iconUrl: 'https://example.com/new.png' }]

    provider.refreshInBackground()
    const stale = provider.lookupEmojiByText('[星星眼]')

    assert.strictEqual(stale.iconUrl, 'https://example.com/old.png')
    assert.strictEqual(loadCount, 2)
}
```

**Step 2: Run test to verify it fails**

Run:

```bash
node test/unit/render-emoji-context.test.js
node test/unit/emoji-index-provider-refresh.test.js
```

Expected:

- `render-emoji-context` 因 `createRenderEmojiContext()` 仍会等待 provider 而失败
- 新增的 provider 刷新测试因 `refreshInBackground()` / stale 语义尚不存在而失败

**Step 3: Write minimal implementation**

最小实现目标：

- 给 `EmojiIndexProvider` 增加后台刷新入口，例如 `refreshInBackground()`
- provider 持有：
  - 当前缓存 `index`
  - `expiresAt`
  - 单飞中的 `loadingPromise`
- `lookupEmojiByText()` 永远只读当前缓存，不等待加载
- `createRenderEmojiContext()` 改为：
  - 先创建 context
  - 立即注册 `seedData`
  - 触发 provider 后台刷新
  - 不 `await` provider

**Step 4: Run tests to verify they pass**

Run:

```bash
node test/unit/render-emoji-context.test.js
node test/unit/emoji-index-provider-refresh.test.js
node test/unit/emoji-index-cold-start.test.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add test/unit/render-emoji-context.test.js test/unit/emoji-index-provider-refresh.test.js src/services/imageGenerator/renderers/components/emojiIndexProvider.js src/services/imageGenerator/renderers/components/renderEmojiContext.js
git commit -F - <<'EOF'
refactor: 让 emoji provider 走非阻塞后台刷新

- 为请求级 context 去除同步远程等待
- 为 provider 增加 stale-while-refresh 语义
- 为冷启动和 TTL 过期行为补回归测试
EOF
```

执行前置条件：先获得用户明确批准。当前阶段不要执行 git。

### Task 2: 把预览卡入口切到非阻塞 context 语义

**Files:**
- Modify: `src/services/imageGenerator/generators/previewCard.js`
- Modify: `test/unit/card-emoji-context-integration.test.js`
- Reference: `src/services/imageGenerator/renderers/components/renderEmojiContext.js`

**Step 1: Write the failing test**

补一个入口级回归，目标是证明：

1. 预览卡相关 renderer 在 provider 尚未预热时仍可继续渲染。
2. 已存在于 `seedData` 的节点型 emoji 仍正常工作。
3. provider 为空或未完成刷新时，卡片只会降级为原文，不应卡住或抛错。

建议直接在 `card-emoji-context-integration.test.js` 增加一个“慢 provider 但 renderer 可立即继续”的测试，避免引入真正的 Puppeteer 依赖。

**Step 2: Run test to verify it fails**

Run:

```bash
node test/unit/card-emoji-context-integration.test.js
```

Expected: FAIL，因为当前入口默认假设 context 已经同步预热完成。

**Step 3: Write minimal implementation**

实现范围保持最小：

- `previewCard.js` 继续在渲染前创建 `emojiContext`
- 但不依赖 provider 已加载完成
- 保证所有 renderer 都只通过 context 的当前可见状态工作
- 不在 renderer 内新增异步等待

备注：

- 这一任务重点不是新增功能，而是确认主入口与新的 provider 生命周期对齐
- 若 `previewCard.js` 本身无需额外改动，只需更新测试和少量注释，也可以保持实现改动最小

**Step 4: Run tests to verify they pass**

Run:

```bash
node test/unit/card-emoji-context-integration.test.js
node test/unit/dynamic-emoji-registry-integration.test.js
node test/unit/user-card-emoji-rendering.test.js
node test/unit/card-text-normalization-entry.test.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/services/imageGenerator/generators/previewCard.js test/unit/card-emoji-context-integration.test.js
git commit -F - <<'EOF'
refactor: 让预览卡入口适配非阻塞 emoji context

- 主渲染路径不再依赖 provider 同步预热
- 保持节点型与纯文本型表情的现有降级语义
EOF
```

执行前置条件：先获得用户明确批准。当前阶段不要执行 git。

### Task 3: 为专栏 HTML 代码语义区域保护建立红灯测试

**Files:**
- Modify: `test/unit/article-html-emoji.test.js`
- Reference: `docs/plans/2026-03-07-image-generator-review-followups-design.md`

**Step 1: Write the failing test**

在现有 `article-html-emoji.test.js` 中新增覆盖：

1. `<pre>[星星眼]</pre>` 保持原文
2. `<code>[星星眼]</code>` 保持原文
3. 普通 `<p>[星星眼]</p>` 仍可替换

建议测试骨架：

```js
async function testArticleHtmlDoesNotReplaceEmojiInsideCodeLikeTags() {
    const emojiContext = await buildContext()
    const html = replaceEmojiTokensInHtml(
        '<pre>[星星眼]</pre><code>[星星眼]</code><p>[星星眼]</p>',
        emojiContext
    )

    assert.ok(html.includes('<pre>[星星眼]</pre>'))
    assert.ok(html.includes('<code>[星星眼]</code>'))
    assert.ok(html.includes('<p><img class="emoji"'))
}
```

**Step 2: Run test to verify it fails**

Run:

```bash
node test/unit/article-html-emoji.test.js
```

Expected: FAIL，当前实现会把 `<pre>` / `<code>` 中的文本也替成 `<img>`

**Step 3: Write minimal implementation**

只做 blocklist 扩展，不重写算法：

- 在 `src/services/imageGenerator/renderers/components/articleHtmlEmoji.js` 中把受保护标签从
  - `script|style|textarea`
  扩展为
  - `script|style|textarea|pre|code|kbd|samp`

要求：

- 不改动现有按标签段分割的处理方式
- 不引入新依赖
- 不碰标签属性替换逻辑

**Step 4: Run test to verify it passes**

Run:

```bash
node test/unit/article-html-emoji.test.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add test/unit/article-html-emoji.test.js src/services/imageGenerator/renderers/components/articleHtmlEmoji.js
git commit -F - <<'EOF'
fix: 保护专栏 HTML 代码语义区域不做 emoji 替换

- 为 pre/code 等标签补充回归测试
- 仅扩大 blocklist，保持现有正文替换算法不变
EOF
```

执行前置条件：先获得用户明确批准。当前阶段不要执行 git。

### Task 4: 运行问题 2/3 的最小回归集

**Files:**
- Reference: `test/unit/render-emoji-context.test.js`
- Reference: `test/unit/emoji-index-provider-refresh.test.js`
- Reference: `test/unit/emoji-index-cold-start.test.js`
- Reference: `test/unit/card-emoji-context-integration.test.js`
- Reference: `test/unit/dynamic-emoji-registry-integration.test.js`
- Reference: `test/unit/user-card-emoji-rendering.test.js`
- Reference: `test/unit/card-text-normalization-entry.test.js`
- Reference: `test/unit/article-html-emoji.test.js`
- Reference: `test/unit/theme-emoji-style.test.js`

**Step 1: Run the targeted regression suite**

Run:

```bash
node test/unit/render-emoji-context.test.js
node test/unit/emoji-index-provider-refresh.test.js
node test/unit/emoji-index-cold-start.test.js
node test/unit/card-emoji-context-integration.test.js
node test/unit/dynamic-emoji-registry-integration.test.js
node test/unit/user-card-emoji-rendering.test.js
node test/unit/card-text-normalization-entry.test.js
node test/unit/article-html-emoji.test.js
node test/unit/theme-emoji-style.test.js
```

Expected: PASS

**Step 2: Spot-check residual risk**

确认两点：

1. 当前计划没有覆盖真实 Puppeteer 出图耗时，只验证入口语义和字符串渲染语义。
2. provider 后台刷新日志量是否可接受，必要时补 `debug` 级别日志。

**Step 3: Commit**

```bash
git add test/unit/render-emoji-context.test.js test/unit/emoji-index-provider-refresh.test.js test/unit/emoji-index-cold-start.test.js test/unit/card-emoji-context-integration.test.js test/unit/dynamic-emoji-registry-integration.test.js test/unit/user-card-emoji-rendering.test.js test/unit/card-text-normalization-entry.test.js test/unit/article-html-emoji.test.js test/unit/theme-emoji-style.test.js src/services/imageGenerator/renderers/components/emojiIndexProvider.js src/services/imageGenerator/renderers/components/renderEmojiContext.js src/services/imageGenerator/generators/previewCard.js src/services/imageGenerator/renderers/components/articleHtmlEmoji.js
git commit -F - <<'EOF'
test: 完成 image generator review follow-ups 最小回归

- 覆盖非阻塞 emoji provider 生命周期
- 覆盖专栏 HTML 代码语义区域保护
- 确认相关卡片渲染入口无回归
EOF
```

执行前置条件：先获得用户明确批准。当前阶段不要执行 git。
