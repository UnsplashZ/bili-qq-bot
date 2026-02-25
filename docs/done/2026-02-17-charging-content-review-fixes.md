# 充电专属内容功能 Review 修复计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 根据 code review 结果，修复充电专属内容支持功能中的问题（1 个 Critical、3 个 Important、3 个 Minor）。

**Architecture:** 修复分为四个维度：订阅推送路径的功能一致性（Critical）、渲染器的安全性和视觉完整性（Important）、重复代码提取（Important）、CSS 与样式的规范化（Minor）。所有纯函数改动均采用 TDD，副作用代码直接修改后人工验证。

**Tech Stack:** Node.js 18+，无测试框架（用 `node` 直接运行，`assert` 模块）

---

## 背景

当前分支 `feat：表情回复功能` 的 working tree 有 4 个文件的未提交修改，实现了 B 站充电专属内容支持。Code review 发现以下问题：

| 级别 | 编号 | 问题 |
|------|------|------|
| Critical | C1 | `checkUserVideo`（手动订阅路径）缺少充电标志注入 |
| Important | I1 | `MAJOR_TYPE_BLOCKED` 渲染器 `pubTime` 未 escape |
| Important | I2 | `MAJOR_TYPE_BLOCKED` 渲染器缺少 action bar（互动数据） |
| Important | I3 | `resolveArticleTitle` 逻辑重复（两处手写相同代码） |
| Minor | M1 | `detectChargingContent` 无测试覆盖 |
| Minor | M2 | `is_only_fans` 字段语义未文档化 |
| Minor | M3 | `border-radius: 12px` 硬编码，未使用设计系统变量 |

---

## Task 1：修复 C1 — checkUserVideo 手动订阅路径补充充电标志

**优先级：Critical**

**Files:**
- Modify: `src/services/subscription/updateChecker.js:1019-1022`

**背景：**
`checkUserVideoUnified`（Cookie 同步路径，第 1110–1117 行）已有：
```javascript
if (video.is_charging_arc) {
    info.data.is_charging_arc = true;
}
```
但 `checkUserVideo`（手动订阅路径，第 1012–1036 行）的 `info.status !== 'success'` 检查后（第 1022 行），缺少相同的代码。

**Step 1: 定位插入点**

打开 `src/services/subscription/updateChecker.js`，找到约第 1019–1025 行：

```javascript
                        if (info.status !== 'success') {
                            logger.warn(`[UpdateChecker] Failed to get video detail for ${bvid}`);
                            continue;
                        }

                        // 生成通知文本
                        const notificationText = `${sub.name} 投稿了新视频：\n${info.data.title}`;
```

**Step 2: 在 `continue;` 之后、通知文本之前插入充电标志代码**

修改后应为：
```javascript
                        if (info.status !== 'success') {
                            logger.warn(`[UpdateChecker] Failed to get video detail for ${bvid}`);
                            continue;
                        }

                        if (video.is_charging_arc) {
                            info.data.is_charging_arc = true;
                        }

                        // 生成通知文本
                        const notificationText = `${sub.name} 投稿了新视频：\n${info.data.title}`;
```

**Step 3: 验证两条路径的代码完全一致**

在编辑器中并排对比 `checkUserVideo`（约第 1022 行区域）和 `checkUserVideoUnified`（约第 1112 行区域），确认两处的充电标志注入代码逻辑完全相同。

**Step 4: Commit**

```bash
git add src/services/subscription/updateChecker.js
git commit -m "fix: checkUserVideo 手动订阅路径补充充电标志注入"
```

---

## Task 2：修复 I1 — MAJOR_TYPE_BLOCKED 渲染器中 pubTime 的 XSS 防护

**优先级：Important**

**Files:**
- Modify: `src/services/imageGenerator/renderers/dynamic.js:116`

**背景：**
`pubTime` 的最后一个来源是 `module_author.pub_time`（第 89 行），这是 B 站 API 直接返回的原始字符串，可能含 HTML 特殊字符。`authorName` 和 `hint_message` 已正确 escape，`pubTime` 漏掉了。

**Step 1: 查看当前代码（约第 89 行和第 116 行）**

```javascript
// 第 89 行
const pubTime = formatPubTime(data.data.pub_ts) || formatPubTime(module_author.pub_ts) || module_author.pub_time || '';

// 第 116 行（MAJOR_TYPE_BLOCKED 渲染器内）
<span class="pub-time">${pubTime}</span>
```

