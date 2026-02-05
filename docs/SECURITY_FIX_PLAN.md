# Bili QQ Bot 安全与稳定性修复计划

## 📋 文档说明

**版本：** v1.0
**创建日期：** 2026-02-05
**部署环境：** 内网环境（降低外部攻击风险的优先级）
**预计总工作量：** 3-5个工作日（P0-P1问题）

---

## 🎯 优先级定义（已根据内网环境调整）

| 优先级 | 说明 | 处理时限 |
|--------|------|---------|
| **P0-严重** | 影响核心功能稳定性、数据完整性的问题 | 立即修复（1-2天） |
| **P1-重要** | 影响长期稳定运行、资源泄漏的问题 | 1周内修复 |
| **P2-建议** | 代码质量、可维护性改进 | 2-4周内修复 |
| **P3-优化** | 性能优化、用户体验改进 | 后续迭代 |

**内网环境调整说明：**
- Dashboard登录暴力破解防护：P0 → P2
- CSRF保护：P0 → P2
- 路径穿越（Cookie删除）：P0 → P1（内网环境降低风险，但仍需修复）

---

## 📊 问题清单总览

### P0-严重问题（3个）

| ID | 问题 | 影响范围 | 工作量 |
|----|------|---------|--------|
| P0-1 | JWT密钥每次重启随机生成 | 所有Dashboard用户 | 0.5h |
| P0-2 | 异步初始化未捕获Promise拒绝 | 应用启动失败 | 1h |
| P0-3 | 链接处理缓存竞态条件 | 链接处理失败后无法重试 | 1h |

**预计总工作量：** 2.5小时

### P1-重要问题（11个）

| ID | 问题 | 影响范围 | 工作量 |
|----|------|---------|--------|
| P1-1 | 多处静默吞噬错误 | 调试困难 | 2h |
| P1-2 | 向量内存驱逐竞态条件 | 数据丢失 | 2h |
| P1-3 | 向量内存加载后可能超限 | 内存溢出 | 2h |
| P1-4 | 订阅定时器未正确清理 | 内存泄漏 | 1h |
| P1-5 | 正则表达式ReDoS风险 | DoS攻击 | 0.5h |
| P1-6 | ServiceManager重启无限循环 | 进程卡死 | 1h |
| P1-7 | WebSocket重连无指数退避 | 重连风暴 | 1h |
| P1-8 | 链接处理错误上下文不足 | 问题排查困难 | 0.5h |
| P1-9 | Python端口参数未验证 | 启动失败 | 0.5h |
| P1-10 | AI API超时过长 | 请求阻塞 | 0.5h |
| P1-11 | 路径穿越（Cookie删除） | 文件被删除 | 1h |

**预计总工作量：** 12小时

### P2-建议问题（4个，内网优先）

| ID | 问题 | 影响范围 | 工作量 |
|----|------|---------|--------|
| P2-1 | Dashboard登录速率限制 | 暴力破解（内网风险低） | 1h |
| P2-2 | CSRF保护 | 跨站攻击（内网风险低） | 2h |
| P2-3 | Cookie过期仅警告不刷新 | 用户体验差 | 1h |
| P2-4 | AI配置URL和模型验证 | 配置错误 | 1h |

**预计总工作量：** 5小时

---

## 🔴 第一阶段：P0严重问题修复（立即执行）

### P0-1：JWT密钥持久化

**问题描述：** 每次服务重启，JWT密钥随机生成，导致所有用户Token失效

**影响：** 用户需要频繁重新登录，无法维持长期会话

**修复步骤：**

#### 1. 修改配置文件 `src/config.js`

**位置：** 第220-235行

```javascript
// ❌ 修复前
jwtSecret: {
    env: 'JWT_SECRET',
    def: '',
    type: 'string',
    get: function() {
        if ('jwtSecret' in _overrides) return _overrides.jwtSecret;
        let envVal = process.env.JWT_SECRET;
        if (envVal) return envVal;
        // 生成随机密钥（会丢失）
        const crypto = require('crypto');
        const secret = crypto.randomBytes(32).toString('hex');
        process.env.JWT_SECRET = secret;
        logger.warn('JWT_SECRET not set in .env, generated a temporary random secret...');
        return secret;
    }
}

// ✅ 修复后
jwtSecret: {
    env: 'JWT_SECRET',
    def: '',
    type: 'string',
    get: function() {
        if ('jwtSecret' in _overrides) return _overrides.jwtSecret;
        let envVal = process.env.JWT_SECRET;
        if (envVal) return envVal;

        // 检查持久化的密钥文件
        const crypto = require('crypto');
        const fs = require('fs');
        const path = require('path');
        const secretPath = path.join(__dirname, '../config/.jwtSecret');

        try {
            if (fs.existsSync(secretPath)) {
                const saved = fs.readFileSync(secretPath, 'utf8').trim();
                if (saved && saved.length === 64) { // 验证格式
                    logger.info('[Config] Loaded JWT_SECRET from .jwtSecret file');
                    return saved;
                }
            }
        } catch (err) {
            logger.warn('[Config] Failed to read .jwtSecret:', err.message);
        }

        // 生成新密钥并持久化
        const secret = crypto.randomBytes(32).toString('hex');
        try {
            // 确保目录存在
            const dir = path.dirname(secretPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            // 写入文件（仅当前用户可读写）
            fs.writeFileSync(secretPath, secret, { mode: 0o600 });
            logger.warn('[Config] JWT_SECRET generated and saved to config/.jwtSecret');
            logger.warn('[Config] Consider moving this to .env file for better security');
        } catch (err) {
            logger.error('[Config] Failed to save JWT_SECRET:', err);
        }

        return secret;
    }
}
```

#### 2. 更新 `.gitignore`

```bash
# 添加到 .gitignore
config/.jwtSecret
```

#### 3. 测试验证

