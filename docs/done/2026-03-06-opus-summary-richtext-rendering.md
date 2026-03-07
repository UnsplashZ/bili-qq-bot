# Opus Summary Priority And RichText Icon Rendering Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复 `opus/1176618467023912983` 这类动态卡片“直播间地址/下载地址为空”问题，并增强富文本节点渲染（含 `WEB/VOTE/LOTTERY/BV` 图标与链接文本语义）。

**Architecture:** 方案分为两条主线：第一条在动态正文选择层（`desc` vs `summary`）引入“可用性优先”决策，优先选取包含有效链接语义的节点流；第二条在富文本渲染层补齐链接节点类型与图标渲染能力。全链路保持向后兼容，失败时统一回退为纯文本，不中断预览图生成。

**Tech Stack:** Node.js (CommonJS), Puppeteer 截图链路, 自定义 HTML/CSS 渲染器, 本地 Node 单元测试脚本 (`node test/unit/*.test.js`)

---

## 约束与原则

- 不直接复制 `dynamic-bot` 的 SVG 文件；仅参考其视觉风格，在本仓库重绘图标。
- 先写失败测试再实现（TDD）。
- 每个任务完成后做最小验证。
- 所有 git 操作（尤其 commit）执行前必须先获得用户明确批准（仓库规则硬约束）。
- 本地预览输出统一写入 `test/output/`。

---

### Task 1: 建立来源选择回归测试（先失败）

**Files:**
- Create: `test/unit/dynamic-richtext-source-selection.test.js`
- Modify: `src/services/imageGenerator/renderers/dynamic.js`

**Step 1: Write the failing test**

```js
#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { renderDynamicContent } = require('../../src/services/imageGenerator/renderers/dynamic')

function makeData({ descText, descNodes, summaryText, summaryNodes }) {
    return {
        data: {
            item: {
                modules: {
                    module_author: { name: 'tester', face: 'https://i0.hdslb.com/bfs/face/member/noface.jpg' },
                    module_dynamic: {
                        desc: { text: descText, rich_text_nodes: descNodes },
                        major: {
                            type: 'MAJOR_TYPE_OPUS',
                            opus: {
                                title: 'opus title',
                                summary: { text: summaryText, rich_text_nodes: summaryNodes },
                                pics: [{ url: 'https://i0.hdslb.com/bfs/new_dyn/test.png' }]
                            }
                        }
                    },
                    module_stat: { forward: { count: 1 }, like: { count: 2 }, comment: { count: 3 } }
                },
                id_str: '1176618467023912983'
            },
            pub_ts: 1700000000
        }
    }
}

function run() {
    // Case 1: desc 只有标签、无链接节点；summary 含 WEB 节点 -> 应优先 summary
    const html1 = renderDynamicContent(makeData({
        descText: '直播间地址：\\n下载游戏：',
        descNodes: [],
        summaryText: '直播间地址：https://live.bilibili.com/27354807\\n下载游戏：https://www.biligame.com/detail/?id=108820',
        summaryNodes: [
            { type: 'RICH_TEXT_NODE_TYPE_TEXT', text: '直播间地址：' },
            { type: 'RICH_TEXT_NODE_TYPE_WEB', text: '网页链接', jump_url: 'https://live.bilibili.com/27354807' },
            { type: 'RICH_TEXT_NODE_TYPE_TEXT', text: '\\n下载游戏：' },
            { type: 'RICH_TEXT_NODE_TYPE_WEB', text: '网页链接', jump_url: 'https://www.biligame.com/detail/?id=108820' }
        ]
    }))
    assert.ok(html1.includes('live.bilibili.com/27354807'))
    assert.ok(html1.includes('biligame.com/detail/?id=108820'))

    // Case 2: desc 已有有效 URL 节点 -> 保持 desc 优先
    const html2 = renderDynamicContent(makeData({
        descText: 'desc link',
        descNodes: [{ type: 'RICH_TEXT_NODE_TYPE_URL', text: 'https://example.com', jump_url: 'https://example.com' }],
        summaryText: 'summary fallback',
        summaryNodes: []
    }))
    assert.ok(html2.includes('example.com'))
}

run()
console.log('PASS dynamic-richtext-source-selection')
```

**Step 2: Run test to verify it fails**

Run: `node test/unit/dynamic-richtext-source-selection.test.js`  
Expected: FAIL（当前实现仍优先 `desc`，不会输出 `summary` 中链接）

**Step 3: Write minimal implementation**

在 `resolveDynamicText()` 中新增“来源可用性决策”辅助函数，并替换原有固定优先级逻辑（详见 Task 3 的完整实现）。

**Step 4: Run test to verify it passes**

Run: `node test/unit/dynamic-richtext-source-selection.test.js`  
Expected: PASS

**Step 5: Commit**

