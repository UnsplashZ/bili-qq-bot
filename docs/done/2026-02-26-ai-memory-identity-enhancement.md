# AI 记忆系统用户身份增强方案

## 背景

当前 AI 功能的设计意图是：基于群 ID 和用户 ID 形成记忆，在较长的聊天上下文中保持对每个用户的识别和认知。但实际使用中存在记忆混乱、向量记忆效果差、LLM 无法区分不同用户等问题。

本文档对现有 AI 系统做了深入的代码级诊断，列出 6 个结构性问题及其完整的修改方案。

### 已确认的设计决策

- **目标模型/API**：Deepseek API 及其他 OpenAI 兼容接口
- **阶段二方案**：方案 A —— 多轮 messages 格式 + 用户名同时编入 `name` 字段和 `content` 开头，双重保障 API 兼容性
- **阶段三画像方案**：LLM 摘要画像，复用聊天模型（不新增模型配置项）
- **画像开关**：在 WebUI 中提供开关，关闭时降级为结构化元数据方案（零 LLM 调用成本）
- **实施范围**：三个阶段全部实施
- **命令消息**：以 `/` 开头的命令消息不录入 AI 上下文和向量记忆
- **`/AI 新对话` 范围**：只清空对话上下文，不清空向量记忆和用户画像
- **画像数据来源**：优先从上下文获取，不足时从向量记忆补充
- **私聊场景**：自然兼容，画像生成时跳过 `private_` 开头的 groupId

---

## 问题诊断

### 问题 1：向量记忆完全丢失用户身份（严重程度：P0）

**涉及文件：** `src/services/vectorMemoryService.js:348-355`、`src/handlers/messageHandler.js`、`src/handlers/aiHandler.js:286`

**现状：**

向量记忆存储结构中不包含任何用户标识：

```javascript
// vectorMemoryService.js:348-355
memory.push({
    text,           // 纯消息文本
    role,           // "user" 或 "assistant"
    vector,         // embedding 向量
    timestamp,
    accessCount: 1,
    importance: ...
    // 没有 userId，没有 userName
})
```

调用方也未传递用户信息：

```javascript
// messageHandler.js — 存储用户消息
vectorMemory.addMemory(groupId, cleanMsg, 'user')  // 没有传 userId/userName

// aiHandler.js:286 — 存储助手回复
vectorMemory.addMemory(contextKey, reply, 'assistant')
```

RAG 注入时（`aiHandler.js:137-139`），LLM 看到的是无身份标记的记忆：

```javascript
const memoryText = relevantMemories.map(m =>
    `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`
).join('\n')
```

**后果：**

群聊中张三一周前说"我最喜欢吃火锅"，这条记忆存入向量库时丢失了所有用户信息。之后李四问 AI "你知道我喜欢吃什么吗？"，向量搜索匹配到这条记忆，LLM 看到 `User: 我最喜欢吃火锅`，无法判断这是谁说的，很可能把张三的偏好当成李四的回答——记忆张冠李戴。

---

### 问题 2：历史消息被压扁成纯文本塞进 system prompt（严重程度：P1）

**涉及文件：** `aiHandler.js:60-152`

**现状：**

发送给 LLM API 的消息结构只有 2 条 messages：

```javascript
// aiHandler.js:149-152
let currentMessages = [
    { role: 'system', content: systemPrompt },  // 系统指令+历史文本+RAG记忆，全部拼成一个字符串
    { role: 'user', content: currentMessageContent || message }
]
```

所有历史对话被序列化成 system prompt 内的一段纯文本（`aiHandler.js:69-98`）：

```
历史消息：
5分钟前，张三说："今天天气不错"
3分钟前，李四说："确实，适合出门"
1分钟前，AI助手说："你们打算去哪里？"
```

这段文本与系统身份设定、核心规则、RAG 记忆、时间信息全部拼接在同一个 `system` 消息里。

**后果：**

1. **模型丧失多轮对话结构理解。** 现代 LLM 对 `messages` 数组中 `role` 的交替有专门的 attention 优化。把历史压成纯文本放在 system 里，模型只是在"阅读一段描述"，而非"参与一段对话"，对话感和连贯性下降。
2. **"Lost in the Middle" 效应。** system prompt 越长，模型对其中具体指令的遵从度越低。身份设定、核心规则、历史消息、RAG 记忆互相稀释，导致人设不稳定和规则遗忘。
3. **用户身份感知弱化。** 虽然历史文本里标注了"张三说"、"李四说"，但嵌在一大段纯文本中，模型需要自行"阅读理解"来区分用户，远不如从消息结构中直接获得高效。

