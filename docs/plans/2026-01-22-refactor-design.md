# 代码重构设计方案

**日期：** 2026-01-22
**目标：** 基于 Code Review 发现的问题，进行渐进式修复，优先解决 Critical 和 Major 级别问题
**原则：** 不影响现有功能，不引入新 Bug

---

## 一、修复优先级（串行执行顺序）

基于 Critical 和 Major 级别问题的影响范围，修复顺序如下：

### Phase 1: XSS 安全漏洞修复（Critical）
- **问题**：`app.js` 中使用 `innerHTML` 渲染用户数据，存在严重 XSS 风险
- **方案**：重构所有渲染逻辑，使用 `textContent` + `createElement` 安全构建 DOM
- **范围**：用户订阅列表、群组面板、关注同步界面
- **预计时间**：2-3 天

### Phase 2: Python 服务重构为 FastAPI（Critical）
- **问题**：每次 API 请求 spawn 新进程，导致资源耗尽和高延迟
- **方案**：将 `bili_service.py` 改造为常驻 FastAPI HTTP 服务
- **架构**：Node.js 通过 HTTP 调用 Python，而非 spawn
- **预计时间**：5-7 天

### Phase 3: 缓存并发问题修复（Critical）
- **问题 1**：`followingsCacheManager.js` 存在竞态条件，并发请求穿透缓存
- **问题 2**：文件写入不安全，进程崩溃导致 JSON 损坏
- **方案**：引入并发锁 + 原子文件写入
- **预计时间**：1-2 天

### Phase 4: 代码质量提升（Major + Minor）
- **问题**：注释风格不统一、异常处理遗漏、批量订阅串行化
- **方案**：统一中文注释、完善异常捕获、优化批量订阅为并发
- **预计时间**：2-3 天

**总预计时间：10-15 天**

---

## 二、Phase 1 详细设计：XSS 漏洞修复

### 目标
彻底消除 `app.js` 中的 XSS 漏洞，将所有 `innerHTML` 渲染改为安全的 DOM API。

### 受影响的关键函数

1. **`renderUserSubscriptions(groupId, users)`** - 渲染 UP 主订阅列表
   - 危险点：`${user.name}` 直接插入 HTML
   - 改造方式：使用 `createElement('div')` + `textContent`

2. **`renderBangumiSubscriptions(groupId, bangumi)`** - 渲染番剧订阅
   - 危险点：`${item.title}` 未转义
   - 改造方式：同上

3. **`renderFollowings()`** - 渲染关注列表（同步模态框）
   - 危险点：`${following.name}`, `${following.sign}` 直接插入
   - 改造方式：创建 DOM 元素，避免字符串拼接

4. **`loadFollowingGroups()`** - 渲染 B 站分组列表
   - 危险点：`${group.name}` 未转义
   - 改造方式：使用 `textContent` 设置文本

### 重构模式

**原有代码（不安全）：**
```javascript
container.innerHTML = users.map(user => `
  <div class="list-item">
    <div class="subscription-name">${user.name}</div>
  </div>
`).join('');
```

**安全重构：**
```javascript
container.innerHTML = ''; // 清空
users.forEach(user => {
  const item = document.createElement('div');
  item.className = 'list-item';

  const nameEl = document.createElement('div');
  nameEl.className = 'subscription-name';
  nameEl.textContent = user.name; // 安全：自动转义

  item.appendChild(nameEl);
  container.appendChild(item);
});
```

### 测试验证

修复完成后，需验证：
1. 正常用户名显示正确
2. 包含 `<script>alert('xss')</script>` 的恶意用户名被转义为纯文本
3. 界面样式和交互功能不受影响

---

## 三、Phase 2 详细设计：Python FastAPI 重构

### 目标
将 `bili_service.py` 从"每次调用启动新进程"改造为"常驻 HTTP 服务"，彻底解决性能瓶颈。

### 架构对比

**当前架构（问题）：**
```
Node.js API 请求 → spawn python bili_service.py video BV123
                 → 启动 Python 解释器 (~500ms)
                 → 加载库 (bilibili-api, PIL) (~300ms)
                 → 执行命令
                 → 返回结果
                 → 进程退出
```
**每次请求耗时：800ms-1s**

**目标架构：**
```
Node.js 启动时 → 启动 FastAPI 服务 (一次性)
Node.js API 请求 → HTTP POST http://localhost:8765/api/video
                 → FastAPI 处理 (~10ms)
                 → 返回结果
FastAPI 保持运行
```
**每次请求耗时：10-50ms**

