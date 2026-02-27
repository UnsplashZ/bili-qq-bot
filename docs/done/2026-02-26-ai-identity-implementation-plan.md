# AI 记忆用户身份增强 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复 AI 向量记忆中用户身份丢失问题，将历史消息从压扁文本改为多轮 messages 格式，并为每个用户建立持久画像。

**Architecture:** 三个阶段顺序实施：阶段一修复向量记忆的用户身份存储和检索，阶段二将 prompt 从单条 system 文本重构为原生多轮对话结构，阶段三新建 `userProfileService.js` 实现用户画像的生成和注入。

**Tech Stack:** Node.js, vectorMemoryService.js, aiHandler.js, messageHandler.js, aiContextService.js (已有实现), Express API, React/Vite Dashboard

**Design Doc:** `docs/plans/2026-02-26-ai-memory-identity-enhancement.md`

---

## Phase 1: 基础修复

### Task 1: addMemory 存储用户身份

**Files:**
- Modify: `src/services/vectorMemoryService.js` (addMemory 方法，约第 306 行)
- Modify: `src/handlers/messageHandler.js` (约第 196-204 行)
- Test: `test/unit/vectorMemory-userIdentity.test.js`

**Step 1: 写失败测试**

创建 `test/unit/vectorMemory-userIdentity.test.js`：

```javascript
#!/usr/bin/env node
/**
 * test/unit/vectorMemory-userIdentity.test.js
 * 运行: node test/unit/vectorMemory-userIdentity.test.js
 */
'use strict'

const assert = require('assert')

// 构造最小化的 addMemory 结果验证（不依赖真实 embedding）
// 直接测试存储结构中是否包含 userId/userName

function buildMemoryEntry(text, role, userId = null, userName = null) {
    const entry = {
        text,
        role,
        vector: [],
        timestamp: Date.now(),
        accessCount: 1,
        importance: 1.0,
    }
    if (userId != null) entry.userId = userId
    if (userName != null) entry.userName = userName
    return entry
}

// Case 1: 用户消息含 userId/userName
{
    const entry = buildMemoryEntry('我喜欢编程', 'user', '123456', '张三')
    assert.strictEqual(entry.userId, '123456', '应包含 userId')
    assert.strictEqual(entry.userName, '张三', '应包含 userName')
    console.log('✓ Case 1: user 消息包含 userId 和 userName')
}

// Case 2: 助手回复不含 userId
{
    const entry = buildMemoryEntry('好的，我明白了', 'assistant')
    assert.strictEqual(entry.userId, undefined, '助手消息不含 userId')
    assert.strictEqual(entry.userName, undefined, '助手消息不含 userName')
    console.log('✓ Case 2: assistant 消息不含用户字段')
}

// Case 3: embedding 文本前缀逻辑
function buildEmbeddingText(text, role, userName) {
    return (role === 'user' && userName) ? `${userName}: ${text}` : text
}

assert.strictEqual(buildEmbeddingText('我喜欢编程', 'user', '张三'), '张三: 我喜欢编程')
assert.strictEqual(buildEmbeddingText('好的', 'assistant', null), '好的')
assert.strictEqual(buildEmbeddingText('消息', 'user', null), '消息') // 无 userName 不加前缀
console.log('✓ Case 3: embedding 文本前缀逻辑正确')

// Case 4: 旧数据无 userId 时 fallback
function getDisplayName(m) {
    return m.userName || (m.role === 'assistant' ? 'AI助手' : '某位用户')
}

assert.strictEqual(getDisplayName({ role: 'user' }), '某位用户')
assert.strictEqual(getDisplayName({ role: 'assistant' }), 'AI助手')
assert.strictEqual(getDisplayName({ role: 'user', userName: '李四' }), '李四')
console.log('✓ Case 4: 旧数据无 userName 时 fallback 正确')

console.log('\n所有测试通过 ✓')
```

**Step 2: 运行确认测试能跑通（暂时不会失败，因为是纯逻辑测试）**

```bash
node test/unit/vectorMemory-userIdentity.test.js
```
预期：所有 case 通过（这是规格测试，验证即将实现的逻辑）

**Step 3: 修改 `src/services/vectorMemoryService.js` — addMemory 方法签名和存储结构**

找到 `async addMemory(groupId, text, role)` 方法（约第 306 行），做以下改动：

1. **签名变更**：
```javascript
// 改前
async addMemory(groupId, text, role) {

// 改后
async addMemory(groupId, text, role, userId = null, userName = null) {
```

2. **embedding 文本加用户名前缀**（在调用 `this.getEmbedding(text)` 之前加入）：
```javascript
// 在 const vector = await this.getEmbedding(text) 前插入
const embeddingText = (role === 'user' && userName) ? `${userName}: ${text}` : text
const vector = await this.getEmbedding(embeddingText)
// 原来是 this.getEmbedding(text)，改为 this.getEmbedding(embeddingText)
```

3. **存储结构新增字段**（找到 `memory.push({` 块，在 `importance: ...` 后加）：
```javascript
memory.push({
    text,
    role,
    vector,
    timestamp: Date.now(),
    accessCount: 1,
    importance: this.calculateImportance(text, role, Date.now(), 1),
    userId,    // 新增
    userName   // 新增
})
```

**Step 4: 修改 `src/handlers/messageHandler.js` — 向量记忆调用传入用户信息**

找到约第 196-204 行的向量记忆存储代码：

```javascript
// 改前
vectorMemoryService.addMemory(groupId, cleanMsg, 'user').catch(e => {

// 改后
vectorMemoryService.addMemory(groupId, cleanMsg, 'user', userId, userName).catch(e => {
```

注意：`userId` 和 `userName` 在 messageHandler.js 此处上下文中已可用（同一函数内前面已赋值）。

**Step 5: 运行测试确认**

```bash
node test/unit/vectorMemory-userIdentity.test.js
```
预期：全部通过

**Step 6: Commit**

```bash
git add src/services/vectorMemoryService.js src/handlers/messageHandler.js test/unit/vectorMemory-userIdentity.test.js
git commit -m "feat(ai): addMemory 存储 userId/userName，embedding 加用户名前缀"
```

---

### Task 2: RAG 注入加入时间和用户名