---

### 问题 3：RAG 记忆注入缺少时间信息（严重程度：P1）

**涉及文件：** `aiHandler.js:137-139`

**现状：**

自动 RAG 注入格式中没有时间戳：

```javascript
// aiHandler.js:137-139
const memoryText = relevantMemories.map(m =>
    `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`
).join('\n')
```

向量搜索结果中实际携带了 `timestamp`（`vectorMemoryService.js:534-539`），但在注入时被忽略。

与此同时，MCP 混合搜索路径（`aiHandler.js:234-235`）反而带了时间：

```javascript
`[Local Memory] ${m.role === 'user' ? 'User' : 'Assistant'} (${new Date(m.timestamp).toLocaleString(...)}): ${m.text}`
```

两条路径注入格式不一致。

**后果：**

LLM 无法判断 RAG 记忆的时效性。用户三个月前说"我不喜欢 Java"，上周说"最近在学 Java 觉得还不错"，如果两条记忆都被召回，模型无法判断哪条更当前有效，可能给出过时的回答。

---

### 问题 4：向量搜索缺少用户相关性加权（严重程度：P1）

**涉及文件：** `vectorMemoryService.js:506-519`

**现状：**

搜索逻辑为纯余弦相似度排序，不考虑任何其他因子：

```javascript
// vectorMemoryService.js:506-519
const scored = memory.map(m => ({
    text: m.text,
    role: m.role,
    timestamp: m.timestamp,
    score: this.cosineSimilarity(queryVector, m.vector),
    memoryRef: m
}))

const results = scored
    .filter(m => m.score > threshold && m.text !== queryText)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
```

搜索过程中不知道"当前是谁在说话"，也不考虑记忆的时间新旧。

**后果：**

张三问"我之前说过什么？"，搜索会匹配群里所有人语义相近的消息，返回结果可能是李四或王五说的。因为"谁问的"这个信息完全没有进入搜索计算。同时，旧记忆和新记忆在排序中地位完全相同。

---

### 问题 5：缺乏用户维度的记忆体系（严重程度：P2）

**涉及文件：** `aiContextService.js:9`、`vectorMemoryService.js:14`

**现状：**

整个系统只有一个存储维度——群组：

```javascript
// aiContextService.js:9
this.contexts = new Map()  // groupId -> [{role, content}, ...]

// vectorMemoryService.js:14
this.memories = new Map()  // groupId -> [{text, role, vector, ...}]
```

没有任何机制支持：
- 按用户检索记忆（"我上周说了什么" 会搜索全群所有人的消息）
- 建立用户画像（用户的偏好、性格、常聊话题的持续认知）
- 用户间记忆的优先级区分

**后果：**

AI 对每个用户没有稳定的"认知基底"。即使向量检索偶尔命中了正确的用户记忆，这种认知也是碎片化的、不连贯的。在活跃群中，20 个用户的消息混杂在一起，AI 对每个人都只有模糊的印象。

---

### 问题 6：反注入过滤误伤正常消息（严重程度：P2）

**涉及文件：** `aiHandler.js:25`

**现状：**

```javascript
// aiHandler.js:25
content = content.replace(/(你现在是|扮演|角色是|身份是|role is|you are now)/gi, '')
```

这个全局正则替换会误伤正常消息：
- "你现在是不是在忙?" → "不是在忙?"
- "你扮演得不错" → "你得不错"
- "他的身份是学生" → "他的学生"

**后果：**

用户的正常消息语义被破坏，存入上下文和向量记忆的内容与用户实际表达不一致，导致 AI 理解偏差。

---

## 修改方案

### 阶段一：基础修复（改动最小，效果最明显）

**改动文件：** `vectorMemoryService.js`、`aiHandler.js`、`messageHandler.js`

#### 1.1 向量记忆存储加入用户身份

**`vectorMemoryService.js` — `addMemory` 方法签名变更：**

```javascript
// 原签名
async addMemory(groupId, text, role)

// 新签名
async addMemory(groupId, text, role, userId = null, userName = null)
```

存储结构新增字段：

```javascript
memory.push({
    text,
    role,
    vector,
    timestamp: Date.now(),
    accessCount: 1,
    importance: ...,
    userId,       // 新增
    userName      // 新增
})
```

Embedding 输入文本加入用户名前缀（让语义空间本身携带用户信息）：