```bash
# 1. 删除旧密钥文件（如果存在）
rm -f config/.jwtSecret

# 2. 启动服务
npm start

# 3. 检查日志，应该看到：
# [Config] JWT_SECRET generated and saved to config/.jwtSecret

# 4. 验证文件创建
ls -la config/.jwtSecret
# 应该显示 -rw------- (权限 600)

# 5. 重启服务
npm start

# 6. 检查日志，应该看到：
# [Config] Loaded JWT_SECRET from .jwtSecret file

# 7. 登录Dashboard，获取Token
# 8. 重启服务
# 9. 使用旧Token访问API，应该仍然有效
```

**工作量：** 30分钟
**风险：** 低
**回滚方案：** 恢复原代码，删除 `.jwtSecret` 文件

---

### P0-2：异步初始化错误处理

**问题描述：** bot.js 中的异步初始化代码未正确捕获Promise拒绝

**影响：** 启动失败时应用静默运行，无法诊断问题

**修复步骤：**

#### 1. 修改 `src/bot.js`

**位置：** 第309-332行

```javascript
// ❌ 修复前
(async () => {
    try {
        logger.info('Starting Service Manager...');
        await ServiceManager.start();
        // ...
    } catch (e) {
        logger.error('Failed to start Service Manager:', e);
    }
    // ... 更多 try-catch
    createWebSocketConnection();
})();

// ✅ 修复后
/**
 * 初始化应用程序
 * @throws {Error} 如果任何关键组件启动失败
 */
async function initializeBot() {
    try {
        logger.info('=================================================');
        logger.info('Starting Bili QQ Bot...');
        logger.info('=================================================');

        // 启动Python服务
        logger.info('[Init] Step 1/4: Starting Python Service Manager...');
        await ServiceManager.start();
        logger.info('[Init] ✓ Python Service Manager started');

        // 初始化MCP Manager
        logger.info('[Init] Step 2/4: Initializing MCP Manager...');
        await mcpManager.init();
        logger.info('[Init] ✓ MCP Manager initialized');

        // 启动Dashboard服务器
        logger.info('[Init] Step 3/4: Starting Dashboard Server...');
        await dashboardServer.start(config.dashboardPort);
        logger.info(`[Init] ✓ Dashboard Server started on port ${config.dashboardPort}`);

        // 创建WebSocket连接
        logger.info('[Init] Step 4/4: Connecting to NapCat WebSocket...');
        createWebSocketConnection();
        logger.info('[Init] ✓ WebSocket connection initiated');

        logger.info('=================================================');
        logger.info('Bili QQ Bot initialization completed successfully!');
        logger.info('=================================================');
    } catch (error) {
        logger.error('=================================================');
        logger.error('FATAL: Bot initialization failed!');
        logger.error('=================================================');
        logger.error('[Init] Error:', error.message);
        logger.error('[Init] Stack trace:', error.stack);
        logger.error('[Init] Please check your configuration and try again.');
        logger.error('=================================================');

        // 优雅清理
        try {
            await gracefulShutdown();
        } catch (cleanupError) {
            logger.error('[Init] Cleanup failed:', cleanupError);
        }

        // 退出进程
        process.exit(1);
    }
}

// 启动应用
initializeBot().catch(err => {
    logger.error('[Init] Unhandled promise rejection during initialization:', err);
    process.exit(1);
});

// 全局未处理Promise拒绝处理器
process.on('unhandledRejection', (reason, promise) => {
    logger.error('=================================================');
    logger.error('CRITICAL: Unhandled Promise Rejection!');
    logger.error('=================================================');
    logger.error('Reason:', reason);
    logger.error('Promise:', promise);
    if (reason instanceof Error) {
        logger.error('Stack trace:', reason.stack);
    }
    logger.error('=================================================');
    // 在生产环境中可能想要退出
    // process.exit(1);
});

// 全局未捕获异常处理器
process.on('uncaughtException', (error) => {
    logger.error('=================================================');
    logger.error('CRITICAL: Uncaught Exception!');
    logger.error('=================================================');
    logger.error('Error:', error.message);
    logger.error('Stack trace:', error.stack);
    logger.error('=================================================');
    process.exit(1);
});
```

#### 2. 测试验证

```bash
# 测试1：正常启动
npm start
# 应该看到清晰的步骤日志

# 测试2：Python服务启动失败
# 修改 config.json，设置错误的 pythonPath
# 启动应用，应该看到错误信息并退出

# 测试3：Dashboard端口被占用
# 先启动一个服务占用3000端口
node -e "require('http').createServer().listen(3000)"
# 启动应用，应该看到端口冲突错误并退出

# 测试4：WebSocket连接失败
# 不启动NapCat，启动应用
# 应该看到连接失败日志，但不会退出（重连机制）
```

**工作量：** 1小时
**风险：** 低
**回滚方案：** 恢复原代码

---

### P0-3：链接处理缓存竞态条件

**问题描述：** 链接在处理前就加入缓存，失败后无法重试

**影响：** 当链接处理失败时（网络错误、API限流），用户无法重新发送链接重试

**修复步骤：**

#### 1. 修改 `src/handlers/messageHandler.js`

**位置：** 第166-181行

