# 代码重构实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 基于 Code Review 发现的问题，串行修复 Critical 和 Major 级别的安全漏洞和性能问题，确保不影响现有功能。

**Architecture:** 分 4 个 Phase 串行执行：Phase 1 修复 XSS（DOM API 重构），Phase 2 重构 Python 为 FastAPI 常驻服务，Phase 3 修复缓存并发问题，Phase 4 提升代码质量。

**Tech Stack:** Vanilla JavaScript (DOM API), FastAPI, Node.js (fetch), 并发锁模式。

---

### Task 0: 准备工作

**Files:**
- 创建新分支

**Step 1: 创建 refactor 分支**

```bash
git checkout -b refactor
```

**Step 2: 提交设计文档**

```bash
git add docs/plans/2026-01-22-refactor-design.md
git commit -m "docs: add refactor design document"
```

---

## Phase 1: XSS 安全漏洞修复

### Task 1: 重构 renderUserSubscriptions（UP 主订阅列表）

**Files:**
- Modify: `src/web/public/js/app.js` (lines 393-418)

**Step 1: 备份当前实现**

复制当前的 `renderUserSubscriptions` 函数到临时注释，以便对比测试。

**Step 2: 重写 renderUserSubscriptions 使用 DOM API**

```javascript
renderUserSubscriptions(groupId, users) {
  const container = document.querySelector('.tab-content');

  if (users.length === 0) {
    container.innerHTML = '';
    const emptyHint = document.createElement('p');
    emptyHint.className = 'empty-hint';
    emptyHint.textContent = '暂无 UP 主订阅';

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-primary';
    addBtn.textContent = '+ 添加 UP 主订阅';
    addBtn.onclick = () => this.showAddUserSubDialog(groupId);

    container.appendChild(emptyHint);
    container.appendChild(addBtn);
    return;
  }

  // 创建订阅列表容器
  container.innerHTML = '';
  const listDiv = document.createElement('div');
  listDiv.className = 'subscription-list';

  users.forEach(user => {
    const item = document.createElement('div');
    item.className = 'list-item';

    const details = document.createElement('div');
    details.className = 'subscription-details';

    const nameDiv = document.createElement('div');
    nameDiv.className = 'subscription-name';
    nameDiv.textContent = user.name; // 安全

    const uidDiv = document.createElement('div');
    uidDiv.className = 'subscription-uid';
    uidDiv.textContent = `UID: ${user.uid}`; // 安全

    details.appendChild(nameDiv);
    details.appendChild(uidDiv);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn-icon btn-danger';
    removeBtn.title = '取消订阅';
    removeBtn.textContent = '×';
    removeBtn.onclick = () => this.removeUserSub(groupId, user.uid);

    item.appendChild(details);
    item.appendChild(removeBtn);
    listDiv.appendChild(item);
  });

  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-primary';
  addBtn.textContent = '+ 添加 UP 主订阅';
  addBtn.onclick = () => this.showAddUserSubDialog(groupId);

  container.appendChild(listDiv);
  container.appendChild(addBtn);
}
```

**Step 3: 手动测试功能对等性**

1. 启动服务：`npm start`
2. 打开 WebUI，选择一个有订阅的群组
3. 验证：订阅列表显示正常，删除按钮工作正常

**Step 4: XSS 注入测试**

创建测试脚本 `test-xss.js`（临时文件）：

```javascript
// 在浏览器 Console 中执行
const maliciousUser = {
  uid: '12345',
  name: '<img src=x onerror=alert("XSS")>'
};
app.renderUserSubscriptions('test', [maliciousUser]);
// 预期：显示文本 "<img src=x onerror=alert("XSS")>"，不执行脚本
```

**Step 5: 提交**

```bash
git add src/web/public/js/app.js
git commit -m "fix(xss): secure renderUserSubscriptions with DOM API"
```

---

### Task 2: 重构 renderBangumiSubscriptions（番剧订阅列表）