```javascript
const embeddingText = (role === 'user' && userName) ? `${userName}: ${text}` : text
const vector = await this.getEmbedding(embeddingText)
```

**向下兼容：** 旧记忆数据缺少 `userId`/`userName` 字段时，读取时自然为 `undefined`，在注入 prompt 时 fallback 为 `"某位用户"` 即可，无需数据迁移。

**调用方同步修改：**

```javascript
// messageHandler.js — 改为传递用户信息
vectorMemory.addMemory(groupId, cleanMsg, 'user', userId, userName)

// aiHandler.js:286 — 助手回复无需 userId，同时补加 .catch() 防止 unhandled rejection
vectorMemory.addMemory(contextKey, reply, 'assistant').catch(e => {
    logger.error('[AiHandler] Failed to save assistant reply to vector memory:', e)
})
```

#### 1.2 RAG 注入加入时间戳和用户名

**`aiHandler.js:137-139` 修改：**

```javascript
// 原代码
const memoryText = relevantMemories.map(m =>
    `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`
).join('\n')

// 新代码
const memoryText = relevantMemories.map(m => {
    const who = m.userName || (m.role === 'assistant' ? 'AI助手' : '某位用户')
    const when = this.formatRelativeTime(m.timestamp)
    return `(${when}) ${who}: ${m.text}`
}).join('\n')
```

需新增 `formatRelativeTime` 工具方法（复用 `aiHandler.js:72-87` 已有的相对时间逻辑，提取为独立方法），并补充周/月级别以适配 RAG 记忆的长时间跨度：

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

同时统一 MCP 混合搜索路径（`aiHandler.js:234-235`）的格式，与自动 RAG 注入保持一致。

#### 1.3 向量搜索加入用户相关性和时间加权

**`vectorMemoryService.js` — `search` 方法签名变更：**

```javascript
// 原签名
async search(groupId, queryText, limit)

// 新签名
async search(groupId, queryText, limit, currentUserId = null)
```

打分逻辑从纯余弦相似度改为多维加权：

```javascript
const scored = memory.map(m => {
    const semanticScore = this.cosineSimilarity(queryVector, m.vector)

    // 用户相关性加权：当前用户自己的历史记忆轻微加分
    const userBoost = (currentUserId && m.userId === currentUserId) ? 0.05 : 0

    // 时间衰减：越新的记忆微调加分
    const ageHours = (Date.now() - (m.timestamp || 0)) / (1000 * 60 * 60)
    const timeBoost = Math.max(0, 0.03 * (1 - ageHours / (24 * 30)))  // 30 天线性衰减到 0

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

**设计说明：** 语义分数（0-1 范围）仍然是主导因子。用户匹配（+0.05）和时间新鲜度（+0.00~0.03）只做微调，不会打乱基本的语义排序，但在多个结果语义得分接近时，会优先返回当前用户的最近历史。

**`cleanResults` 同步修改（关键）：**

当前 `search` 方法在返回结果前有一道 `cleanResults` 映射（`vectorMemoryService.js:534-539`），会剥离 `memoryRef` 等内部字段。必须在此处同步透传 `userId` 和 `userName`，否则 1.2 的 RAG 注入 `m.userName` 将始终为 `undefined`：

```javascript
// 原代码
const cleanResults = results.map(r => ({
    text: r.text,
    role: r.role,
    timestamp: r.timestamp,
    score: r.score
}));

// 新代码
const cleanResults = results.map(r => ({
    text: r.text,
    role: r.role,
    timestamp: r.timestamp,
    userId: r.userId,       // 新增：透传用户 ID
    userName: r.userName,    // 新增：透传用户名
    score: r.score
}));
```

**调用方同步修改：**

```javascript
// aiHandler.js:130 — 主 RAG 搜索，传入当前用户 ID
relevantMemories = await vectorMemory.search(contextKey, message, undefined, userId)

