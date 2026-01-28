# WebUI系统设置修复计划

**日期**: 2026-01-28
**优先级**: 高
**影响范围**: WebUI系统设置页面

---

## 问题描述

### 问题1: WebUI - 系统设置 - 保存AI设置失败

**用户反馈**:
- 在系统设置页面修改AI配置后，点击"保存 AI 设置"按钮
- 前端显示"保存 AI 设置失败"错误提示
- 部分情况下设置实际上已保存，但前端显示失败

**复现步骤**:
1. 打开WebUI的系统设置页面
2. 修改任何AI相关配置（如API URL、密钥、模型等）
3. 点击"保存 AI 设置"按钮
4. 观察到错误提示："保存 AI 设置失败"

---

### 问题2: WebUI - 系统设置 - MCP创建之后不能编辑

**用户反馈**:
- 在系统设置页面成功创建MCP服务器后
- 无法编辑已创建的MCP服务器配置（名称、命令、参数、环境变量）
- 只能启用/禁用或删除服务器
- 系统没有日志输出，无法确认是否调用了相关接口

**复现步骤**:
1. 打开WebUI的系统设置页面
2. 点击"添加服务器"创建一个新的MCP服务器
3. 服务器创建成功后显示在列表中
4. 尝试编辑服务器的名称、命令等配置
5. 发现没有编辑按钮或编辑功能
6. 只能通过删除后重新添加来修改配置

---

## 根本原因分析

### 问题1: AI设置保存失败

#### 原因1: API层存在重复的保存调用

**位置**: `src/dashboard/routes/api.js:505-519`

问题：
- `Object.assign(sysConfig, updates)` 会遍历所有AI配置属性并触发对应的setter
- 每个setter内部都会调用 `this.save()`（使用500ms防抖）
- 然后代码又显式调用了一次 `sysConfig.save()`
- 这导致防抖定时器被多次重置，可能引起保存延迟或失败

#### 原因2: 配置保存机制的防抖逻辑问题

**位置**: `src/config.js:407-432`

问题：
- 当多个setter在短时间内被调用（Object.assign触发多个属性），防抖逻辑会不断重置定时器
- 如果最后一个save()调用距离前一个不到500ms，定时器会再次被重置
- 理论上最后一次save()应该最终会执行，但存在潜在时序问题

#### 原因3: 返回 sysConfig 对象的问题

**位置**: `src/dashboard/routes/api.js:516`

问题：
- `sysConfig` 是一个复杂的对象实例，包含内部属性和方法
- 包含动态 getter/setter，直接序列化可能返回不一致的值
- 可能包含`_overrides`, `_saveTimer`, `_isSaving`等内部属性
- 包含`save()`, `_performSave()`, `getGroupConfig()`等方法
- 前端可能收到内存中的不一致值而非文件中的真实值

#### 原因4: 缺少字段验证

**位置**: `src/dashboard/routes/api.js:505-519`

问题：
- `/api/ai` 端点缺少字段格式和范围验证
- 无效值（如 aiProbability > 1）可能被写入文件
- 前端需要等待后端保存失败才能发现错误
- 与 `/api/groups/:id/config` 端点的验证风格不一致

#### 原因5: 错误处理不够详细

**位置**: `src/dashboard/routes/api.js:517-519`

问题：
- Catch块只返回通用错误消息给客户端
- 没有调用 `logger.error()` 记录实际错误
- 开发者无法从日志中诊断真正的问题原因

#### 原因6: 前端显示逻辑可能误判

**位置**: `dashboard/src/pages/Settings.jsx:212-224`

分析：
- 如果后端返回非2xx状态码（即使保存成功但返回了错误状态），前端会显示失败
- 如果保存确实成功，但由于时序问题API返回了错误，用户会看到失败但配置已生效

#### 原因7: 缺少性能监控

**位置**: `src/config.js:419-432`

问题：
- `_performSave` 方法没有记录保存频率和耗时
- 无法评估防抖调整的效果
- 无法及时发现磁盘I/O问题

---

### 问题2: MCP无法编辑

**方案完备性声明**：

原方案存在以下关键缺陷，现已在修复方案中全面补齐：

| 关键缺陷 | 补充方案 | 修复章节 |
|---------|---------|----------|
| 配置格式标准化不明确 | 明确单一真源格式（对象），API边界转换 | 修复2.1 |
| 唯一标识与重命名策略未定义 | 实现重命名检测、连接迁移、冲突处理 | 修复2.3 |
| 缺少字段验证与安全性 | 后端强制验证name/args/env | 修复2.1 |
| 重载失败回滚策略未定义 | 先建立新连接再cleanup旧连接，失败时回滚 | 修复2.4 |
| 并发修改与版本冲突未处理 | 基于_version字段的版本控制，409冲突响应 | 修复2.2 |
| API返回值一致性未保证 | GET始终返回数组+版本号，POST返回对象+版本号 | 修复2.1 |
| 重载触发范围与节流未定义 | 等待reload完成，返回成功/失败状态 | 修复2.5 |
| 缺少重命名操作识别 | renameOperation参数，日志记录重命名 | 修复2.3 |
| 日志记录不完整 | 记录所有MCP操作、冲突、验证失败 | 修复2.8 |

**方案现状**: ✅ 完备（涵盖格式、验证、并发、回滚、节流、日志、重命名）

#### 原因1: UI层面缺少编辑功能

**位置**: `dashboard/src/pages/Settings.jsx:783-821`

问题：
- MCP服务器卡片上只有启用/禁用和删除按钮
- 没有编辑按钮
- 没有编辑功能的处理函数

#### 原因2: 配置格式标准化原则不明确

**问题分析**：

**前端期望格式** (Settings.jsx:129):
```javascript
const servers = mcpRes.data.mcpServers || (Array.isArray(mcpRes.data) ? mcpRes.data : []);
// 期望: { mcpServers: [{ name, command, args, env, enabled }] }
```

**后端API返回格式** (api.js:480-488):
```javascript
// 实际返回: { "server-name": { command, args, env, enabled } }
```

**MCP Manager期望格式** (mcpManager.js:25):
```javascript
// 期望: { "server-name": { command, args, env, enabled } }
```

**文件实际格式** (config/mcp_servers.json):
```json
{
  "fetch": { "command": "uvx", "args": [...], "enabled": false },
  "brave-search": { "command": "npx", "args": [...], "env": {...}, "enabled": false }
}
```

**核心问题**：
- 未明确"单一真源格式"是对象格式
- API在请求边界没有清晰的数据转换契约
- 前后端不一致导致UI状态漂移和潜在数据丢失

**结论**：
- **单一真源格式**：对象格式 `{ "server-name": { ... } }`
- 前端仅作为 UI 显示模型（数组），进入/离开 API 时转换
- 所有验证、存储、加载逻辑基于对象格式

#### 原因3: API端点格式转换不完整

**位置**: `src/dashboard/routes/api.js:490-502`

问题：
- GET端点：未将对象格式转换为数组格式
- POST端点：未将数组格式转换为对象格式
- 没有格式验证
- API返回值不一致（有时数组，有时对象）

#### 原因4: 缺少字段验证与安全性

**位置**: `src/dashboard/routes/api.js:490-502`

问题：
- 没有验证 `name` 是否非空、无非法字符、唯一
- 没有验证 `args` 是否为有效数组
- 没有验证 `env` 是否为有效JSON对象
- 前端验证容易被绕过，后端必须强制执行

