# Review 修复计划（2026-02-18）

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复针对当前分支 `feat：表情回复功能` 的 Code Review 发现的 9 个问题（2 个 Important、1 个导出规范、3 个 Minor 代码、1 个测试隔离、1 个文件格式、1 个样式变量）。

**Architecture:** 修复分为五类：单行安全修复（I1/I2）、导出可读性（I3）、带测试的防御性编程（M1/M3）、测试框架加固（M4）、文件格式与样式规范（M5/M6）。涉及 working tree 未提交修改的文件 + 已提交的源文件。

**Tech Stack:** Node.js 18+，Node.js 内置 `assert`（测试），无测试框架

---

## 问题一览

| ID | 文件 | 行号 | 类型 |
|----|------|------|------|
| I1 | `src/services/imageGenerator/renderers/dynamic.js` | 213 | 安全：正常路径 pubTime 未 escape |
| I2 | `src/handlers/messageHandler.js` | 39 | 日志：缺少 messageId 用 warn 而非 debug |
| I3 | `src/services/subscription/updateChecker.js` | 1601 | 可读性：Object.assign 隐式混入实例 |
| M1 | `src/handlers/messageHandler.js` | 225/230/283/285/287 | 魔法字符串：表情 ID 无命名常量 |
| M2 | `src/handlers/messageHandler.js` | 284-288 | UX：部分成功时 emoji 语义不清，加注释 |
| M3 | `src/services/imageGenerator/generators/previewCard.js` | 14 | 防御：null data 会抛 TypeError |
| M4 | `test/unit/messageHandler-linkReaction.test.js` | 全文 | 测试：用例间状态未隔离 |
| M5 | `src/services/imageGenerator/generators/previewCard.js` | 全文 | 格式：CRLF 行尾符与仓库不一致 |
| M6 | `src/utils/designSystem.js` | 237-239 | 样式：`.charging-mark` 颜色硬编码 |

---

## Task 1：I2 + I1 — 日志级别 + pubTime escape（安全快修）

**Files:**
- Modify: `src/handlers/messageHandler.js:39`
- Modify: `src/services/imageGenerator/renderers/dynamic.js:213`

### Step 1: 修改 messageHandler.js — warn → debug（第 39 行）

当前：
```javascript
        if (!messageId) {
            logger.warn(`[MessageHandler] Cannot send emoji reaction: no messageId (emojiId=${emojiId})`)
            return
        }
```

修改后：
```javascript
        if (!messageId) {
            logger.debug(`[MessageHandler] Cannot send emoji reaction: no messageId (emojiId=${emojiId})`)
            return
        }
```

### Step 2: 修改 dynamic.js — 正常路径 pubTime escape（第 213 行）

当前（约第 213 行，正常动态渲染路径的 header）：
```javascript
                        <span class="pub-time">${pubTime}</span>
```

修改后（注意这是正常路径 `<div class="user-info">` 里的 pub-time，不是 BLOCKED 路径的那一行）：
```javascript
                        <span class="pub-time">${escapeHtml(String(pubTime))}</span>
```

**重要**：确认 `escapeHtml` 在文件顶部已 import（第 1 行），`String()` 包装处理空值安全。

### Step 3: 验证两处 pubTime 都已 escape

在 `dynamic.js` 里搜索 `pub-time`，确认两处（BLOCKED 路径第 116 行、正常路径第 213 行）都使用了 `escapeHtml(String(pubTime))`。

### Step 4: 验证现有测试仍通过

```bash
node test/unit/messageHandler-emojiReaction.test.js 2>/dev/null
```

预期：6/6 通过（warn→debug 不影响功能测试）

---

## Task 2：I3 — updateChecker 导出可读性

**Files:**
- Modify: `src/services/subscription/updateChecker.js:1601`

### Step 1: 修改导出模式

当前（第 1600-1601 行）：
```javascript
const updateCheckerInstance = new UpdateChecker()
module.exports = Object.assign(updateCheckerInstance, { resolveArticleTitle })
```

修改后：
```javascript
const updateCheckerInstance = new UpdateChecker()
// resolveArticleTitle 是模块级工具函数，仅用于测试访问，不属于 UpdateChecker 类方法
module.exports = updateCheckerInstance
module.exports.resolveArticleTitle = resolveArticleTitle
```

**说明**：两种写法在 JavaScript 中功能等价，但显式两行写法更清晰地表达了意图——`resolveArticleTitle` 是挂在模块导出上的工具函数，不是实例方法。注释进一步说明用途。

### Step 2: 验证测试仍通过

```bash
node test/unit/resolveArticleTitle.test.js 2>/dev/null
```

预期：5/5 通过（导出方式变化不影响 `require('...').resolveArticleTitle` 的访问）