// aiHandler.js:231 — MCP 混合搜索路径，同样传入 userId
const vectorResults = await vectorMemory.search(contextKey, queryText, 5, userId)
```

**⚠️ L3 查询缓存 key 需同步修改（关键）：**

当前 L3 缓存以 `queryText` 为键。加入 `currentUserId` 参数后，同一查询词由不同用户发起时会产生不同的排序结果（userBoost 不同），但缓存键相同，导致后发起的用户命中先发起用户的排序结果——即张三查"爬山"缓存了对张三有利的排序，李四随后查"爬山"拿到的却是张三视角的结果。

必须将缓存键改为 `${queryText}:${currentUserId || ''}`：

```javascript
// vectorMemoryService.js — L3 缓存存取时使用复合 key
const cacheKey = `${queryText}:${currentUserId || ''}`
// 读取时：cache.queryCache.get(cacheKey)
// 写入时：cache.queryCache.set(cacheKey, { results: cleanResults, expires: ... })
```

#### 1.4 修复反注入过滤误伤

**`aiHandler.js:25` 修改：**

```javascript
// 删除这一行
content = content.replace(/(你现在是|扮演|角色是|身份是|role is|you are now)/gi, '')
```

保留其他合理的防注入措施（`<system>` 标签移除等）。已有的 `CORE_INSTRUCTIONS` 中"身份与边界"规则从 prompt 层面提供了防护，不需要在消息文本层面做粗暴的关键词删除。

#### 1.5 命令消息不录入上下文和向量记忆

当前 `messageHandler.js:136` 在命令分发之前就录入了上下文，导致 `/AI 概率 0.3`、`/订阅用户 12345` 等命令文本出现在 AI 对话历史中。阶段二改为多轮 messages 后这些命令会作为独立的 `role: "user"` 消息更加显眼。

**已有实现说明（无需改签名）：**
`aiContextService.addMessageToContext()` 已经接受 `userId` 和 `userName` 参数并存储，`messageHandler.js` 也已经正确传入这两个参数。此处**只需要加 `/` 前缀判断**，不需要改函数签名：

```javascript
// 跳过命令消息，不录入 AI 上下文（只加这个判断，函数签名不变）
if (rawMessage && !rawMessage.trim().startsWith('/')) {
    aiHandler.addMessageToContext(groupId || userId, 'user', rawMessage, userId, userName)
}
```

向量记忆侧已有类似的 `/` 前缀检查（`messageHandler.js:196`），保持一致。

---

### 阶段二：Prompt 结构优化

**改动文件：** `aiHandler.js`

#### 2.1 重构 prompt 为结构化多层 messages

将 `getReply()` 中的 prompt 构建从"2 条 messages"改为结构化多层。用户名同时写入 `name` 字段（结构层面）和 `content` 开头（文本层面），双重保障：即使 Deepseek 或其他兼容 API 忽略 `name` 字段，LLM 仍能从 content 中识别用户。

```javascript
let currentMessages = [
    // 第 1 层：精简的系统指令 + RAG 记忆 + 用户画像（阶段三加入）
    {
        role: 'system',
        content: [
            systemPromptBase,
            CORE_INSTRUCTIONS,
            timeInfo,
            profileBlock,     // 用户画像（阶段三）
            ragMemoryBlock    // RAG 记忆放在 system 末尾
        ].filter(Boolean).join('\n\n')
    },

    // 第 2 层：近期历史，用原生多轮对话格式
    ...historyMessages.map(msg => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        name: sanitizeName(msg.userId),
        content: msg.role === 'assistant'
            ? this.cleanMessage(msg.content)
            : `[${msg.userName || '用户'}] ${this.cleanMessage(msg.content)}`
    })),

    // 第 3 层：当前消息
    {
        role: 'user',
        name: sanitizeName(currentUserId),
        content: `[${currentUserName}] ${this.cleanMessage(currentMessage.content)}`
    }
]
```

**具体示例 — 群里张三和李四在聊天：**

```json
[
  {
    "role": "system",
    "content": "你是一个可爱的猫娘...\n\n【当前对话参与者】\n- 张三：喜欢编程，养了一只猫\n- 李四：动漫爱好者\n\n<rag_memory>\n(3天前) 张三: 我周末喜欢去爬山\n</rag_memory>"
  },
  {
    "role": "user",
    "name": "user_123",
    "content": "[张三] 今天天气不错"
  },
  {
    "role": "user",
    "name": "user_456",
    "content": "[李四] 确实，适合出门"
  },
  {
    "role": "assistant",
    "content": "你们打算去哪里？"
  },
  {
    "role": "user",
    "name": "user_123",
    "content": "[张三] 去爬山吧"
  }
]
```

LLM 从三个层面获取用户身份信息：
1. **`name` 字段**：结构化标识（API 支持时生效）
2. **`content` 中的 `[用户名]` 前缀**：文本层面的标识（任何 API 都生效）
3. **system prompt 中的用户画像**：稳定的认知基底（阶段三加入）

**⚠️ 必须删除现有的手动 JSON 转义：**

当前 `getReply` 在构建纯文本历史时对 content 做了手动转义：

```javascript
// 当前代码——改为多轮 messages 格式后必须删除这两行
const safeContent = this.cleanMessage(msg.content)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
```

改为多轮 messages 后，content 字符串由 JSON 序列化器自动处理，保留这段代码会造成双重转义，导致消息内容出现 `\\\\` 和 `\\"` 乱码。