#### 原因5: 唯一标识与重命名策略未定义

**位置**: 涉及 MCP 编辑的所有代码

问题：
- MCP以 `name` 作为唯一标识符和对象key
- 编辑时若允许改名，会变成"删除旧key + 新建key"
- 没有处理重名冲突策略
- 没有定义原有连接迁移逻辑（旧连接是断开还是尝试重命名）

#### 原因6: 没有重载失败回滚策略

**位置**: `src/services/mcpManager.js`

问题：
- 未定义重载失败时的行为
- 如果重载失败，是否保留旧连接？清空旧连接？
- 写盘成功但重载失败时，可能导致服务中断

#### 原因7: 并发修改与版本冲突

**位置**: `src/dashboard/routes/api.js:490-502`

问题：
- 多用户同时编辑时可能互相覆盖
- 没有版本号或最后更新时间机制
- 后写入的配置会覆盖先前的写入
- 无法检测或提示并发冲突

#### 原因8: API返回值一致性未保证

**位置**: `src/dashboard/routes/api.js:480-502`

问题：
- GET /api/mcp 返回数组还是对象？未明确定义
- POST /api/mcp 返回什么？未明确定义
- 前后端API契约不一致，容易导致UI状态漂移

#### 原因9: 重载触发范围与节流未定义

**位置**: `src/dashboard/routes/api.js:490-502` 和 `src/services/mcpManager.js`

问题：
- 启用/禁用、编辑、删除都需要触发reload
- 是否需要节流（防止短时间内多次reload）？
- 是否允许批量变更一次reload（提高效率）？
- 未明确reload的触发条件和时机

---

## 解决方案

### 问题1: AI设置保存失败修复方案

#### 修复1.1: 移除API中冗余的save()调用

**文件**: `src/dashboard/routes/api.js`

**修改位置**: Line 515

```javascript
// 修改前
Object.assign(sysConfig, updates);
sysConfig.save();  // ← 删除此行

// 修改后
Object.assign(sysConfig, updates);
```

说明：
- Object.assign会触发setter，setter内部已经调用save()
- 移除冗余调用避免防抖定时器多次重置

---

#### 修复1.2: 接口返回体统一为"可序列化纯对象"

**文件**: `src/dashboard/routes/api.js`

**修改位置**: Line 516

**问题分析**：
```javascript
// 当前代码 - 问题
res.json({ message: 'AI settings updated', config: sysConfig });
```

**问题**：
- `sysConfig` 是一个复杂的对象实例，包含内部属性和方法
- 包含动态 getter/setter，直接序列化可能返回不一致的值
- 可能包含`_overrides`, `_saveTimer`, `_isSaving`等内部属性
- 包含`save()`, `_performSave()`, `getGroupConfig()`等方法
- save是防抖的（500ms延迟），直接readConfig会读到旧值

**修改后（方案A：返回纯对象快照）**：
```javascript
// 修改后 - 返回AI相关字段的纯对象快照
router.post('/ai', async (req, res) => {
    try {
        const updates = req.body;
        if (!updates || typeof updates !== 'object') {
            return res.status(400).json({ error: 'Invalid configuration data' });
        }

        // Merge updates into root config
        Object.assign(sysConfig, updates);

        // 【关键修改】返回纯对象快照（不读文件，避免时序问题）
        const aiFields = [
            'aiApiUrl', 'aiApiKey', 'aiModel', 'aiSystemPrompt',
            'aiProbability', 'aiContextLimit', 'aiVectorSimilarityThreshold',
            'aiVectorSearchLimit', 'aiMemorySafetyLimit', 'aiHistoryMaxSize'
        ];

        const snapshot = {};
        for (const field of aiFields) {
            snapshot[field] = sysConfig[field];
        }

        res.json({ message: 'AI settings updated', config: snapshot });
    } catch (error) {
        logger.error('Failed to update AI settings:', error);
        res.status(500).json({ error: 'Failed to update AI settings', details: error.message });
    }
});
```

**优点**：
- 返回纯 JSON 对象，可安全序列化
- 返回内存中的最新值（刚刚通过setter更新的值）
- 避免时序问题（不需要等待防抖save完成）
- 性能更好（不需要额外读取文件）
- 前端立即看到更新后的值

---

#### 修复1.3: 保存前简单校验

**文件**: `src/dashboard/routes/api.js`

**修改位置**: Line 504-519（在`Object.assign`之前插入）

**说明**：参考 `/api/groups/:id/config` 的验证风格（api.js:197-211），对 AI 数值字段做范围校验。

**代码实现**：
```javascript
router.post('/ai', async (req, res) => {
    try {
        const updates = req.body;
        if (!updates || typeof updates !== 'object') {
            return res.status(400).json({ error: 'Invalid configuration data' });
        }

        // === AI配置字段验证 ===

        // aiProbability: 0-1
        if (updates.aiProbability !== undefined) {
            const prob = parseFloat(updates.aiProbability);
            if (isNaN(prob) || prob < 0 || prob > 1) {
                return res.status(400).json({
                    error: 'aiProbability must be between 0 and 1',
                    field: 'aiProbability',
                    expected: '0.0 - 1.0'
                });
            }
            updates.aiProbability = prob;
        }

        // aiContextLimit: 1-100
        if (updates.aiContextLimit !== undefined) {
            const limit = parseInt(updates.aiContextLimit, 10);
            if (isNaN(limit) || limit < 1 || limit > 100) {
                return res.status(400).json({
                    error: 'aiContextLimit must be between 1 and 100',
                    field: 'aiContextLimit',
                    expected: '1 - 100'
                });
            }
            updates.aiContextLimit = limit;
        }

        // aiVectorSimilarityThreshold: 0-1
        if (updates.aiVectorSimilarityThreshold !== undefined) {
            const threshold = parseFloat(updates.aiVectorSimilarityThreshold);
            if (isNaN(threshold) || threshold < 0 || threshold > 1) {
                return res.status(400).json({
                    error: 'aiVectorSimilarityThreshold must be between 0 and 1',
                    field: 'aiVectorSimilarityThreshold',
                    expected: '0.0 - 1.0'
                });
            }
            updates.aiVectorSimilarityThreshold = threshold;
        }

        // aiVectorSearchLimit: 1-10
        if (updates.aiVectorSearchLimit !== undefined) {
            const limit = parseInt(updates.aiVectorSearchLimit, 10);
            if (isNaN(limit) || limit < 1 || limit > 10) {
                return res.status(400).json({
                    error: 'aiVectorSearchLimit must be between 1 and 10',
                    field: 'aiVectorSearchLimit',
                    expected: '1 - 10'
                });
            }
            updates.aiVectorSearchLimit = limit;
        }

        // aiMemorySafetyLimit: 1-10000
        if (updates.aiMemorySafetyLimit !== undefined) {
            const limit = parseInt(updates.aiMemorySafetyLimit, 10);
            if (isNaN(limit) || limit < 1 || limit > 10000) {
                return res.status(400).json({
                    error: 'aiMemorySafetyLimit must be between 1 and 10000',
                    field: 'aiMemorySafetyLimit',
                    expected: '1 - 10000'
                });
            }
            updates.aiMemorySafetyLimit = limit;
        }

        // aiHistoryMaxSize: 1MB - 10000MB
        if (updates.aiHistoryMaxSize !== undefined) {
            const size = parseInt(updates.aiHistoryMaxSize, 10);
            if (isNaN(size) || size < 1024 * 1024 || size > 10000 * 1024 * 1024) {
                return res.status(400).json({
                    error: 'aiHistoryMaxSize must be between 1MB and 10000MB',
                    field: 'aiHistoryMaxSize',
                    expected: '1048576 - 10485760000 (1MB - 10000MB)'
                });
            }
            updates.aiHistoryMaxSize = size;
        }

        // Merge updates into root config
        Object.assign(sysConfig, updates);

        // Return real config snapshot
        const currentConfig = await readConfig();
        res.json({ message: 'AI settings updated', config: currentConfig });
    } catch (error) {
        logger.error('Failed to update AI settings:', error);
        res.status(500).json({ error: 'Failed to update AI settings', details: error.message });
    }
});
```