**Files:**
- Modify: `src/web/public/js/app.js` (lines 420-445)

**Step 1: 重写 renderBangumiSubscriptions**

```javascript
renderBangumiSubscriptions(groupId, bangumi) {
  const container = document.querySelector('.tab-content');

  if (bangumi.length === 0) {
    container.innerHTML = '';
    const emptyHint = document.createElement('p');
    emptyHint.className = 'empty-hint';
    emptyHint.textContent = '暂无番剧订阅';

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-primary';
    addBtn.textContent = '+ 添加番剧订阅';
    addBtn.onclick = () => this.showAddBangumiSubDialog(groupId);

    container.appendChild(emptyHint);
    container.appendChild(addBtn);
    return;
  }

  container.innerHTML = '';
  const listDiv = document.createElement('div');
  listDiv.className = 'subscription-list';

  bangumi.forEach(item => {
    const listItem = document.createElement('div');
    listItem.className = 'list-item';

    const details = document.createElement('div');
    details.className = 'subscription-details';

    const titleDiv = document.createElement('div');
    titleDiv.className = 'subscription-name';
    titleDiv.textContent = item.title; // 安全

    const seasonDiv = document.createElement('div');
    seasonDiv.className = 'subscription-uid';
    seasonDiv.textContent = `Season ID: ${item.season_id}`; // 安全

    details.appendChild(titleDiv);
    details.appendChild(seasonDiv);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn-icon btn-danger';
    removeBtn.title = '取消订阅';
    removeBtn.textContent = '×';
    removeBtn.onclick = () => this.removeBangumiSub(groupId, item.season_id);

    listItem.appendChild(details);
    listItem.appendChild(removeBtn);
    listDiv.appendChild(listItem);
  });

  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-primary';
  addBtn.textContent = '+ 添加番剧订阅';
  addBtn.onclick = () => this.showAddBangumiSubDialog(groupId);

  container.appendChild(listDiv);
  container.appendChild(addBtn);
}
```

**Step 2: 测试并提交**

```bash
# 功能测试（同 Task 1）
git add src/web/public/js/app.js
git commit -m "fix(xss): secure renderBangumiSubscriptions with DOM API"
```

---

### Task 3: 重构 renderFollowings（关注列表）

**Files:**
- Modify: `src/web/public/js/app.js` (lines 1196-1243)

**Step 1: 重写 renderFollowings**

```javascript
renderFollowings() {
  const container = document.getElementById('followingsUserGrid');

  if (!this.followings || this.followings.length === 0) {
    container.innerHTML = '';
    const emptyHint = document.createElement('p');
    emptyHint.className = 'empty-hint';
    emptyHint.textContent = '暂无关注数据';
    container.appendChild(emptyHint);
    this.updateSelectedCount();
    return;
  }

  container.innerHTML = '';

  this.followings.forEach(following => {
    const card = document.createElement('div');
    card.className = 'following-card';
    card.dataset.uid = following.uid;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'following-checkbox';
    checkbox.dataset.uid = following.uid;

    const avatar = document.createElement('img');
    avatar.className = 'following-avatar';
    avatar.src = following.face || 'https://via.placeholder.com/48';
    avatar.alt = following.name;
    avatar.onerror = () => { avatar.src = 'https://via.placeholder.com/48'; };

    const info = document.createElement('div');
    info.className = 'following-info';

    const nameDiv = document.createElement('div');
    nameDiv.className = 'following-name';
    nameDiv.textContent = following.name; // 安全

    const uidDiv = document.createElement('div');
    uidDiv.className = 'following-uid';
    uidDiv.textContent = `UID: ${following.uid}`; // 安全

    info.appendChild(nameDiv);
    info.appendChild(uidDiv);

    if (following.sign) {
      const signDiv = document.createElement('div');
      signDiv.className = 'following-sign';
      signDiv.textContent = following.sign; // 安全
      info.appendChild(signDiv);
    }

    card.appendChild(checkbox);
    card.appendChild(avatar);
    card.appendChild(info);

    // 绑定点击事件
    card.addEventListener('click', (e) => {
      if (e.target.tagName !== 'INPUT') {
        checkbox.checked = !checkbox.checked;
      }
      this.updateCardSelection(card);
      this.updateSelectedCount();
    });

    checkbox.addEventListener('change', () => {
      this.updateCardSelection(card);
      this.updateSelectedCount();
    });

    container.appendChild(card);
  });

  this.updateSelectedCount();
}
```