#### 2.2 name 字段的 sanitize

OpenAI API 的 `name` 字段有格式限制：只接受 `[a-zA-Z0-9_-]`，最长 64 字符。使用 userId 作为唯一标识符（稳定、不随改名变化），中文显示名通过 content 前缀传递：

```javascript
function sanitizeName(userId) {
    if (!userId) return undefined
    return `user_${userId}`
}
```

#### 2.3 system prompt 精简

将历史消息从 system prompt 中移出后，system prompt 只包含：
- 身份设定（`systemPromptBase`）
- 核心规则（`CORE_INSTRUCTIONS`）
- 时间参考信息（精简为一行）
- 当前对话参与者画像（阶段三加入）
- RAG 记忆块（如果有）

预期 system prompt 长度从当前的"随历史消息无限膨胀"变为相对固定的范围，减轻 "lost in the middle" 问题。

#### 2.4 群聊中连续 user 消息的处理

群聊中经常出现多个用户连续发言的情况，产生连续多条 `role: "user"` 消息。OpenAI API 明确支持此模式，Deepseek 等兼容接口预期也能正常处理，但需在实施前通过测试脚本验证（见 2.5 前置条件）。`[用户名]` 前缀进一步帮助模型区分不同发言者。

assistant 消息不加用户名前缀，因为 assistant 角色始终是 AI 自身，无歧义。

#### 2.5 兼容性说明

- `name` 字段在不支持的 API 上会被静默忽略，不影响功能。
- 用户名写入 `content` 开头是天然兼容所有 API 的方案，不需要额外的 fallback 开关。
- 多轮 messages 格式下，每条 message 有固定的 token 开销（约 4 tokens/条），相比纯文本历史会略增加 token 消耗，但换来的对话结构理解提升远超这个成本。

**⚠️ 实施前置条件：连续 user messages 需先验证**

Deepseek API 对连续多条 `role: "user"` 消息的处理行为未经实际验证。阶段二实施前，必须先编写一个最小化测试脚本（放在 `test/debug/` 目录），直接调用当前配置的 AI API，发送包含 2-3 条连续 user messages 的请求，确认不报错且回复质量正常后再推进。

---

### 阶段三：用户画像系统

**新增文件：** `src/services/userProfileService.js`
**改动文件：** `aiHandler.js`、`messageHandler.js`、`vectorMemoryService.js`、`config.js`、`src/dashboard/routes/api.js`、`dashboard/src/pages/Settings.jsx`、`dashboard/src/pages/Groups.jsx`

#### 3.1 设计目标

为 AI 提供对每个用户的稳定"认知基底"，不依赖单次向量检索的碎片化匹配。提供两个运行档位：

| 模式 | 说明 | LLM 调用 | 效果 |
|------|------|----------|------|
| **LLM 摘要画像**（开启） | 定期用 LLM 从用户历史消息中提炼画像摘要 | 有（复用聊天模型） | 最好，AI 对每个用户有深度认知 |
| **结构化元数据**（关闭/降级） | 只记录用户基础信息（昵称、消息数、活跃时间） | 无 | 基础，AI 至少知道每个人的存在和活跃度 |

用户在 WebUI 中通过开关切换两种模式。

#### 3.2 数据结构

```javascript
// data/profiles/{groupId}.json
{
    "123456789": {
        "userId": "123456789",
        "userName": "张三",                // 最近一次发言使用的名称，每次发言时更新
        "profile": "经常讨论编程相关话题...",  // LLM 生成的摘要（开启时才有）
        "lastUpdated": 1700000000000,       // 画像上次更新时间
        "messagesSinceUpdate": 0,           // 自上次画像更新后的消息计数
        "totalMessages": 150,               // 在本群的总消息数
        "lastActiveTime": 1700000000000     // 最后活跃时间
    }
}
```

无论画像功能是否开启，`userName`、`totalMessages`、`lastActiveTime` 这三个元数据字段始终更新（零成本）。`profile` 字段只在 LLM 摘要模式开启时才生成和更新。

#### 3.3 画像生成与更新机制

**基础元数据（始终运行）：**