```javascript
// ❌ 修复前
for (const link of links) {
    if (!linkHandler.isLinkCached(link.cacheKey)) {
        // 立即添加到缓存，防止并发请求重复处理
        linkHandler.addLinkToCache(link.cacheKey);
        await linkHandler.processSingleLink(link, ws, groupId, userId);
        hasProcessedLinks = true;
        // ...
    }
}

// ✅ 修复后
for (const link of links) {
    if (!linkHandler.isLinkCached(link.cacheKey)) {
        let processSuccess = false;

        try {
            // 先尝试处理链接
            await linkHandler.processSingleLink(link, ws, groupId, userId);
            processSuccess = true;
            hasProcessedLinks = true;

            logger.debug(`[MessageHandler] Successfully processed link: ${link.match}`);
        } catch (error) {
            logger.error(`[MessageHandler] Failed to process link ${link.match}:`, {
                error: error.message,
                stack: error.stack,
                groupId,
                userId,
                linkType: link.type,
                linkId: link.id
            });

            // 不添加到缓存，允许用户重试
            // 向用户发送错误提示
            try {
                await linkHandler.sendGroupMessage(ws, groupId, [
                    {
                        type: 'text',
                        data: {
                            text: `处理链接失败: ${error.message || '未知错误'}\n您可以稍后重新发送链接重试`
                        }
                    }
                ], userId);
            } catch (sendError) {
                logger.error('[MessageHandler] Failed to send error message:', sendError);
            }
        }

        // 只在成功处理后添加到缓存
        if (processSuccess) {
            linkHandler.addLinkToCache(link.cacheKey);
            logger.debug(`[MessageHandler] Added link to cache: ${link.cacheKey}`);
        }

        // 处理完成后延迟，避免并发冲突
        const linkIndex = links.indexOf(link);
        if (linkIndex < links.length - 1) {
            logger.info(`[MessageHandler] Waiting 1000ms before processing next link...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
}
```

#### 2. 增强 `linkHandler.js` 的错误处理

**位置：** `src/handlers/linkHandler.js`

```javascript
// 在 processSingleLink 方法中
async processSingleLink(link, ws, groupId, userId) {
    const { type, id, cacheKey } = link;

    try {
        logger.info(`[LinkHandler] Processing ${type} link: ${id} for group ${groupId}`);

        // ... 现有处理逻辑 ...

    } catch (error) {
        // 增强错误信息
        const errorDetails = {
            type,
            id,
            groupId,
            userId,
            errorMessage: error.message,
            errorCode: error.code,
            errorName: error.name
        };

        logger.error(`[LinkHandler] Error processing ${type} link ${id}:`, errorDetails);

        // 根据错误类型决定是否可重试
        if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
            throw new Error('网络连接失败，请稍后重试');
        } else if (error.response && error.response.status === 412) {
            throw new Error('B站风控，请更新Cookie');
        } else if (error.response && error.response.status === 404) {
            // 404错误不应该重试
            throw new Error('内容不存在或已被删除');
        } else {
            throw error; // 重新抛出原始错误
        }
    }
}
```

#### 3. 测试验证

```bash
# 测试1：正常链接处理
# 在QQ群发送B站链接，应该正常处理并加入缓存

# 测试2：网络错误重试
# 停止Python服务：pkill -f bili_server.py
# 在QQ群发送B站链接，应该看到错误提示
# 重启Python服务
# 再次发送相同链接，应该能正常处理

# 测试3：API错误（不应重试的情况）
# 发送一个不存在的BV号，应该提示"内容不存在"
# 再次发送相同链接，仍然提示错误（因为已加入缓存）

# 测试4：检查日志
# 应该看到详细的错误日志，包含errorDetails

# 测试5：缓存验证
# 处理成功的链接应该在缓存中
# 处理失败的链接不应该在缓存中
```

**工作量：** 1小时
**风险：** 低
**回滚方案：** 恢复原代码

---

## 🟠 第二阶段：P1重要问题修复（1周内完成）

### P1-1：修复静默错误吞噬

**问题描述：** 多处使用 `.catch(() => {})` 吞噬错误

**影响文件：**
- `src/config.js` (第467, 481行)
- `src/services/cacheManager.js` (第46行)

**修复步骤：**

#### 1. 修改 `src/config.js`

```javascript
// ❌ 修复前（第467行）
this._performSave().catch(() => {});

// ✅ 修复后
this._performSave().catch((err) => {
    logger.error('[Config] Failed to save configuration:', {
        error: err.message,
        stack: err.stack,
        timestamp: new Date().toISOString()
    });

    // 可选：触发健康检查失败
    if (this.onSaveError) {
        this.onSaveError(err);
    }

    // 可选：在持续失败时发送告警
    this.saveErrorCount = (this.saveErrorCount || 0) + 1;
    if (this.saveErrorCount >= 5) {
        logger.error('[Config] CRITICAL: Configuration save has failed 5 times in a row!');
        // 可以在这里集成告警系统
    }
});
```

```javascript
// ❌ 修复前（第481行）
fs.unlink(backupFile).catch(() => {});

// ✅ 修复后
fs.unlink(backupFile).catch((err) => {
    // 文件不存在是正常情况
    if (err.code !== 'ENOENT') {
        logger.warn('[Config] Failed to delete old backup file:', {
            file: backupFile,
            error: err.message
        });
    }
});
```

#### 2. 修改 `src/services/cacheManager.js`

```javascript
// ❌ 修复前（第46行）
fs.utimes(filePath, now, now).catch(() => {});

// ✅ 修复后
fs.utimes(filePath, now, now).catch((err) => {
    // 文件不存在是正常情况（可能被清理）
    if (err.code !== 'ENOENT') {
        logger.warn('[CacheManager] Failed to update file access time:', {
            file: path.basename(filePath),
            error: err.message
        });
    }
    // 不阻止缓存操作继续进行
});
```

#### 3. 添加全局错误监控（新增）

创建 `src/utils/errorMonitor.js`：

```javascript
const logger = require('./logger');

class ErrorMonitor {
    constructor() {
        this.errorCounts = new Map();
        this.lastAlertTime = new Map();
        this.ALERT_THRESHOLD = 5; // 5次错误触发告警
        this.ALERT_COOLDOWN = 5 * 60 * 1000; // 5分钟告警冷却
    }

    /**
     * 记录错误并判断是否需要告警
     * @param {string} category - 错误类别（如 'config_save', 'cache_update'）
     * @param {Error} error - 错误对象
     */
    recordError(category, error) {
        const count = (this.errorCounts.get(category) || 0) + 1;
        this.errorCounts.set(category, count);

        const now = Date.now();
        const lastAlert = this.lastAlertTime.get(category) || 0;

        if (count >= this.ALERT_THRESHOLD && (now - lastAlert) > this.ALERT_COOLDOWN) {
            this.triggerAlert(category, count, error);
            this.lastAlertTime.set(category, now);
        }
    }