**Step 2: 测试并提交**

```bash
git add src/web/public/js/app.js
git commit -m "fix(xss): secure renderFollowings with DOM API"
```

---

### Task 4: 重构 loadFollowingGroups（分组列表）

**Files:**
- Modify: `src/web/public/js/app.js` (lines 1110-1149)

**Step 1: 重写 loadFollowingGroups（仅重构渲染部分）**

找到 line 1128 开始的渲染逻辑，替换为：

```javascript
// 原代码 line 1128-1136 使用了 innerHTML
// 改为：
const container = document.getElementById('followingGroupsList');
container.innerHTML = '';

groups.forEach(group => {
  const label = document.createElement('label');
  label.className = 'group-item';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.value = group.name;
  if (currentConfig.includes(group.name)) {
    checkbox.checked = true;
  }

  const nameSpan = document.createElement('span');
  nameSpan.className = 'group-name';
  nameSpan.textContent = group.name; // 安全

  const countSpan = document.createElement('span');
  countSpan.className = 'group-count';
  countSpan.textContent = `(${group.count}人)`; // 安全

  label.appendChild(checkbox);
  label.appendChild(nameSpan);
  label.appendChild(countSpan);

  container.appendChild(label);
});
```

**Step 2: 测试并提交**

```bash
git add src/web/public/js/app.js
git commit -m "fix(xss): secure loadFollowingGroups with DOM API"
```

---

### Task 5: Phase 1 总结测试

**Step 1: 完整回归测试**

测试清单：
- [ ] UP 主订阅列表显示正常
- [ ] 番剧订阅列表显示正常
- [ ] 关注同步模态框正常工作
- [ ] 分组选择正常工作
- [ ] 所有删除/添加按钮功能正常

**Step 2: XSS 安全测试**

在浏览器 Console 中注入测试：
```javascript
// 测试各种 XSS payload 都被转义为纯文本
const xssPayloads = [
  '<script>alert("xss")</script>',
  '<img src=x onerror=alert(1)>',
  '<svg onload=alert(1)>',
  'javascript:alert(1)'
];
```

**Step 3: 删除临时测试文件**

```bash
rm test-xss.js  # 如果创建了
```

**Step 4: 最终提交**

```bash
git add .
git commit -m "fix(xss): Phase 1 complete - all XSS vulnerabilities eliminated"
```

---

## Phase 2: Python FastAPI 重构

### Task 6: 创建 FastAPI 服务骨架

**Files:**
- Create: `src/services/bili_fastapi.py`
- Create: `requirements-fastapi.txt`

**Step 1: 创建 requirements-fastapi.txt**

```txt
fastapi==0.109.0
uvicorn==0.27.0
pydantic==2.5.3
```

**Step 2: 安装依赖**

```bash
pip install -r requirements-fastapi.txt
```

**Step 3: 创建 bili_fastapi.py 骨架**

```python
# src/services/bili_fastapi.py
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional
import uvicorn

# 导入现有函数
from bili_service import check_cookie, get_following_groups

app = FastAPI(title="Bilibili API Service")

# 健康检查端点
@app.get("/health")
async def health_check():
    return {"status": "ok"}

# 数据模型
class CheckCookieRequest(BaseModel):
    group_id: Optional[str] = None

class FollowingGroupsRequest(BaseModel):
    group_id: Optional[str] = None

# API 端点
@app.post("/api/check_cookie")
async def api_check_cookie(req: CheckCookieRequest):
    result = await check_cookie(req.group_id)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result.get("message", "Unknown error"))
    return result

@app.post("/api/following_groups")
async def api_following_groups(req: FollowingGroupsRequest):
    result = await get_following_groups(req.group_id)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result.get("message", "Unknown error"))
    return result

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8765)
```