每当用户在群内发消息时，`messageHandler.js` 调用 `userProfileService.recordMessage(groupId, userId, userName)` 更新元数据：
- `userName` 更新为最新名称（解决改名后 LLM 认为是两个人的问题）
- `totalMessages` 自增
- `lastActiveTime` 更新
- `messagesSinceUpdate` 自增

**私聊场景跳过：** 当 `groupId` 以 `private_` 开头时，跳过画像记录和生成。私聊只有 Root 管理员一人，生成画像无意义，避免无效的 LLM 调用。

**LLM 摘要画像（`aiProfileEnabled` 开启时）：**

触发条件：
- 首次生成：`totalMessages` 达到 `aiProfileMinMessages`（默认 30）且 `profile` 字段为空
- 后续更新：`messagesSinceUpdate` 达到 `aiProfileUpdateInterval`（默认 50）

生成流程：
1. **收集消息（两源结合）**：优先从 `aiContextService` 中按 `userId` 过滤该用户最近的消息；如果上下文中该用户的消息不足（少于 20 条），从 `vectorMemoryService` 中按 `userId` 过滤补充。向量记忆保留周期更长，能覆盖上下文因 trim 而丢失的老消息。合并后取最近 100 条。
   - **前提依赖**：向量记忆按 userId 过滤依赖阶段一的改造（`addMemory` 新增 `userId` 参数）。阶段一上线前的存量向量记忆没有 `userId` 字段，无法按用户过滤。这些旧数据会随 smart trim 逐渐被淘汰替换，过渡期内画像生成主要依赖上下文数据，向量补充的效果会随时间增长。
   - **需新增 `vectorMemoryService` 方法**：当前 `vectorMemoryService` 没有按用户过滤记忆的接口，需新增 `getMemoriesByUser` 方法：

```javascript
// vectorMemoryService.js — 新增方法（供阶段三画像生成使用）
async getMemoriesByUser(groupId, userId, limit = 100) {
    const memory = await this.loadGroupMemory(groupId)
    return memory
        .filter(m => m.userId === userId)
        .slice(-limit)
        .map(m => ({ text: m.text, role: m.role, timestamp: m.timestamp }))
}
```
2. 如果已有旧画像（`profile` 字段），一并作为输入
3. 调用 LLM 生成/更新画像摘要，复用 `.env` 中已配置的聊天模型（`AI_API_URL` / `AI_MODEL`），不新增模型配置项
4. 存储 `profile` 字段，重置 `messagesSinceUpdate` 为 0，更新 `lastUpdated`

**画像生成 prompt：**

```
请根据以下群聊中某位用户的历史发言，生成一段简短的用户画像（不超过200字）。
画像应包含：这个人感兴趣的话题、性格特征、说话风格、提到过的个人信息等。
只描述客观可观察的特征，不做主观评价。
如果已有旧画像，请在旧画像基础上增量更新，保留仍然有效的信息，加入新观察到的特征。

用户昵称：{userName}

{旧画像：...（如有）}

该用户最近的发言：
{消息列表，每条带时间}
```

**异步执行：** 画像生成在 `messageHandler.js` 处理完消息后异步触发（`fire-and-forget`），不阻塞消息回复流程。即使画像生成失败，也不影响正常的 AI 对话。必须加 `.catch()` 防止 unhandled rejection：

```javascript
// messageHandler.js — 异步触发画像更新（不阻塞消息处理）
userProfileService.maybeUpdateProfile(groupId, userId, userName).catch(e => {
    logger.error('[MessageHandler] Profile update failed:', e)
})
```

**画像随消息增长而更新的频率估算：**

以一个活跃群（20 人，每人每天 10 条消息）为例：
- 每个用户每 50 条消息更新一次 → 每人约 5 天更新一次
- 整个群每天约 4 次画像更新 LLM 调用
- 每次调用输入约 2000-3000 tokens（100 条消息摘选），输出约 200 tokens
- 成本极低，远小于日常聊天对话的 LLM 调用量

#### 3.4 画像注入方式

在 `aiHandler.js` 的 prompt 构建中，从当前对话窗口中出现过的用户筛选画像注入 system prompt：