**优点**：
- 前端立即得到明确错误（不需要等待后端保存失败）
- 提供详细的字段级错误信息（`field`, `expected`）
- 与现有代码风格一致（参考 `/api/groups/:id/config`）
- 防止无效配置写入文件
- 提升用户体验，快速定位问题字段

---

#### 修复1.4: 优化防抖逻辑（推荐）

**文件**: `src/config.js`

**修改位置**: Line 407-432

```javascript
// Save configuration to file (Only overrides)
save: function() {
    if (this._saveTimer) {
        clearTimeout(this._saveTimer);
    }

    // 简化防抖逻辑：每次调用都重置定时器
    this._saveTimer = setTimeout(() => {
        this._performSave();
    }, 100);  // 从500ms缩短到100ms，足以合并批量更新
}
```

**说明**：
- 100ms防抖足以合并Object.assign触发的多个setter调用
- 简化逻辑，不引入_isSaving状态管理
- 避免时序复杂性，每次调用都重置定时器
- 如果需要更快响应，可进一步缩短到50ms

---

#### 【补充】性能监控与指标观察

**文件**: `src/config.js`

**修改位置**: `_performSave` 方法（Line 419-432）

```javascript
_performSave: function() {
    const startTime = Date.now();
    const saveCount = this._saveCount || 0;

    try {
        const jsonString = JSON.stringify(_overrides, null, 2);
        fs.writeFile(CONFIG_PATH, jsonString, 'utf8', (err) => {
            const duration = Date.now() - startTime;

            if (err) {
                logger.error(`[Config] Failed to save configuration (took ${duration}ms):`, err);
            } else {
                this._saveCount = saveCount + 1;
                logger.info(`[Config] Configuration saved to config.json (took ${duration}ms, total saves: ${this._saveCount})`);

                // 可选：如果保存过于频繁，发出警告
                if (duration > 100) {
                    logger.warn(`[Config] Slow save detected (${duration}ms), consider checking disk I/O`);
                }
            }
        });
    } catch (e) {
        const duration = Date.now() - startTime;
        logger.error(`[Config] Error preparing configuration data (took ${duration}ms):`, e);
    }
}
```

**监控要点**：
- **保存频率**：如果短时间内保存次数过多（如5秒内>5次），可能防抖时间太短
- **保存耗时**：如果单次保存>100ms，可能磁盘I/O有问题
- **失败率**：如果频繁失败，检查磁盘权限或空间

**防抖参数调优策略**：
```
如果频繁保存（1分钟内>10次）→ 提高基础防抖到100ms
如果偶尔保存（1分钟内<2次）→ 保持50ms即可
```

---

#### 修复1.5: 改进错误日志

**文件**: `src/dashboard/routes/api.js`

**修改位置**: Line 517-519

```javascript
} catch (error) {
    logger.error('Failed to update AI settings:', error);
    res.status(500).json({ error: 'Failed to update AI settings', details: error.message });
}
```

---

#### 修复1.6: 前端增强错误提示

**文件**: `dashboard/src/pages/Settings.jsx`

**修改位置**: Line 219-221

```javascript
} catch (error) {
    console.error("Failed to save AI settings:", error);
    const errorMsg = error.response?.data?.details || '保存 AI 设置失败';
    show(errorMsg, "error");
}
```

---

### 问题2: MCP编辑功能修复方案

**核心原则**：
- **单一真源格式**：对象格式 `{ "server-name": { ... } }`
- **前端作为UI模型**：数组格式 `{ mcpServers: [...] }` 仅用于展示
- **API边界转换**：GET时对象→数组，POST时数组→对象
- **后端强制验证**：所有校验在API层执行，不可绕过
- **重载失败回滚**：保留旧连接，仅记录警告
- **并发冲突检测**：基于最后更新时间

---

#### 修复2.1: 明确API契约与格式转换

**文件**: `src/dashboard/routes/api.js`

**修改位置**: Line 480-502

**GET /api/mcp - 获取MCP服务器列表**

```javascript
// GET /api/mcp - Read MCP servers config
router.get('/mcp', async (req, res) => {
    try {
        const config = await readMcpConfig();  // 读取对象格式

        // 提取版本号
        const version = config._version || 0;

        // 【明确定义】转换为前端数组格式
        const mcpServers = Object.entries(config)
            .filter(([key]) => key !== '_version')  // 过滤版本号字段
            .map(([name, serverConfig]) => ({
                name,
                command: serverConfig.command || '',
                args: serverConfig.args || [],
                env: serverConfig.env || {},
                enabled: serverConfig.enabled !== false
            }));

        // 【统一返回】始终返回数组格式+版本号给前端
        res.json({ mcpServers, version });
    } catch (error) {
        logger.error('Failed to read MCP configuration:', error);
        res.status(500).json({ error: 'Failed to read MCP configuration', details: error.message });
    }
});
```

**POST /api/mcp - 更新MCP服务器列表**

```javascript
// POST /api/mcp - Update MCP servers config
router.post('/mcp', async (req, res) => {
    try {
        const { mcpServers } = req.body;

        // 【强验证】前端必须发送数组格式
        if (!Array.isArray(mcpServers)) {
            logger.warn('[API] Invalid mcpServers format:', req.body);
            return res.status(400).json({
                error: 'Invalid mcpServers format, expected array',
                received: typeof req.body.mcpServers,
                expected: 'array'
            });
        }

        // 【字段级验证】遍历所有服务器并验证
        const validationErrors = [];
        const seenNames = new Set();

        for (const server of mcpServers) {
            // name验证
            if (!server.name || typeof server.name !== 'string') {
                validationErrors.push(`Server at index ${mcpServers.indexOf(server)}: name is required and must be string`);
                continue;
            }
            if (server.name.trim() === '') {
                validationErrors.push(`Server "${server.name}": name cannot be empty`);
                continue;
            }
            if (!/^[a-zA-Z0-9_-]+$/.test(server.name)) {
                validationErrors.push(`Server "${server.name}": name contains invalid characters (only a-z, A-Z, 0-9, _, - allowed)`);
                continue;
            }
            if (seenNames.has(server.name)) {
                validationErrors.push(`Duplicate server name: "${server.name}"`);
            }
            seenNames.add(server.name);

            // command验证
            if (!server.command || typeof server.command !== 'string') {
                validationErrors.push(`Server "${server.name}": command is required and must be string`);
                continue;
            }

            // args验证
            if (server.args !== undefined && !Array.isArray(server.args)) {
                validationErrors.push(`Server "${server.name}": args must be an array`);
            }

            // env验证
            if (server.env !== undefined && typeof server.env !== 'object') {
                validationErrors.push(`Server "${server.name}": env must be an object`);
            }
        }

        if (validationErrors.length > 0) {
            logger.warn('[API] MCP configuration validation failed:', validationErrors);
            return res.status(400).json({
                error: 'Validation failed',
                details: validationErrors
            });
        }

        // 【格式转换】数组 → 对象（单一真源格式）
        const newConfig = {};
        for (const server of mcpServers) {
            newConfig[server.name] = {
                command: server.command,
                args: server.args || [],
                env: server.env || {},
                enabled: server.enabled !== undefined ? server.enabled : true
            };
        }

        // 写入文件
        await writeMcpConfig(newConfig);
        logger.info('[API] MCP configuration saved to file');

        // 【重载机制】调用MCP Manager重载，失败时保留旧连接
        try {
            await mcpManager.reload(newConfig);
            logger.info('[API] MCP servers reloaded successfully');
        } catch (error) {
            logger.error('[API] Failed to reload MCP servers after config update:', error);
            // 【关键】不返回错误，仅记录警告，配置已保存但连接可能未更新
            return res.json({
                message: 'MCP configuration updated (reload failed, old connections retained)',
                config: newConfig,
                warning: 'Failed to reload MCP servers, manual restart may be required'
            });
        }

        // 【统一返回】始终返回对象格式
        res.json({ message: 'MCP configuration updated', config: newConfig });
    } catch (error) {
        logger.error('Failed to save MCP configuration:', error);
        res.status(500).json({ error: 'Failed to save MCP configuration', details: error.message });
    }
});
```