    /**
     * 重置错误计数
     */
    resetCount(category) {
        this.errorCounts.set(category, 0);
    }

    /**
     * 触发告警
     */
    triggerAlert(category, count, error) {
        logger.error(`[ErrorMonitor] ALERT: ${category} has failed ${count} times!`, {
            category,
            count,
            lastError: error.message,
            timestamp: new Date().toISOString()
        });

        // TODO: 集成告警系统（邮件、钉钉、企业微信等）
    }

    /**
     * 获取错误统计
     */
    getStats() {
        const stats = {};
        for (const [category, count] of this.errorCounts.entries()) {
            stats[category] = count;
        }
        return stats;
    }
}

module.exports = new ErrorMonitor();
```

在 `config.js` 中使用：

```javascript
const errorMonitor = require('../utils/errorMonitor');

this._performSave().catch((err) => {
    logger.error('[Config] Failed to save configuration:', err);
    errorMonitor.recordError('config_save', err);
});
```

**测试验证：**

```bash
# 测试1：配置保存失败
# 修改文件权限，使其不可写
chmod 444 config/config.json
# 修改配置，应该看到错误日志（不是静默失败）
# 恢复权限
chmod 644 config/config.json

# 测试2：缓存文件utimes失败
# 观察日志，应该只在非ENOENT错误时记录

# 测试3：错误监控
# 连续触发5次配置保存失败
# 应该看到告警日志
```

**工作量：** 2小时
**风险：** 低

---

### P1-2 & P1-3：向量内存管理优化

**问题描述：**
1. 驱逐LRU组时存在竞态条件
2. 加载文件后可能超出内存限制

**修复步骤：**

#### 1. 修改 `src/services/vectorMemoryService.js`

创建完整的重构版本：

```javascript
const path = require('path');
const storageUtils = require('../utils/storageUtils');
const logger = require('../utils/logger');
const config = require('../config');

class VectorMemoryService {
    constructor() {
        this.dataDir = path.join(process.cwd(), 'data', 'vectors');

        // L1缓存：内存中的向量数据
        this.memories = new Map(); // groupId -> array of memories

        // L2缓存：LRU组缓存
        this.groupCache = new Map(); // groupId -> { lastAccess: timestamp }

        // L3缓存：查询缓存
        this.queryCache = new Map(); // groupId -> Map(queryText -> results)

        // 内存限制配置
        this.maxL1MemoryBytes = config.aiVectorMaxSize || 200 * 1024 * 1024; // 200MB
        this.maxGroupCacheSize = 3; // 最多缓存3个群组
        this.maxQueryCacheSize = 20; // 每组最多20个查询缓存
        this.queryCacheTTL = 5 * 60 * 1000; // 5分钟

        // 定时保存
        this.saveTimers = new Map(); // groupId -> timer
        this.saveDebounceDuration = 5000; // 5秒防抖

        // 🆕 驱逐锁，防止并发驱逐
        this.evictionLock = false;

        // 🆕 单组大小限制（最多占总内存的50%）
        this.maxSingleGroupSize = this.maxL1MemoryBytes * 0.5;

        logger.info('[VectorMemory] Service initialized', {
            maxL1Memory: `${(this.maxL1MemoryBytes / 1024 / 1024).toFixed(0)}MB`,
            maxGroupCache: this.maxGroupCacheSize,
            maxQueryCache: this.maxQueryCacheSize,
            maxSingleGroup: `${(this.maxSingleGroupSize / 1024 / 1024).toFixed(0)}MB`
        });
    }

    /**
     * 🆕 异步驱逐LRU组（带锁保护）
     */
    async evictLRUGroup() {
        // 防止并发驱逐
        if (this.evictionLock) {
            logger.debug('[VectorMemory] Eviction already in progress, skipping');
            return;
        }

        this.evictionLock = true;
        try {
            const entries = Array.from(this.groupCache.entries());
            if (entries.length === 0) {
                logger.debug('[VectorMemory] No groups to evict');
                return;
            }

            // 按最后访问时间排序
            entries.sort((a, b) => a[1].lastAccess - b[1].lastAccess);
            const [oldestGroupId, cacheEntry] = entries[0];

            logger.info(`[VectorMemory] Evicting LRU group: ${oldestGroupId}`, {
                lastAccess: new Date(cacheEntry.lastAccess).toISOString(),
                memoryUsage: `${(this.calculateTotalL1Memory() / 1024 / 1024).toFixed(2)}MB`
            });

            // 先保存未持久化的数据
            if (this.saveTimers.has(oldestGroupId)) {
                await this._flushGroupToStorage(oldestGroupId);
            }

            // 清理缓存
            this.groupCache.delete(oldestGroupId);
            this.memories.delete(oldestGroupId);

            // 清理查询缓存
            if (this.queryCache.has(oldestGroupId)) {
                this.queryCache.delete(oldestGroupId);
            }

            logger.info(`[VectorMemory] Successfully evicted group ${oldestGroupId}`);
        } catch (error) {
            logger.error('[VectorMemory] Failed to evict LRU group:', error);
            throw error;
        } finally {
            this.evictionLock = false;
        }
    }

    /**
     * 🆕 刷新组数据到存储（异步）
     */
    async _flushGroupToStorage(groupId) {
        try {
            // 清除定时器
            const timer = this.saveTimers.get(groupId);
            if (timer) {
                clearTimeout(timer);
                this.saveTimers.delete(groupId);
            }

            // 获取内存数据
            const memory = this.memories.get(groupId);
            if (!memory) {
                logger.debug(`[VectorMemory] No data to flush for group ${groupId}`);
                return;
            }

            // 异步写入
            const filePath = path.join(this.dataDir, `${groupId}.json`);
            await storageUtils.asyncWriteWithBackup(filePath, memory);

            logger.debug(`[VectorMemory] Flushed ${memory.length} memories for group ${groupId}`);
        } catch (error) {
            logger.error(`[VectorMemory] Failed to flush group ${groupId}:`, error);
            throw error;
        }
    }