**Step 4: 测试 FastAPI 启动**

```bash
cd src/services
python bili_fastapi.py
# 预期：服务启动在 http://127.0.0.1:8765
# 访问 http://127.0.0.1:8765/docs 查看 API 文档
```

**Step 5: 提交**

```bash
git add src/services/bili_fastapi.py requirements-fastapi.txt
git commit -m "feat(api): create FastAPI service skeleton with 2 endpoints"
```

---

### Task 7: 添加剩余的 FastAPI 端点（视频、动态等）

**Files:**
- Modify: `src/services/bili_fastapi.py`

**Step 1: 添加所有数据模型**

在 `bili_fastapi.py` 中添加：

```python
class VideoRequest(BaseModel):
    bvid: str
    group_id: Optional[str] = None

class UserDynamicRequest(BaseModel):
    uid: str
    group_id: Optional[str] = None

class UserLiveRequest(BaseModel):
    uid: str
    group_id: Optional[str] = None

class BangumiRequest(BaseModel):
    season_id: str
    group_id: Optional[str] = None

class DynamicDetailRequest(BaseModel):
    dynamic_id: str
    group_id: Optional[str] = None

class MyFollowingsRequest(BaseModel):
    group_name: Optional[str] = None
    group_id: Optional[str] = None
```

**Step 2: 添加所有 API 端点**

```python
from bili_service import (
    get_video_info, get_user_dynamic, get_user_live,
    get_bangumi_info, get_dynamic_detail, get_my_followings,
    get_article_info, get_live_room_info, get_opus_detail,
    get_user_info, get_user_card, get_ep_info, get_media_info,
    get_login_url, poll_login
)

@app.post("/api/video")
async def api_video(req: VideoRequest):
    result = await get_video_info(req.bvid, req.group_id)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["message"])
    return result

@app.post("/api/user_dynamic")
async def api_user_dynamic(req: UserDynamicRequest):
    result = await get_user_dynamic(req.uid, req.group_id)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["message"])
    return result

# ... 继续添加其他端点（bangumi, dynamic_detail, my_followings 等）
# 按照相同模式添加所有 bili_service.py 中的命令
```

**Step 3: 测试端点**

```bash
# 启动服务
python bili_fastapi.py

# 在另一个终端测试
curl -X POST http://127.0.0.1:8765/api/check_cookie \
  -H "Content-Type: application/json" \
  -d '{"group_id": null}'
# 预期：返回 {"status": "success", "data": {"logged_in": false}}
```

**Step 4: 提交**

```bash
git add src/services/bili_fastapi.py
git commit -m "feat(api): add all FastAPI endpoints for bili commands"
```

---

### Task 8: 修改 biliApi.js 支持 HTTP 调用

**Files:**
- Modify: `src/services/biliApi.js`

**Step 1: 添加 FastAPI 客户端逻辑**

在 `biliApi.js` 的 `constructor` 中添加：

```javascript
constructor() {
    this.pythonPath = config.pythonPath;
    this.scriptPath = config.biliScriptPath;
    this.retryDelay = 10000;
    this.maxRetries = 1;

    // 新增：FastAPI 配置
    this.useFastAPI = process.env.USE_FASTAPI !== 'false'; // 默认启用
    this.fastAPIUrl = 'http://127.0.0.1:8765';
    this.pythonProcess = null;
}
```

**Step 2: 添加 FastAPI 启动方法**