```bash
git add test/unit/dynamic-richtext-source-selection.test.js src/services/imageGenerator/renderers/dynamic.js
git commit -F - <<'EOF'
test: 新增动态正文来源选择回归测试

- 覆盖 desc 空链接场景下 summary 优先的行为约束
- 覆盖 desc 已有有效链接时保持 desc 优先
EOF
```

执行前置条件：先获得用户明确批准（Git Confirmation Rule）。

---

### Task 2: 建立富文本节点渲染回归测试（先失败）

**Files:**
- Create: `test/unit/richtext-node-rendering.test.js`
- Modify: `src/services/imageGenerator/renderers/components/richtext.js`

**Step 1: Write the failing test**

```js
#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { parseRichText } = require('../../src/services/imageGenerator/renderers/components/richtext')

function run() {
    const html = parseRichText([
        { type: 'RICH_TEXT_NODE_TYPE_TEXT', text: '直播间地址：' },
        { type: 'RICH_TEXT_NODE_TYPE_WEB', text: '网页链接', jump_url: 'https://live.bilibili.com/27354807' },
        { type: 'RICH_TEXT_NODE_TYPE_TEXT', text: '\\n下载游戏：' },
        { type: 'RICH_TEXT_NODE_TYPE_WEB', text: '网页链接', jump_url: 'https://www.biligame.com/detail/?id=108820' },
        { type: 'RICH_TEXT_NODE_TYPE_TOPIC', text: '#鸣潮#' },
        { type: 'RICH_TEXT_NODE_TYPE_GOODS', text: '商品链接' }
    ], '')

    assert.ok(html.includes('rt-link-inline'))
    assert.ok(html.includes('rt-link-icon'))
    assert.ok(html.includes('live.bilibili.com/27354807'))
    assert.ok(html.includes('biligame.com/detail/?id=108820'))
    assert.ok(html.includes('#鸣潮#'))
    assert.ok(html.includes('商品链接'))
}

run()
console.log('PASS richtext-node-rendering')
```

**Step 2: Run test to verify it fails**

Run: `node test/unit/richtext-node-rendering.test.js`  
Expected: FAIL（当前不识别 `RICH_TEXT_NODE_TYPE_WEB` 图标与 URL 展示策略）

**Step 3: Write minimal implementation**

在 `parseRichText()` 中引入：
- `ICON_LINK_TYPES = WEB/VOTE/LOTTERY/BV`
- `TEXT_LINK_TYPES = AT/TOPIC/GOODS`
- `WEB/URL` 节点显示文本策略：`node.text` 为“网页链接”或空时，降级展示 `jump_url`

**Step 4: Run test to verify it passes**

Run: `node test/unit/richtext-node-rendering.test.js`  
Expected: PASS

**Step 5: Commit**

```bash
git add test/unit/richtext-node-rendering.test.js src/services/imageGenerator/renderers/components/richtext.js
git commit -F - <<'EOF'
test: 新增富文本节点渲染回归测试

- 覆盖 WEB 节点图标与链接文本输出
- 覆盖 TOPIC/GOODS 链接色文本输出
EOF
```

执行前置条件：先获得用户明确批准（Git Confirmation Rule）。

---

### Task 3: 实现动态正文来源优先策略（summary 优先可用性）

**Files:**
- Modify: `src/services/imageGenerator/renderers/dynamic.js`
- Test: `test/unit/dynamic-richtext-source-selection.test.js`

**Step 1: Add helper functions**

```js
function hasRichLinkNodes(nodes) {
    if (!Array.isArray(nodes) || nodes.length === 0) return false
    const richTypes = new Set([
        'RICH_TEXT_NODE_TYPE_WEB',
        'RICH_TEXT_NODE_TYPE_URL',
        'RICH_TEXT_NODE_TYPE_BV',
        'RICH_TEXT_NODE_TYPE_VOTE',
        'RICH_TEXT_NODE_TYPE_LOTTERY'
    ])
    return nodes.some(node => richTypes.has(node?.type))
}

function looksLikeAddressLabelButMissingValue(text) {
    const normalized = normalizePlainText(text)
    if (!normalized) return false
    const hasLabel = /直播间地址[:：]|下载(游戏|地址)?[:：]/.test(normalized)
    const hasUrl = /https?:\/\/|www\./i.test(normalized)
    return hasLabel && !hasUrl
}
```

**Step 2: Replace source selection block in `resolveDynamicText()`**

```js
const descText = dynamicModule.desc?.text || ''
const descNodes = dynamicModule.desc?.rich_text_nodes
const summary = dynamicModule.major?.opus?.summary || {}
const summaryText = summary.text || ''
const summaryNodes = summary.rich_text_nodes

const descHasRich = hasRichLinkNodes(descNodes)
const summaryHasRich = hasRichLinkNodes(summaryNodes)
const shouldPreferSummary = summaryHasRich && (!descHasRich || looksLikeAddressLabelButMissingValue(descText))

if (shouldPreferSummary) {
    text = summaryText
    richTextNodes = summaryNodes
    source = 'opus_summary_preferred'
} else if (dynamicModule.desc) {
    text = descText
    richTextNodes = descNodes
    source = 'desc'
}
```

