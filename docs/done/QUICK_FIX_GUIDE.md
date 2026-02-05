# 快速修复指南

> 这是一个简化的执行指南，详细的技术文档请参考 [SECURITY_FIX_PLAN.md](./SECURITY_FIX_PLAN.md)

## 🚀 快速开始

### 前置准备（5分钟）

```bash
# 1. 创建修复分支
git checkout -b fix/security-stability

# 2. 备份当前数据
./scripts/backup.sh

# 3. 安装测试依赖（如需要）
npm install

# 4. 记录当前状态
git status
npm test  # 确认测试环境正常
```

---

## 📋 修复检查清单

### 第一天（2.5小时）- P0严重问题

#### ✅ P0-1: JWT密钥持久化 (30分钟)

**文件：** `src/config.js` (第220-235行)

**任务：**
- [ ] 添加 `.jwtSecret` 文件读取逻辑
- [ ] 添加密钥生成和保存逻辑
- [ ] 设置文件权限为 600
- [ ] 更新 `.gitignore` 排除密钥文件

**验证：**
```bash
# 删除旧密钥（如果存在）
rm -f config/.jwtSecret

# 启动服务
npm start

# 检查文件创建
ls -la config/.jwtSecret  # 应该显示 -rw-------

# 重启服务，验证密钥保持不变
npm start
```

**完成标志：** 服务重启后JWT Token仍然有效

---

#### ✅ P0-2: Promise错误处理 (1小时)

**文件：** `src/bot.js` (第309-332行)

**任务：**
- [ ] 创建 `initializeBot()` 异步函数
- [ ] 包装所有初始化调用在 try-catch 中
- [ ] 添加清晰的步骤日志
- [ ] 添加 `unhandledRejection` 全局处理器
- [ ] 添加 `uncaughtException` 全局处理器

**验证：**
```bash
# 测试正常启动
npm start

# 测试启动失败（修改配置触发错误）
# 应该看到清晰的错误信息和退出
```

**完成标志：** 启动失败时有清晰错误日志并正确退出

---

#### ✅ P0-3: 链接缓存竞态 (1小时)

**文件：** `src/handlers/messageHandler.js` (第166-181行)

**任务：**
- [ ] 添加 `processSuccess` 标志变量
- [ ] 在 try-catch 中处理链接
- [ ] 只在成功后添加到缓存
- [ ] 失败时向用户发送错误提示

**验证：**
```bash
# 1. 停止Python服务
pkill -f bili_server.py

# 2. 发送B站链接到QQ群
# 应该看到错误提示，缓存中不应有该链接

# 3. 重启Python服务
npm start

# 4. 再次发送相同链接
# 应该能正常处理
```

**完成标志：** 链接处理失败后可以重试成功

---

### 第二天（12小时）- P1重要问题

#### ✅ P1-1: 修复静默错误 (2小时)

**影响文件：**
- `src/config.js` (第467, 481行)
- `src/services/cacheManager.js` (第46行)

**快速修复：**
```bash
# 搜索所有空catch块
grep -rn "\.catch(() => {})" src/

# 每个空catch都改为记录错误
.catch((err) => {
    logger.error('[Component] Operation failed:', err);
});
```

**验证：** 不应该再有 `() => {}` 的空catch块

---

#### ✅ P1-2&3: 向量内存优化 (4小时)

**文件：** `src/services/vectorMemoryService.js`

**任务：**
- [ ] 添加驱逐锁 `evictionLock`
- [ ] 实现异步 `evictLRUGroup()`
- [ ] 实现 `_flushGroupToStorage()`
- [ ] 在 `ensureGroupLoaded()` 中检查内存
- [ ] 添加单组大小限制

**验证：**
```bash
# 创建超大向量文件测试
node scripts/create-large-vector.js

# 启动应用，观察自动裁剪日志
npm start
```

---

#### ✅ P1-4: 订阅定时器清理 (1小时)

**文件：** `src/services/subscription/updateChecker.js`

**任务：**
- [ ] 完善 `stop()` 方法
- [ ] 在 `start()` 开始时调用 `stop()`
- [ ] 添加 `restart()` 方法
- [ ] 添加 `getStatus()` 调试方法

**验证：**
```bash
# 测试重复启动
node -e "
const checker = require('./src/services/subscription/updateChecker');
for (let i = 0; i < 10; i++) checker.start();
console.log(checker.getStatus());
"
```

---

#### ✅ P1-5: ReDoS防护 (30分钟)

**文件：** `src/handlers/linkHandler.js`

**任务：**
- [ ] 添加 `MAX_MESSAGE_LENGTH = 10000` 常量
- [ ] 在 `extractLinks()` 开头添加长度检查
- [ ] 添加快速域名预检

**验证：**
```bash
# 测试超长消息
node -e "
const handler = require('./src/handlers/linkHandler');
const msg = 'https://bilibili.com/video/BV123' + 'a'.repeat(20000);
handler.extractLinks(msg, '123');
"
# 应该看到截断警告
```

---

#### ✅ P1-6: ServiceManager超时 (1小时)

**文件：** `src/services/ServiceManager.js` (第126-137行)

**任务：**
- [ ] 在 `restart()` 中添加10秒超时
- [ ] 超时后发送 SIGKILL
- [ ] 添加详细日志

---

#### ✅ P1-7: WebSocket指数退避 (1小时)

**文件：** `src/bot.js` (第243-257行)