```javascript
async startFastAPIService() {
    if (!this.useFastAPI) return;

    const { spawn } = require('child_process');
    const logger = require('../utils/logger');

    logger.info('[BiliApi] Starting FastAPI service...');

    this.pythonProcess = spawn(this.pythonPath, [
        'bili_fastapi.py'
    ], {
        cwd: path.join(__dirname, '../../src/services'),
        stdio: 'inherit'
    });

    this.pythonProcess.on('error', (err) => {
        logger.error('[BiliApi] FastAPI service error:', err);
    });

    this.pythonProcess.on('exit', (code) => {
        logger.warn(`[BiliApi] FastAPI service exited with code ${code}`);
    });

    // 等待服务就绪
    await this.waitForFastAPIReady();
}

async waitForFastAPIReady(maxRetries = 10) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(`${this.fastAPIUrl}/health`);
            if (response.ok) {
                logger.info('[BiliApi] FastAPI service ready');
                return;
            }
        } catch (e) {
            // 服务还未就绪
        }
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error('FastAPI service failed to start');
}
```

**Step 3: 添加 HTTP 调用方法（双轨制）**

```javascript
async callFastAPI(endpoint, data) {
    if (!this.useFastAPI) {
        throw new Error('FastAPI not enabled');
    }

    const response = await fetch(`${this.fastAPIUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'FastAPI request failed');
    }

    return await response.json();
}
```

**Step 4: 修改 getCredentialStatus 为双轨制**

```javascript
async getCredentialStatus(groupId) {
    if (this.useFastAPI) {
        try {
            return await this.callFastAPI('/api/check_cookie', { group_id: groupId });
        } catch (error) {
            logger.warn('[BiliApi] FastAPI call failed, falling back to spawn:', error);
            // 降级到 spawn
        }
    }

    // 原有的 spawn 逻辑作为降级方案
    const args = [];
    if (groupId) args.push(groupId);
    return this.runCommand('check_cookie', args);
}
```

**Step 5: 提交**

```bash
git add src/services/biliApi.js
git commit -m "feat(api): add FastAPI client with fallback to spawn"
```

---

### Task 9: 在 server.js 中启动 FastAPI 服务

**Files:**
- Modify: `src/web/server.js`

**Step 1: 在 Server 类的 start 方法中添加 FastAPI 启动**

找到 `async start()` 方法，在启动 Express 服务器之前添加：

```javascript
async start() {
    try {
        // 启动 FastAPI 服务
        const biliApi = require('../services/biliApi');
        await biliApi.startFastAPIService();

        // 启动 Express 服务器
        this.server = this.app.listen(this.port, () => {
            logger.info(`Web server started on port ${this.port}`);
        });
    } catch (error) {
        logger.error('Failed to start server:', error);
        process.exit(1);
    }
}
```

**Step 2: 添加优雅关闭逻辑**

```javascript
async stop() {
    if (this.server) {
        this.server.close();
    }

    // 关闭 FastAPI 服务
    const biliApi = require('../services/biliApi');
    if (biliApi.pythonProcess) {
        biliApi.pythonProcess.kill('SIGTERM');
    }
}

// 监听退出信号
process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down gracefully');
    await server.stop();
    process.exit(0);
});
```

**Step 3: 测试启动**

```bash
npm start
# 预期：日志显示 "FastAPI service ready" 和 "Web server started"
```

**Step 4: 提交**

```bash
git add src/web/server.js
git commit -m "feat(api): integrate FastAPI startup in Node.js server"
```

---

### Task 10: 逐接口迁移到 FastAPI

**Files:**
- Modify: `src/services/biliApi.js`

**Step 1: 迁移低频接口（getFollowingGroups）**

```javascript
async getFollowingGroups(groupId) {
    if (this.useFastAPI) {
        try {
            return await this.callFastAPI('/api/following_groups', { group_id: groupId });
        } catch (error) {
            logger.warn('[BiliApi] FastAPI call failed, falling back');
        }
    }

    const args = [];
    if (groupId) args.push(groupId);
    return this.runCommand('following_groups', args);
}
```

**Step 2: 迁移高频接口（getVideoInfo, getUserDynamic）**

```javascript
async getVideoInfo(bvid, groupId) {
    if (this.useFastAPI) {
        try {
            return await this.callFastAPI('/api/video', { bvid, group_id: groupId });
        } catch (error) {
            logger.warn('[BiliApi] FastAPI call failed, falling back');
        }
    }

    const args = [bvid];
    if (groupId) args.push(groupId);
    return this.runCommand('video', args);
}