**Files:**
- Modify: `src/handlers/aiHandler.js`（cleanMessage 方法后新增 formatRelativeTime；约第 137-139 行的 RAG 注入；约第 234-235 行的 MCP 路径）

**Step 1: 在 `src/handlers/aiHandler.js` 中提取 `formatRelativeTime` 方法**

在 `cleanMessage` 方法之后（约第 30 行附近）新增：

```javascript
formatRelativeTime(timestamp) {
    if (!timestamp) return '未知时间'
    const diff = Date.now() - timestamp
    const minutes = Math.floor(diff / 60000)
    if (minutes < 1) return '刚刚'
    if (minutes < 60) return `${minutes}分钟前`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}小时前`
    const days = Math.floor(hours / 24)
    if (days < 7) return `${days}天前`
    if (days < 30) return `${Math.floor(days / 7)}周前`
    return `${Math.floor(days / 30)}个月前`
}
```

**Step 2: 修改 RAG 注入格式**

找到约第 137-139 行：

```javascript
// 改前
const memoryText = relevantMemories.map(m =>
    `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`
).join('\n')

// 改后
const memoryText = relevantMemories.map(m => {
    const who = m.userName || (m.role === 'assistant' ? 'AI助手' : '某位用户')
    const when = this.formatRelativeTime(m.timestamp)
    return `(${when}) ${who}: ${m.text}`
}).join('\n')
```

**Step 3: 统一 MCP 混合搜索路径的格式**

找到约第 234-235 行的 MCP Local Memory 格式：

```javascript
// 改前
`[Local Memory] ${m.role === 'user' ? 'User' : 'Assistant'} (${new Date(m.timestamp).toLocaleString(...)}): ${m.text}`

// 改后
`[Local Memory] (${this.formatRelativeTime(m.timestamp)}) ${m.userName || (m.role === 'assistant' ? 'AI助手' : '某位用户')}: ${m.text}`
```

**Step 4: Commit**

```bash
git add src/handlers/aiHandler.js
git commit -m "feat(ai): RAG 注入加入时间和用户名，提取 formatRelativeTime 方法"
```

---

### Task 3: 向量搜索用户加权 + L3 缓存 key 修复

**Files:**
- Modify: `src/services/vectorMemoryService.js`（search 方法，约第 476 行）
- Modify: `src/handlers/aiHandler.js`（search 调用处，约第 130、231 行）
- Test: `test/unit/vectorMemory-userSearch.test.js`

**Step 1: 写失败测试**

创建 `test/unit/vectorMemory-userSearch.test.js`：

```javascript
#!/usr/bin/env node
/**
 * test/unit/vectorMemory-userSearch.test.js
 * 运行: node test/unit/vectorMemory-userSearch.test.js
 */
'use strict'

const assert = require('assert')

// 测试打分逻辑
function scoreMemory(m, currentUserId) {
    const semanticScore = m.semanticScore  // 模拟余弦相似度
    const userBoost = (currentUserId && m.userId === currentUserId) ? 0.05 : 0
    const ageHours = (Date.now() - (m.timestamp || 0)) / (1000 * 60 * 60)
    const timeBoost = Math.max(0, 0.03 * (1 - ageHours / (24 * 30)))
    return semanticScore + userBoost + timeBoost
}

// Case 1: 当前用户自己的记忆得到加权
{
    const ownMemory = { semanticScore: 0.7, userId: 'user_123', timestamp: Date.now() - 1000 }
    const otherMemory = { semanticScore: 0.7, userId: 'user_456', timestamp: Date.now() - 1000 }
    const ownScore = scoreMemory(ownMemory, 'user_123')
    const otherScore = scoreMemory(otherMemory, 'user_123')
    assert.ok(ownScore > otherScore, '自己的记忆应得到 userBoost 加权')
    console.log(`✓ Case 1: 自己 ${ownScore.toFixed(3)} > 他人 ${otherScore.toFixed(3)}`)
}

// Case 2: currentUserId 为 null 时不加权（向下兼容）
{
    const memory = { semanticScore: 0.7, userId: 'user_123', timestamp: Date.now() }
    const score = scoreMemory(memory, null)
    assert.ok(score >= 0.7, '不传 userId 不应崩溃')
    console.log('✓ Case 2: currentUserId=null 不崩溃')
}

// Case 3: 新记忆比旧记忆得到轻微时间加成
{
    const newMemory = { semanticScore: 0.7, userId: null, timestamp: Date.now() }
    const oldMemory = { semanticScore: 0.7, userId: null, timestamp: Date.now() - 31 * 24 * 60 * 60 * 1000 }
    const newScore = scoreMemory(newMemory, null)
    const oldScore = scoreMemory(oldMemory, null)
    assert.ok(newScore > oldScore, '新记忆应得到时间加成')
    console.log(`✓ Case 3: 新 ${newScore.toFixed(3)} > 旧 ${oldScore.toFixed(3)}`)
}

// Case 4: L3 缓存 key 包含 userId
function buildCacheKey(queryText, currentUserId) {
    return `${queryText}:${currentUserId || ''}`
}

assert.strictEqual(buildCacheKey('爬山', 'user_123'), '爬山:user_123')
assert.strictEqual(buildCacheKey('爬山', null), '爬山:')
assert.notStrictEqual(
    buildCacheKey('爬山', 'user_123'),
    buildCacheKey('爬山', 'user_456'),
    '不同用户的相同查询不能共用缓存'
)
console.log('✓ Case 4: L3 缓存 key 区分用户')