**任务：**
- [ ] 添加 `currentReconnectDelay` 变量
- [ ] 实现退避策略：1s→2s→4s→8s→60s
- [ ] 连接成功后重置延迟

---

#### ✅ P1-8到P1-11 (3小时)

参考详细文档 [SECURITY_FIX_PLAN.md](./SECURITY_FIX_PLAN.md) 中的步骤

---

## 🔍 测试验证

### 自动化测试

```bash
# 运行修复验证脚本
./scripts/test-fixes.sh

# 应该看到类似输出：
# [TEST] P0-1: JWT密钥持久化
#   ✓ PASS: JWT密钥文件存在且格式正确
#   ✓ PASS: JWT密钥文件权限正确
# ...
# 通过: 25
# 失败: 0
# 跳过: 3
```

### 手动测试场景

#### 场景1：应用启动和重启
```bash
npm start
# 等待3秒
npm stop
npm start
# 验证：JWT Token仍然有效
```

#### 场景2：链接处理失败重试
```bash
# 1. 停止Python服务
# 2. 发送B站链接
# 3. 重启Python服务
# 4. 再次发送相同链接
# 验证：第二次能成功处理
```

#### 场景3：长时间运行稳定性
```bash
# 运行24小时
npm start

# 检查内存使用
ps aux | grep node
# 应该稳定在 < 500MB

# 检查定时器泄漏
node --expose-gc -e "
const checker = require('./src/services/subscription/updateChecker');
for (let i = 0; i < 100; i++) {
  checker.start();
  global.gc();
}
"
# 内存不应该明显增长
```

---

## 🚨 问题排查

### 常见问题

#### 1. JWT密钥文件权限错误

**症状：** 启动时警告 "Failed to read .jwtSecret"

**解决：**
```bash
chmod 600 config/.jwtSecret
```

#### 2. 向量内存持续增长

**症状：** 内存使用超过500MB

**排查：**
```bash
# 检查向量文件大小
du -sh data/vectors/*

# 查找超大文件
find data/vectors -size +50M

# 手动裁剪
node -e "
const fs = require('fs');
const file = 'data/vectors/大群号.json';
const data = JSON.parse(fs.readFileSync(file));
const trimmed = data.slice(-1000); // 只保留最新1000条
fs.writeFileSync(file, JSON.stringify(trimmed));
"
```

#### 3. 订阅检查停止工作

**症状：** 没有推送通知

**排查：**
```bash
# 检查定时器状态
node -e "
const checker = require('./src/services/subscription/updateChecker');
console.log(checker.getStatus());
"

# 手动触发检查
node -e "
const checker = require('./src/services/subscription/updateChecker');
checker.checkAllSubscriptions();
"
```

---

## 📊 进度追踪

复制下表到您的项目管理工具：

```markdown
| 问题ID | 优先级 | 状态 | 开始时间 | 完成时间 | 验证 |
|--------|--------|------|----------|----------|------|
| P0-1   | P0     | ⬜️   |          |          | ⬜️   |
| P0-2   | P0     | ⬜️   |          |          | ⬜️   |
| P0-3   | P0     | ⬜️   |          |          | ⬜️   |
| P1-1   | P1     | ⬜️   |          |          | ⬜️   |
| P1-2   | P1     | ⬜️   |          |          | ⬜️   |
| P1-3   | P1     | ⬜️   |          |          | ⬜️   |
| P1-4   | P1     | ⬜️   |          |          | ⬜️   |
| P1-5   | P1     | ⬜️   |          |          | ⬜️   |
| P1-6   | P1     | ⬜️   |          |          | ⬜️   |
| P1-7   | P1     | ⬜️   |          |          | ⬜️   |
| P1-8   | P1     | ⬜️   |          |          | ⬜️   |
| P1-9   | P1     | ⬜️   |          |          | ⬜️   |
| P1-10  | P1     | ⬜️   |          |          | ⬜️   |
| P1-11  | P1     | ⬜️   |          |          | ⬜️   |
```

状态图例：
- ⬜️ 待开始
- 🟡 进行中
- ✅ 已完成
- ❌ 已阻塞

---

## 🔄 提交和部署

### 提交代码

```bash
# 确保所有测试通过
./scripts/test-fixes.sh

# 提交修复
git add .
git commit -m "fix: P0严重问题修复

- JWT密钥持久化
- Promise错误处理
- 链接缓存竞态条件

Ref: docs/SECURITY_FIX_PLAN.md"

# 推送到远程
git push origin fix/security-stability

# 创建Pull Request
gh pr create --title "安全与稳定性修复" --body "$(cat docs/SECURITY_FIX_PLAN.md)"
```

### 部署到生产

```bash
# 1. 备份生产数据
./scripts/backup.sh

# 2. 拉取最新代码
git pull origin main

# 3. 安装依赖
npm install

# 4. 重启服务
npm stop
npm start

# 5. 验证服务正常
curl http://localhost:3000/api/health
./scripts/test-fixes.sh

# 6. 监控日志
tail -f logs/application.log
```

---

## 📞 获取帮助

- **详细文档：** [SECURITY_FIX_PLAN.md](./SECURITY_FIX_PLAN.md)
- **代码审查：** [CODE_REVIEW_REPORT.md](./CODE_REVIEW_REPORT.md)
- **问题反馈：** GitHub Issues

---

**最后更新：** 2026-02-05