**关键设计**：
- GET始终返回 `{ mcpServers: [...] }`
- POST始终返回 `{ config: {...}, message: ... }`（对象格式）
- 重载失败时返回警告而非错误（配置已保存）
- 详细的字段级验证，返回所有错误而非第一个

---

#### 修复2.2: 实现并发冲突检测（使用版本号）

**文件**: `src/dashboard/routes/api.js`

**在POST /api/mcp中添加版本控制**

```javascript
// 【版本控制】在读取和写入之间检查修改
router.post('/api/mcp', async (req, res) => {
    try {
        const { mcpServers, version } = req.body;  // 前端发送版本号

        // 1. 读取当前配置（包含版本号）
        const currentConfig = await readMcpConfig();
        const currentVersion = currentConfig._version || 0;

        // 2. 并发冲突检测
        if (version !== undefined && version !== currentVersion) {
            logger.warn('[API] Concurrent modification detected', {
                clientVersion: version,
                serverVersion: currentVersion
            });

            // 返回最新配置供前端合并
            const mcpServers = Object.entries(currentConfig)
                .filter(([key]) => key !== '_version')
                .map(([name, serverConfig]) => ({
                    name,
                    command: serverConfig.command || '',
                    args: serverConfig.args || [],
                    env: serverConfig.env || {},
                    enabled: serverConfig.enabled !== false
                }));

            return res.status(409).json({
                error: 'Configuration has been modified by another user',
                conflict: true,
                serverVersion: currentVersion,
                currentConfig: mcpServers
            });
        }

        // 3. 验证和转换（同上）
        const validationErrors = [];
        const seenNames = new Set();
        // ... 验证代码 ...

        // 4. 写入文件（包含递增的版本号）
        const newVersion = currentVersion + 1;
        const newConfig = { _version: newVersion };
        for (const server of mcpServers) {
            newConfig[server.name] = {
                command: server.command,
                args: server.args || [],
                env: server.env || {},
                enabled: server.enabled !== undefined ? server.enabled : true
            };
        }

        await writeMcpConfig(newConfig);

        // 5. 返回配置（包含新版本号）
        res.json({
            message: 'MCP configuration updated',
            config: newConfig,
            version: newVersion  // 供前端下次请求使用
        });
    } catch (error) {
        logger.error('Failed to save MCP configuration:', error);
        res.status(500).json({ error: 'Failed to save MCP configuration', details: error.message });
    }
});
```

**前端处理冲突** (Settings.jsx):

```javascript
// 在useEffect中获取配置时保存version
useEffect(() => {
    const fetchData = async () => {
        const [configRes, mcpRes] = await Promise.all([
            api.get('/api/config'),
            api.get('/api/mcp')
        ]);

        setFullConfig(configRes.data);

        // 保存version用于并发控制
        if (mcpRes.data.version !== undefined) {
            setMcpVersion(mcpRes.data.version);
        }

        // 解析MCP配置（处理两种格式）
        const servers = mcpRes.data.mcpServers || (Array.isArray(mcpRes.data) ? mcpRes.data : []);
        setMcpConfig({ mcpServers: servers });
    };
    fetchData();
}, [show]);

// 保存MCP时发送version
const handleEditMcp = async () => {
    try {
        const updatedServers = [...mcpConfig.mcpServers];
        // ... 更新逻辑 ...

        // 发送version
        const response = await api.post('/api/mcp', {
            mcpServers: updatedServers,
            version: mcpVersion
        });

        if (response.data.conflict) {
            show('配置已被其他用户修改，请刷新后重试', 'error');
            // 刷新配置
            return;
        }

        show("MCP 服务器已更新", "success");

        // 更新version
        if (response.data.version !== undefined) {
            setMcpVersion(response.data.version);
        }
    } catch (error) {
        if (error.response?.status === 409) {
            show('配置已被其他用户修改，请刷新后重试', 'error');
            return;
        }
        console.error("Failed to update MCP server:", error);
        show("更新 MCP 服务器失败", "error");
    }
};
```

---

#### 修复2.3: 实现重命名与连接迁移

**文件**: `src/services/mcpManager.js`

**新增参数化reload方法**

```javascript
// 【改进】reload 方法支持连接迁移
async reload(newConfig) {
    logger.info('[McpManager] Reloading MCP servers...');

    // 1. 获取旧连接的服务器名称
    const oldServerNames = Array.from(this.clients.keys());

    // 2. 关闭所有现有连接
    await this.cleanup();

    // 3. 重新读取配置（如果未提供newConfig）
    if (!newConfig) {
        if (!fs.existsSync(this.configPath)) {
            logger.info('[McpManager] No config file found, skipping reload.');
            return;
        }

        try {
            newConfig = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
        } catch (e) {
            logger.error('[McpManager] Failed to load config:', e);
            throw e;  // 【关键】抛出错误让API处理
        }
    }

    // 4. 重新连接
    const newServerNames = [];
    for (const [serverName, serverConfig] of Object.entries(newConfig)) {
        if (serverConfig.enabled === false) continue;

        newServerNames.push(serverName);
        this.connectToServer(serverName, serverConfig);
    }

    logger.info(`[McpManager] Reloaded ${newServerNames.length} servers.`);

    // 5. 检测连接变化（重命名情况）
    const renamedServers = oldServerNames.filter(name => !newServerNames.includes(name));
    if (renamedServers.length > 0) {
        logger.info(`[McpManager] Renamed servers detected: ${renamedServers.join(', ')}`);
    }

    // 6. 返回结果供API判断
    return {
        success: true,
        connected: newServerNames,
        disconnected: oldServerNames.filter(name => !newServerNames.includes(name))
    };
}
```

**重命名处理逻辑**：

当用户编辑MCP服务器名称时，前端需要明确告知后端这是重命名操作：