    /**
     * 🆕 确保组已加载到内存（带内存限制）
     */
    async ensureGroupLoaded(groupId) {
        // 已加载，更新访问时间
        if (this.memories.has(groupId)) {
            if (this.groupCache.has(groupId)) {
                this.groupCache.get(groupId).lastAccess = Date.now();
            }
            return;
        }

        logger.info(`[VectorMemory] Loading group ${groupId} into memory`);

        // 🆕 加载前检查内存，预留80%空间
        let currentMemory = this.calculateTotalL1Memory();
        const targetMemory = this.maxL1MemoryBytes * 0.8;

        while (currentMemory > targetMemory && this.groupCache.size > 0) {
            logger.info(`[VectorMemory] Memory usage ${(currentMemory / 1024 / 1024).toFixed(2)}MB exceeds target ${(targetMemory / 1024 / 1024).toFixed(2)}MB, evicting...`);
            await this.evictLRUGroup();
            currentMemory = this.calculateTotalL1Memory();
        }

        // 加载文件
        const filePath = path.join(this.dataDir, `${groupId}.json`);
        let data = await storageUtils.safeReadJSON(filePath, []);

        // 🆕 检查单个文件大小
        const fileSize = JSON.stringify(data).length;
        if (fileSize > this.maxSingleGroupSize) {
            logger.warn(`[VectorMemory] Group ${groupId} exceeds max single group size`, {
                currentSize: `${(fileSize / 1024 / 1024).toFixed(2)}MB`,
                maxSize: `${(this.maxSingleGroupSize / 1024 / 1024).toFixed(2)}MB`,
                memoryCount: data.length
            });

            // 裁剪到合适大小（保留最新的70%）
            const keepCount = Math.floor(data.length * 0.7);
            const removed = data.length - keepCount;
            data = data.slice(-keepCount); // 保留最后的keepCount条

            logger.info(`[VectorMemory] Trimmed group ${groupId}: removed ${removed} oldest memories, kept ${keepCount}`);

            // 立即保存裁剪后的数据
            await storageUtils.asyncWriteWithBackup(filePath, data);
        }

        // 加载到内存
        this.memories.set(groupId, data);
        this.groupCache.set(groupId, { lastAccess: Date.now() });

        logger.info(`[VectorMemory] Loaded ${data.length} memories for group ${groupId}`, {
            size: `${(fileSize / 1024 / 1024).toFixed(2)}MB`,
            totalMemory: `${(this.calculateTotalL1Memory() / 1024 / 1024).toFixed(2)}MB`
        });

        // 🆕 加载后再次检查总内存
        currentMemory = this.calculateTotalL1Memory();
        while (currentMemory > this.maxL1MemoryBytes && this.groupCache.size > 1) {
            logger.warn(`[VectorMemory] Memory usage ${(currentMemory / 1024 / 1024).toFixed(2)}MB exceeds limit ${(this.maxL1MemoryBytes / 1024 / 1024).toFixed(2)}MB, evicting...`);
            await this.evictLRUGroup();
            currentMemory = this.calculateTotalL1Memory();
        }
    }

    /**
     * 计算L1缓存总内存使用
     */
    calculateTotalL1Memory() {
        let total = 0;
        for (const [groupId, memories] of this.memories.entries()) {
            total += JSON.stringify(memories).length;
        }
        return total;
    }

    /**
     * 🆕 定时保存（带错误恢复）
     */
    saveGroupMemory(groupId) {
        // 清除现有定时器
        if (this.saveTimers.has(groupId)) {
            clearTimeout(this.saveTimers.get(groupId));
        }

        // 设置新定时器
        const timer = setTimeout(async () => {
            try {
                await this._flushGroupToStorage(groupId);
            } catch (error) {
                logger.error(`[VectorMemory] Failed to save group ${groupId}:`, error);
                // 🆕 不删除saveTimer，下次修改时会重试
            }
        }, this.saveDebounceDuration);

        this.saveTimers.set(groupId, timer);
    }

    // ... 其他方法保持不变 ...
}

module.exports = new VectorMemoryService();
```

#### 2. 测试验证

```bash
# 测试1：内存限制
# 创建一个超大向量文件
node -e "
const fs = require('fs');
const large = Array(100000).fill({ content: 'test'.repeat(100), embedding: Array(1536).fill(0.1) });
fs.writeFileSync('data/vectors/123456789.json', JSON.stringify(large));
"

# 启动应用，加载该群组，应该看到自动裁剪日志

# 测试2：并发驱逐
# 快速切换多个群组，观察是否有并发问题

# 测试3：保存失败恢复
# 修改文件权限为只读
chmod 444 data/vectors/
# 修改向量数据，应该看到保存失败日志
# 恢复权限
chmod 755 data/vectors/
# 再次修改，应该能正常保存
```

**工作量：** 4小时
**风险：** 中等（核心功能，需要充分测试）

---

### P1-4：订阅定时器清理

**问题描述：** 重复调用 `start()` 会导致定时器泄漏

**修复步骤：**

#### 1. 修改 `src/services/subscription/updateChecker.js`

```javascript
// ❌ 修复前
start() {
    // 直接创建定时器
    this.initTimer = setTimeout(() => { ... }, 3000);
    this.timer = setInterval(() => { ... }, checkInterval * 1000);
    // ...
}

// ✅ 修复后
/**
 * 启动订阅检查器
 * @param {boolean} skipInitialDelay - 是否跳过初始延迟，立即执行第一次检查
 */