**Step 2: 修改第 116 行，对 pubTime 应用 escapeHtml**

修改后：
```javascript
<span class="pub-time">${escapeHtml(String(pubTime))}</span>
```

说明：`String()` 包装确保 `pubTime` 为空字符串时不会输出 `"undefined"`，`escapeHtml` 已在文件顶部 import。

**Step 3: 确认正常渲染路径（第 207 行）也有同样问题（但不在本任务范围内修改）**

第 207 行（正常动态渲染路径）：
```javascript
<span class="pub-time">${pubTime}</span>
```
这是一个预存在的问题，不在本次修改范围内。在代码旁留一行注释即可：

```javascript
// TODO: pubTime 在正常路径也未 escape，与第 89 行 pub_time 字段相关
<span class="pub-time">${pubTime}</span>
```

**Step 4: Commit**

```bash
git add src/services/imageGenerator/renderers/dynamic.js
git commit -m "fix: MAJOR_TYPE_BLOCKED 渲染器 pubTime 补充 escapeHtml"
```

---

## Task 3：修复 I2 — MAJOR_TYPE_BLOCKED 渲染器添加 action bar

**优先级：Important**

**Files:**
- Modify: `src/services/imageGenerator/renderers/dynamic.js:120-123`

**背景：**
充电专属动态的互动数据（点赞、转发、评论数）在 API 响应中是公开可见的，`module_stat` 在第 85 行已经解构，在 MAJOR_TYPE_BLOCKED 早期返回时可以直接访问。当前占位卡片缺少 action bar，视觉上与其他所有动态类型不一致。

**Step 1: 确认 `module_stat`、`ICONS`、`formatNumber` 在早期返回位置已可用**

检查 dynamic.js：
- `module_stat` 在第 85 行定义：`const module_stat = modules.module_stat || {};`
- `ICONS` 在第 5 行 import：`const ICONS = require('./icons');`
- `formatNumber` 在第 1 行 import

三者在第 104 行的 `if (major?.type === 'MAJOR_TYPE_BLOCKED')` 块内均已可用。

**Step 2: 在 MAJOR_TYPE_BLOCKED 返回的 HTML 末尾添加 action bar**

当前代码（约第 120-123 行）：
```javascript
            <div class="charging-blocked-hint">
                ${lines.map(l => `<p>${l}</p>`).join('')}
            </div>
        </div>`
```

修改后：
```javascript
            <div class="charging-blocked-hint">
                ${lines.map(l => `<p>${l}</p>`).join('')}
            </div>
            <div class="action-bar">
                <div class="action-item">${ICONS.share} ${formatNumber(module_stat.forward?.count)}</div>
                <div class="action-item">${ICONS.comment} ${formatNumber(module_stat.comment?.count)}</div>
                <div class="action-item">${ICONS.like} ${formatNumber(module_stat.like?.count)}</div>
            </div>
        </div>`
```

**Step 3: Commit**

```bash
git add src/services/imageGenerator/renderers/dynamic.js
git commit -m "feat: 充电专属占位动态补充 action bar 展示互动数据"
```

---

## Task 4：修复 I3 — 提取 resolveArticleTitle 辅助函数（TDD）

**优先级：Important**

**Files:**
- Modify: `src/services/subscription/updateChecker.js:1207-1213` 和 `1305-1311`
- Create: `test/unit/resolveArticleTitle.test.js`

**背景：**
`checkUserArticle`（第 1209–1213 行）和 `checkUserArticleUnified`（第 1307–1311 行）含有完全相同的逻辑：

```javascript
const actualType = info.type || 'article';
const articleTitle = actualType === 'dynamic'
    ? info.data?.item?.modules?.module_dynamic?.major?.opus?.title
    : info.data.title;
```

提取为辅助函数，消除重复，并使业务逻辑可单独测试。

### Step 1: 写失败的测试

创建 `test/unit/resolveArticleTitle.test.js`：