async getUserDynamic(uid, groupId) {
    if (this.useFastAPI) {
        try {
            return await this.callFastAPI('/api/user_dynamic', { uid, group_id: groupId });
        } catch (error) {
            logger.warn('[BiliApi] FastAPI call failed, falling back');
        }
    }

    const args = [uid];
    if (groupId) args.push(groupId);
    return this.runCommandWithRetry('user_dynamic', args);
}
```

**Step 3: 迁移所有剩余接口（按相同模式）**

对每个方法添加 FastAPI 优先 + spawn 降级逻辑。

**Step 4: 性能测试**

创建测试脚本 `test-performance.js`（临时）：

```javascript
const biliApi = require('./src/services/biliApi');

(async () => {
  console.time('FastAPI');
  await biliApi.getCredentialStatus('123');
  console.timeEnd('FastAPI');
  // 预期：< 50ms
})();
```

**Step 5: 提交**

```bash
git add src/services/biliApi.js
git commit -m "feat(api): migrate all methods to FastAPI with fallback"
```

---

### Task 11: Phase 2 总结测试

**Step 1: 完整功能测试**

- [ ] WebUI 所有功能正常（视频查询、订阅管理、关注同步）
- [ ] 性能测试：API 响应时间 < 50ms（之前 > 800ms）

**Step 2: 压力测试（可选）**

使用 `ab` 或 `wrk` 进行并发测试：
```bash
ab -n 1000 -c 10 http://localhost:3000/api/bilibili/status?groupId=123
# 预期：无错误，平均响应时间 < 100ms
```

**Step 3: 提交**

```bash
git commit -m "refactor(api): Phase 2 complete - FastAPI migration done"
```

---

## Phase 3: 缓存并发问题修复

### Task 12: 添加并发锁到 followingsCacheManager

**Files:**
- Modify: `src/web/services/followingsCacheManager.js`

**Step 1: 添加锁字段到 constructor**

```javascript
constructor() {
    this.cacheFile = path.join(__dirname, '../../data/followings-cache.json');
    this.cooldownMs = 60 * 60 * 1000; // 1 hour
    this.maxCacheAge = 7 * 24 * 60 * 60 * 1000; // 7 days
    this.cache = null;

    // 新增：并发锁
    this.refreshing = false;
    this.refreshPromise = null;
}
```

**Step 2: 重写 refresh 方法**

```javascript
async refresh(groupId) {
    // 如果正在刷新，返回同一个 Promise
    if (this.refreshing) {
        logger.info('[FollowingsCacheManager] Refresh already in progress, waiting...');
        return await this.refreshPromise;
    }

    if (!this.canRefresh()) {
        const remaining = this.getCooldownRemaining();
        throw new Error(`刷新过于频繁，请等待 ${Math.ceil(remaining / 1000)} 秒后再试`);
    }

    this.refreshing = true;
    this.refreshPromise = (async () => {
        try {
            logger.info('[FollowingsCacheManager] Starting refresh...');
            const result = await biliApi.getMyFollowings(null, groupId);

            if (result.status !== 'success') {
                throw new Error(result.message || '获取关注列表失败');
            }

            this.saveCache(result.data);
            logger.info('[FollowingsCacheManager] Refresh complete');
            return result;
        } finally {
            this.refreshing = false;
            this.refreshPromise = null;
        }
    })();

    return await this.refreshPromise;
}
```

**Step 3: 提交**

```bash
git add src/web/services/followingsCacheManager.js
git commit -m "fix(cache): add concurrency lock to prevent race conditions"
```

---

### Task 13: 实现原子文件写入

**Files:**
- Modify: `src/web/services/followingsCacheManager.js`

**Step 1: 重写 saveCache 方法**

```javascript
saveCache(data) {
    const cacheData = {
        data: data,
        lastUpdate: Date.now(),
        version: 1
    };

    const tempFile = this.cacheFile + '.tmp';

    try {
        // 写入临时文件
        fs.writeFileSync(tempFile, JSON.stringify(cacheData, null, 2));

        // 原子重命名
        fs.renameSync(tempFile, this.cacheFile);

        this.cache = cacheData;
        logger.info('[FollowingsCacheManager] Cache saved successfully');
    } catch (error) {
        // 清理临时文件
        try {
            if (fs.existsSync(tempFile)) {
                fs.unlinkSync(tempFile);
            }
        } catch {}

        logger.error('[FollowingsCacheManager] Failed to save cache:', error);
        throw error;
    }
}
```

**Step 2: 测试并发场景**

创建测试脚本 `test-concurrent.js`（临时）：

```javascript
const manager = require('./src/web/services/followingsCacheManager');