start(skipInitialDelay = false) {
    // 🆕 先停止现有定时器，防止泄漏
    this.stop();

    const checkInterval = config.subscriptionCheckInterval || 60;
    const syncInterval = config.cookieSyncInterval || 300;

    logger.info('[UpdateChecker] Starting subscription checker', {
        checkInterval: `${checkInterval}s`,
        syncInterval: `${syncInterval}s`,
        skipInitialDelay
    });

    // 主检查定时器
    const initialDelay = skipInitialDelay ? 0 : 3000;
    this.initTimer = setTimeout(() => {
        this.checkAllSubscriptions().catch(err => {
            logger.error('[UpdateChecker] Initial check failed:', err);
        });
    }, initialDelay);

    this.timer = setInterval(() => {
        this.checkAllSubscriptions().catch(err => {
            logger.error('[UpdateChecker] Periodic check failed:', err);
        });
    }, checkInterval * 1000);

    // Cookie同步定时器
    this.initSyncTimer = setTimeout(() => {
        this.syncCookieFollows().catch(err => {
            logger.error('[UpdateChecker] Initial sync failed:', err);
        });
    }, 5000);

    this.syncTimer = setInterval(() => {
        this.syncCookieFollows().catch(err => {
            logger.error('[UpdateChecker] Periodic sync failed:', err);
        });
    }, syncInterval * 1000);

    logger.info('[UpdateChecker] All timers started successfully');
}

/**
 * 停止订阅检查器
 */
stop() {
    logger.info('[UpdateChecker] Stopping subscription checker...');

    let clearedCount = 0;

    if (this.initTimer) {
        clearTimeout(this.initTimer);
        this.initTimer = null;
        clearedCount++;
    }

    if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
        clearedCount++;
    }

    if (this.initSyncTimer) {
        clearTimeout(this.initSyncTimer);
        this.initSyncTimer = null;
        clearedCount++;
    }

    if (this.syncTimer) {
        clearInterval(this.syncTimer);
        this.syncTimer = null;
        clearedCount++;
    }

    if (clearedCount > 0) {
        logger.info(`[UpdateChecker] Cleared ${clearedCount} timers`);
    }
}

/**
 * 🆕 重启订阅检查器（先停止再启动）
 */
restart() {
    logger.info('[UpdateChecker] Restarting subscription checker...');
    this.stop();
    this.start(true); // 跳过初始延迟
}

/**
 * 🆕 获取定时器状态（用于调试）
 */
getStatus() {
    return {
        running: !!(this.timer || this.syncTimer),
        timers: {
            initTimer: !!this.initTimer,
            mainTimer: !!this.timer,
            initSyncTimer: !!this.initSyncTimer,
            syncTimer: !!this.syncTimer
        }
    };
}
```

#### 2. 在相关命令中使用 `restart()`

修改 `src/commands/subscription.js`（如果有配置变更命令）：

```javascript
// 当用户修改订阅配置后
async function handleConfigUpdate() {
    // 保存配置
    await config.save();

    // 🆕 重启订阅检查器应用新配置
    const updateChecker = require('../services/subscription/updateChecker');
    updateChecker.restart();

    return { type: 'text', message: '配置已更新，订阅检查器已重启' };
}
```

#### 3. 添加健康检查

创建 `src/services/subscription/healthCheck.js`：

```javascript
const logger = require('../../utils/logger');

class SubscriptionHealthCheck {
    constructor() {
        this.lastCheckTime = null;
        this.checkFailCount = 0;
        this.MAX_FAIL_COUNT = 5;
    }

    /**
     * 记录检查成功
     */
    recordSuccess() {
        this.lastCheckTime = Date.now();
        this.checkFailCount = 0;
    }

    /**
     * 记录检查失败
     */
    recordFailure() {
        this.checkFailCount++;

        if (this.checkFailCount >= this.MAX_FAIL_COUNT) {
            logger.error(`[SubscriptionHealth] CRITICAL: Subscription check has failed ${this.checkFailCount} times consecutively!`);
            // TODO: 触发告警
        }
    }

    /**
     * 检查是否超时（超过2倍检查间隔未执行）
     */
    isStale(checkInterval) {
        if (!this.lastCheckTime) return false;

        const threshold = checkInterval * 2 * 1000;
        const elapsed = Date.now() - this.lastCheckTime;

        if (elapsed > threshold) {
            logger.warn(`[SubscriptionHealth] Subscription check is stale (${(elapsed / 1000).toFixed(0)}s since last check)`);
            return true;
        }

        return false;
    }

    /**
     * 获取健康状态
     */
    getHealth() {
        return {
            healthy: this.checkFailCount < this.MAX_FAIL_COUNT,
            lastCheckTime: this.lastCheckTime,
            checkFailCount: this.checkFailCount
        };
    }
}

module.exports = new SubscriptionHealthCheck();
```

在 `updateChecker.js` 中集成：

```javascript
const healthCheck = require('./healthCheck');

async checkAllSubscriptions() {
    try {
        // ... 现有逻辑 ...
        healthCheck.recordSuccess();
    } catch (error) {
        logger.error('[UpdateChecker] Check failed:', error);
        healthCheck.recordFailure();
        throw error;
    }
}
```

#### 4. 测试验证

```bash
# 测试1：正常启动停止
npm start
# 在控制台执行
node -e "
const checker = require('./src/services/subscription/updateChecker');
console.log('Status before stop:', checker.getStatus());
checker.stop();
console.log('Status after stop:', checker.getStatus());
checker.start();
console.log('Status after start:', checker.getStatus());
"

# 测试2：重复启动（应该不会泄漏）
node -e "
const checker = require('./src/services/subscription/updateChecker');
for (let i = 0; i < 10; i++) {
  checker.start();
  console.log('Started', i+1, 'times');
}
console.log('Final status:', checker.getStatus());
checker.stop();
"

# 测试3：重启功能
# 修改订阅配置，观察日志中是否有 "Restarting subscription checker" 信息