### 实施方案

#### 3.1 创建 FastAPI 服务

新建文件 `src/services/bili_fastapi.py`：

```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn
# 复用现有函数
from bili_service import (
    get_video_info, get_bangumi_info, get_user_dynamic,
    check_cookie, get_following_groups, # 等等
)

app = FastAPI()

class VideoRequest(BaseModel):
    bvid: str
    group_id: str = None

@app.post("/api/video")
async def api_video(req: VideoRequest):
    result = await get_video_info(req.bvid, req.group_id)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["message"])
    return result

# ... 为每个命令创建对应的端点
```

启动脚本：`uvicorn bili_fastapi:app --host 127.0.0.1 --port 8765`

#### 3.2 修改 Node.js 调用层

修改 `src/services/biliApi.js`：

```javascript
class BiliApi {
    constructor() {
        this.baseUrl = 'http://127.0.0.1:8765';
        this.pythonProcess = null; // 用于管理 FastAPI 进程生命周期
    }

    async startPythonService() {
        // 启动 FastAPI（仅在 Node 启动时调用一次）
        this.pythonProcess = spawn('uvicorn', [
            'bili_fastapi:app',
            '--host', '127.0.0.1',
            '--port', '8765'
        ], { cwd: './src/services' });

        // 等待服务就绪
        await this.waitForService();
    }

    async getVideoInfo(bvid, groupId) {
        const response = await fetch(`${this.baseUrl}/api/video`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bvid, group_id: groupId })
        });
        return await response.json();
    }
}
```

#### 3.3 渐进式迁移策略

为保证"不影响当前功能"，采用双轨制：

**步骤 1：** 先迁移低频接口（如 `check_cookie`, `following_groups`），验证稳定性。
**步骤 2：** 迁移高频接口（`video`, `user_dynamic`）。
**步骤 3：** 保留旧的 `runCommand` 作为降级方案，如果 FastAPI 服务挂了，自动回退到 spawn 模式。

### 生命周期管理

- **启动**：Node.js 服务启动时，自动启动 FastAPI（在 `src/web/server.js` 初始化）
- **健康检查**：每 30 秒 ping `GET /health`，如果失败则重启 FastAPI
- **关闭**：Node.js 退出时，优雅关闭 FastAPI（`SIGTERM`）

---

## 四、Phase 3 详细设计：缓存并发问题修复

### 目标
修复 `followingsCacheManager.js` 中的两个 Critical 问题：
1. **竞态条件**：并发请求穿透缓存检查
2. **文件写入不安全**：进程崩溃导致 JSON 文件损坏

### 问题分析

**当前代码逻辑（有缺陷）：**
```javascript
async refresh(groupId) {
    if (!this.canRefresh()) {
        throw new Error('刷新过于频繁');
    }

    // ⚠️ 问题：这里到 API 返回之间有很长时间
    const result = await biliApi.getMyFollowings(null, groupId);

    // ⚠️ 在这段时间内，其他请求可能通过了 canRefresh 检查
    this.saveCache(result.data);
}
```

**竞态场景：**
```
Time  Request A              Request B
0ms   canRefresh() → true
1ms                          canRefresh() → true (还未更新状态)
2ms   调用 API...
3ms                          调用 API... (重复调用！)
```

### 解决方案

#### 4.1 引入并发锁

```javascript
class FollowingsCacheManager {
    constructor() {
        this.refreshing = false; // 刷新锁
        this.refreshPromise = null; // 复用正在进行的刷新
    }

    async refresh(groupId) {
        // 如果正在刷新，等待并返回相同结果
        if (this.refreshing) {
            return await this.refreshPromise;
        }

        if (!this.canRefresh()) {
            throw new Error('刷新过于频繁');
        }

        this.refreshing = true;
        this.refreshPromise = (async () => {
            try {
                const result = await biliApi.getMyFollowings(null, groupId);
                this.saveCache(result.data);
                return result;
            } finally {
                this.refreshing = false;
                this.refreshPromise = null;
            }
        })();

        return await this.refreshPromise;
    }
}
```

#### 4.2 原子文件写入

使用临时文件 + 原子重命名模式：