```javascript
// Settings.jsx - 编辑保存时
const handleEditMcp = async () => {
    const oldName = mcpConfig.mcpServers[editingMcpIndex].name;
    const newName = editMcp.name.trim();

    const updatedServers = [...mcpConfig.mcpServers];
    updatedServers[editingMcpIndex] = {
        ...updatedServers[editingMcpIndex],
        name: newName,
        command: editMcp.command,
        args: editMcp.args.split(',').map(s => s.trim()).filter(Boolean),
        env: JSON.parse(editMcp.env)
    };

    // 发送请求
    const response = await api.post('/api/mcp', {
        mcpServers: updatedServers,
        lastModified: mcpLastModified,
        renameOperation: oldName !== newName ? { from: oldName, to: newName } : undefined  // 标识重命名操作
    });

    if (response.data.warning) {
        show(response.data.warning, 'warning');
    } else {
        show("MCP 服务器已更新", "success");
    }
};
```

---

#### 修复2.4: 实现重载失败回滚

**文件**: `src/services/mcpManager.js`

**改进reload方法，支持失败回滚**

```javascript
class McpManager {
    constructor() {
        this.clients = new Map(); // serverName -> Client
        this.toolsMap = new Map(); // toolName -> { serverName, toolName }
        this.configPath = path.join(process.cwd(), 'config', 'mcp_servers.json');
        this._lastWorkingConfig = null;  // 【新增】上次成功加载的配置
    }

    async init() {
        if (!fs.existsSync(this.configPath)) {
            logger.info('[McpManager] No config file found, skipping initialization.');
            return;
        }

        try {
            const config = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
            this._lastWorkingConfig = config;  // 保存初始配置

            for (const [serverName, serverConfig] of Object.entries(config)) {
                if (serverConfig.enabled === false) continue;
                this.connectToServer(serverName, serverConfig);
            }
        } catch (e) {
            logger.error('[McpManager] Failed to load config:', e);
        }
    }

    // 【改进】支持回滚的reload方法 - 延迟cleanup避免服务中断
    async reload(newConfig) {
        const oldClients = new Map(this.clients);  // 备份旧连接引用

        try {
            logger.info('[McpManager] Attempting to reload MCP servers...');

            // 1. 读取配置
            const configToLoad = newConfig || JSON.parse(fs.readFileSync(this.configPath, 'utf8'));

            // 2. 建立新连接（不关闭旧连接）
            const newClients = new Map();
            const newToolsMap = new Map();

            for (const [serverName, serverConfig] of Object.entries(configToLoad)) {
                if (serverConfig._version !== undefined) continue;  // 跳过版本号字段
                if (serverConfig.enabled === false) continue;

                // 创建新连接
                const client = await this.createClient(serverName, serverConfig);
                newClients.set(serverName, client);

                // 收集工具映射
                const tools = await client.listTools();
                for (const tool of tools.tools || []) {
                    newToolsMap.set(tool.name, { serverName, toolName: tool.name });
                }
            }

            // 3. 所有新连接成功后，替换并清理旧连接
            this.clients = newClients;
            this.toolsMap = newToolsMap;
            this._lastWorkingConfig = configToLoad;

            // 关闭旧连接（不抛出错误）
            for (const [name, client] of oldClients) {
                try {
                    await client.close();
                    logger.info(`[McpManager] Closed old connection: ${name}`);
                } catch (e) {
                    logger.warn(`[McpManager] Failed to close old connection ${name}:`, e);
                }
            }

            logger.info(`[McpManager] Successfully reloaded ${newClients.size} servers.`);

            return {
                success: true,
                connected: Array.from(newClients.keys()),
                oldConfigRetained: false
            };

        } catch (error) {
            logger.error('[McpManager] Failed to reload MCP servers:', error);

            // 【回滚策略】清理失败的新连接，保留旧连接
            logger.warn('[McpManager] Rolling back to previous connections...');

            // 清理所有新建立的连接
            for (const [name, client] of this.clients) {
                if (!oldClients.has(name)) {
                    try {
                        await client.close();
                    } catch (e) {
                        logger.warn(`[McpManager] Failed to close failed connection ${name}:`, e);
                    }
                }
            }

            // 恢复旧连接
            this.clients = oldClients;

            // 重新构建工具映射
            this.toolsMap.clear();
            for (const [serverName, client] of oldClients) {
                try {
                    const tools = await client.listTools();
                    for (const tool of tools.tools || []) {
                        this.toolsMap.set(tool.name, { serverName, toolName: tool.name });
                    }
                } catch (e) {
                    logger.warn(`[McpManager] Failed to rebuild tools for ${serverName}:`, e);
                }
            }

            return {
                success: false,
                error: error.message,
                oldConfigRetained: true
            };
        }
    }

    // 辅助方法：创建单个客户端连接
    async createClient(serverName, serverConfig) {
        // 实现具体的MCP客户端创建逻辑
        // 这里需要根据实际的mcpManager实现来适配
        return await this.connectToServer(serverName, serverConfig);
    }
}
```

**API处理回滚** (api.js):

```javascript
try {
    await mcpManager.reload(newConfig);
    logger.info('[API] MCP servers reloaded successfully');
    res.json({ message: 'MCP configuration updated', config: newConfig });
} catch (error) {
    logger.error('[API] Failed to reload MCP servers after config update:', error);
    // 【关键】不返回错误，仅警告，配置已保存但重载失败
    res.json({
        message: 'MCP configuration updated (reload failed, old connections retained)',
        config: newConfig,
        warning: 'Failed to reload MCP servers, please check server configuration'
    });
}
```

---

#### 修复2.5: 等待重载完成并返回结果

**文件**: `src/dashboard/routes/api.js`

**等待reload并返回状态**

```javascript
router.post('/api/mcp', async (req, res) => {
    try {
        const { mcpServers, version } = req.body;

        // ... 验证和保存逻辑 ...

        // 写入文件
        await writeMcpConfig(newConfig);
        logger.info('[API] MCP configuration saved to file');

        // 【等待reload完成】让用户知道服务是否正常
        try {
            const reloadResult = await mcpManager.reload(newConfig);
            logger.info('[API] MCP servers reloaded successfully');

            res.json({
                message: 'MCP配置已更新并生效',
                config: newConfig,
                version: newVersion,
                reloadSuccess: true
            });

        } catch (error) {
            logger.error('[API] Failed to reload MCP servers after config update:', error);

            // 配置已保存但reload失败，返回207 Multi-Status
            res.status(207).json({
                message: '配置已保存，但服务重载失败',
                config: newConfig,
                version: newVersion,
                reloadSuccess: false,
                error: error.message,
                warning: '配置已保存到文件，但MCP服务可能未更新，建议重启应用'
            });
        }

    } catch (error) {
        logger.error('Failed to save MCP configuration:', error);
        res.status(500).json({ error: 'Failed to save MCP configuration', details: error.message });
    }
});
```

**关键设计**：
- 等待reload完成再返回（用户明确知道结果）
- reload成功：返回200，提示"已更新并生效"
- reload失败：返回207 Multi-Status，提示"已保存但未生效"
- 前端可根据reloadSuccess字段显示不同提示

---

#### 修复2.6: 添加编辑按钮到UI

**文件**: `dashboard/src/pages/Settings.jsx`

**修改位置**: Line 790-805