**Step 3: Keep old fallback behavior**

保留原有：
- `desc` 无文本时回退 `summary`
- 话题节点注入逻辑
- 图片占位符清洗

**Step 4: Run tests**

Run:
- `node test/unit/dynamic-richtext-source-selection.test.js`
- `node test/unit/richtext-node-rendering.test.js`

Expected: 全部 PASS

**Step 5: Commit**

```bash
git add src/services/imageGenerator/renderers/dynamic.js
git commit -F - <<'EOF'
fix: 优化动态正文来源选择优先级

- 在 desc 缺少可用链接语义时优先使用 opus.summary
- 修复地址标签后链接丢失导致的预览空地址问题
EOF
```

执行前置条件：先获得用户明确批准（Git Confirmation Rule）。

---

### Task 4: 新增富文本图标资源与加载器（重绘，不复制）

**Files:**
- Create: `src/services/imageGenerator/assets/icons/richtext/RICH_TEXT_NODE_TYPE_WEB.svg`
- Create: `src/services/imageGenerator/assets/icons/richtext/RICH_TEXT_NODE_TYPE_VOTE.svg`
- Create: `src/services/imageGenerator/assets/icons/richtext/RICH_TEXT_NODE_TYPE_LOTTERY.svg`
- Create: `src/services/imageGenerator/assets/icons/richtext/RICH_TEXT_NODE_TYPE_BV.svg`
- Create: `src/services/imageGenerator/renderers/components/richtextIcons.js`

**Step 1: Create icon loader**

```js
'use strict'

const fs = require('fs')
const path = require('path')

const ICON_CACHE = new Map()
const BASE_DIR = path.resolve(__dirname, '../../assets/icons/richtext')

function toDataUri(svgText) {
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svgText)}`
}

function loadRichTextIcon(type) {
    const file = `${type}.svg`
    if (ICON_CACHE.has(file)) return ICON_CACHE.get(file)
    try {
        const content = fs.readFileSync(path.join(BASE_DIR, file), 'utf8')
        const uri = toDataUri(content)
        ICON_CACHE.set(file, uri)
        return uri
    } catch (_e) {
        ICON_CACHE.set(file, '')
        return ''
    }
}