---

## Task 3：M1 + M2 — 表情 ID 命名常量 + 部分成功注释

**Files:**
- Modify: `src/handlers/messageHandler.js:33-55`（sendEmojiReaction 方法之前）
- Modify: `src/handlers/messageHandler.js:225,230,283,285,287`（调用处）
- Modify: `src/handlers/messageHandler.js:284-288`（结果表情逻辑处加注释）
- Modify: `test/unit/messageHandler-emojiReaction.test.js`（更新测试断言）
- Modify: `test/unit/messageHandler-linkReaction.test.js`（更新测试断言）

### Step 1: 在 sendEmojiReaction 方法定义之前添加常量

在 `messageHandler.js` 第 32 行（`sendEmojiReaction` 定义之前，class 内部）找到合适位置，在 class 外（文件顶部，require 语句之后）添加常量：

```javascript
// 表情 ID 常量（NapCat set_msg_emoji_like）
const LINK_EMOJI = {
    THINKING: '66',   // 思考中 —— 链接处理开始
    OK:       '76',   // OK     —— 全部链接处理成功
    CRYING:   '5',    // 流泪   —— 至少一个链接处理失败
    SHUSH:    '21',   // 嘘     —— 全部链接在冷却期，跳过
}
```

**位置**：在 `const logger = require(...)` 等 require 语句之后、`class MessageHandler {` 之前。

### Step 2: 替换 5 处魔法字符串

将以下调用中的字符串字面量替换为常量：

| 行（原） | 原代码 | 修改后 |
|---------|--------|--------|
| 约第 225 行 | `this.sendEmojiReaction(ws, messageId, '21');` | `this.sendEmojiReaction(ws, messageId, LINK_EMOJI.SHUSH);` |
| 约第 230 行 | `this.sendEmojiReaction(ws, messageId, '66');  // 思考中` | `this.sendEmojiReaction(ws, messageId, LINK_EMOJI.THINKING);` |
| 约第 283 行 | `this.sendEmojiReaction(ws, messageId, '66', false);  // 撤销思考` | `this.sendEmojiReaction(ws, messageId, LINK_EMOJI.THINKING, false);` |
| 约第 285 行 | `this.sendEmojiReaction(ws, messageId, '5');   // 流泪（失败）` | `this.sendEmojiReaction(ws, messageId, LINK_EMOJI.CRYING);` |
| 约第 287 行 | `this.sendEmojiReaction(ws, messageId, '76');  // OK（完成）` | `this.sendEmojiReaction(ws, messageId, LINK_EMOJI.OK);` |

### Step 3: 在结果表情逻辑处添加 M2 注释

在约第 283-288 行的 `if (hasErrors)` 块，添加一行注释说明部分成功的设计决策：

```javascript
            // 撤销思考表情，发送结果表情。
            // 注：hasErrors 为 true 表示"至少一个链接失败"，并非全部失败。
            // 失败链接的具体 URL 已在上方错误提示文字中说明。
            this.sendEmojiReaction(ws, messageId, LINK_EMOJI.THINKING, false);
            if (hasErrors) {
                this.sendEmojiReaction(ws, messageId, LINK_EMOJI.CRYING);
            } else {
                this.sendEmojiReaction(ws, messageId, LINK_EMOJI.OK);
            }
```

### Step 4: 更新两个测试文件中的断言

`LINK_EMOJI` 常量在 `messageHandler.js` 内部（非导出），测试文件无法直接 import。**测试文件中继续使用字符串字面量**，但需在注释中与常量名对应，增加可读性：

在 `test/unit/messageHandler-emojiReaction.test.js` 中，为测试名称/注释加上常量名对照：
```javascript
// '66' = LINK_EMOJI.THINKING
assert.strictEqual(ws._sent[0].params.emoji_id, '66')
```

在 `test/unit/messageHandler-linkReaction.test.js` 中，相同处理：
```javascript
assert.strictEqual(emojiActions[0].params.emoji_id, '66')  // THINKING
assert.strictEqual(emojiActions[2].params.emoji_id, '76')  // OK
```

### Step 5: 运行两个测试文件

```bash
node test/unit/messageHandler-emojiReaction.test.js 2>/dev/null
node test/unit/messageHandler-linkReaction.test.js 2>/dev/null
```

预期：两者均全部通过（常量替换不改变运行时字符串值）

---

## Task 4：M3 — detectChargingContent null 防御（TDD）

**Files:**
- Modify: `src/services/imageGenerator/generators/previewCard.js:14-26`
- Modify: `test/unit/detectChargingContent.test.js`（新增 2 个 case）

### Step 1: 在测试文件末尾（`所有测试通过` 前）新增 2 个 case