```javascript
// 获取最近上下文中出现的用户，按最后发言时间排序，最多取 5 人
const MAX_PROFILE_USERS = 5
const seenUsers = new Map() // userId -> lastTimestamp
for (const msg of context) {
    if (msg.userId) {
        seenUsers.set(msg.userId, msg.timestamp || 0)
    }
}
const activeUserIds = [...seenUsers.entries()]
    .sort((a, b) => b[1] - a[1])   // 按最后发言时间降序
    .slice(0, MAX_PROFILE_USERS)
    .map(([uid]) => uid)

// 加载画像（含降级处理）
const profiles = await userProfileService.getActiveProfiles(groupId, activeUserIds)

if (profiles.length > 0) {
    const profileText = profiles.map(p => {
        if (p.profile) {
            // LLM 摘要模式
            return `- ${p.userName}：${p.profile}`
        } else {
            // 降级模式：结构化元数据
            return `- ${p.userName}：共发言${p.totalMessages}条`
        }
    }).join('\n')
    systemPrompt += `\n\n【当前对话参与者】\n${profileText}`
}
```

**注入上限：** 固定最多注入 5 个用户的画像（按最近发言时间排序截断），不做配置项。20 人活跃群中，5 人 × 200 字 ≈ 1000 tokens，在可控范围内。

#### 3.5 WebUI 管理

**全局设置页面（Settings.jsx）：**

在 AI 配置区域增加"用户画像"开关：
- 开关控制 `aiProfileEnabled`（全局配置项）
- 开关旁显示说明："开启后 AI 将定期从用户历史消息中提炼画像摘要（消耗少量 token）。关闭后仅记录基础元数据。"

**群组管理页面（Groups.jsx）：**

群级配置中支持覆盖全局的画像开关（`groupConfigs[groupId].aiProfileEnabled`），允许特定群开启/关闭。

**Dashboard API（api.js）：**

新增画像相关的 API 端点：
- `GET /api/profiles/:groupId` — 获取某群所有用户画像（用于 WebUI 展示）
- `DELETE /api/profiles/:groupId/:userId` — 删除某用户画像（重置）

#### 3.6 新增配置项

在 `config.js` 的 META 中添加：

| 配置项 | 类型 | 默认值 | 说明 | 作用域 |
|--------|------|--------|------|--------|
| `aiProfileEnabled` | boolean | `false` | 是否启用 LLM 摘要画像。关闭时降级为结构化元数据 | 全局/群级覆盖 |
| `aiProfileMinMessages` | number | `30` | 首次生成画像所需的最低消息数 | 全局 |
| `aiProfileUpdateInterval` | number | `50` | 每隔多少条新消息触发画像更新 | 全局 |
| `aiProfileMaxLength` | number | `200` | 画像摘要最大字符数（写入生成 prompt 中限制输出） | 全局 |

`aiProfileEnabled` 支持群级覆盖（通过 `groupConfigs[groupId].aiProfileEnabled`），其他三个配置项为全局配置。

---

## 实施优先级与依赖关系

```
阶段一（基础修复）─────────────────────────┐
  1.1 向量记忆加入用户身份                  │  改动文件：vectorMemoryService.js,
  1.2 RAG 注入加入时间和用户名              │            aiHandler.js,
  1.3 搜索加入用户相关性加权                │            messageHandler.js
  1.4 修复反注入误伤                        │  向下兼容旧数据，无需迁移
                                            │
阶段二（Prompt 结构优化）──────────────────┤  依赖阶段一（消息已携带用户信息）
  2.1 重构 prompt 为多层 messages           │  改动文件：aiHandler.js
  2.2 name 字段 sanitize                    │  兼容 Deepseek 及所有 OpenAI 兼容 API
  2.3 system prompt 精简                    │
                                            │
阶段三（用户画像系统）─────────────────────┘  依赖阶段一（消息有身份标记）
  3.1 新建 userProfileService.js               新增文件：userProfileService.js
  3.2 元数据记录 + LLM 画像生成/更新           改动文件：messageHandler.js, aiHandler.js,
  3.3 画像注入 prompt                                    config.js, api.js,
  3.4 WebUI 开关 + 画像管理                              Settings.jsx, Groups.jsx
  3.5 新增配置项
```

三个阶段可以顺序实施，也可以阶段一+阶段二合并实施（都是改 `aiHandler.js`），阶段三独立进行。

---

## 边界场景与处理策略

以下是代码审查中发现的边界场景，逐一确认了处理方式：

### 已纳入方案的场景