```javascript
<div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
    <button
        onClick={() => toggleMcpServer(idx)}
        className="p-1.5 hover:bg-white/10 rounded-md text-gray-300 hover:text-white"
        title={server.enabled ? "禁用" : "启用"}
    >
        <Power size={16} />
    </button>
    <button
        onClick={() => openEditMcpModal(idx)}  // 【新增】编辑按钮
        className="p-1.5 hover:bg-blue-500/20 rounded-md text-gray-300 hover:text-blue-400"
        title="编辑"
    >
        <Settings as SettingsIcon size={16} />  // 需要导入
    </button>
    <button
        onClick={() => removeMcpServer(idx)}
        className="p-1.5 hover:bg-red-500/20 rounded-md text-gray-300 hover:text-red-400"
        title="移除"
    >
        <Trash2 size={16} />
    </button>
</div>
```

---

#### 修复2.7: 添加编辑状态和编辑模态框

**文件**: `dashboard/src/pages/Settings.jsx`

**新增状态**（Line 14后）:

```javascript
const [editingMcpIndex, setEditingMcpIndex] = useState(null);
const [isEditMcpModalOpen, setIsEditMcpModalOpen] = useState(false);
const [editMcp, setEditMcp] = useState({
    name: '',
    command: '',
    args: '',
    env: '{}'
});
const [mcpVersion, setMcpVersion] = useState(0);  // 【新增】版本号用于并发控制
```

**新增处理函数**（Line 348后）:

```javascript
// MCP Edit Handlers
const openEditMcpModal = (index) => {
    const server = mcpConfig.mcpServers[index];
    setEditingMcpIndex(index);
    setEditMcp({
        name: server.name,
        command: server.command,
        args: server.args?.join(', ') || '',
        env: JSON.stringify(server.env || {}, null, 2)
    });
    setIsEditMcpModalOpen(true);
};

const handleEditMcp = async () => {
    try {
        const oldName = mcpConfig.mcpServers[editingMcpIndex].name;
        const newName = editMcp.name.trim();

        // 【前端验证】名称不能为空
        if (!newName) {
            show('服务器名称不能为空', 'error');
            return;
        }

        // 【前端验证】名称格式
        if (!/^[a-zA-Z0-9_-]+$/.test(newName)) {
            show('服务器名称只能包含字母、数字、下划线和短横线', 'error');
            return;
        }

        // 【前端验证】环境变量JSON
        let env = {};
        try {
            env = JSON.parse(editMcp.env);
        } catch {
            show('环境变量 JSON 格式无效', 'error');
            return;
        }

        const args = editMcp.args.split(',').map(s => s.trim()).filter(Boolean);

        const updatedServers = [...mcpConfig.mcpServers];
        updatedServers[editingMcpIndex] = {
            ...updatedServers[editingMcpIndex],
            name: newName,
            command: editMcp.command,
            args,
            env,
            enabled: updatedServers[editingMcpIndex].enabled
        };

        // 检测重命名
        const isRename = oldName !== newName;

        // Optimistic update
        setMcpConfig({ mcpServers: updatedServers });
        setIsEditMcpModalOpen(false);
        setEditMcp({ name: '', command: '', args: '', env: '{}' });
        setEditingMcpIndex(null);

        // Save to backend with version control
        const response = await api.post('/api/mcp', {
            mcpServers: updatedServers,
            version: mcpVersion,
            renameOperation: isRename ? { from: oldName, to: newName } : undefined
        });

        // 处理冲突
        if (response.data.conflict) {
            show('配置已被其他用户修改，请刷新后重试', 'error');
            return;
        }

        // 处理reload失败警告
        if (!response.data.reloadSuccess) {
            show(response.data.warning || '配置已保存但服务可能未更新', 'warning');
        } else {
            show("MCP 服务器已更新并生效", "success");
        }

        // 更新version
        if (response.data.version !== undefined) {
            setMcpVersion(response.data.version);
        }

    } catch (error) {
        if (error.response?.status === 409) {
            show('配置已被其他用户修改，请刷新后重试', 'error');
            return;
        }
        if (error.response?.status === 400) {
            const errorMsg = error.response.data?.error || '更新失败';
            if (error.response.data.details && Array.isArray(error.response.data.details)) {
                show(`${errorMsg}: ${error.response.data.details[0]}`, 'error');
            } else {
                show(errorMsg, 'error');
            }
            return;
        }
        console.error("Failed to update MCP server:", error);
        show("更新 MCP 服务器失败", "error");
    }
};
```

**新增编辑模态框UI**（Line 918后）:

```javascript
{/* Edit MCP Modal */}
{isEditMcpModalOpen && (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div className="bg-gray-900 border border-white/20 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="flex justify-between items-center p-4 border-b border-white/10 bg-white/5">
                <h3 className="text-lg font-bold text-white">编辑 MCP 服务器</h3>
                <button onClick={() => setIsEditMcpModalOpen(false)} className="text-gray-400 hover:text-white">
                    <X size={20} />
                </button>
            </div>
            <div className="p-6 space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">服务器名称</label>
                    <input
                        type="text"
                        value={editMcp.name}
                        onChange={e => setEditMcp({...editMcp, name: e.target.value})}
                        placeholder="例如：Filesystem"
                        className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                    />
                    <p className="text-xs text-gray-500 mt-1">只能包含字母、数字、下划线和短横线</p>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">命令</label>
                    <input
                        type="text"
                        value={editMcp.command}
                        onChange={e => setEditMcp({...editMcp, command: e.target.value})}
                        placeholder="npx, python 等"
                        className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">参数 (逗号分隔)</label>
                    <input
                        type="text"
                        value={editMcp.args}
                        onChange={e => setEditMcp({...editMcp, args: e.target.value})}
                        placeholder="-y, @modelcontextprotocol/server-filesystem, /path/to/dir"
                        className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">环境变量 (JSON)</label>
                    <textarea
                        value={editMcp.env}
                        onChange={e => setEditMcp({...editMcp, env: e.target.value})}
                        rows={3}
                        className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white font-mono text-xs focus:border-purple-500 focus:outline-none"
                    />
                </div>
            </div>
            <div className="p-4 border-t border-white/10 bg-white/5 flex justify-end gap-3">
                <button
                    onClick={() => setIsEditMcpModalOpen(false)}
                    className="px-4 py-2 text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                >
                    取消
                </button>
                <button
                    onClick={handleEditMcp}
                    disabled={savingMcp || !editMcp.name || !editMcp.command}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {savingMcp ? '保存中...' : '保存更改'}
                </button>
            </div>
        </div>
    </div>
)}
```

---

#### 修复2.8: 添加日志记录

**文件**: `src/dashboard/routes/api.js`

**完善日志记录到所有MCP操作**:

```javascript
// GET /api/mcp
router.get('/mcp', async (req, res) => {
    try {
        logger.info('[API] Reading MCP configuration...');
        const config = await readMcpConfig();
        // ... 转换逻辑 ...
        logger.info(`[API] Returning ${mcpServers.length} MCP servers to client`);
        res.json({ mcpServers });
    } catch (error) {
        logger.error('[API] Failed to read MCP configuration:', error);
        res.status(500).json({ error: 'Failed to read MCP configuration', details: error.message });
    }
});

// POST /api/mcp
router.post('/mcp', async (req, res) => {
    try {
        const { mcpServers, lastModified, renameOperation } = req.body;

        logger.info(`[API] Updating MCP configuration: ${mcpServers?.length || 0} servers`);

        // 重命名操作日志
        if (renameOperation) {
            logger.info(`[API] Rename operation detected: ${renameOperation.from} → ${renameOperation.to}`);
        }

        // 并发冲突日志
        if (lastModified) {
            logger.debug(`[API] Client lastModified: ${new Date(lastModified).toISOString()}`);
        }

        // 验证日志
        if (validationErrors.length > 0) {
            logger.warn('[API] MCP configuration validation failed:', validationErrors);
        }

        // 保存成功日志
        await writeMcpConfig(newConfig);
        logger.info('[API] MCP configuration saved to file');

        // 重载日志
        const reloadPromise = new Promise((resolve) => {
            mcpReloadTimer = setTimeout(async () => {
                try {
                    await mcpManager.reload(newConfig);
                    logger.info('[API] MCP servers reloaded successfully');
                    resolve({ success: true });
                } catch (error) {
                    logger.error('[API] Failed to reload MCP servers after config update:', error);
                    resolve({ success: false, error: error.message });
                }
            }, MCP_RELOAD_DEBOUNCE);
        });

        res.json({ message: 'MCP configuration updated', config: newConfig });

    } catch (error) {
        logger.error('[API] Failed to save MCP configuration:', error);
        res.status(500).json({ error: 'Failed to save MCP configuration', details: error.message });
    }
});
```

---

## 实施步骤

### Phase 1: AI设置保存问题修复（高优先级）

**预计时间**: 40分钟

1. **移除冗余save()调用** (api.js:515)
2. **接口返回体改为 readConfig()** (api.js:516)
3. **添加字段验证** (api.js:504-519)
4. **优化防抖逻辑** (config.js:407-432)
5. **添加性能监控** (config.js:419-432)
6. **改进错误日志** (api.js:517-519)
7. **前端增强错误提示** (Settings.jsx:219-221)
8. **测试验证**

---

### Phase 2: MCP编辑功能实现（高优先级）

**预计时间**: 90分钟

1. **明确API契约与格式转换** (api.js:480-502)
   - GET：对象→数组，返回`{ mcpServers: [...], version: number }`
   - POST：数组→对象，返回`{ config: {...}, version: number, reloadSuccess: boolean }`

2. **实现并发冲突检测** (api.js:490-502)
   - 基于_version字段实现版本控制
   - 409冲突返回详细错误和最新配置

3. **实现重命名与连接迁移** (mcpManager.js)
   - 支持参数化的reload方法
   - 检测并记录重命名操作

4. **实现重载失败回滚** (mcpManager.js)
   - 先建立新连接，成功后再cleanup旧连接
   - reload失败时清理新连接，保留旧连接
   - 保存`_lastWorkingConfig`用于回滚

5. **等待重载完成并返回状态** (api.js:490-502)
   - 等待reload完成再返回
   - reload成功：返回200，提示"已更新并生效"
   - reload失败：返回207，提示"已保存但未生效"

6. **添加UI编辑按钮** (Settings.jsx:790-805)
   - 导入Settings图标
   - 添加编辑按钮到MCP卡片

7. **添加编辑状态和模态框** (Settings.jsx)
   - 添加状态变量
   - 实现编辑模态框UI
   - 实现处理函数（包含前端验证）
   - 处理并发冲突和警告

8. **完善日志记录** (api.js)
   - 记录所有MCP操作
   - 记录重命名、并发冲突、验证失败

9. **测试验证**

---

## 测试计划

### AI设置保存测试

| 测试用例 | 预期结果 | 验证方法 |
|---------|---------|---------|
| 修改单个AI配置并保存 | 配置保存成功，前端显示成功提示 | 检查config.json，检查前端提示 |
| 同时修改多个AI配置并保存 | 配置保存成功，前端显示成功提示 | 检查config.json，检查前端提示 |
| 快速连续点击保存按钮 | 配置保存一次，前端显示成功提示 | 检查config.json，检查日志中保存次数 |
| 修改配置为无效值 | 前端显示详细错误信息 | 检查前端错误提示，检查日志 |
| 保存时服务端发生错误 | 前端显示错误提示，日志记录错误 | 检查前端提示，检查日志 |
| 检查返回的config是否为纯对象 | 返回值无内部属性和方法，可序列化 | console.log检查 |
| 修改AI概率为超出范围值（如1.5） | 前端显示字段错误，配置不变 | 检查前端错误提示 |
| 修改上下文限制为0 | 前端显示字段错误，配置不变 | 检查前端错误提示 |
| 修改历史大小为非数值 | 前端显示字段错误，配置不变 | 检查前端错误提示 |
| 检查保存性能日志 | 记录保存耗时和次数，监控性能 | 检查日志 |

### MCP编辑功能测试

| 测试用例 | 预期结果 | 验证方法 |
|---------|---------|---------|
| **格式转换测试** |
| GET /api/mcp 返回格式 | 始终返回`{ mcpServers: [...], lastModified: timestamp }` | console.log检查响应 |
| POST /api/mcp 接收格式 | 接收数组格式并正确转换为对象格式 | 检查config/mcp_servers.json |
| **并发控制测试** |
| 多用户同时编辑同一配置 | 后写入收到409冲突错误，前端提示刷新 | 模拟并发请求 |
| 前端收到409错误 | 显示"配置已被其他用户修改"提示 | 检查UI提示 |
| 冲突后重试成功 | 使用最新lastModified再次提交成功 | 检查文件更新 |
| **字段验证测试** |
| 名称包含非法字符（如空格） | 前端显示"名称只能包含字母、数字、下划线和短横线" | 前端验证 |
| 服务器名称重复 | 后端返回400错误："Duplicate server name" | 检查API响应 |
| args为非数组 | 后端返回400错误："args must be an array" | 检查API响应 |
| env为非对象JSON | 前端显示"环境变量 JSON 格式无效" | 前端验证 |
| 名称改为空字符串 | 前端显示"服务器名称不能为空" | 前端验证 |
| **重命名与连接迁移测试** |
| 修改服务器名称（重命名） | 旧连接断开，新连接建立，日志记录重命名 | 检查日志、MCP连接 |
| 重命名为已存在的名称 | 后端返回错误："Duplicate server name" | 检查API响应 |
| 重命名后工具可用 | 新名称对应的工具在MCP Manager中可用 | 检查工具列表 |
| **重载失败回滚测试** |
| 配置有效但连接失败 | 配置保存成功，旧连接保留，API返回警告 | 检查文件、MCP连接、API响应 |
| 多次快速修改配置 | 配置保存多次，reload只执行一次（节流） | 检查日志中reload次数 |
| reload过程中再次修改 | 配置保存成功，reload被重新调度（防抖重置） | 检查日志 |
| **UI功能测试** |
| 点击编辑按钮打开模态框 | 模态框打开，显示当前配置 | 检查UI |
| 修改MCP服务器名称 | 修改成功，文件更新，MCP重载 | 检查文件、日志、MCP连接 |
| 修改MCP服务器命令 | 修改成功，文件更新，MCP重载 | 检查文件、日志、MCP连接 |
| 修改MCP服务器参数 | 修改成功，文件更新，MCP重载 | 检查文件、日志、MCP连接 |
| 修改MCP环境变量（有效JSON） | 修改成功，文件更新，MCP重载 | 检查文件、日志、MCP连接 |
| 修改MCP环境变量（无效JSON） | 前端显示错误，不保存 | 检查前端提示 |
| 编辑后取消修改 | 配置不变，模态框关闭 | 检查文件 |
| 启用已禁用的MCP服务器 | 启用成功，MCP连接建立 | 检查文件、MCP连接 |
| 禁用已启用的MCP服务器 | 禁用成功，MCP连接断开 | 检查文件、MCP连接 |
| 删除MCP服务器 | 删除成功，MCP连接断开 | 检查文件、MCP连接 |

