# 修复任务快速开始指南

本指南帮助您快速开始执行安全修复计划。

---

## 🚀 开始前的准备

### 1. 备份当前数据

**重要：在任何修改前都要备份！**

```bash
# 执行自动备份脚本
./scripts/backup.sh

# 手动备份（可选）
cp -r data data_backup_$(date +%Y%m%d)
cp config/config.json config/config.json.backup
cp .env .env.backup
```

### 2. 创建修复分支

```bash
# 确保主分支是最新的
git checkout main
git pull origin main

# 创建修复分支
git checkout -b security-fixes-2026

# 如果需要，为每个优先级创建单独分支
git checkout -b p0-critical-fixes
```

### 3. 确认环境

```bash
# 检查Node.js版本（需要18+）
node --version

# 检查Python版本（需要3.8+）
python3 --version

# 安装依赖
npm install
pip install bilibili-api-python

# 运行测试脚本验证环境
./scripts/test-fixes.sh
```

---

## 📋 第一天：P0-1 JWT密钥持久化

### 时间：上午（约30分钟）

#### 步骤1：修改代码（15分钟）

**打开文件：** `src/config.js`

**找到位置：** 第220-235行，`jwtSecret` 的定义

**替换代码：** 见完整修复文档 `docs/SECURITY_FIX_PLAN.md` 的 P0-1 部分

**要点：**
- 添加持久化逻辑
- 检查已保存的密钥
- 保存新生成的密钥
- 设置文件权限为600

#### 步骤2：更新.gitignore（1分钟）

```bash
# 编辑 .gitignore
echo "config/.jwtSecret" >> .gitignore
```

#### 步骤3：测试（10分钟）

```bash
# 1. 删除旧密钥（如果存在）
rm -f config/.jwtSecret

# 2. 启动服务
npm start

# 3. 检查日志，应该看到：
#    [Config] JWT_SECRET generated and saved to config/.jwtSecret

# 4. 验证文件
ls -la config/.jwtSecret
# 应该显示 -rw------- (权限 600)

# 5. 记录密钥
SECRET1=$(cat config/.jwtSecret)
echo "First secret: $SECRET1"

# 6. 停止服务 (Ctrl+C)
# 7. 重启服务
npm start

# 8. 检查日志，应该看到：
#    [Config] Loaded JWT_SECRET from .jwtSecret file

# 9. 验证密钥未变
SECRET2=$(cat config/.jwtSecret)
if [ "$SECRET1" == "$SECRET2" ]; then
    echo "✓ JWT密钥持久化成功！"
else
    echo "✗ 密钥发生变化，修复失败"
fi
```

#### 步骤4：提交代码（5分钟）

```bash
git add src/config.js .gitignore
git commit -m "fix(P0-1): 实现JWT密钥持久化

- 将JWT密钥保存到config/.jwtSecret文件
- 设置文件权限为600（仅所有者可读写）
- 重启后加载已保存的密钥
- 更新.gitignore排除密钥文件

测试：
- 首次启动生成并保存密钥
- 重启后加载已保存密钥
- 验证密钥在重启后保持不变"
```

---

## 📋 第一天：P0-2 Promise错误处理

### 时间：下午（约1小时）

#### 步骤1：重构bot.js（40分钟）

**打开文件：** `src/bot.js`

**找到位置：** 第309-332行的异步IIFE

**主要修改：**
1. 创建 `async function initializeBot()` 函数
2. 添加步骤日志（Step 1/4, 2/4等）
3. 添加全局错误处理器
4. 改进错误信息格式

**参考代码：** 见 `docs/SECURITY_FIX_PLAN.md` 的 P0-2 部分

#### 步骤2：测试（15分钟）

```bash
# 测试1：正常启动
npm start
# 应该看到清晰的步骤日志：
# [Init] Step 1/4: Starting Python Service Manager...
# [Init] ✓ Python Service Manager started
# ...

# 测试2：模拟Python服务失败
# 修改 config.json，设置错误的 pythonPath
nano config/config.json
# 将 "pythonPath" 改为 "/usr/bin/python-not-exists"

npm start
# 应该看到详细的错误信息并退出
# [Init] FATAL: Bot initialization failed!
# [Init] Error: ...

# 恢复配置
git checkout config/config.json

# 测试3：模拟端口占用
# 开一个新终端
node -e "require('http').createServer().listen(3000); console.log('Blocking port 3000')"

# 在原终端启动
npm start
# 应该看到端口占用错误并退出

# 关闭占用端口的进程
# 返回新终端按 Ctrl+C
```

#### 步骤3：提交代码（5分钟）

```bash
git add src/bot.js
git commit -m "fix(P0-2): 改进应用初始化错误处理

- 创建initializeBot函数统一管理初始化流程
- 添加全局unhandledRejection和uncaughtException处理器
- 改进错误日志格式，包含详细堆栈信息
- 启动失败时正确退出进程（exit code 1）
- 添加清晰的步骤日志（Step 1/4等）

测试：
- 正常启动流程验证
- Python服务失败测试
- Dashboard端口占用测试
- 所有错误场景都能正确记录并退出"
```

---

## 📋 第二天：P0-3 链接缓存竞态

### 时间：上午（约1小时）

#### 步骤1：修改messageHandler.js（30分钟）

**打开文件：** `src/handlers/messageHandler.js`

**找到位置：** 第166-181行的链接处理循环

**主要修改：**
1. 添加 `processSuccess` 标志
2. 将缓存添加移到成功检查后
3. 增强错误处理和用户提示

**参考代码：** 见 `docs/SECURITY_FIX_PLAN.md` 的 P0-3 部分