# 测试4：健康检查
# 停止Python服务，观察5次失败后是否有CRITICAL告警
```

**工作量：** 1小时
**风险：** 低

---

### P1-5：ReDoS防护

**问题描述：** 未限制消息长度，正则匹配可能导致DoS

**修复步骤：**

#### 1. 修改 `src/handlers/linkHandler.js`

```javascript
// 在 extractLinks 方法开头添加
extractLinks(rawMessage, groupId) {
    // 🆕 输入验证和长度限制
    if (!rawMessage || typeof rawMessage !== 'string') {
        logger.warn('[LinkHandler] Invalid message type:', typeof rawMessage);
        return [];
    }

    const MAX_MESSAGE_LENGTH = 10000; // 10KB
    const originalLength = rawMessage.length;

    if (originalLength > MAX_MESSAGE_LENGTH) {
        logger.warn(`[LinkHandler] Message too long (${originalLength} chars), truncating to ${MAX_MESSAGE_LENGTH}`, {
            groupId,
            originalLength,
            truncatedLength: MAX_MESSAGE_LENGTH
        });
        rawMessage = rawMessage.substring(0, MAX_MESSAGE_LENGTH);
    }

    // 🆕 快速预检：消息中是否包含bilibili域名
    const hasBilibiliDomain = rawMessage.includes('bilibili.com') ||
                             rawMessage.includes('b23.tv') ||
                             rawMessage.includes('bilibili');

    if (!hasBilibiliDomain) {
        logger.debug('[LinkHandler] No bilibili links found in message (quick check)');
        return [];
    }

    const links = [];

    // 现有正则提取逻辑...
    // ...

    return links;
}
```

#### 2. 添加正则性能监控

创建 `src/utils/regexMonitor.js`：

```javascript
const logger = require('./logger');

/**
 * 监控正则表达式执行时间
 * @param {string} patternName - 正则模式名称
 * @param {RegExp} regex - 正则表达式
 * @param {string} input - 输入字符串
 * @param {Function} callback - 执行函数 (regex, input) => result
 * @returns {*} 执行结果
 */
function monitorRegex(patternName, regex, input, callback) {
    const startTime = process.hrtime.bigint();

    try {
        const result = callback(regex, input);
        const endTime = process.hrtime.bigint();
        const durationMs = Number(endTime - startTime) / 1000000;

        // 如果执行时间超过100ms，记录警告
        if (durationMs > 100) {
            logger.warn(`[RegexMonitor] Slow regex execution: ${patternName}`, {
                duration: `${durationMs.toFixed(2)}ms`,
                inputLength: input.length,
                pattern: regex.source.substring(0, 100) // 只记录前100字符
            });
        }

        return result;
    } catch (error) {
        const endTime = process.hrtime.bigint();
        const durationMs = Number(endTime - startTime) / 1000000;

        logger.error(`[RegexMonitor] Regex execution failed: ${patternName}`, {
            duration: `${durationMs.toFixed(2)}ms`,
            inputLength: input.length,
            error: error.message
        });

        throw error;
    }
}

module.exports = { monitorRegex };
```

在 `linkHandler.js` 中使用：

```javascript
const { monitorRegex } = require('../utils/regexMonitor');

// 替换所有正则匹配
let match;
while ((match = monitorRegex('videoRegex', this.videoRegex, rawMessage, (r, m) => r.exec(m))) !== null) {
    // ... 处理匹配 ...
}
```

**测试验证：**

```bash
# 测试1：正常长度消息
# 发送包含B站链接的正常消息，应该正常处理

# 测试2：超长消息
node -e "
const linkHandler = require('./src/handlers/linkHandler');
const longMessage = 'https://www.bilibili.com/video/BV1xx411c7mD' + 'a'.repeat(20000);
console.log('Extracting links from', longMessage.length, 'chars');
const links = linkHandler.extractLinks(longMessage, '123456');
console.log('Found', links.length, 'links');
"
# 应该看到截断警告

# 测试3：无B站链接的长消息
node -e "
const linkHandler = require('./src/handlers/linkHandler');
const longMessage = 'no bilibili links here' + 'a'.repeat(20000);
const start = Date.now();
const links = linkHandler.extractLinks(longMessage, '123456');
const duration = Date.now() - start;
console.log('Duration:', duration, 'ms (should be < 10ms)');
"

