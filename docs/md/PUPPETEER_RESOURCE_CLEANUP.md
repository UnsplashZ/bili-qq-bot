# Puppeteer 资源自动清理功能说明

## 概述

本次更新为 Puppeteer 图片生成服务实现了完整的资源自动清理功能，防止内存泄漏和资源耗尽问题。

## 实现的功能

### 1. 页面池管理 (`src/services/imageGenerator/core/browser.js`)

#### 核心特性：
- **页面池追踪**：使用 `Set` 数据结构追踪所有活跃的页面实例
- **并发限制**：最大同时打开 5 个页面（可配置），超过限制时会自动等待
- **页面超时**：每个页面设置 30 秒超时，超时自动关闭
- **定期清理监控**：每分钟自动检查并清理泄漏的页面

#### 新增方法：
```javascript
// 等待页面池有空闲位置
async waitForAvailableSlot()

// 设置页面超时自动清理
setupPageTimeout(page)

// 清除页面超时定时器
clearPageTimeout(page)

// 安全关闭页面
async closePage(page)

// 获取页面池统计信息
getPoolStats()

// 清理所有资源（程序退出时调用）
async cleanup()
```

#### 配置参数：
```javascript
this.maxPages = 5;           // 最大页面数：3-5个
this.pageTimeout = 30000;    // 页面超时：30秒
cleanupInterval = 60000;     // 清理间隔：每分钟
```

### 2. 生成器优化（确保资源释放）

所有生成器函数都已更新为使用 `try-finally` 模式：

#### helpCard.js
```javascript
async function generateHelpCard(type, groupId) {
    const page = await browserManager.createPage({...});
    try {
        // 生成图片逻辑
        return buffer.toString('base64');
    } catch (error) {
        throw error;
    } finally {
        // 确保页面在任何情况下都会被关闭
        await browserManager.closePage(page);
    }
}
```

#### subscriptionList.js
- 同样的 `try-finally` 模式
- 确保即使发生错误也会关闭页面

#### previewCard.js
- 同样的 `try-finally` 模式
- 处理复杂的内容渲染，保证资源释放

### 3. ImageGenerator 主类增强 (`src/services/imageGenerator/index.js`)

新增方法：
```javascript
// 清理所有资源
async cleanup()

// 获取页面池统计信息
getPoolStats()
```

### 4. 程序优雅退出 (`src/bot.js`)

在 `gracefulShutdown` 函数中集成资源清理：
```javascript
async function gracefulShutdown() {
    // ...

    // 清理 Puppeteer 资源
    await imageGenerator.cleanup();

    // ...
}
```

监听信号：
- `SIGINT` (Ctrl+C)
- `SIGTERM` (系统终止)

## 工作流程

### 页面创建流程
```
1. 调用 createPage()
2. ↓ 检查页面池是否已满
3. ↓ 等待空闲位置（如果已满）
4. ↓ 创建新页面
5. ↓ 添加到页面池
6. ↓ 设置超时定时器
7. ↓ 返回页面实例
```

### 页面关闭流程
```
1. 调用 closePage(page)
2. ↓ 清除超时定时器
3. ↓ 从页面池移除
4. ↓ 关闭页面（如果未关闭）
5. ↓ 错误处理（确保从池中移除）
```

### 定期清理流程
```
每 60 秒：
1. 获取浏览器所有页面
2. ↓ 查找未被追踪的页面
3. ↓ 关闭泄漏的页面
4. ↓ 记录页面池状态
```

## 防止内存泄漏的机制

### 1. 并发限制
- 最多同时打开 5 个页面
- 防止创建过多页面导致内存耗尽

### 2. 超时自动关闭
- 每个页面 30 秒超时
- 防止页面长时间占用资源

### 3. Try-Finally 模式
- 确保异常情况下页面也会关闭
- 防止代码异常导致资源泄漏

### 4. 定期清理监控
- 每分钟检查泄漏页面
- 双重保险，捕获遗漏的页面

### 5. 优雅退出
- 程序退出时清理所有资源
- 关闭所有页面和浏览器实例

## 监控和调试

### 查看页面池状态
```javascript
const stats = imageGenerator.getPoolStats();
console.log(stats);
// { active: 2, max: 5, available: 3 }
```

### 日志输出
- `logger.debug`: 页面创建/关闭事件
- `logger.warn`: 页面池满、超时、泄漏检测
- `logger.error`: 清理错误

### 测试脚本
运行测试验证资源清理功能：
```bash
node test-resource-cleanup.js
```

## 性能优化

### 内存使用
- 限制同时打开的页面数
- 及时释放不需要的页面
- 防止内存持续增长

### 响应时间
- 页面池管理避免频繁创建/销毁浏览器
- 超时机制防止长时间等待

### 稳定性
- 错误恢复机制
- 资源泄漏检测
- 优雅退出处理

## 最佳实践

### 1. 始终使用 try-finally
```javascript
const page = await browserManager.createPage({...});
try {
    // 你的代码
} finally {
    await browserManager.closePage(page);
}
```

### 2. 不要直接调用 page.close()
使用 `browserManager.closePage(page)` 以确保正确清理。

### 3. 监控页面池状态
在开发环境中定期检查页面池是否正常工作。

### 4. 配置合适的参数
根据服务器资源调整 `maxPages` 和 `pageTimeout`。

## 注意事项

1. **兼容性**：保持与现有代码的完全兼容，无需修改调用方代码
2. **性能**：页面池限制可能导致高并发时排队，这是正常行为
3. **日志**：开发环境建议开启 debug 日志，生产环境使用 warn 以上级别

## 总结

通过实现页面池管理、超时清理、定期监控和优雅退出，本次更新全面解决了 Puppeteer 内存泄漏问题，提供了稳定可靠的图片生成服务。
