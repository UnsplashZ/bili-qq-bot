# Puppeteer 资源管理 - 快速开始

## 基本使用

所有现有代码无需修改，资源管理是自动的：

```javascript
const imageGenerator = require('./src/services/imageGenerator');

// 1. 生成帮助卡片（资源会自动管理）
const helpImage = await imageGenerator.generateHelpCard('user', groupId);

// 2. 生成订阅列表（资源会自动管理）
const listImage = await imageGenerator.generateSubscriptionList(data, groupId);

// 3. 生成预览卡片（资源会自动管理）
const previewImage = await imageGenerator.generatePreviewCard(data, 'video', groupId);
```

## 监控页面池状态（可选）

```javascript
// 查看当前页面池状态
const stats = imageGenerator.getPoolStats();
console.log(`活跃页面: ${stats.active}/${stats.max}`);
console.log(`可用槽位: ${stats.available}`);
```

## 程序退出时清理（已自动集成）

在 `src/bot.js` 中已经集成，无需额外操作：

```javascript
process.on('SIGINT', gracefulShutdown);   // Ctrl+C
process.on('SIGTERM', gracefulShutdown);  // 系统终止
```

## 配置参数

在 `src/services/imageGenerator/core/browser.js` 中可调整：

```javascript
this.maxPages = 5;           // 最大页面数（建议 3-5）
this.pageTimeout = 30000;    // 页面超时（毫秒）
```

## 测试

运行测试脚本验证资源管理：

```bash
node test-resource-cleanup.js
```

## 自动防护机制

✅ **页面数量限制**：最多同时 5 个页面
✅ **超时自动关闭**：30 秒未使用自动关闭
✅ **异常安全关闭**：错误时也会释放资源
✅ **泄漏检测清理**：每分钟自动检查清理
✅ **优雅退出清理**：程序退出时释放所有资源

## 注意事项

1. **并发限制**：同时生成超过 5 张图片时会排队等待（正常行为）
2. **不要直接操作页面**：使用提供的 API，不要直接调用 `page.close()`
3. **日志级别**：开发时建议 DEBUG，生产环境 WARN 以上

详细说明请查看：`PUPPETEER_RESOURCE_CLEANUP.md`