// 模拟 10 个并发请求
Promise.all([...Array(10)].map(() => manager.refresh('123')))
  .then(() => console.log('✅ 并发测试通过'))
  .catch(err => console.error('❌ 并发测试失败:', err));
// 预期：只调用一次 API，其他请求等待并返回相同结果
```

**Step 3: 提交**

```bash
git add src/web/services/followingsCacheManager.js
git commit -m "fix(cache): implement atomic file write to prevent corruption"
```

---

### Task 14: Phase 3 总结测试

**Step 1: 并发测试**

运行 `test-concurrent.js`，验证：
- [ ] 10 个并发请求只触发 1 次 API 调用
- [ ] 所有请求返回相同结果

**Step 2: 崩溃测试**

1. 修改 `saveCache` 添加延时：`setTimeout(() => fs.renameSync(...), 2000)`
2. 启动服务，触发刷新
3. 在 2 秒内 kill 进程：`kill -9 <pid>`
4. 检查缓存文件：`cat data/followings-cache.json`
   - 预期：文件内容完整（旧数据或新数据，不会是部分写入）

**Step 3: 清理临时文件**

```bash
rm test-concurrent.js
```

**Step 4: 提交**

```bash
git commit -m "fix(cache): Phase 3 complete - race condition and corruption fixed"
```

---

## Phase 4: 代码质量提升

### Task 15: 统一中文注释（bili_service.py）

**Files:**
- Modify: `src/services/bili_service.py`

**Step 1: 替换英文注释为中文**

逐行扫描文件，将英文注释改为中文：

```python
# 修改前（英文）
# Load credentials from a file if they exist

# 修改后（中文）
# 从文件加载凭证（如果存在）
```

**Step 2: 移动 import os 到顶部**

找到文件中间的 `import os`（约 line 18），移动到文件顶部的导入区域。

**Step 3: 提交**

```bash
git add src/services/bili_service.py
git commit -m "chore: unify comments to Chinese and fix PEP 8 import order"
```

---

### Task 16: 修复异常处理遗漏

**Files:**
- Modify: `src/services/bili_service.py`

**Step 1: 修复 load_credential**

```python
def load_credential(group_id=None):
    file_path = get_credential_file(group_id)
    try:
        with open(file_path, 'r') as f:
            data = json.load(f)
            return Credential(sessdata=data.get('SESSDATA'), bili_jct=data.get('BILI_JCT'), buvid3=data.get('BUVID3'))
    except FileNotFoundError:
        return None
    except json.JSONDecodeError as e:
        # 新增：捕获 JSON 解析错误
        print(f'警告：Cookie 文件损坏 {file_path}: {e}', file=sys.stderr)
        return None