```javascript
#!/usr/bin/env node
/**
 * test/unit/resolveArticleTitle.test.js
 *
 * 测试 resolveArticleTitle 辅助函数
 *
 * 运行: node test/unit/resolveArticleTitle.test.js
 */

'use strict'

const assert = require('assert')

// 暂时直接内联实现（在 updateChecker.js 抽取前先测试逻辑）
const { resolveArticleTitle } = require('../../src/services/subscription/updateChecker')

// --- 测试用例 ---

// Case 1: 普通 article 类型，有标题
{
    const info = { type: 'article', data: { title: '我的专栏文章' } }
    const result = resolveArticleTitle(info)
    assert.strictEqual(result.actualType, 'article')
    assert.strictEqual(result.title, '我的专栏文章')
    console.log('✓ Case 1: article 类型正确提取标题')
}

// Case 2: info.type 未设置，默认为 article
{
    const info = { data: { title: '默认专栏' } }
    const result = resolveArticleTitle(info)
    assert.strictEqual(result.actualType, 'article')
    assert.strictEqual(result.title, '默认专栏')
    console.log('✓ Case 2: type 未设置时默认为 article')
}

// Case 3: dynamic 类型（新版专栏重定向），从 opus.title 提取
{
    const info = {
        type: 'dynamic',
        data: {
            item: {
                modules: {
                    module_dynamic: {
                        major: {
                            opus: { title: '新版专栏Opus标题' }
                        }
                    }
                }
            }
        }
    }
    const result = resolveArticleTitle(info)
    assert.strictEqual(result.actualType, 'dynamic')
    assert.strictEqual(result.title, '新版专栏Opus标题')
    console.log('✓ Case 3: dynamic 类型从 opus.title 提取标题')
}

// Case 4: dynamic 类型但 opus.title 不存在，返回降级文字
{
    const info = { type: 'dynamic', data: { item: { modules: {} } } }
    const result = resolveArticleTitle(info)
    assert.strictEqual(result.actualType, 'dynamic')
    assert.strictEqual(result.title, '（无标题）')
    console.log('✓ Case 4: dynamic 类型无标题时降级为（无标题）')
}

// Case 5: article 类型但 data.title 为 undefined，返回降级文字
{
    const info = { type: 'article', data: {} }
    const result = resolveArticleTitle(info)
    assert.strictEqual(result.title, '（无标题）')
    console.log('✓ Case 5: article 类型无标题时降级为（无标题）')
}

console.log('\n所有测试通过 ✓')
```

### Step 2: 运行测试，确认失败

```bash
node test/unit/resolveArticleTitle.test.js
```

预期失败信息：`TypeError: resolveArticleTitle is not a function`（函数尚未导出）

### Step 3: 在 updateChecker.js 中添加 resolveArticleTitle 函数并导出

在 `updateChecker.js` 文件顶部区域（`class UpdateChecker` 定义之前，约第 20 行附近）添加：

```javascript
/**
 * 解析专栏推送的实际类型和标题
 * 新版 B 站专栏（cv号）可能被重定向为 opus/动态格式，需按实际类型处理
 * @param {Object} info - biliApi.getArticleInfo 返回值
 * @returns {{ actualType: string, title: string }}
 */
function resolveArticleTitle(info) {
    const actualType = info.type || 'article'
    const title = actualType === 'dynamic'
        ? info.data?.item?.modules?.module_dynamic?.major?.opus?.title
        : info.data?.title
    return { actualType, title: title || '（无标题）' }
}
```

在文件末尾的 `module.exports` 中导出：

```javascript
module.exports = { UpdateChecker, resolveArticleTitle }
```

> **注意：** 若文件当前导出形式为 `module.exports = UpdateChecker`，需改为对象形式，并确认其他引用该模块的文件（`subscriptionService.js` 等）是否需要同步更新导入方式。

### Step 4: 运行测试，确认通过

```bash
node test/unit/resolveArticleTitle.test.js
```

预期输出：
```
✓ Case 1: article 类型正确提取标题
✓ Case 2: type 未设置时默认为 article
✓ Case 3: dynamic 类型从 opus.title 提取标题
✓ Case 4: dynamic 类型无标题时降级为（无标题）
✓ Case 5: article 类型无标题时降级为（无标题）

所有测试通过 ✓
```

### Step 5: 替换两处重复代码

**位置 1**：`checkUserArticle`（约第 1209–1216 行）

将：
```javascript
                        // 新版专栏可能重定向为 opus/动态格式，按实际类型处理
                        const actualType = info.type || 'article';
                        const articleTitle = actualType === 'dynamic'
                            ? info.data?.item?.modules?.module_dynamic?.major?.opus?.title
                            : info.data.title;

                        // 生成通知文本
                        const notificationText = `${sub.name} 发布了新专栏：\n${articleTitle || '（无标题）'}`;
```