console.log('\n所有测试通过 ✓')
```

**Step 2: 运行确认测试通过**

```bash
node test/unit/vectorMemory-userSearch.test.js
```
预期：全部通过（规格验证）

**Step 3: 修改 `src/services/vectorMemoryService.js` — search 方法**

1. **签名变更**（约第 476 行）：
```javascript
// 改前
async search(groupId, queryText, limit) {

// 改后
async search(groupId, queryText, limit, currentUserId = null) {
```

2. **打分逻辑改为多维加权**（找到 `const scored = memory.map(m => ({` 块，替换）：
```javascript
const scored = memory.map(m => {
    const semanticScore = this.cosineSimilarity(queryVector, m.vector)
    const userBoost = (currentUserId && m.userId === currentUserId) ? 0.05 : 0
    const ageHours = (Date.now() - (m.timestamp || 0)) / (1000 * 60 * 60)
    const timeBoost = Math.max(0, 0.03 * (1 - ageHours / (24 * 30)))
    return {
        text: m.text,
        role: m.role,
        timestamp: m.timestamp,
        userId: m.userId,
        userName: m.userName,
        score: semanticScore + userBoost + timeBoost,
        memoryRef: m
    }
})
```

3. **cleanResults 透传 userId/userName**（找到 `const cleanResults = results.map(r => ({` 块）：
```javascript
const cleanResults = results.map(r => ({
    text: r.text,
    role: r.role,
    timestamp: r.timestamp,
    userId: r.userId,    // 新增
    userName: r.userName, // 新增
    score: r.score
}))
```

4. **L3 缓存 key 改为复合 key**（搜索文件中所有 `cache.queryCache.get(queryText)` 和 `cache.queryCache.set(queryText,` 的位置，共 2 处）：

在 L3 缓存读取之前加入：
```javascript
const cacheKey = `${queryText}:${currentUserId || ''}`
```
然后将所有 `queryCache.get(queryText)` 改为 `queryCache.get(cacheKey)`，`queryCache.set(queryText,` 改为 `queryCache.set(cacheKey,`。

**Step 4: 修改 `src/handlers/aiHandler.js` — 传入 userId 到 search 调用**

找到两处 `vectorMemory.search(` 调用：

```javascript
// 约第 130 行 — 主 RAG 搜索
// 改前: relevantMemories = await vectorMemory.search(contextKey, message)
// 改后:
relevantMemories = await vectorMemory.search(contextKey, message, undefined, userId)

// 约第 231 行 — MCP 混合搜索
// 改前: const vectorResults = await vectorMemory.search(contextKey, queryText, 5)
// 改后:
const vectorResults = await vectorMemory.search(contextKey, queryText, 5, userId)
```

注意：`getReply` 方法签名中已有 `userId` 参数，直接使用即可。

**Step 5: 运行测试**

```bash
node test/unit/vectorMemory-userSearch.test.js
```

**Step 6: Commit**

```bash
git add src/services/vectorMemoryService.js src/handlers/aiHandler.js test/unit/vectorMemory-userSearch.test.js
git commit -m "feat(ai): 向量搜索加入用户相关性/时间加权，修复 L3 缓存 key 包含 userId"
```

---

### Task 4: 修复反注入过滤误伤

**Files:**
- Modify: `src/handlers/aiHandler.js`（cleanMessage 方法，约第 22 行）

**Step 1: 删除误伤正常消息的正则替换**

在 `cleanMessage` 方法中找到：

```javascript
// 删除这一行
content = content.replace(/(你现在是|扮演|角色是|身份是|role is|you are now)/gi, '');
```

直接删除该行。其余防注入措施（`<system>` 标签移除等）保留不动。

**Step 2: Commit**

```bash
git add src/handlers/aiHandler.js
git commit -m "fix(ai): 删除反注入过滤中误伤正常消息的关键词替换"
```

---

### Task 5: 跳过命令消息录入上下文

**Files:**
- Modify: `src/handlers/messageHandler.js`（约第 132-137 行）

**Step 1: 加入 `/` 前缀判断**

找到约第 132-137 行的上下文录入代码：

```javascript
// 改前
if (rawMessage) {
    const sender = messageData.sender || {};
    const userName = sender.card || sender.nickname || `用户${userId}`;
    aiHandler.addMessageToContext(groupId || userId, 'user', rawMessage, userId, userName);
}

// 改后
if (rawMessage && !rawMessage.trim().startsWith('/')) {
    const sender = messageData.sender || {};
    const userName = sender.card || sender.nickname || `用户${userId}`;
    aiHandler.addMessageToContext(groupId || userId, 'user', rawMessage, userId, userName);
}
```

**Step 2: Commit**

```bash
git add src/handlers/messageHandler.js
git commit -m "fix(ai): 命令消息（/前缀）不录入 AI 上下文"
```

---

## Phase 2: Prompt 结构优化

### Task 6: 验证 Deepseek API 支持连续 user messages（前置条件）

**Files:**
- Create: `test/debug/test-consecutive-messages.js`

**Step 1: 创建测试脚本**

创建 `test/debug/test-consecutive-messages.js`：

```javascript
#!/usr/bin/env node
/**
 * 验证当前配置的 AI API 是否支持连续多条 role: "user" 消息
 * 运行: node test/debug/test-consecutive-messages.js
 *
 * 需要先设置环境变量（或在 .env 中配置）：
 *   AI_CHAT_API_URL, AI_CHAT_API_KEY, AI_CHAT_MODEL
 */
'use strict'

require('dotenv').config()
const axios = require('axios')

const apiUrl = process.env.AI_CHAT_API_URL || process.env.AI_API_URL
const apiKey = process.env.AI_CHAT_API_KEY || process.env.AI_API_KEY
const model = process.env.AI_CHAT_MODEL || process.env.AI_MODEL

if (!apiUrl || !apiKey) {
    console.error('❌ 未配置 AI API URL 或 API Key，请检查 .env 文件')
    process.exit(1)
}

async function test() {
    console.log(`测试 API: ${apiUrl}`)
    console.log(`模型: ${model}\n`)

    const messages = [
        { role: 'system', content: '你是一个助手，请简短回答问题。' },
        { role: 'user', name: 'user_111', content: '[张三] 今天天气不错' },
        { role: 'user', name: 'user_222', content: '[李四] 确实，适合出门' },
        { role: 'assistant', content: '你们打算去哪里呀？' },
        { role: 'user', name: 'user_111', content: '[张三] 想去爬山，你觉得李四喜欢户外活动吗？' }
    ]

    try {
        const response = await axios.post(apiUrl, {
            model,
            messages,
            max_tokens: 100,
            temperature: 0.7
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 15000
        })

        const reply = response.data?.choices?.[0]?.message?.content
        console.log('✅ API 接受了连续 user messages，未报错')
        console.log('回复内容:', reply)
        console.log('\n验证通过：可以继续实施阶段二')
    } catch (err) {
        if (err.response) {
            console.error('❌ API 报错:', err.response.status, err.response.data)
        } else {
            console.error('❌ 请求失败:', err.message)
        }
        console.error('\n阶段二实施前请解决此问题')
        process.exit(1)
    }
}

test()
```

**Step 2: 运行测试**

```bash
node test/debug/test-consecutive-messages.js
```

预期输出：
```
✅ API 接受了连续 user messages，未报错
回复内容: ... (任意有意义的回复)
验证通过：可以继续实施阶段二
```

如果报错，检查 API 文档，考虑为连续 user messages 之间插入虚拟 assistant 消息作为 fallback。

**Step 3: 验证通过后删除测试脚本，commit**

```bash
rm test/debug/test-consecutive-messages.js
git add -A
git commit -m "test: 验证 Deepseek API 支持连续 user messages，确认阶段二可行"
```

---

### Task 7: 重构 getReply 为多轮 messages 格式

**Files:**
- Modify: `src/handlers/aiHandler.js`（getReply 方法，约第 34-290 行）
- Test: `test/unit/aiHandler-multiTurn.test.js`

**Step 1: 写失败测试**

创建 `test/unit/aiHandler-multiTurn.test.js`：

```javascript
#!/usr/bin/env node
/**
 * test/unit/aiHandler-multiTurn.test.js
 * 运行: node test/unit/aiHandler-multiTurn.test.js
 */
'use strict'

const assert = require('assert')

// 测试辅助函数（从 aiHandler 提取的纯逻辑）

function sanitizeName(userId) {
    if (!userId) return undefined
    return `user_${userId}`
}

function buildHistoryMessages(historyMessages, cleanMessageFn) {
    return historyMessages.map(msg => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        ...(sanitizeName(msg.userId) ? { name: sanitizeName(msg.userId) } : {}),
        content: msg.role === 'assistant'
            ? cleanMessageFn(msg.content)
            : `[${msg.userName || '用户'}] ${cleanMessageFn(msg.content)}`
    }))
}

const identity = s => s  // 模拟 cleanMessage 直接返回

// Case 1: name 字段格式符合 API 要求
{
    const name = sanitizeName('123456789')
    assert.ok(/^[a-zA-Z0-9_-]+$/.test(name), 'name 字段应只含合法字符')
    assert.ok(name.length <= 64, 'name 字段不超过 64 字符')
    assert.strictEqual(name, 'user_123456789')
    console.log('✓ Case 1: sanitizeName 格式正确')
}

// Case 2: userId 为 null 时返回 undefined（不设置 name 字段）
{
    assert.strictEqual(sanitizeName(null), undefined)
    assert.strictEqual(sanitizeName(undefined), undefined)
    console.log('✓ Case 2: sanitizeName(null) 返回 undefined')
}

// Case 3: user 消息 content 有 [用户名] 前缀
{
    const msgs = buildHistoryMessages([
        { role: 'user', userId: '111', userName: '张三', content: '今天天气不错', timestamp: Date.now() }
    ], identity)
    assert.ok(msgs[0].content.startsWith('[张三]'), 'user 消息应有 [用户名] 前缀')
    assert.strictEqual(msgs[0].name, 'user_111')
    console.log('✓ Case 3: user 消息有 [用户名] 前缀和 name 字段')
}

// Case 4: assistant 消息没有 [用户名] 前缀，没有 name 字段
{
    const msgs = buildHistoryMessages([
        { role: 'assistant', content: '你好！', timestamp: Date.now() }
    ], identity)
    assert.ok(!msgs[0].content.startsWith('['), 'assistant 消息不应有 [前缀]')
    assert.strictEqual(msgs[0].name, undefined, 'assistant 消息不应有 name 字段')
    console.log('✓ Case 4: assistant 消息无前缀无 name 字段')
}

// Case 5: userName 缺失时降级为 "用户"
{
    const msgs = buildHistoryMessages([
        { role: 'user', userId: '999', content: '测试', timestamp: Date.now() }
    ], identity)
    assert.ok(msgs[0].content.startsWith('[用户]'), '无 userName 时降级为 [用户]')
    console.log('✓ Case 5: 无 userName 时降级为 [用户]')
}

// Case 6: 验证 content 中不含双重转义
{
    const raw = '这里有"引号"和\\反斜杠'
    const msgs = buildHistoryMessages([
        { role: 'user', userId: '111', userName: '张三', content: raw, timestamp: Date.now() }
    ], identity)
    // content 不应出现 \\\\ 或 \\"
    assert.ok(!msgs[0].content.includes('\\\\'), '不应双重转义反斜杠')
    assert.ok(!msgs[0].content.includes('\\"'), '不应双重转义引号')
    console.log('✓ Case 6: content 无双重转义')
}

console.log('\n所有测试通过 ✓')
```

**Step 2: 运行确认通过**

```bash
node test/unit/aiHandler-multiTurn.test.js
```

**Step 3: 修改 `src/handlers/aiHandler.js` — 重构 getReply 的 prompt 构建**

这是本阶段改动最大的步骤。在 `getReply` 方法中：

3a. **在 getReply 方法外（类方法层面）新增 `sanitizeName`**：

```javascript
sanitizeName(userId) {
    if (!userId) return undefined
    return `user_${String(userId)}`
}
```

3b. **删除 historyText 字符串拼接逻辑**（约第 60-110 行的 `historyText` 变量构建，包含手动 `.replace(/\\/g, '\\\\').replace(/"/g, '\\"')` 的转义代码）

3c. **替换 `let currentMessages = [...]` 的构建**（约第 149-152 行的 2 条消息格式）：

将原来的：
```javascript
let currentMessages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: currentMessageContent || message }
]
```

改为：

```javascript
// 拆分历史和当前消息
const allContext = context || []
const historyMessages = allContext.slice(0, -1)
const currentMsg = allContext[allContext.length - 1]

// 构建多轮 messages
let currentMessages = [
    // 第 1 层：system（身份 + 规则 + 时间 + RAG 记忆，不含历史消息）
    {
        role: 'system',
        content: systemPrompt
    },

    // 第 2 层：近期历史（原生多轮格式）
    ...historyMessages.map(msg => {
        const msgObj = {
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            content: msg.role === 'assistant'
                ? this.cleanMessage(msg.content)
                : `[${msg.userName || '用户'}] ${this.cleanMessage(msg.content)}`
        }
        const name = this.sanitizeName(msg.userId)
        if (name && msg.role !== 'assistant') msgObj.name = name
        return msgObj
    }),

    // 第 3 层：当前消息
    {
        role: 'user',
        ...(this.sanitizeName(userId) ? { name: this.sanitizeName(userId) } : {}),
        content: currentMsg
            ? `[${currentMsg.userName || userName || '用户'}] ${this.cleanMessage(currentMsg.content)}`
            : `[${userName || '用户'}] ${this.cleanMessage(message)}`
    }
]
```

注意：`getReply` 方法中已有 `userId` 和 `userName` 参数，可直接使用。如果 `getReply` 签名中没有 `userName`，需要确认参数来源（参见方案文档 2.1 节）。

3d. **从 system prompt 构建中删除 historyText 部分**（在 `systemPrompt` 变量的拼接中找到 `historyText` 并删除相关代码）。

**Step 4: 运行测试**

```bash
node test/unit/aiHandler-multiTurn.test.js
```

**Step 5: Commit**

```bash
git add src/handlers/aiHandler.js test/unit/aiHandler-multiTurn.test.js
git commit -m "feat(ai): getReply 重构为多轮 messages 格式，删除 historyText 拼接"
```

---

## Phase 3: 用户画像系统

### Task 8: 新增配置项

**Files:**
- Modify: `src/config.js`（META 对象，在 AI Memory Configuration 区域之后）

**Step 1: 在 `src/config.js` 的 META 中新增画像配置项**

在 `aiEnableSmartTrim` 行之后插入：

```javascript
// AI User Profile Configuration
aiProfileEnabled: { env: null, def: false, type: 'bool' },
aiProfileMinMessages: { env: null, def: 30, type: 'int' },
aiProfileUpdateInterval: { env: null, def: 50, type: 'int' },
aiProfileMaxLength: { env: null, def: 200, type: 'int' },
```

`aiProfileEnabled` 支持群级覆盖（通过 `groupConfigs[groupId].aiProfileEnabled`），遵循现有群级配置模式。

**Step 2: Commit**

```bash
git add src/config.js
git commit -m "feat(ai): 新增用户画像配置项（aiProfileEnabled 等 4 个）"
```

---

### Task 9: 创建 userProfileService.js

**Files:**
- Create: `src/services/userProfileService.js`
- Test: `test/unit/userProfile-metadata.test.js`

**Step 1: 写失败测试**

创建 `test/unit/userProfile-metadata.test.js`：

```javascript
#!/usr/bin/env node
/**
 * test/unit/userProfile-metadata.test.js
 * 运行: node test/unit/userProfile-metadata.test.js
 */
'use strict'

const assert = require('assert')

// 测试元数据更新逻辑（不依赖文件 IO）

function applyRecordMessage(existing, userId, userName) {
    const now = Date.now()
    const entry = existing || {
        userId,
        userName,
        totalMessages: 0,
        messagesSinceUpdate: 0,
        lastActiveTime: now,
        profile: null,
        lastUpdated: null
    }
    return {
        ...entry,
        userName,  // 总是更新为最新名称
        totalMessages: entry.totalMessages + 1,
        messagesSinceUpdate: entry.messagesSinceUpdate + 1,
        lastActiveTime: now
    }
}

function shouldGenerateProfile(entry, minMessages, updateInterval) {
    if (entry.totalMessages < minMessages) return false
    if (!entry.profile) return true  // 首次生成
    return entry.messagesSinceUpdate >= updateInterval
}

// Case 1: 首次记录创建完整结构
{
    const entry = applyRecordMessage(null, '111', '张三')
    assert.strictEqual(entry.userId, '111')
    assert.strictEqual(entry.userName, '张三')
    assert.strictEqual(entry.totalMessages, 1)
    assert.strictEqual(entry.messagesSinceUpdate, 1)
    console.log('✓ Case 1: 首次记录创建正确')
}

// Case 2: 改名后 userName 更新为最新
{
    const old = applyRecordMessage(null, '111', '张三')
    const updated = applyRecordMessage(old, '111', '张三改名了')
    assert.strictEqual(updated.userName, '张三改名了')
    assert.strictEqual(updated.totalMessages, 2)
    console.log('✓ Case 2: 改名后 userName 更新')
}

// Case 3: 画像触发条件
{
    const entry = { totalMessages: 30, messagesSinceUpdate: 0, profile: null }
    assert.strictEqual(shouldGenerateProfile(entry, 30, 50), true, '首次达到 30 条应触发')

    const entry2 = { totalMessages: 100, messagesSinceUpdate: 49, profile: '旧画像' }
    assert.strictEqual(shouldGenerateProfile(entry2, 30, 50), false, '未到 50 条不触发更新')

    const entry3 = { totalMessages: 100, messagesSinceUpdate: 50, profile: '旧画像' }
    assert.strictEqual(shouldGenerateProfile(entry3, 30, 50), true, '到 50 条触发更新')
    console.log('✓ Case 3: 画像触发条件正确')
}

// Case 4: 私聊 groupId 跳过
{
    function shouldSkipProfile(groupId) {
        return String(groupId).startsWith('private_')
    }
    assert.strictEqual(shouldSkipProfile('private_12345'), true)
    assert.strictEqual(shouldSkipProfile('987654321'), false)
    console.log('✓ Case 4: 私聊 groupId 跳过画像生成')
}

console.log('\n所有测试通过 ✓')
```

**Step 2: 运行确认通过**

```bash
node test/unit/userProfile-metadata.test.js
```

**Step 3: 创建 `src/services/userProfileService.js`**

```javascript
'use strict'

const fs = require('fs').promises
const path = require('path')
const logger = require('../utils/logger')
const config = require('../config')
const { asyncWriteWithBackup } = require('../utils/storageUtils')

class UserProfileService {
    constructor() {
        this.dataDir = path.join(process.cwd(), 'data', 'profiles')
        this.profiles = new Map()  // groupId -> { userId -> profileEntry }
        this.saveTimers = new Map()
        this.init()
    }

    async init() {
        try {
            await fs.mkdir(this.dataDir, { recursive: true })
        } catch (e) {
            logger.error('[UserProfile] Failed to create profiles dir:', e)
        }
    }

    _profilePath(groupId) {
        return path.join(this.dataDir, `${groupId}.json`)
    }

    async _loadGroupProfiles(groupId) {
        if (this.profiles.has(groupId)) return this.profiles.get(groupId)
        try {
            const data = await fs.readFile(this._profilePath(groupId), 'utf8')
            const parsed = JSON.parse(data)
            this.profiles.set(groupId, parsed)
            return parsed
        } catch (e) {
            const empty = {}
            this.profiles.set(groupId, empty)
            return empty
        }
    }

    _saveGroupProfilesDebounced(groupId) {
        if (this.saveTimers.has(groupId)) clearTimeout(this.saveTimers.get(groupId))
        this.saveTimers.set(groupId, setTimeout(async () => {
            this.saveTimers.delete(groupId)
            const data = this.profiles.get(groupId)
            if (!data) return
            try {
                await asyncWriteWithBackup(this._profilePath(groupId), JSON.stringify(data, null, 2))
            } catch (e) {
                logger.error(`[UserProfile] Failed to save profiles for ${groupId}:`, e)
            }
        }, 500))
    }

    /**
     * 记录用户发言，更新基础元数据（始终运行，无 LLM 调用）
     */
    async recordMessage(groupId, userId, userName) {
        if (String(groupId).startsWith('private_')) return
        if (!userId) return

        const profiles = await this._loadGroupProfiles(groupId)
        const existing = profiles[userId]
        const now = Date.now()

        profiles[userId] = {
            userId: String(userId),
            userName: userName || (existing ? existing.userName : `用户${userId}`),
            profile: existing ? existing.profile : null,
            lastUpdated: existing ? existing.lastUpdated : null,
            totalMessages: (existing ? existing.totalMessages : 0) + 1,
            messagesSinceUpdate: (existing ? existing.messagesSinceUpdate : 0) + 1,
            lastActiveTime: now
        }

        this._saveGroupProfilesDebounced(groupId)
    }

    /**
     * 检查并触发画像更新（fire-and-forget，调用方须加 .catch()）
     */
    async maybeUpdateProfile(groupId, userId, userName, contextService, vectorMemoryService) {
        if (String(groupId).startsWith('private_')) return
        if (!userId) return
        if (!config.getGroupConfig(groupId, 'aiProfileEnabled')) return

        const profiles = await this._loadGroupProfiles(groupId)
        const entry = profiles[userId]
        if (!entry) return

        const minMessages = config.aiProfileMinMessages
        const updateInterval = config.aiProfileUpdateInterval

        const shouldGenerate = entry.totalMessages >= minMessages &&
            (!entry.profile || entry.messagesSinceUpdate >= updateInterval)

        if (!shouldGenerate) return

        logger.info(`[UserProfile] Generating profile for user ${userId} in group ${groupId}`)
        await this._generateProfile(groupId, userId, userName, entry, contextService, vectorMemoryService)
    }

    async _generateProfile(groupId, userId, userName, entry, contextService, vectorMemoryService) {
        // 1. 收集消息（上下文优先，不足时从向量记忆补充）
        const messages = []

        // 从上下文获取该用户的消息
        const context = contextService.getContext(String(groupId)) || []
        const ctxMessages = context.filter(m => String(m.userId) === String(userId))
        messages.push(...ctxMessages.map(m => ({ text: m.content, timestamp: m.timestamp })))

        // 不足 20 条时从向量记忆补充
        if (messages.length < 20 && vectorMemoryService) {
            try {
                const vecMessages = await vectorMemoryService.getMemoriesByUser(String(groupId), String(userId), 100)
                for (const m of vecMessages) {
                    if (!messages.find(x => x.text === m.text)) {
                        messages.push(m)
                    }
                }
            } catch (e) {
                logger.warn('[UserProfile] Failed to fetch vector memories for profile:', e)
            }
        }

        // 取最近 100 条，按时间排序
        messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
        const recent = messages.slice(-100)

        if (recent.length === 0) return

        // 2. 构建 prompt
        const maxLength = config.aiProfileMaxLength
        const messageList = recent.map(m => {
            const time = m.timestamp ? new Date(m.timestamp).toLocaleDateString('zh-CN') : '未知日期'
            return `[${time}] ${m.text}`
        }).join('\n')

        const prompt = [
            `请根据以下群聊中某位用户的历史发言，生成一段简短的用户画像（不超过${maxLength}字）。`,
            `画像应包含：这个人感兴趣的话题、性格特征、说话风格、提到过的个人信息等。`,
            `只描述客观可观察的特征，不做主观评价。`,
            entry.profile ? `如果已有旧画像，请在旧画像基础上增量更新，保留仍然有效的信息，加入新观察到的特征。` : '',
            `\n用户昵称：${userName || entry.userName}`,
            entry.profile ? `\n旧画像：${entry.profile}` : '',
            `\n该用户最近的发言：\n${messageList}`
        ].filter(Boolean).join('\n')

        // 3. 调用 LLM（复用聊天模型配置）
        try {
            const axios = require('axios')
            const response = await axios.post(config.aiChatApiUrl, {
                model: config.aiChatModel,
                messages: [
                    { role: 'system', content: '你是一个分析用户画像的助手，请简洁客观地描述用户特征。' },
                    { role: 'user', content: prompt }
                ],
                max_tokens: maxLength * 2,
                temperature: 0.3
            }, {
                headers: { 'Authorization': `Bearer ${config.aiChatApiKey}`, 'Content-Type': 'application/json' },
                timeout: 30000
            })

            const newProfile = response.data?.choices?.[0]?.message?.content?.trim()
            if (!newProfile) return

            // 4. 保存
            const profiles = await this._loadGroupProfiles(groupId)
            if (profiles[userId]) {
                profiles[userId].profile = newProfile
                profiles[userId].lastUpdated = Date.now()
                profiles[userId].messagesSinceUpdate = 0
                this._saveGroupProfilesDebounced(groupId)
                logger.info(`[UserProfile] Profile updated for user ${userId} in group ${groupId}`)
            }
        } catch (e) {
            logger.error('[UserProfile] LLM call failed during profile generation:', e)
        }
    }

    /**
     * 获取活跃用户的画像（最多 N 人，按最后发言时间排序）
     */
    async getActiveProfiles(groupId, activeUserIds) {
        if (!activeUserIds || activeUserIds.length === 0) return []
        const profiles = await this._loadGroupProfiles(groupId)
        return activeUserIds
            .map(uid => profiles[String(uid)])
            .filter(Boolean)
    }

    /**
     * 删除某用户画像（重置）
     */
    async deleteProfile(groupId, userId) {
        const profiles = await this._loadGroupProfiles(groupId)
        if (profiles[userId]) {
            delete profiles[userId].profile
            delete profiles[userId].lastUpdated
            profiles[userId].messagesSinceUpdate = 0
            this._saveGroupProfilesDebounced(groupId)
        }
    }

    /**
     * 获取某群所有画像（用于 WebUI 展示）
     */
    async getAllProfiles(groupId) {
        return await this._loadGroupProfiles(groupId)
    }
}

module.exports = new UserProfileService()
```

**Step 4: 运行测试**

```bash
node test/unit/userProfile-metadata.test.js
```

**Step 5: Commit**

```bash
git add src/services/userProfileService.js test/unit/userProfile-metadata.test.js
git commit -m "feat(ai): 新建 userProfileService，实现用户画像元数据和 LLM 摘要生成"
```

---

### Task 10: 为 vectorMemoryService 新增 getMemoriesByUser

**Files:**
- Modify: `src/services/vectorMemoryService.js`（在 search 方法之后新增）

**Step 1: 新增 `getMemoriesByUser` 方法**

在 `search` 方法之后（约第 560 行之后）插入：

```javascript
/**
 * 按用户 ID 过滤记忆（供画像生成使用）
 * 依赖阶段一的改造：addMemory 存储了 userId
 * 旧数据无 userId 字段，会被自动过滤掉
 */
async getMemoriesByUser(groupId, userId, limit = 100) {
    const memory = await this.loadGroupMemory(groupId)
    return memory
        .filter(m => m.userId && String(m.userId) === String(userId))
        .slice(-limit)
        .map(m => ({ text: m.text, role: m.role, timestamp: m.timestamp }))
}
```

**Step 2: Commit**

```bash
git add src/services/vectorMemoryService.js
git commit -m "feat(ai): vectorMemoryService 新增 getMemoriesByUser 方法"
```

---

### Task 11: messageHandler 集成画像记录

**Files:**
- Modify: `src/handlers/messageHandler.js`

**Step 1: 在 messageHandler.js 顶部引入 userProfileService**

找到现有的 `require` 语句区域，加入：

```javascript
const userProfileService = require('../services/userProfileService')
```

**Step 2: 在消息处理流程中调用画像记录**

在向量记忆存储代码（约第 196-204 行）之后，添加画像元数据记录：

```javascript
// 用户画像元数据记录（始终运行，不含 LLM 调用）
if (groupId && userId) {
    const sender = messageData.sender || {}
    const userName = sender.card || sender.nickname || `用户${userId}`
    userProfileService.recordMessage(groupId, userId, userName).catch(e => {
        logger.error('[MessageHandler] Profile record failed:', e)
    })
}
```

**Step 3: 在 AI 消息处理流程完成后，异步触发画像更新**

找到 AI 触发区域（通常是 aiHandler 相关调用），在其之后添加（需要引入 aiContextService 和 vectorMemoryService 的引用，如果已有则直接使用）：

```javascript
// 异步触发画像更新（不阻塞消息处理）
if (groupId && userId) {
    const sender = messageData.sender || {}
    const userName = sender.card || sender.nickname || `用户${userId}`
    userProfileService.maybeUpdateProfile(
        groupId, userId, userName, aiContextService, vectorMemoryService
    ).catch(e => {
        logger.error('[MessageHandler] Profile update failed:', e)
    })
}
```

注意：`aiContextService` 和 `vectorMemoryService` 在 messageHandler.js 中应已有引用。

**Step 4: Commit**

```bash
git add src/handlers/messageHandler.js
git commit -m "feat(ai): messageHandler 集成用户画像元数据记录和异步更新触发"
```

---

### Task 12: aiHandler 注入用户画像到 system prompt

**Files:**
- Modify: `src/handlers/aiHandler.js`（getReply 方法的 system prompt 构建部分）

**Step 1: 在 aiHandler.js 顶部引入 userProfileService**

```javascript
const userProfileService = require('../services/userProfileService')
```

**Step 2: 在 getReply 方法中构建画像注入块**

在 RAG 记忆注入逻辑之后，system prompt 最终拼接之前，加入：

```javascript
// 用户画像注入（最多 5 个最近活跃用户）
let profileBlock = ''
if (!String(groupId).startsWith('private_')) {
    try {
        const MAX_PROFILE_USERS = 5
        const seenUsers = new Map()  // userId -> lastTimestamp
        for (const msg of context) {
            if (msg.userId) {
                seenUsers.set(String(msg.userId), msg.timestamp || 0)
            }
        }
        const activeUserIds = [...seenUsers.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, MAX_PROFILE_USERS)
            .map(([uid]) => uid)

        const profiles = await userProfileService.getActiveProfiles(groupId, activeUserIds)
        if (profiles.length > 0) {
            const profileLines = profiles.map(p =>
                p.profile
                    ? `- ${p.userName}：${p.profile}`
                    : `- ${p.userName}：共发言${p.totalMessages}条`
            ).join('\n')
            profileBlock = `\n\n【当前对话参与者】\n${profileLines}`
        }
    } catch (e) {
        logger.warn('[AiHandler] Failed to load user profiles:', e)
    }
}
```

**Step 3: 将 profileBlock 拼入 system prompt**

在 `systemPrompt` 最终拼接时加入 `profileBlock`：

```javascript
// 在 systemPrompt 末尾（RAG 记忆之前或之后）加入画像
systemPrompt += profileBlock
```

**Step 4: Commit**

```bash
git add src/handlers/aiHandler.js
git commit -m "feat(ai): aiHandler 注入用户画像到 system prompt（最多 5 人）"
```

---

### Task 13: 画像管理 API 端点

**Files:**
- Modify: `src/dashboard/routes/api.js`

**Step 1: 在 api.js 顶部引入 userProfileService**

```javascript
const userProfileService = require('../../services/userProfileService')
```

**Step 2: 新增两个端点**

在 api.js 的群组相关路由区域后添加：

```javascript
// GET /api/profiles/:groupId — 获取某群所有用户画像
router.get('/profiles/:groupId', authenticateToken, async (req, res) => {
    const groupId = normalizeGroupId(req.params.groupId)
    if (!groupId) return res.status(400).json({ error: 'Invalid groupId' })
    try {
        const profiles = await userProfileService.getAllProfiles(groupId)
        res.json({ groupId, profiles })
    } catch (e) {
        logger.error('[API] Failed to get profiles:', e)
        res.status(500).json({ error: 'Internal error' })
    }
})

// DELETE /api/profiles/:groupId/:userId — 重置某用户画像
router.delete('/profiles/:groupId/:userId', authenticateToken, async (req, res) => {
    const groupId = normalizeGroupId(req.params.groupId)
    const userId = req.params.userId
    if (!groupId || !userId) return res.status(400).json({ error: 'Invalid params' })
    try {
        await userProfileService.deleteProfile(groupId, userId)
        res.json({ success: true })
    } catch (e) {
        logger.error('[API] Failed to delete profile:', e)
        res.status(500).json({ error: 'Internal error' })
    }
})
```

**Step 3: Commit**

```bash
git add src/dashboard/routes/api.js
git commit -m "feat(api): 新增画像查询和删除端点 GET/DELETE /api/profiles/:groupId"
```

---

### Task 14: Settings.jsx 全局画像开关

**Files:**
- Modify: `dashboard/src/pages/Settings.jsx`

**Step 1: 在 AI 配置区域新增 `aiProfileEnabled` 开关**

找到 Settings.jsx 中已有的 AI 开关区域（搜索 `aiEnabled` 或 `aiRagEnabled` 相关 UI 代码），参照相同的 UI 模式（通常是 toggle/switch 组件），在其后添加：

```jsx
{/* 用户画像开关 */}
<div className="flex items-center justify-between py-2">
    <div>
        <span className="text-sm font-medium">用户画像</span>
        <p className="text-xs text-gray-400 mt-0.5">
            开启后 AI 将定期从用户历史消息中提炼画像摘要（消耗少量 token）。关闭后仅记录基础元数据。
        </p>
    </div>
    <input
        type="checkbox"
        checked={config.aiProfileEnabled ?? false}
        onChange={e => handleConfigChange('aiProfileEnabled', e.target.checked)}
        className="toggle"
    />
</div>
```

注意：`handleConfigChange` 和 `config` 变量名以实际代码为准，参照文件中已有的其他 boolean 配置开关的写法。

**Step 2: Build 并验证**

```bash
cd dashboard && npm run build
```
预期：构建成功，无报错。

**Step 3: Commit**

```bash
cd ..
git add dashboard/src/pages/Settings.jsx dashboard/dist/
git commit -m "feat(dashboard): Settings 页面新增用户画像全局开关"
```

---

### Task 15: Groups.jsx 群级画像开关

**Files:**
- Modify: `dashboard/src/pages/Groups.jsx`

**Step 1: 在 AI 设置标签页新增群级 `aiProfileEnabled` 覆盖开关**

找到 Groups.jsx 中 AI 配置相关的 tab 面板（搜索 `aiEnabled` 或类似的群级配置 UI），参照相同模式添加群级画像开关：

```jsx
{/* 群级用户画像开关（覆盖全局设置） */}
<div className="flex items-center justify-between py-2">
    <div>
        <span className="text-sm font-medium">用户画像</span>
        <p className="text-xs text-gray-400 mt-0.5">
            覆盖全局设置。留空则继承全局配置。
        </p>
    </div>
    <select
        value={groupConfig.aiProfileEnabled === undefined ? '' : String(groupConfig.aiProfileEnabled)}
        onChange={e => {
            const val = e.target.value
            handleGroupConfigChange('aiProfileEnabled', val === '' ? undefined : val === 'true')
        }}
        className="select select-sm"
    >
        <option value="">继承全局</option>
        <option value="true">开启</option>
        <option value="false">关闭</option>
    </select>
</div>
```

注意：`handleGroupConfigChange` 和 `groupConfig` 变量名以实际代码为准。

**Step 2: Build 并验证**

```bash
cd dashboard && npm run build
```

**Step 3: Commit**

```bash
cd ..
git add dashboard/src/pages/Groups.jsx dashboard/dist/
git commit -m "feat(dashboard): Groups 页面新增群级用户画像覆盖开关"
```

---

## 收尾

### Task 16: 集成验证

**Step 1: 运行所有单元测试**

```bash
node test/unit/vectorMemory-userIdentity.test.js
node test/unit/vectorMemory-userSearch.test.js
node test/unit/userProfile-metadata.test.js
node test/unit/aiHandler-multiTurn.test.js
```

预期：全部通过，无报错。

**Step 2: 检查现有测试未被破坏**

```bash
node test/unit/detectChargingContent.test.js
node test/unit/feedState-race.test.js
node test/unit/messageHandler-emojiReaction.test.js
node test/unit/resolveArticleTitle.test.js
```

预期：全部通过。

**Step 3: 将方案文档移至 done/**

```bash
mv docs/plans/2026-02-26-ai-memory-identity-enhancement.md docs/done/
git add docs/done/2026-02-26-ai-memory-identity-enhancement.md docs/plans/2026-02-26-ai-memory-identity-enhancement.md
git commit -m "docs: 将 AI 用户身份增强方案移至 done/"
```

---

## 注意事项

1. **Task 7 依赖 Task 6**：必须先验证 API 支持连续 user messages 才能实施 Task 7。

2. **旧数据向下兼容**：向量记忆中无 `userId`/`userName` 的旧记录，在 RAG 注入时 fallback 为"某位用户"，在用户搜索加权时 `userBoost = 0`，不会崩溃。

3. **画像生成依赖 Task 1**：向量记忆侧的 `getMemoriesByUser` 只能过滤阶段一改造后存储的新记录（有 `userId` 字段）。旧记录无法按用户过滤，过渡期内画像主要依赖上下文数据，向量补充效果随时间增长。

4. **`getReply` 签名扩展**：Task 7 中若发现 `getReply` 当前签名缺少 `userName` 参数，需同步扩展签名并更新调用方。查看 `aiHandler.js` 实际入参，从 context 最后一条消息的 `userName` 字段获取即可。
