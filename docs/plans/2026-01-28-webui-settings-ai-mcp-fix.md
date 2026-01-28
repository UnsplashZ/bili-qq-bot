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

**修改后**：
```javascript
// 修改后
router.post('/ai', async (req, res) => {
    try {
        const updates = req.body;
        if (!updates || typeof updates !== 'object') {
            return res.status(400).json({ error: 'Invalid configuration data' });
        }

        // Merge updates into root config
        Object.assign(sysConfig, updates);

        // 【关键修改】返回真实的配置快照（从文件读取，避免内存中的不一致）
        const currentConfig = await readConfig();
        res.json({ message: 'AI settings updated', config: currentConfig });
    } catch (error) {
        logger.error('Failed to update AI settings:', error);
        res.status(500).json({ error: 'Failed to update AI settings', details: error.message });
    }
});
```

**优点**：
- 返回纯 JSON 对象，可安全序列化
- 确保前端拿到的是文件中的真实值（而非内存中的可能不一致值）
- 避免前端显示与实际保存内容不一致的情况
- 与 `/api/config` 端点保持一致风格
- 为后续问题提供更彻底的解决方案

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

    // 改为立即保存 + 短期防抖（避免极短时间内多次写入）
    if (!this._isSaving) {
        this._isSaving = true;
        this._saveTimer = setTimeout(async () => {
            try {
                await this._performSave();
            } finally {
                this._isSaving = false;
            }
        }, 50);  // 从500ms缩短到50ms
    } else {
        // 如果已经在保存中，使用更长防抖确保所有更新都被包含
        clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(async () => {
            try {
                await this._performSave();
            } finally {
                this._isSaving = false;
            }
        }, 200);
    }
},
```

**说明**：
- 50ms防抖足以合并极短时间内的多次调用
- 如果正在保存中，使用200ms防抖确保所有更新都被捕获
- 添加`_isSaving`标志避免并发保存

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

#### 修复2.1: 添加编辑按钮到UI

**文件**: `dashboard/src/pages/Settings.jsx`

**修改位置**: Line 790-805

在启用/禁用按钮和删除按钮之间添加编辑按钮。

#### 修复2.2: 添加编辑状态和编辑模态框

**文件**: `dashboard/src/pages/Settings.jsx`

**新增状态**:
- `editingMcpIndex` - 编辑中的MCP索引
- `isEditMcpModalOpen` - 编辑模态框状态
- `editMcp` - 编辑中的MCP数据

**新增处理函数**:
- `openEditMcpModal(index)` - 打开编辑模态框
- `handleEditMcp()` - 处理编辑保存

**新增编辑模态框UI** - 类似添加模态框

#### 修复2.3: 修复API端点的格式转换

**文件**: `src/dashboard/routes/api.js`

**GET /api/mcp**:
- 从文件读取对象格式
- 转换为数组格式 `{ mcpServers: [...] }`
- 返回给前端

**POST /api/mcp**:
- 接收数组格式 `{ mcpServers: [...] }`
- 转换为对象格式 `{ "server-name": { ... } }`
- 写入文件
- 重载MCP服务器

#### 修复2.4: 添加MCP配置重载机制

**文件**: `src/services/mcpManager.js`

**新增方法** `reload()`:
- 关闭所有现有连接
- 重新读取配置文件
- 重新连接到启用的服务器

在API中调用重载方法。

#### 修复2.5: 添加日志记录

**文件**: `src/dashboard/routes/api.js`

添加日志到MCP相关操作：
- 配置更新开始
- 配置保存成功
- MCP重载成功/失败
- 错误日志

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

**预计时间**: 60分钟

1. **添加UI编辑按钮** (Settings.jsx:790-805)
2. **添加编辑状态和模态框** (Settings.jsx)
3. **修复API格式转换** (api.js:480-502)
4. **添加MCP重载机制** (mcpManager.js)
5. **添加日志记录** (api.js)
6. **测试验证**

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

1. **格式转换错误**
   - 风险：数组↔对象转换可能丢失数据或产生格式错误
   - 缓解：添加严格验证，添加测试用例

2. **重载失败导致服务中断**
   - 风险：MCP重载失败可能导致所有MCP服务不可用
   - 缓解：捕获异常，确保原有连接保持（如果可能）

3. **并发修改冲突**
   - 风险：多个用户同时编辑MCP配置可能产生冲突
   - 缓解：添加乐观锁或版本控制（未来改进）

4. **MCP连接失败**
   - 风险：编辑后的配置导致MCP连接失败
   - 缓解：MCP Manager已有重试机制，保持该机制

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
- [ ] `dashboard/src/pages/Settings.jsx` - 添加编辑按钮、编辑模态框、处理函数
- [ ] `src/dashboard/routes/api.js` - 添加格式转换、日志记录
- [ ] `src/services/mcpManager.js` - 添加reload()方法
- [ ] 导入mcpManager到api.js（如果未导入）

---

## 参考资料

- 配置系统架构：`src/config.js`
- MCP Manager实现：`src/services/mcpManager.js`
- Dashboard API路由：`src/dashboard/routes/api.js`
- 前端Settings页面：`dashboard/src/pages/Settings.jsx`
- 日志系统：`src/utils/logger.js`
