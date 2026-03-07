# Opus Richtext Regression Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复最近一版 Opus 富文本回归，避免普通 `#xxx#` 话题被错误加上 SVG 图标，并降低文本型 B 站表情在冷启动时退化为纯文本的概率。

**Architecture:** 这次修复分成两条独立链路。第一条只收紧 `RICH_TEXT_NODE_TYPE_TOPIC` 的图标判定，让真正的 topic 详情链接继续保留图标，普通搜索话题回到纯文本标签样式。第二条保留当前“渲染不等待 provider 加载”的非阻塞策略，但在进程启动后尽早预热默认 emoji provider，把首张卡片的文本表情退化窗口尽量前移到空闲时段。

**Tech Stack:** Node.js 18+, CommonJS, 自执行 Node 单测脚本, B 站动态图文富文本渲染链路

---

## Background

- 复现链接 1：`https://www.bilibili.com/opus/1161315288079138816`
  - 实际返回的 `module_dynamic.topic === null`
  - 但 `major.opus.summary.rich_text_nodes` 含多个 `RICH_TEXT_NODE_TYPE_TOPIC`
  - 这些节点的 `jump_url` 是 `//search.bilibili.com/all?...`
  - 当前实现把所有 `TOPIC` 都放进图标型链接集合，导致普通搜索话题也带 SVG

- 复现链接 2：`https://www.bilibili.com/opus/723219222355771425?from=search`
  - 正文没有 `RICH_TEXT_NODE_TYPE_EMOJI`
  - 文本表情完全依赖 `emojiContext.lookupEmojiByText()` 查默认 provider 索引
  - 当前默认 provider 只做后台刷新，不做启动预热，所以冷启动首轮渲染时可能全部降级为纯文本

## Constraints

- 遵守 DRY / YAGNI：不要改 Python 侧 dynamic/opus 数据结构，问题已定位在 Node 渲染层。
- 保持当前非阻塞策略：不要把 `createRenderEmojiContext()` 改成等待慢网络请求。
- 优先补回归测试，再做最小实现。
- Git 操作仍需用户显式批准；下面的提交步骤只是执行建议，不得自动执行。

## Acceptance Criteria

- 普通搜索话题节点（如 `//search.bilibili.com/all?keyword=...`）继续显示 `#原神#` 文本，但不渲染 `rt-link-inline` / `rt-link-icon`。
- 真正 topic 详情节点（如 `https://www.bilibili.com/v/topic/detail/?topic_id=1`）继续保留 inline SVG 图标。
- 默认 emoji provider 会在应用启动后尽快后台预热，但不会阻塞卡片渲染入口。
- 现有关于“慢 provider 不阻塞渲染”的测试继续通过。

### Task 1: 收紧 Topic 图标判定

**Files:**
- Modify: `src/services/imageGenerator/renderers/components/richtext.js`
- Modify: `test/unit/richtext-node-rendering.test.js`
- Reference: `src/services/imageGenerator/renderers/components/contentNodes.js`

**Step 1: Write the failing test**

在 `test/unit/richtext-node-rendering.test.js` 增加一个明确覆盖“普通搜索话题不带图标”的用例，并把现有带图标断言限定为 topic 详情链接。

```js
function testPlainSearchTopicNodeUsesTextStyleOnly() {
    const html = parseRichText([
        {
            type: 'RICH_TEXT_NODE_TYPE_TOPIC',
            text: '#原神#',
            jump_url: '//search.bilibili.com/all?keyword=%E5%8E%9F%E7%A5%9E'
        }
    ], '')

    assert.ok(html.includes('#原神#'), '普通话题应继续显示文本')
    assert.ok(html.includes('topic-tag'), '普通话题应保留 topic 样式类')
    assert.ok(!html.includes('rt-link-inline'), '普通搜索话题不应走图标容器')
    assert.ok(!html.includes('rt-link-icon'), '普通搜索话题不应输出 SVG 图标')
}
```