```javascript
const fs = require('fs').promises;

async saveCache(data) {
    const cacheData = {
        data: data,
        lastUpdate: Date.now(),
        version: 1
    };

    const tempFile = this.cacheFile + '.tmp';

    try {
        // 写入临时文件
        await fs.writeFile(tempFile, JSON.stringify(cacheData, null, 2));

        // 原子重命名（操作系统保证原子性）
        await fs.rename(tempFile, this.cacheFile);
    } catch (error) {
        // 清理临时文件
        try { await fs.unlink(tempFile); } catch {}
        throw error;
    }
}
```

### 测试验证

- **并发测试**：同时发起 10 个刷新请求，验证只调用一次 API
- **崩溃测试**：在写入过程中强制 kill 进程，验证缓存文件不损坏

---

## 五、Phase 4 详细设计：代码质量提升

### 目标
修复 Major 和 Minor 级别问题，提升代码可维护性。

### 5.1 统一中文注释

**范围：**
- `bili_service.py`：将英文注释改为中文
- `biliApi.js`：统一注释风格
- `subscriptionService.js`：补充缺失的函数说明

**标准：**
```javascript
// ✅ 好的注释
// 获取用户的关注列表，支持按分组筛选
async getMyFollowings(groupName, groupId) { ... }

// ❌ 避免的注释
// Get my followings list
async getMyFollowings(groupName, groupId) { ... }
```

### 5.2 修复异常处理遗漏

**`bili_service.py` - `load_credential`：**
```python
def load_credential(group_id=None):
    file_path = get_credential_file(group_id)
    try:
        with open(file_path, 'r') as f:
            data = json.load(f)
            return Credential(...)
    except FileNotFoundError:
        return None
    except json.JSONDecodeError as e:  # ✅ 新增
        logger.error(f'Cookie 文件损坏: {file_path}, {e}')
        return None
```

**`bili_service.py` - `save_credential`：**
```python
def save_credential(credential, group_id=None):
    try:
        with open(target_file, 'w') as f:
            json.dump({...}, f)
    except PermissionError as e:  # ✅ 明确捕获
        logger.error(f'无写入权限: {e}')
        raise
    except OSError as e:  # ✅ 捕获磁盘满等错误
        logger.error(f'文件写入失败: {e}')
        raise
```

### 5.3 优化批量订阅性能

**`routes/bilibili.js` - `/followings/subscribe`：**

当前串行实现：
```javascript
for (const uid of uids) {
    await subscriptionService.addUserSubscription(uid, groupId);
}
```

改为并发（带限流）：
```javascript
const pLimit = require('p-limit');
const limit = pLimit(5); // 最多同时 5 个

const tasks = uids.map(uid =>
    limit(() => subscriptionService.addUserSubscription(uid, groupId))
);
const results = await Promise.allSettled(tasks);
```

### 5.4 PEP 8 规范

将 `bili_service.py` 中间的 `import os` 移至文件顶部。

---

## 六、完整修复流程

```
1. 创建 refactor 分支
   git checkout -b refactor

2. Phase 1: XSS 修复 (预计 2-3 天)
   - 重构 4 个渲染函数
   - 功能测试 + XSS 注入测试
   - 提交 commit: "fix: eliminate XSS vulnerabilities in app.js"

3. Phase 2: FastAPI 重构 (预计 5-7 天)
   - 创建 FastAPI 服务
   - 逐接口迁移（低频→高频）
   - 性能测试 + 压力测试
   - 提交 commit: "refactor: migrate to FastAPI persistent service"

4. Phase 3: 缓存并发修复 (预计 1-2 天)
   - 添加并发锁
   - 原子文件写入
   - 并发测试
   - 提交 commit: "fix: resolve race condition in cache manager"

5. Phase 4: 代码质量 (预计 2-3 天)
   - 统一注释
   - 异常处理
   - 批量订阅优化
   - 提交 commit: "chore: improve code quality and documentation"

6. refactor 分支保留，由用户决定是否合并到 main
```

---

## 七、风险控制

### 每个 Phase 的安全措施

1. **功能对等测试**：修复前后功能表现完全一致
2. **回滚机制**：每个 Phase 独立提交，可独立回滚
3. **渐进式迁移**：Phase 2 采用双轨制（新旧 API 共存）

### 测试清单

- [ ] Phase 1: XSS 注入测试通过
- [ ] Phase 2: 性能测试达到预期（响应时间 < 50ms）
- [ ] Phase 3: 并发测试无重复 API 调用
- [ ] Phase 4: 所有功能回归测试通过