替换为：
```javascript
                        const { actualType, title: articleTitle } = resolveArticleTitle(info)
                        const notificationText = `${sub.name} 发布了新专栏：\n${articleTitle}`;
```

**位置 2**：`checkUserArticleUnified`（约第 1307–1313 行）

将：
```javascript
                        // 新版专栏可能重定向为 opus/动态格式，按实际类型处理
                        const actualType = info.type || 'article';
                        const articleTitle = actualType === 'dynamic'
                            ? info.data?.item?.modules?.module_dynamic?.major?.opus?.title
                            : info.data.title;

                        const notificationText = `${name} 发布了新专栏：\n${articleTitle || '（无标题）'}`;
```

替换为：
```javascript
                        const { actualType, title: articleTitle } = resolveArticleTitle(info)
                        const notificationText = `${name} 发布了新专栏：\n${articleTitle}`;
```

### Step 6: 再次运行测试，确认仍然通过

```bash
node test/unit/resolveArticleTitle.test.js
```

### Step 7: 检查 module.exports 变更的影响

```bash
grep -r "require.*updateChecker" src/ --include="*.js"
```

若有其他文件引用 `updateChecker.js`，确认它们使用的是 `UpdateChecker` 类（通过对象解构或直接属性访问均可）。

### Step 8: Commit

```bash
git add src/services/subscription/updateChecker.js test/unit/resolveArticleTitle.test.js
git commit -m "refactor: 提取 resolveArticleTitle 函数消除重复代码，添加单元测试"
```

---

## Task 5：添加 detectChargingContent 单元测试（M1）

**优先级：Minor**

**Files:**
- Create: `test/unit/detectChargingContent.test.js`
- Modify: `src/services/imageGenerator/generators/previewCard.js`（导出函数）

**Step 1: 导出 detectChargingContent 函数**

在 `previewCard.js` 末尾找到 `module.exports`（约第 100 行以后），将 `detectChargingContent` 加入导出：

```javascript
module.exports = { generatePreviewCard, detectChargingContent }
```

**Step 2: 创建测试文件**

```javascript
#!/usr/bin/env node
/**
 * test/unit/detectChargingContent.test.js
 *
 * 测试 detectChargingContent 纯函数
 *
 * 运行: node test/unit/detectChargingContent.test.js
 */

'use strict'

const assert = require('assert')
const path = require('path')

// 只加载 previewCard 的纯函数部分（避免触发 browserManager 初始化）
// previewCard.js 的顶层不执行副作用，可直接 require
const { detectChargingContent } = require(path.join(__dirname, '../../src/services/imageGenerator/generators/previewCard'))

// --- dynamic 类型 ---

// Case 1: dynamic 类型，is_only_fans = true
{
    const data = { data: { item: { basic: { is_only_fans: true } } } }
    assert.strictEqual(detectChargingContent('dynamic', data), true)
    console.log('✓ Case 1: dynamic + is_only_fans=true → true')
}

// Case 2: dynamic 类型，is_only_fans = false
{
    const data = { data: { item: { basic: { is_only_fans: false } } } }
    assert.strictEqual(detectChargingContent('dynamic', data), false)
    console.log('✓ Case 2: dynamic + is_only_fans=false → false')
}

// Case 3: dynamic 类型，basic 字段缺失（不崩溃）
{
    const data = { data: { item: {} } }
    assert.strictEqual(detectChargingContent('dynamic', data), false)
    console.log('✓ Case 3: dynamic + basic 缺失 → false（不崩溃）')
}

// Case 4: dynamic 类型，data 为空对象（不崩溃）
{
    const data = { data: {} }
    assert.strictEqual(detectChargingContent('dynamic', data), false)
    console.log('✓ Case 4: dynamic + data={} → false（不崩溃）')
}

// --- video 类型 ---

// Case 5: video 类型，is_charging_arc = true
{
    const data = { data: { is_charging_arc: true } }
    assert.strictEqual(detectChargingContent('video', data), true)
    console.log('✓ Case 5: video + is_charging_arc=true → true')
}

// Case 6: video 类型，is_charging_arc = false
{
    const data = { data: { is_charging_arc: false } }
    assert.strictEqual(detectChargingContent('video', data), false)
    console.log('✓ Case 6: video + is_charging_arc=false → false')
}

// Case 7: video 类型，字段缺失（不崩溃）
{
    const data = { data: {} }
    assert.strictEqual(detectChargingContent('video', data), false)
    console.log('✓ Case 7: video + 字段缺失 → false（不崩溃）')
}

// --- 其他类型 ---

// Case 8: article 类型 → 永远 false
{
    const data = { data: { is_charging_arc: true } }
    assert.strictEqual(detectChargingContent('article', data), false)
    console.log('✓ Case 8: article 类型 → false')
}

// Case 9: 未知类型 → false
{
    assert.strictEqual(detectChargingContent('unknown', {}), false)
    console.log('✓ Case 9: 未知类型 → false')
}

console.log('\n所有测试通过 ✓')
```