module.exports = { loadRichTextIcon }
```

**Step 2: Draw SVGs in local style**

要求：
- 线宽、圆角、视觉重心参考 `dynamic-bot` 风格
- 颜色使用 `currentColor`（避免硬编码主题色）
- 视窗统一 `viewBox="0 0 24 24"`

**Step 3: Verify icon files parse**

Run: `node -e "const {loadRichTextIcon}=require('./src/services/imageGenerator/renderers/components/richtextIcons'); console.log(!!loadRichTextIcon('RICH_TEXT_NODE_TYPE_WEB'))"`  
Expected: 输出 `true`

**Step 4: Run impacted tests**

Run:
- `node test/unit/richtext-node-rendering.test.js`

Expected: PASS

**Step 5: Commit**

```bash
git add src/services/imageGenerator/assets/icons/richtext/*.svg src/services/imageGenerator/renderers/components/richtextIcons.js
git commit -F - <<'EOF'
feat: 新增富文本节点图标资源与加载器

- 本地重绘 WEB/VOTE/LOTTERY/BV 图标
- 增加 data URI 缓存加载器供 richtext 渲染复用
EOF
```

执行前置条件：先获得用户明确批准（Git Confirmation Rule）。

---

### Task 5: 实现富文本节点增强渲染

**Files:**
- Modify: `src/services/imageGenerator/renderers/components/richtext.js`
- Modify: `src/services/imageGenerator/core/theme.js`
- Test: `test/unit/richtext-node-rendering.test.js`

**Step 1: Refactor parse helper**

```js
function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
        .replace(/\n/g, '<br>')
}
```

**Step 2: Implement icon-link render branch**

```js
const { loadRichTextIcon } = require('./richtextIcons')
const ICON_LINK_TYPES = new Set([
    'RICH_TEXT_NODE_TYPE_WEB',
    'RICH_TEXT_NODE_TYPE_VOTE',
    'RICH_TEXT_NODE_TYPE_LOTTERY',
    'RICH_TEXT_NODE_TYPE_BV'
])
const TEXT_LINK_TYPES = new Set([
    'RICH_TEXT_NODE_TYPE_AT',
    'RICH_TEXT_NODE_TYPE_TOPIC',
    'RICH_TEXT_NODE_TYPE_GOODS'
])

function resolveLinkText(node) {
    const raw = String(node?.text || '').trim()
    if (!raw || raw === '网页链接') return String(node?.jump_url || node?.orig_text || raw)
    return raw
}
```

**Step 3: Add CSS classes**

在 `theme.js` 的富文本样式区域添加：

```css
.rt-link-inline {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--color-secondary);
    font-weight: 600;
}

.rt-link-icon {
    width: 1em;
    height: 1em;
    display: inline-block;
    vertical-align: -0.12em;
}

.rt-link-text {
    color: inherit;
}
```

**Step 4: Run tests**

Run:
- `node test/unit/richtext-node-rendering.test.js`
- `node test/unit/dynamic-richtext-source-selection.test.js`

Expected: 全部 PASS

**Step 5: Commit**

```bash
git add src/services/imageGenerator/renderers/components/richtext.js src/services/imageGenerator/core/theme.js
git commit -F - <<'EOF'
feat: 增强富文本节点渲染能力

- 支持 WEB/VOTE/LOTTERY/BV 图标+链接文本渲染
- 支持 AT/TOPIC/GOODS 链接色文本统一样式
- unknown 节点统一链接色兜底
EOF
```

执行前置条件：先获得用户明确批准（Git Confirmation Rule）。

---

### Task 6: 链路验证（真实样本预览图）

**Files:**
- Create (optional temp): `test/temp_render_opus_1176618467023912983.js`
- Output: `test/output/previews/opus_1176618467023912983_after.png`
- Test: `test/unit/dynamic-richtext-source-selection.test.js`
- Test: `test/unit/richtext-node-rendering.test.js`

**Step 1: Add one-off preview script**

```js
#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const biliApi = require('../src/services/biliApi')
const imageGenerator = require('../src/services/imageGenerator')

;(async () => {
    const id = '1176618467023912983'
    const info = await biliApi.getOpusInfo(id, null)
    if (info.status !== 'success') throw new Error(info.message || 'fetch failed')
    const base64 = await imageGenerator.generatePreviewCard(info, info.type, null)
    const out = path.resolve(process.cwd(), `test/output/previews/opus_${id}_after.png`)
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, Buffer.from(base64, 'base64'))
    console.log(out)
})().catch((e) => { console.error(e); process.exit(1) })
```

**Step 2: Run preview generation**

Run: `node test/temp_render_opus_1176618467023912983.js`  
Expected: 输出 `test/output/previews/opus_1176618467023912983_after.png`

**Step 3: Manual verify expected rendering**

检查项：
- “直播间地址”后不再为空
- “下载游戏”后不再为空
- 链接节点呈现链接色，并带对应图标

**Step 4: Run full impacted tests**

Run:
- `node test/unit/dynamic-richtext-source-selection.test.js`
- `node test/unit/richtext-node-rendering.test.js`
- `node test/unit/detectChargingContent.test.js`

Expected: 全部 PASS

**Step 5: Commit**

```bash
git add test/unit/dynamic-richtext-source-selection.test.js test/unit/richtext-node-rendering.test.js src/services/imageGenerator/renderers/dynamic.js src/services/imageGenerator/renderers/components/richtext.js src/services/imageGenerator/renderers/components/richtextIcons.js src/services/imageGenerator/core/theme.js src/services/imageGenerator/assets/icons/richtext/*.svg
git commit -F - <<'EOF'
fix: 修复 opus 地址空值并增强富文本链接渲染

- summary 优先策略修复地址标签后链接丢失
- 富文本节点新增图标渲染与链接文本语义
- 添加回归测试覆盖关键场景
EOF
```

执行前置条件：先获得用户明确批准（Git Confirmation Rule）。

---

## 验收标准

- 对 `https://www.bilibili.com/opus/1176618467023912983` 生成的预览图中，“直播间地址/下载游戏”均不为空。
- `RICH_TEXT_NODE_TYPE_WEB/VOTE/LOTTERY/BV` 显示图标+链接文本；`AT/TOPIC/GOODS` 为链接色文本。
- 旧有动态/视频/专栏渲染不回归（至少通过受影响单测）。
- 任何节点解析失败都不会导致整卡渲染失败（仍可回退纯文本）。

## 风险与回滚

- 风险1：来源优先级调整导致某些动态文本被 summary 替换，出现与旧版不一致。
  - 缓解：仅在 `summary` 具有富链接节点且 `desc` 明显缺失语义时切换。
- 风险2：新增图标导致行高或换行波动。
  - 缓解：使用 `em` 尺寸与 `inline-flex` 对齐，限制最小样式改动。
- 回滚策略：
  - 回滚 `dynamic.js` 来源选择变更可快速恢复旧行为；
  - 回滚 `richtext.js + richtextIcons.js + theme.js + richtext SVG` 可恢复旧富文本展示逻辑。