```

**Step 2: 修复 save_credential**

```python
def save_credential(credential, group_id=None):
    # ... 确定 target_file 逻辑

    try:
        with open(target_file, 'w') as f:
            json.dump({
                'SESSDATA': credential.sessdata,
                'BILI_JCT': credential.bili_jct,
                'BUVID3': credential.buvid3
            }, f)
    except PermissionError as e:
        print(f'错误：无写入权限 {target_file}: {e}', file=sys.stderr)
        raise
    except OSError as e:
        print(f'错误：文件写入失败 {target_file}: {e}', file=sys.stderr)
        raise
```

**Step 3: 提交**

```bash
git add src/services/bili_service.py
git commit -m "fix: add proper exception handling in credential management"
```

---

### Task 17: 优化批量订阅性能

**Files:**
- Modify: `src/web/routes/bilibili.js`
- Add dependency: `p-limit`

**Step 1: 安装 p-limit**

```bash
npm install p-limit
```

**Step 2: 重写 /followings/subscribe 端点**

在 `routes/bilibili.js` 中找到 `/followings/subscribe`（约 line 157），替换为：

```javascript
const pLimit = require('p-limit');

router.post('/followings/subscribe', async (req, res, next) => {
  try {
    const { groupId, uids } = req.body;

    if (!groupId || !uids || !Array.isArray(uids) || uids.length === 0) {
      return res.status(400).json({
        success: false,
        message: '缺少 groupId 或 uids 参数'
      });
    }

    const results = {
      success: [],
      failed: [],
      skipped: []
    };

    // 并发控制：最多同时 5 个请求
    const limit = pLimit(5);

    const tasks = uids.map(uid =>
      limit(async () => {
        try {
          await subscriptionService.addUserSubscription(uid, groupId);
          results.success.push(uid);
        } catch (e) {
          logger.error(`[WebUI] Failed to subscribe user ${uid}:`, e);
          if (e.message && (e.message.includes('已订阅') || e.message.includes('already subscribed'))) {
            results.skipped.push(uid);
          } else {
            results.failed.push({ uid, error: e.message });
          }
        }
      })
    );

    await Promise.all(tasks);

    res.json({
      success: true,
      message: `成功添加 ${results.success.length} 个订阅${results.skipped.length > 0 ? `，跳过 ${results.skipped.length} 个` : ''}${results.failed.length > 0 ? `，失败 ${results.failed.length} 个` : ''}`,
      data: results
    });
  } catch (error) {
    logger.error('[WebUI] Failed to batch subscribe:', error);
    next(error);
  }
});
```

**Step 3: 性能测试**

测试批量订阅 20 个用户：
- 预期时间：串行 ~20 秒 → 并发 ~4 秒

**Step 4: 提交**

```bash
git add src/web/routes/bilibili.js package.json
git commit -m "perf: optimize batch subscribe with concurrency limit"
```

---

### Task 18: Phase 4 总结与最终测试

**Step 1: 完整回归测试**

测试清单：
- [ ] 所有 WebUI 功能正常
- [ ] 注释已统一为中文
- [ ] 批量订阅速度明显提升
- [ ] 无新增 Bug

**Step 2: 代码质量检查**

```bash
# Python 风格检查
flake8 src/services/bili_service.py --ignore=E501,W503

# JavaScript 风格检查（如果配置了 ESLint）
npm run lint
```

**Step 3: 最终提交**

```bash
git add .
git commit -m "chore: Phase 4 complete - code quality improvements done"
```

---

## 总结

### 完成的修复

- ✅ Phase 1: XSS 漏洞修复（4 个渲染函数）
- ✅ Phase 2: Python FastAPI 重构（彻底解决性能问题）
- ✅ Phase 3: 缓存并发问题修复（锁 + 原子写入）
- ✅ Phase 4: 代码质量提升（注释、异常、性能）

### refactor 分支状态

所有修复已完成并提交到 `refactor` 分支，由用户决定是否合并到 `main`。

### 验证清单

- [ ] 所有 Critical 问题已修复
- [ ] 所有 Major 问题已修复
- [ ] 功能回归测试通过
- [ ] 性能测试达标（API < 50ms，批量订阅 < 5s）
- [ ] 安全测试通过（XSS 注入被阻止）