#### 步骤2：增强linkHandler.js错误处理（20分钟）

**打开文件：** `src/handlers/linkHandler.js`

**主要修改：**
- 根据错误类型决定是否可重试
- 添加详细错误日志

#### 步骤3：测试（10分钟）

```bash
# 测试准备：在QQ群发消息需要NapCat运行

# 测试1：正常链接处理
# 在QQ群发送：https://www.bilibili.com/video/BV1xx411c7mD
# 应该正常处理并显示卡片

# 测试2：网络错误可重试
# 停止Python服务
pkill -f bili_server.py

# 在QQ群发送B站链接
# 应该看到错误提示："处理链接失败...您可以稍后重新发送链接重试"

# 重启Python服务
npm start

# 再次发送相同链接
# 应该能正常处理（因为失败时未加入缓存）

# 测试3：查看日志
tail -f logs/application.log | grep "LinkHandler"
# 应该看到详细的错误信息
```

#### 步骤4：提交代码（5分钟）

```bash
git add src/handlers/messageHandler.js src/handlers/linkHandler.js
git commit -m "fix(P0-3): 修复链接处理缓存竞态条件

- 只在链接处理成功后添加到缓存
- 添加processSuccess标志跟踪处理状态
- 失败时不加入缓存，允许用户重试
- 增强错误处理，根据错误类型决定重试策略
- 向用户提供友好的错误提示

测试：
- 正常链接处理流程
- 网络错误后重试验证
- 404错误不应重试
- 详细错误日志验证"
```

---

## 📋 P0问题集成测试

### 时间：第二天下午（约2小时）

#### 完整测试流程

```bash
# 1. 运行自动化测试脚本
./scripts/test-fixes.sh

# 2. 完整功能测试
npm start

# 测试Dashboard登录
# 浏览器访问 http://localhost:3000
# 登录后重启服务，验证Token仍然有效

# 测试链接处理
# 在QQ群发送各类B站链接
# 验证所有类型正常工作

# 测试AI对话
# @机器人 发送消息
# 验证AI功能正常

# 测试订阅推送
# 添加一个订阅
# 等待推送验证

# 3. 错误场景测试
# 模拟各种错误场景
# 验证错误处理和日志

# 4. 稳定性测试
# 让应用运行2-4小时
# 观察内存和CPU使用
# 检查日志中的异常
```

#### 性能基准测试

```bash
# 记录基准指标
echo "=== P0修复后性能基准 ===" > performance.txt
echo "时间: $(date)" >> performance.txt
echo "" >> performance.txt

# 内存使用
ps aux | grep "node.*bot.js" | grep -v grep >> performance.txt

# 进程状态
echo "" >> performance.txt
echo "进程信息:" >> performance.txt
pgrep -f "node.*bot.js" | xargs ps -p >> performance.txt

# 日志大小
echo "" >> performance.txt
echo "日志大小:" >> performance.txt
du -h logs/ >> performance.txt

cat performance.txt
```

---

## 📋 后续步骤

### P0修复完成后

1. **创建Pull Request**
   ```bash
   git push origin p0-critical-fixes
   # 在GitHub创建PR
   # 标题：[P0] 严重问题修复
   ```

2. **部署到测试环境**
   ```bash
   # 备份生产数据
   ./scripts/backup.sh

   # 合并到main
   git checkout main
   git merge p0-critical-fixes

   # 部署
   npm run deploy  # 或您的部署命令
   ```

3. **监控运行状态**
   ```bash
   # 查看日志
   tail -f logs/application.log

   # 监控进程
   watch -n 5 'ps aux | grep node'

   # 监控内存
   watch -n 10 'free -h'
   ```

4. **开始P1修复**
   - 创建新分支 `git checkout -b p1-important-fixes`
   - 参考 `docs/SECURITY_FIX_PLAN.md` 的P1部分
   - 使用相同的流程：修改 → 测试 → 提交

---

## 🔧 常用命令速查

```bash
# 备份
./scripts/backup.sh

# 恢复（指定时间戳）
./scripts/restore.sh 20260205_143022

# 测试修复
./scripts/test-fixes.sh

# 查看日志
tail -f logs/application.log

# 启动服务
npm start

# 检查进程
ps aux | grep node

# 停止服务
pkill -f "node.*bot.js"

# 清理
npm run clean  # 如果配置了

# Git快捷操作
git status
git add .
git commit -m "fix: xxx"
git push origin branch-name
```

---

## 📞 遇到问题？

### 常见问题

**Q: JWT密钥文件权限设置失败**
```bash
# 手动设置权限
chmod 600 config/.jwtSecret
```

**Q: 测试脚本执行失败**
```bash
# 确认脚本有执行权限
chmod +x scripts/*.sh

# 如果是Linux，可能需要安装bc
sudo apt-get install bc  # Ubuntu/Debian
sudo yum install bc      # CentOS/RHEL
```

**Q: Python服务无法启动**
```bash
# 检查Python路径
which python3

# 验证bilibili-api-python安装
pip list | grep bilibili

# 重新安装
pip install --upgrade bilibili-api-python
```

**Q: 修复后出现新问题**
```bash
# 立即回滚
git checkout main
npm start

# 查看问题详情
tail -100 logs/application.log

# 在issue中报告问题
```

---

## 📚 参考资源

- **完整修复文档：** `docs/SECURITY_FIX_PLAN.md`
- **进度追踪：** `docs/FIX_PROGRESS.md`
- **原始审查报告：** （上面的Markdown表格）
- **项目文档：** `CLAUDE.md`

---

**祝修复顺利！遇到问题随时查阅文档或提issue。** 🚀