同时保留现有 topic 详情链接测试，确保下面这个行为仍存在：

```js
function testTopicDetailNodeRendersInlineIcon() {
    const html = parseRichText([
        {
            type: 'RICH_TEXT_NODE_TYPE_TOPIC',
            text: '#元宵快乐#',
            jump_url: 'https://www.bilibili.com/v/topic/detail/?topic_id=1'
        }
    ], '')

    assert.ok(html.includes('rt-link-inline'))
    assert.ok(html.includes('rt-link-icon'))
}
```

**Step 2: Run test to verify it fails**

Run: `node test/unit/richtext-node-rendering.test.js`  
Expected: FAIL，新增的“普通搜索话题不带图标”断言失败，因为当前实现会输出 `rt-link-inline`。

**Step 3: Write minimal implementation**

在 `src/services/imageGenerator/renderers/components/richtext.js` 增加一个只负责 topic 分流的小 helper，不要改动其他链接类型：

```js
function isTopicDetailJumpUrl(url) {
    const normalized = normalizeJumpUrl(url)
    if (!normalized) return false
    return /\/v\/topic\/detail\/\?topic_id=\d+/.test(normalized)
}
```

然后把 `TOPIC` 从通用 `ICON_LINK_TYPES` 中拿出来单独分支：

```js
if (type === 'RICH_TEXT_NODE_TYPE_TOPIC') {
    if (isTopicDetailJumpUrl(node?.jump_url)) {
        return renderIconLink(node, 'topic-tag')
    }
    return renderTextLink(node, 'topic-tag')
}
```

保留这些行为不变：

- `WEB` / `BV` / `VOTE` / `LOTTERY` 仍走图标型链接
- `AT` / `GOODS` / `URL` 仍走文本型链接
- 普通文本和 `EMOJI` 节点逻辑不变

**Step 4: Run test to verify it passes**

Run: `node test/unit/richtext-node-rendering.test.js`  
Expected: PASS，且现有 `WEB`/topic 详情节点测试都继续通过。

**Step 5: Commit**

只有在用户显式批准 git 操作后才执行：

```bash
git add test/unit/richtext-node-rendering.test.js src/services/imageGenerator/renderers/components/richtext.js
git commit -F - <<'EOF'
fix: 收紧 topic 图标渲染判定

- 仅为 topic 详情链接保留 SVG 图标
- 让普通搜索话题回退为纯文本标签样式
- 补充 topic 富文本回归测试
EOF
```

### Task 2: 为默认 Emoji Provider 增加启动预热

**Files:**
- Modify: `src/services/imageGenerator/renderers/components/emojiIndexProvider.js`
- Modify: `src/bot.js`
- Modify: `test/unit/render-emoji-context.test.js`
- Optional Modify: `src/services/imageGenerator/renderers/components/renderEmojiContext.js`

**Step 1: Write the failing test**

在 `test/unit/render-emoji-context.test.js` 增加一个针对“预热入口”的独立用例，不依赖真实网络和默认单例状态。先抽出一个可注入 provider 的 helper，然后用 stub provider 断言它会触发后台刷新、但不会抛错：

```js
function testWarmupEmojiIndexProviderTriggersBackgroundRefresh() {
    let called = 0
    const provider = {
        refreshInBackground() {
            called += 1
            return Promise.resolve()
        }
    }

    warmupEmojiIndexProvider(provider)
    assert.strictEqual(called, 1, '预热入口应触发一次后台刷新')
}

function testWarmupEmojiIndexProviderSwallowsProviderError() {
    const provider = {
        refreshInBackground() {
            throw new Error('boom')
        }
    }

    assert.doesNotThrow(() => warmupEmojiIndexProvider(provider))
}
```

如果需要，把原文件顶部改成：