**Step 3: 运行测试**

```bash
node test/unit/detectChargingContent.test.js
```

预期：全部 9 个 case 通过。

**Step 4: Commit**

```bash
git add src/services/imageGenerator/generators/previewCard.js test/unit/detectChargingContent.test.js
git commit -m "test: 添加 detectChargingContent 单元测试，导出函数"
```

---

## Task 6：文档化 is_only_fans 字段语义（M2）

**优先级：Minor**

**Files:**
- Modify: `src/services/imageGenerator/generators/previewCard.js:14-22`

**Step 1: 在 detectChargingContent 函数内为 is_only_fans 字段添加注释**

当前代码（第 14–22 行）：
```javascript
function detectChargingContent(type, data) {
    if (type === 'dynamic') {
        return data.data?.item?.basic?.is_only_fans === true
    }
    if (type === 'video') {
        return data.data?.is_charging_arc === true
    }
    return false
}
```

修改后：
```javascript
function detectChargingContent(type, data) {
    if (type === 'dynamic') {
        // B 站充电专属动态：item.basic.is_only_fans = true
        // 注：字段名含 "fans" 但实际仅对应充电专属（非粉丝团专属）
        // 已通过 MAJOR_TYPE_BLOCKED 动态 API 响应验证，待确认普通可见充电动态的该字段值
        return data.data?.item?.basic?.is_only_fans === true
    }
    if (type === 'video') {
        // B 站充电专属视频：is_charging_arc = true（来自 /user_videos API 的 vlist 字段）
        return data.data?.is_charging_arc === true
    }
    return false
}
```

**Step 2: Commit**

```bash
git add src/services/imageGenerator/generators/previewCard.js
git commit -m "docs: 为 detectChargingContent 中的 is_only_fans 字段添加语义注释"
```

---

## Task 7：修复 M3 — border-radius 使用 CSS 变量

**优先级：Minor**

**Files:**
- Modify: `src/utils/designSystem.js:241`

**背景：**
`DESIGN_SYSTEM.radius` 定义了：`sm: '6px'`、`md: '10px'`、`lg: '18px'`、`container: '20px'`。`.charging-mark` 徽章当前使用 `border-radius: 12px`（硬编码），应使用设计系统变量。由于徽章需要胶囊形状，使用 `var(--radius-lg)` （18px）最合适。

**Step 1: 修改 designSystem.js 第 241 行**

将：
```css
border-radius: 12px;
```

改为：
```css
border-radius: var(--radius-lg);
```

**Step 2: Commit**

```bash
git add src/utils/designSystem.js
git commit -m "style: charging-mark border-radius 改用设计系统变量 --radius-lg"
```

---

## 最终验证

完成所有 Task 后，运行所有单元测试确认无回归：

```bash
node test/unit/resolveArticleTitle.test.js
node test/unit/detectChargingContent.test.js
node test/unit/feedState-race.test.js
node test/unit/updateVideoState-race.test.js
node test/unit/messageHandler-emojiReaction.test.js
node test/unit/messageHandler-linkReaction.test.js
```

所有测试应全部通过。

---

## 完成检查清单

- [ ] C1: `checkUserVideo` 手动订阅路径已加充电标志注入
- [ ] I1: `MAJOR_TYPE_BLOCKED` 渲染器中 `pubTime` 已 escape
- [ ] I2: `MAJOR_TYPE_BLOCKED` 渲染器已添加 action bar
- [ ] I3: `resolveArticleTitle` 已提取为独立函数，两处重复代码已替换
- [ ] M1: `detectChargingContent` 已有 9 个单元测试
- [ ] M2: `is_only_fans` 字段已有语义注释
- [ ] M3: `border-radius` 已改为 `var(--radius-lg)`
- [ ] 所有现有单元测试通过