| 场景 | 处理方式 | 涉及阶段 |
|------|----------|----------|
| 命令消息（`/AI 概率 0.3` 等）录入 AI 上下文 | 录入前检查 `/` 前缀，跳过命令消息 | 阶段一（1.5） |
| 私聊使用合成 groupId（`"private_{userId}"`） | 上下文和向量记忆自然兼容；画像生成时跳过 `private_` 开头的 groupId | 阶段三 |
| `/AI 新对话` 只清上下文不清向量记忆 | 保持现状，"新对话" ≠ "失忆"。画像也不清空 | 不涉及改动 |
| 旧向量记忆数据无 `userId`/`userName` 字段 | 读取时自然为 `undefined`，注入 prompt 时 fallback 为"某位用户"；搜索加权时 userBoost 为 0 | 阶段一 |
| 画像数据来源：上下文可能因 trim 丢失老消息 | 优先取上下文，不足时从向量记忆按 userId 补充（向量记忆保留周期更长） | 阶段三 |
| 用户改名后旧消息保留旧名 | 画像系统每次发言更新 `userName` 为最新值，画像注入时使用最新名称 | 阶段三 |

### 已知限制（本次不修复）

| 场景 | 现状 | 原因 |
|------|------|------|
| AI 上下文录入 rawMessage 在 URL 展开之前，向量记忆录入在展开之后 | 同一条消息在两处的内容略有不同 | 是现有问题，不是本次改造引入的，修复需要调整 messageHandler 的执行顺序，风险较大 |
| MCP 工具调用的中间消息（tool_calls、tool results）不保存到上下文 | AI 下次对话不记得自己调过什么工具 | 属于 MCP 系统的设计问题，与用户身份改造无关 |
| AI 超时/错误返回的消息不录入上下文 | AI 不记得自己曾超时过 | 影响极小，不值得为此增加复杂度 |
| `userId` 为 null 时 `messageHandler.js:103` 的 `.toString()` 可能崩溃 | 系统消息或畸形 payload 可能触发 | 是已有 bug，不在本方案范围内 |

---

## 风险与注意事项

1. **Embedding 文本变更影响相似度：** 阶段一中 embedding 输入从 `"消息文本"` 改为 `"用户名: 消息文本"`，新旧记忆的向量空间不完全一致。但由于旧记忆缺少 `userName` 字段，可以在 embedding 时判断：有 `userName` 则加前缀，没有则保持原样。随着时间推移，新格式记忆会自然替代旧记忆。

2. **Token 消耗增加：** 阶段二的多轮 messages 格式（每条约 +4 tokens 开销）和阶段三的用户画像注入（每个活跃用户约 +50-100 tokens）会增加 prompt 长度。需监控实际 token 消耗，必要时调整 `aiContextLimit` 或 `aiProfileMaxLength`。

3. **画像生成的 LLM 调用成本：** 每个用户每 50 条消息触发一次 LLM 调用，复用聊天模型。活跃群每天约 4 次画像更新调用，成本可控。用户可随时通过 WebUI 关闭画像功能降级为零额外成本模式。

4. **用户名变更问题：** QQ 群名片可能随时更改。阶段三的画像系统通过 `userId` 关联用户，`userName` 在每次发言时更新为最新值，确保画像始终使用最新名称。旧的上下文消息中仍保留旧名，但画像注入的最新名称会帮助 LLM 建立正确关联。

5. **群聊连续 user 消息：** 阶段二中群聊场景经常出现连续多条 `role: "user"` 消息。Deepseek 和主流 OpenAI 兼容 API 均能正常处理此模式，`[用户名]` 前缀和 `name` 字段共同帮助模型区分发言者。

---

## 测试策略

**阶段一测试：**
- 新增单元测试验证 `addMemory` 正确存储 `userId`/`userName`
- 新增单元测试验证向量搜索的用户加权逻辑（相同语义得分下，当前用户的记忆排序更靠前）
- 验证 RAG 注入格式包含时间和用户名
- 验证旧数据（无 `userId` 字段）的向下兼容

**阶段二测试：**
- 验证生成的 messages 数组结构正确（system + 多轮 user/assistant + 当前 user）
- 验证 `name` 字段格式符合 `[a-zA-Z0-9_-]` 限制
- 验证 content 中的 `[用户名]` 前缀正确添加（user 消息有，assistant 消息无）
- 手动测试 Deepseek API 对多轮 messages 的实际响应质量

**阶段三测试：**
- 验证元数据记录：`totalMessages` 自增、`userName` 更新、`lastActiveTime` 更新
- 验证画像触发条件：`totalMessages >= 30` 首次生成、`messagesSinceUpdate >= 50` 后续更新
- 验证 LLM 开关关闭时不发起画像生成调用，但元数据仍然记录
- 验证画像注入不超过活跃用户范围
- WebUI 开关功能测试：全局开关、群级覆盖