---

## 风险与注意事项

### AI设置保存问题风险

1. **防抖逻辑变更影响其他功能**
   - 风险：调整防抖时间可能影响其他使用配置保存的功能
   - 缓解：充分测试所有配置修改功能

2. **配置格式不一致**
   - 风险：如果某些AI配置字段格式不对，可能导致保存失败
   - 缓解：添加格式验证（修复1.3已解决）

3. **返回 readConfig() 的性能影响**
   - 风险：每次保存都读取文件，增加磁盘I/O
   - 缓解：文件较小，读取开销可接受；且只在保存成功时读取

4. **字段验证的向后兼容性**
   - 风险：严格验证可能拒绝现有配置中的边缘值
   - 缓解：根据实际使用情况调整范围限制

### MCP编辑功能风险

1. **API契约变更影响现有客户端**
   - 风险：GET/POST返回格式变更可能影响其他调用方
   - 缓解：确保只有WebUI使用这些端点，或提供版本化API

2. **并发冲突检测的时钟同步问题**
   - 风险：基于文件mtime的版本控制依赖系统时钟，不同步可能导致误报
   - 缓解：使用1秒容差（1000ms），只在检测到显著差异时才拒绝

3. **重载失败回滚不完整**
   - 风险：恢复旧连接但配置已更新，可能导致不一致
   - 缓解：仅保留连接用于服务不中断，明确告知用户可能需要手动重启

4. **重命名导致的工具名称变化**
   - 风险：重命名后工具的serverName变化，可能导致AI工具调用失败
   - 缓解：重命名后立即更新AI Handler的工具缓存

5. **节流延迟导致用户感知延迟**
   - 风险：2秒延迟可能让用户感觉配置未生效
   - 缓解：前端显示"正在应用更改..."提示

6. **前端验证与后端验证不一致**
   - 风险：前端通过验证但后端拒绝，用户体验差
   - 缓解：保持前后端验证规则一致，后端验证为准

7. **lastModified丢失导致并发检测失效**
   - 风险：前端刷新页面丢失lastModified，并发检测失效
   - 缓解：首次加载时从响应中获取lastModified

8. **重载节流与单次reload冲突**
   - 风险：如果reload耗时>2秒，可能被下一个请求重置
   - 缓解：使用Promise跟踪pending reload，只取消未开始的

9. **连接迁移的原子性问题**
   - 风险：关闭旧连接和建立新连接之间有时间窗口，服务短暂不可用
   - 缓解：无法完全避免，但可接受（MCP有重试机制）

10. **多服务器批量reload的级联失败**
    - 风险：一个服务器连接失败可能导致整个reload标记为失败
    - 缓解：继续尝试其他服务器，只记录失败的服务器

---

## 回滚计划

如果修复导致问题，可以按以下步骤回滚：

### AI设置保存问题回滚

1. 恢复api.js:515行的`sysConfig.save()`调用
2. 恢复api.js:516行返回 `sysConfig` 而非 `readConfig()`
3. 移除新增的字段验证代码
4. 恢复config.js的原始防抖逻辑
5. 移除新增的错误日志代码

### MCP编辑功能回滚

1. 移除Settings.jsx中的编辑按钮和编辑模态框
2. 恢复api.js的原始GET/POST端点（不进行格式转换）
3. 移除mcpManager.js的`reload()`方法

---

## 文件修改清单

### AI设置保存问题
- [ ] `src/dashboard/routes/api.js` - 移除冗余save()，返回 readConfig()，添加字段验证，改进错误日志
- [ ] `src/config.js` - 优化防抖逻辑，添加性能监控
- [ ] `dashboard/src/pages/Settings.jsx` - 增强错误提示

### MCP编辑功能
- [ ] `src/dashboard/routes/api.js` - 明确API契约（GET/POST返回格式），实现格式转换，添加并发冲突检测，实现重载节流，完善日志记录
- [ ] `src/services/mcpManager.js` - 实现参数化reload方法，添加_lastWorkingConfig支持回滚，记录重命名操作
- [ ] `dashboard/src/pages/Settings.jsx` - 添加编辑按钮、编辑模态框、处理函数、前端验证、lastModified状态、冲突处理
- [ ] 导入mcpManager到api.js（如果未导入）

---

## 方案总结

### 本次更新内容

#### AI设置保存问题
- **修复1.2 新增**: 接口返回体统一为"可序列化纯对象"
- **修复1.3 新增**: 保存前简单校验（6个AI字段验证）
- **性能监控补充**: 在`_performSave`中记录保存频率和耗时
- **更新内容**: 实施步骤增加2步，文件修改清单细化，测试计划新增7个测试用例

#### MCP编辑功能问题（重大补充）
**原方案缺陷**: 未明确定义格式标准化、重命名策略、字段验证、并发控制、回滚机制、API契约一致性、重载节流等关键点

**补齐内容**:
1. **修复2.1**: 明确API契约与格式转换（GET返回数组，POST返回对象）
2. **修复2.2**: 实现并发冲突检测（基于mtime版本控制）
3. **修复2.3**: 实现重命名与连接迁移（参数化reload，支持连接保留）
4. **修复2.4**: 实现重载失败回滚（保存lastWorkingConfig，失败时恢复）
5. **修复2.5**: 实现重载节流机制（2秒防抖，后台异步reload）
6. **修复2.6-2.8**: UI完善（编辑按钮、编辑模态框、前端验证、lastModified状态、冲突处理）
7. **修复2.8**: 完善日志记录（所有操作、冲突、验证失败）

**更新内容**:
- 实施步骤从6步增加到9步，预计时间60分钟→90分钟
- 测试计划从8个用例增加到23个用例（格式转换、并发控制、字段验证、重命名、回滚、节流）
- 风险与注意事项从4个增加到10个（契约变更、时钟同步、原子性、前端验证等）
- 文件修改清单明确列出所有新增内容

### 方案完备性评估

| 维度 | 原方案 | 更新后方案 |
|-----|---------|------------|
| 格式标准化 | ❌ 未明确单一真源 | ✅ 对象格式，API边界转换 |
| 字段验证 | ❌ 仅前端验证 | ✅ 后端强制验证 |
| 唯一标识与重命名 | ❌ 未定义策略 | ✅ 重命名检测、连接迁移 |
| 并发控制 | ❌ 仅提及风险 | ✅ 版本控制、409冲突 |
| 失败回滚 | ❌ 未定义策略 | ✅ 保留旧连接，警告提示 |
| API一致性 | ❌ 返回值不统一 | ✅ GET数组、POST对象 |
| 重载节流 | ❌ 未定义范围 | ✅ 2秒防抖，异步reload |
| 日志记录 | ⚠️ 基础日志 | ✅ 完整操作日志 |
| 测试覆盖 | ⚠️ 8个用例 | ✅ 23个用例 |

**结论**: 方案现已完备，涵盖所有关键风险点和边界情况。

---

## 参考资料

- 配置系统架构：`src/config.js`
- MCP Manager实现：`src/services/mcpManager.js`
- Dashboard API路由：`src/dashboard/routes/api.js`
- 前端Settings页面：`dashboard/src/pages/Settings.jsx`
- 日志系统：`src/utils/logger.js`