打开 `test/unit/detectChargingContent.test.js`，在最后一行 `console.log('\n所有测试通过 ✓')` 之前添加：

```javascript
// --- null / undefined 防御 ---
{
    // Case 10: data 为 null → false（不崩溃）
    assert.doesNotThrow(() => detectChargingContent('dynamic', null))
    assert.strictEqual(detectChargingContent('dynamic', null), false)
    console.log('✓ Case 10: data=null → false（不崩溃）')
}
{
    // Case 11: data 为 undefined → false（不崩溃）
    assert.doesNotThrow(() => detectChargingContent('video', undefined))
    assert.strictEqual(detectChargingContent('video', undefined), false)
    console.log('✓ Case 11: data=undefined → false（不崩溃）')
}
```

### Step 2: 运行测试，确认失败

```bash
node test/unit/detectChargingContent.test.js 2>/dev/null
```

预期失败：Case 10 抛出 `TypeError: Cannot read properties of null (reading 'data')`

### Step 3: 修改 detectChargingContent，添加 null guard

当前（第 14-26 行）：
```javascript
function detectChargingContent(type, data) {
    if (type === 'dynamic') {
        // ...
        return data.data?.item?.basic?.is_only_fans === true
    }
    if (type === 'video') {
        // ...
        return data.data?.is_charging_arc === true
    }
    return false
}
```

修改后（在函数体第一行加 guard）：
```javascript
function detectChargingContent(type, data) {
    if (!data) return false
    if (type === 'dynamic') {
        // B 站充电专属动态：item.basic.is_only_fans = true
        // 注：字段名含 "fans" 但实际对应充电专属（非粉丝团专属），
        // 充电专属内容通常伴随 MAJOR_TYPE_BLOCKED 遮蔽，此字段可用于在 badge 层额外标记
        return data.data?.item?.basic?.is_only_fans === true
    }
    if (type === 'video') {
        // B 站充电专属视频：is_charging_arc = true（来自 /user_videos API 的 vlist 字段）
        return data.data?.is_charging_arc === true
    }
    return false
}
```

### Step 4: 运行测试，确认全部通过

```bash
node test/unit/detectChargingContent.test.js 2>/dev/null
```

预期：11/11 通过

---

## Task 5：M4 — 测试隔离（messageHandler-linkReaction.test.js）

**Files:**
- Modify: `test/unit/messageHandler-linkReaction.test.js`

**问题：** 每个 `test()` 用例覆写 `linkHandler.extractLinks` 等属性后不还原，导致用例间存在状态依赖。

### Step 1: 在文件顶部，`require` 语句之后捕获原始值

在 `const handler = require(...)` 之后（约第 70 行），添加：

```javascript
// 捕获被 mock 模块的原始方法，用于每次测试后还原
const _originals = {
    extractLinks:      linkHandler.extractLinks,
    isLinkCached:      linkHandler.isLinkCached,
    processSingleLink: linkHandler.processSingleLink,
    addLinkToCache:    linkHandler.addLinkToCache,
    shouldReply:       aiHandler.shouldReply,
}
```

### Step 2: 修改 test() 运行器，在 finally 中还原状态

当前 `test()` 函数（约第 72-82 行）：
```javascript
async function test(name, fn) {
    try {
        await fn()
        console.log(`  PASS: ${name}`)
        passed++
    } catch (e) {
        console.error(`  FAIL: ${name}`)
        console.error(`     ${e.message}`)
        failed++
    }
}
```

修改后：
```javascript
async function test(name, fn) {
    try {
        await fn()
        console.log(`  PASS: ${name}`)
        passed++
    } catch (e) {
        console.error(`  FAIL: ${name}`)
        console.error(`     ${e.message}`)
        failed++
    } finally {
        // 每次测试后还原被 mock 的属性，防止状态泄漏到下一个用例
        linkHandler.extractLinks      = _originals.extractLinks
        linkHandler.isLinkCached      = _originals.isLinkCached
        linkHandler.processSingleLink = _originals.processSingleLink
        linkHandler.addLinkToCache    = _originals.addLinkToCache
        aiHandler.shouldReply         = _originals.shouldReply
    }
}
```

### Step 3: 移除场景 6 末尾的手动还原（现已由 finally 处理）

找到场景 6（约第 173-182 行）中的这一行，删除：
```javascript
        aiHandler.shouldReply = () => false  // 还原   ← 删除此行
```

### Step 4: 运行测试，确认全部通过且顺序无关

```bash
node test/unit/messageHandler-linkReaction.test.js 2>/dev/null
```

预期：7/7 通过

---

## Task 6：M5 — 修复 previewCard.js 的 CRLF 行尾符