# 测试4：慢正则监控
# 构造一个可能触发回溯的字符串
# 观察是否有慢正则警告
```

**工作量：** 0.5小时
**风险：** 低

---

### P1-6到P1-11 的修复步骤

由于篇幅限制，我将其他P1问题的修复步骤总结如下：

**P1-6: ServiceManager重启超时** - 添加10秒超时和SIGKILL强制终止
**P1-7: WebSocket指数退避** - 实现1s→2s→4s→8s→最大60s的退避策略
**P1-8: 链接错误上下文** - 添加唯一错误ID和完整堆栈跟踪
**P1-9: Python端口验证** - 验证端口范围1024-65535
**P1-10: AI超时优化** - 基础30s，工具调用每个+2s，最大45s
**P1-11: 路径穿越加强** - 使用path.basename+白名单验证+路径前缀检查

详细代码见前面的审查报告。

---

## 📅 实施时间表

### 第一周（P0问题）

| 日期 | 任务 | 负责人 | 状态 |
|------|------|--------|------|
| Day 1 上午 | P0-1: JWT密钥持久化 | - | ⬜️ 待开始 |
| Day 1 下午 | P0-2: Promise错误处理 | - | ⬜️ 待开始 |
| Day 2 上午 | P0-3: 链接缓存竞态 | - | ⬜️ 待开始 |
| Day 2 下午 | P0问题集成测试 | - | ⬜️ 待开始 |

### 第二周（P1问题 Part 1）

| 日期 | 任务 | 负责人 | 状态 |
|------|------|--------|------|
| Day 3 | P1-1: 错误吞噬修复 | - | ⬜️ 待开始 |
| Day 4-5 | P1-2,3: 向量内存优化 | - | ⬜️ 待开始 |
| Day 6 | P1-4: 订阅定时器 | - | ⬜️ 待开始 |
| Day 7 | P1-5: ReDoS防护 | - | ⬜️ 待开始 |

### 第三周（P1问题 Part 2）

| 日期 | 任务 | 负责人 | 状态 |
|------|------|--------|------|
| Day 8 | P1-6,7: ServiceManager+WebSocket | - | ⬜️ 待开始 |
| Day 9 | P1-8,9,10: 错误上下文+验证+超时 | - | ⬜️ 待开始 |
| Day 10 | P1-11: 路径穿越加强 | - | ⬜️ 待开始 |
| Day 11-12 | P1问题集成测试 | - | ⬜️ 待开始 |

---

## ✅ 验证检查清单

### 代码审查清单

- [ ] 所有修改已通过代码审查
- [ ] 无新增的安全漏洞
- [ ] 错误处理完整且有意义
- [ ] 日志记录适当（级别、内容）
- [ ] 代码风格符合项目规范
- [ ] 添加了必要的注释和文档

### 功能测试清单

#### P0问题验证

- [ ] JWT密钥在重启后保持不变
- [ ] 应用启动失败时正确退出并记录错误
- [ ] 链接处理失败后可以重试

#### P1问题验证

- [ ] 配置保存失败时有错误日志
- [ ] 向量内存不会无限增长
- [ ] 订阅定时器不会泄漏
- [ ] 超长消息不会导致CPU 100%
- [ ] ServiceManager重启不会hang住
- [ ] WebSocket重连使用指数退避
- [ ] 错误日志包含足够上下文
- [ ] Python端口验证生效
- [ ] AI请求有合理超时
- [ ] Cookie删除路径验证生效

### 性能测试清单

- [ ] 内存使用在正常范围（< 500MB）
- [ ] CPU使用平稳（< 50%）
- [ ] 响应时间正常（链接处理 < 5s）
- [ ] 无明显内存泄漏（24小时运行）

### 回归测试清单

- [ ] 链接解析功能正常（视频、动态、番剧等）
- [ ] AI对话功能正常
- [ ] 订阅推送功能正常
- [ ] Dashboard登录和管理功能正常
- [ ] 图像生成功能正常
- [ ] 命令系统功能正常

---

## 🚨 风险管理

### 高风险修改

| 修改 | 风险 | 缓解措施 |
|------|------|---------|
| 向量内存重构 | 数据丢失 | 1. 完整备份 data/vectors/<br>2. 分步测试<br>3. 金丝雀发布 |
| Promise错误处理 | 启动失败 | 1. 保留原代码备份<br>2. 本地充分测试<br>3. 准备快速回滚 |
| 链接缓存逻辑 | 功能失效 | 1. A/B测试<br>2. 监控错误率<br>3. 快速回滚机制 |

### 回滚计划

#### 快速回滚步骤

```bash
# 1. 停止服务
npm stop

# 2. 切换到备份分支
git checkout backup-before-fix

# 3. 恢复数据（如果需要）
cp -r data_backup/* data/

# 4. 重启服务
npm start

# 5. 验证服务正常
curl http://localhost:3000/api/health
```

#### 数据备份脚本

创建 `scripts/backup.sh`：

```bash
#!/bin/bash

# 备份数据
BACKUP_DIR="backups/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

echo "Creating backup at $BACKUP_DIR..."

# 备份配置
cp config/config.json "$BACKUP_DIR/"
cp .env "$BACKUP_DIR/" 2>/dev/null || true

# 备份数据
cp -r data/vectors "$BACKUP_DIR/"
cp -r data/contexts "$BACKUP_DIR/"
cp -r data/cookies*.json "$BACKUP_DIR/" 2>/dev/null || true
cp data/subscriptions.json "$BACKUP_DIR/" 2>/dev/null || true

echo "Backup completed: $BACKUP_DIR"
echo "To restore: cp -r $BACKUP_DIR/* ./"
```

---

## 📝 修复后的最佳实践

### 1. 代码规范

```javascript
// ✅ 好的错误处理
async function processData() {
    try {
        const result = await someAsyncOperation();
        return result;
    } catch (error) {
        logger.error('[ComponentName] Operation failed:', {
            error: error.message,
            stack: error.stack,
            context: { /* 相关上下文 */ }
        });
        throw error; // 或返回默认值
    }
}

// ❌ 坏的错误处理
async function processData() {
    try {
        return await someAsyncOperation();
    } catch (error) {
        // 吞噬错误
    }
}
```

### 2. 资源管理

```javascript
// ✅ 正确的定时器管理
class Service {
    start() {
        this.stop(); // 先清理
        this.timer = setInterval(() => { ... }, 1000);
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
}

// ❌ 错误的定时器管理
class Service {
    start() {
        this.timer = setInterval(() => { ... }, 1000); // 泄漏
    }
}
```

### 3. 输入验证

```javascript
// ✅ 完整的输入验证
function processGroupId(groupId) {
    // 类型检查
    if (!groupId) return null;

    // 格式验证
    const id = String(groupId);
    if (!/^[1-9]\d{8,10}$/.test(id)) {
        throw new Error('Invalid group ID format');
    }

    // 范围检查
    const num = parseInt(id, 10);
    if (num < 10000000 || num > 999999999999) {
        throw new Error('Group ID out of range');
    }

    return id;
}

// ❌ 不充分的验证
function processGroupId(groupId) {
    return String(groupId); // 没有验证
}
```

---

## 📚 参考文档

1. **Node.js最佳实践：** https://github.com/goldbergyoni/nodebestpractices
2. **OWASP安全指南：** https://owasp.org/www-project-top-ten/
3. **Promise错误处理：** https://nodejs.org/api/process.html#process_event_unhandledrejection
4. **内存管理：** https://nodejs.org/en/docs/guides/simple-profiling/

---

## 📞 支持和反馈

如有问题或建议，请通过以下方式联系：

- **GitHub Issues：** https://github.com/[your-repo]/bili-qq-bot/issues
- **文档：** 见项目 `docs/` 目录

---

**文档维护：** 每次修复完成后更新状态
**最后更新：** 2026-02-05