```js
const {
    EmojiIndexProvider,
    warmupEmojiIndexProvider
} = require('../../src/services/imageGenerator/renderers/components/emojiIndexProvider')
```

**Step 2: Run test to verify it fails**

Run: `node test/unit/render-emoji-context.test.js`  
Expected: FAIL，报 `warmupEmojiIndexProvider is not a function` 或等价错误。

**Step 3: Write minimal implementation**

先在 `src/services/imageGenerator/renderers/components/emojiIndexProvider.js` 暴露一个通用预热 helper：

```js
function warmupEmojiIndexProvider(provider = getDefaultEmojiIndexProvider()) {
    try {
        return provider?.refreshInBackground?.() || null
    } catch (_) {
        return null
    }
}
```

再在 `src/bot.js` 启动入口尽早调用它，但不要 `await`：

```js
const {
    warmupEmojiIndexProvider
} = require('./services/imageGenerator/renderers/components/emojiIndexProvider')

warmupEmojiIndexProvider()
```

放置原则：

- 放在模块初始化或启动早期，确保连接 NapCat 前就能开始后台拉取 emoji 索引
- 不要把调用塞进 `createRenderEmojiContext()` 的等待路径里
- 不要改 `render-emoji-context` 现有“慢 loader 不阻塞”的契约

如有必要，可在 `renderEmojiContext.js` 中仅保留现在的后台刷新兜底，不做行为升级。

**Step 4: Run test to verify it passes**

Run: `node test/unit/render-emoji-context.test.js`  
Expected: PASS，新用例通过，原有 “createRenderEmojiContext 不应等待慢 loader” 断言仍然通过。

然后跑一组最小回归：

Run: `node test/unit/richtext-emoji-context.test.js`  
Expected: PASS

Run: `node test/unit/card-emoji-context-integration.test.js`  
Expected: PASS

**Step 5: Commit**

只有在用户显式批准 git 操作后才执行：

```bash
git add test/unit/render-emoji-context.test.js src/services/imageGenerator/renderers/components/emojiIndexProvider.js src/bot.js
git commit -F - <<'EOF'
fix: 预热默认 emoji provider

- 为默认 emoji 索引增加非阻塞启动预热入口
- 在应用启动早期触发后台刷新
- 保留慢 provider 不阻塞卡片渲染的行为
EOF
```

## Final Verification

在两项任务都完成后，按最小到较完整的顺序验证：

Run: `node test/unit/richtext-node-rendering.test.js`  
Expected: PASS

Run: `node test/unit/render-emoji-context.test.js`  
Expected: PASS

Run: `node test/unit/richtext-emoji-context.test.js`  
Expected: PASS

Run: `node test/unit/card-emoji-context-integration.test.js`  
Expected: PASS

Run: `node test/unit/emoji-index-cold-start.test.js`  
Expected: PASS

## Manual Smoke Check

完成代码后，用实际链接做一次冷启动烟测：

1. 重启进程，确保默认 emoji provider 处于冷缓存状态。
2. 首次渲染 `https://www.bilibili.com/opus/1161315288079138816`
   - 预期：`#原神#` / `#原神月之四#` / `#三月重临#` 仍有话题样式，但不出现 SVG 图标。
3. 首次渲染 `https://www.bilibili.com/opus/723219222355771425?from=search`
   - 预期：应用启动后一小段时间内 provider 完成预热，后续首批正常请求不再大面积退化为纯文本。
4. 如首个请求仍偶发纯文本，记录发生时机和日志，再决定是否需要第二阶段方案（例如持久化 emoji 索引到磁盘）。

## Notes for Executor

- 不要修改 Python 侧 `dynamic_service.py`；当前两条回归都已经能在 Node 端修复。
- 不要顺手重构 `contentNodes.js`、`dynamic.js` 或主题样式文件，这不是本次范围。
- 如果 topic URL 还存在第三种合法 detail 形式，先在实现里兼容真实 URL，再补一条测试，不要靠猜。