**Files:**
- Modify: `src/services/imageGenerator/generators/previewCard.js`（行尾符转换）

**问题：** 该文件使用 CRLF（`\r\n`），仓库其他文件使用 LF（`\n`）。

### Step 1: 转换行尾符

```bash
sed -i '' 's/\r//' src/services/imageGenerator/generators/previewCard.js
```

（macOS 的 `sed -i ''` 语法；Linux 用 `sed -i 's/\r//'`）

### Step 2: 验证转换结果

```bash
file src/services/imageGenerator/generators/previewCard.js
```

预期输出：`UTF-8 text`（无 `CRLF` 字样）

### Step 3: 运行测试，确认无回归

```bash
node test/unit/detectChargingContent.test.js 2>/dev/null
```

预期：11/11 通过（行尾符不影响运行时行为）

---

## Task 7：M6 — `.charging-mark` 颜色加入 DESIGN_SYSTEM

**Files:**
- Modify: `src/utils/designSystem.js`

**问题：** `.charging-mark` 的三处颜色值（`#FFB300`、`rgba(255, 179, 0, 0.15)`、`rgba(255, 179, 0, 0.4)`)是硬编码，与设计系统的变量化理念不符。

### Step 1: 在 `DESIGN_SYSTEM` 对象末尾（第 36 行 `typeBadge` 之后）添加颜色配置

```javascript
    // 充电专属内容颜色
    charging: {
        gold:        '#FFB300',
        goldBg:      'rgba(255, 179, 0, 0.15)',
        goldBorder:  'rgba(255, 179, 0, 0.4)',
    }
```

完整的 `DESIGN_SYSTEM` 结尾应为：
```javascript
    typeBadge: {
        fontSize: '28px',
        padding: '16px 28px',
        gap: '12px',
        marginBottom: '20px',
        fontWeight: '700'
    },
    // 充电专属内容颜色
    charging: {
        gold:        '#FFB300',
        goldBg:      'rgba(255, 179, 0, 0.15)',
        goldBorder:  'rgba(255, 179, 0, 0.4)',
    }
};
```

### Step 2: 在 `.charging-mark` CSS 中使用新常量（约第 234-244 行）

当前：
```css
            .charging-mark {
                font-size: ${DESIGN_SYSTEM.typography.small};
                font-weight: 600;
                color: #FFB300;
                background: rgba(255, 179, 0, 0.15);
                border: 1px solid rgba(255, 179, 0, 0.4);
                padding: 4px 12px;
                border-radius: var(--radius-lg);
                margin-left: 8px;
                letter-spacing: 0.02em;
            }
```

修改后：
```css
            .charging-mark {
                font-size: ${DESIGN_SYSTEM.typography.small};
                font-weight: 600;
                color: ${DESIGN_SYSTEM.charging.gold};
                background: ${DESIGN_SYSTEM.charging.goldBg};
                border: 1px solid ${DESIGN_SYSTEM.charging.goldBorder};
                padding: 4px 12px;
                border-radius: var(--radius-lg);
                margin-left: 8px;
                letter-spacing: 0.02em;
            }
```

### Step 3: 搜索确认没有其他遗留硬编码

```bash
grep -n "FFB300\|179, 0" src/utils/designSystem.js
```

预期：0 条匹配（全部已替换）

---

## 最终验证

依次运行所有测试，确认无回归：

```bash
node test/unit/messageHandler-emojiReaction.test.js 2>/dev/null
node test/unit/messageHandler-linkReaction.test.js 2>/dev/null
node test/unit/detectChargingContent.test.js 2>/dev/null
node test/unit/resolveArticleTitle.test.js 2>/dev/null
node test/unit/feedState-race.test.js 2>/dev/null
node test/unit/updateVideoState-race.test.js 2>/dev/null
```

所有测试全部通过后完成。

---

## 完成检查清单

- [ ] I1: `dynamic.js:213` 正常路径 pubTime 已 `escapeHtml(String(pubTime))`
- [ ] I2: `messageHandler.js:39` warn → debug
- [ ] I3: `updateChecker.js:1601` Object.assign → 显式两行 + 注释
- [ ] M1: `messageHandler.js` 5 处表情 ID 改为 `LINK_EMOJI.*` 常量
- [ ] M2: `messageHandler.js:283` 部分成功行为加注释说明
- [ ] M3: `detectChargingContent` 加 `if (!data) return false`，测试新增 Case 10-11
- [ ] M4: `messageHandler-linkReaction.test.js` 测试 finally 还原状态
- [ ] M5: `previewCard.js` CRLF → LF
- [ ] M6: `DESIGN_SYSTEM.charging` 颜色常量，`.charging-mark` 使用变量插值
- [ ] 所有 6 个测试文件全部通过
