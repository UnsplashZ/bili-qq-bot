# WebUI Bilibili 登录和关注同步功能实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**目标：** 重构 WebUI 的 Bilibili 登录和关注同步功能，将其从全局 header 移至群组面板，修复二维码显示问题，实现混合模式的关注同步。

**架构：** 前端使用 qrcodejs2 生成二维码，后端新增关注分组列表 API 和缓存管理器，每个群组独立管理 Bilibili 登录状态。

**技术栈：** Vanilla JavaScript, qrcodejs2, Express.js, Python (bilibili-api-python)

---

## Task 1: 移除 Header 中的全局按钮

**目标：** 清理旧的全局登录和关注同步按钮

**Files:**
- Modify: `src/web/public/index.html:14-16`
- Modify: `src/web/public/js/app.js` (移除相关事件监听器)

**Step 1: 移除 Header 中的按钮**

编辑 `src/web/public/index.html`，删除这两个按钮：

```html
<!-- 删除这两行 -->
<button class="btn btn-secondary" id="bilibiliLoginBtn">B站登录</button>
<button class="btn btn-secondary" id="followingSyncBtn">关注同步</button>
```

**Step 2: 移除对应的事件监听器**

编辑 `src/web/public/js/app.js`，找到并删除：

```javascript
// 删除这些事件监听器
document.getElementById('bilibiliLoginBtn')?.addEventListener('click', ...);
document.getElementById('followingSyncBtn')?.addEventListener('click', ...);

// 删除相关方法（如果有的话）
// showBilibiliLoginModal()
// showFollowingSyncModal()
```

**Step 3: 测试页面加载**

Run: 启动 WebUI 服务器并访问页面
```bash
npm start
# 访问 http://localhost:3100
```

Expected: Header 中不再显示这两个按钮，页面正常加载无报错

**Step 4: 提交**

```bash
git add src/web/public/index.html src/web/public/js/app.js
git commit -m "refactor(webui): remove global Bilibili login buttons from header"
```

---

## Task 2: 添加 qrcodejs2 库

**目标：** 引入二维码生成库

**Files:**
- Modify: `src/web/public/index.html:175-177`

**Step 1: 添加 qrcodejs2 CDN 引用**

在 `src/web/public/index.html` 的 `</body>` 标签前添加：

```html
  <!-- Scripts -->
  <script src="https://cdn.jsdelivr.net/npm/qrcodejs2@0.0.1/qrcode.min.js"></script>
  <script src="/js/utils.js"></script>
  <script src="/js/api.js"></script>
  <script src="/js/app.js"></script>
</body>
```

**Step 2: 验证库加载**

Run: 启动服务器，打开浏览器控制台
```bash
npm start
# 在浏览器控制台执行: typeof QRCode
```

Expected: 返回 "function"，说明库已成功加载

**Step 3: 提交**

```bash
git add src/web/public/index.html
git commit -m "feat(webui): add qrcodejs2 library for QR code generation"
```

---

## Task 3: Python 后端 - 添加获取关注分组列表功能

**目标：** 在 Python 后端添加获取 Bilibili 关注分组列表的函数

**Files:**
- Modify: `src/services/bili_service.py` (在 `get_my_followings` 后添加新函数)

**Step 1: 添加 get_following_groups 函数**

在 `bili_service.py` 的 `get_my_followings` 函数后（约 1062 行），添加：

```python
async def get_following_groups(group_id=None):
    """获取关注分组列表"""
    try:
        cred = load_credential(group_id)
        if not cred:
            return {"status": "error", "message": "未登录，请先配置 cookies.json"}

        # 获取自己的 UID
        self_info = await user.get_self_info(credential=cred)
        my_uid = self_info['mid']

        # 获取关注分组列表
        groups_api = Api("https://api.bilibili.com/x/relation/tags", method="GET", credential=cred)
        groups = await groups_api.result

        if not groups:
            return {"status": "success", "data": []}

        # 格式化返回
        result = []
        for g in groups:
            result.append({
                'tagid': g.get('tagid'),
                'name': g.get('name'),
                'count': g.get('count', 0)
            })

        return {"status": "success", "data": result}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"status": "error", "message": str(e)}
```

**Step 2: 添加命令分发**

在 `main()` 函数的命令分发器中（约 1135 行，`my_followings` 命令之后），添加：

```python
    elif command == "following_groups":
        group_id = sys.argv[2] if len(sys.argv) > 2 else None
        result = await get_following_groups(group_id)
        print(json.dumps(result, ensure_ascii=False))
```

**Step 3: 测试 Python 函数**

Run: 测试新添加的命令
```bash
source venv/bin/activate
python src/services/bili_service.py following_groups
```

Expected: 返回 JSON 格式的分组列表或错误信息（如未登录）

**Step 4: 提交**

```bash
git add src/services/bili_service.py
git commit -m "feat(api): add get_following_groups Python function"
```

---

## Task 4: Node.js 后端 - 添加 FollowingsCacheManager

**目标：** 创建关注列表缓存管理器

**Files:**
- Create: `src/web/services/followingsCacheManager.js`

**Step 1: 创建缓存管理器文件**

创建 `src/web/services/followingsCacheManager.js`：

```javascript
const fs = require('fs').promises;
const path = require('path');
const biliApi = require('../../services/biliApi');
const logger = require('../../utils/logger');

class FollowingsCacheManager {
  constructor() {
    this.cache = {
      data: [],                  // 关注用户列表
      lastRefresh: null,         // 上次刷新时间戳 (毫秒)
      cooldownMs: 3600000        // 冷却时间 1小时
    };

    this.cacheFile = path.join(process.cwd(), 'data', 'followings-cache.json');
    this.loadCache();
  }

  // 检查是否可以刷新
  canRefresh() {
    if (!this.cache.lastRefresh) return true;
    const elapsed = Date.now() - this.cache.lastRefresh;
    return elapsed >= this.cache.cooldownMs;
  }

  // 获取下次可刷新的剩余秒数
  getNextRefreshIn() {
    if (!this.cache.lastRefresh) return 0;
    const elapsed = Date.now() - this.cache.lastRefresh;
    const remaining = this.cache.cooldownMs - elapsed;
    return Math.max(0, Math.floor(remaining / 1000));
  }

  // 刷新数据
  async refresh(groupId) {
    if (!this.canRefresh()) {
      const minutes = Math.ceil(this.getNextRefreshIn() / 60);
      throw new Error(`刷新过于频繁，请 ${minutes} 分钟后再试`);
    }

    const result = await biliApi.getMyFollowings(null, groupId);

    if (result.status === 'success') {
      this.cache.data = result.data || [];
      this.cache.lastRefresh = Date.now();
      await this.saveCache();
    }

    return result;
  }

  // 获取数据（带缓存信息）
  getData() {
    return {
      data: this.cache.data,
      cache: {
        lastRefresh: this.cache.lastRefresh
          ? new Date(this.cache.lastRefresh).toISOString()
          : null,
        canRefresh: this.canRefresh(),
        nextRefreshIn: this.getNextRefreshIn()
      }
    };
  }

  // 持久化缓存
  async saveCache() {
    try {
      await fs.writeFile(this.cacheFile, JSON.stringify(this.cache, null, 2));
      logger.info('[FollowingsCacheManager] Cache saved');
    } catch (e) {
      logger.error('[FollowingsCacheManager] Failed to save cache:', e);
    }
  }

  // 加载缓存
  async loadCache() {
    try {
      const data = await fs.readFile(this.cacheFile, 'utf-8');
      const loaded = JSON.parse(data);

      // 检查缓存是否过期（超过 7 天自动失效）
      if (loaded.lastRefresh && Date.now() - loaded.lastRefresh < 7 * 24 * 60 * 60 * 1000) {
        this.cache = loaded;
        logger.info('[FollowingsCacheManager] Cache loaded');
      }
    } catch (e) {
      // 文件不存在或解析失败，使用默认值
      logger.info('[FollowingsCacheManager] No cache found, starting fresh');
    }
  }
}

module.exports = new FollowingsCacheManager();
```

**Step 2: 测试缓存管理器**

Run: 创建测试脚本验证
```bash
node -e "const cache = require('./src/web/services/followingsCacheManager'); console.log('Cache initialized:', cache.getData())"
```

Expected: 输出缓存数据结构，无报错

**Step 3: 提交**

```bash
git add src/web/services/followingsCacheManager.js
git commit -m "feat(webui): add FollowingsCacheManager for caching following list"
```

---

## Task 5: Node.js 后端 - 添加新的 API 路由

**目标：** 在 bilibili.js 路由中添加获取关注分组列表的接口

**Files:**
- Modify: `src/web/routes/bilibili.js`

**Step 1: 添加获取关注分组列表路由**

在 `src/web/routes/bilibili.js` 的 `GET /followings` 路由之前添加：

```javascript
// 获取关注分组列表
router.get('/following-groups', async (req, res, next) => {
  try {
    const { groupId } = req.query;

    if (!groupId) {
      return res.status(400).json({
        success: false,
        message: '缺少 groupId 参数'
      });
    }

    const result = await biliApi.runCommand('following_groups', [groupId]);

    if (result.status === 'success') {
      res.json({
        success: true,
        data: result.data
      });
    } else {
      res.status(500).json({
        success: false,
        message: result.message || '获取关注分组失败'
      });
    }
  } catch (error) {
    logger.error('[WebUI] Failed to get following groups:', error);
    next(error);
  }
});
```

**Step 2: 修改 GET /followings 路由添加缓存**

替换现有的 `GET /followings` 路由：

```javascript
const followingsCacheManager = require('../services/followingsCacheManager');

// 获取账号关注列表（带缓存）
router.get('/followings', async (req, res, next) => {
  try {
    const { groupId } = req.query;

    // 返回缓存数据
    const cacheData = followingsCacheManager.getData();

    res.json({
      success: true,
      data: cacheData.data,
      cache: cacheData.cache
    });
  } catch (error) {
    logger.error('[WebUI] Failed to get followings:', error);
    next(error);
  }
});
```

**Step 3: 修改 POST /followings/refresh 路由添加冷却检查**

替换现有的刷新路由：

```javascript
// 刷新关注列表（带冷却检查）
router.post('/followings/refresh', async (req, res, next) => {
  try {
    const { groupId } = req.query;

    if (!groupId) {
      return res.status(400).json({
        success: false,
        message: '缺少 groupId 参数'
      });
    }

    // 尝试刷新（包含冷却检查）
    const result = await followingsCacheManager.refresh(groupId);

    if (result.status === 'success') {
      const cacheData = followingsCacheManager.getData();
      res.json({
        success: true,
        message: '刷新成功',
        data: cacheData.data,
        cache: cacheData.cache
      });
    } else {
      res.status(500).json({
        success: false,
        message: result.message || '刷新失败'
      });
    }
  } catch (error) {
    // 冷却期错误
    if (error.message.includes('刷新过于频繁')) {
      const cacheData = followingsCacheManager.getData();
      return res.status(429).json({
        success: false,
        message: error.message,
        cache: cacheData.cache
      });
    }

    logger.error('[WebUI] Failed to refresh followings:', error);
    next(error);
  }
});
```

**Step 4: 添加 biliApi 的 following_groups 方法**

在 `src/services/biliApi.js` 中添加：

```javascript
async getFollowingGroups(groupId) {
    const args = [];
    if (groupId) args.push(groupId);
    return this.runCommand('following_groups', args);
}
```

**Step 5: 测试 API 端点**

Run: 启动服务器并测试
```bash
npm start
# 在另一个终端测试:
curl "http://localhost:3100/api/bilibili/following-groups?groupId=123456"
curl "http://localhost:3100/api/bilibili/followings?groupId=123456"
```

Expected: 返回 JSON 响应，包含分组列表或关注列表

**Step 6: 提交**

```bash
git add src/web/routes/bilibili.js src/services/biliApi.js
git commit -m "feat(api): add following-groups endpoint and cache management"
```

---

## Task 6: 前端 API 客户端 - 添加新接口方法

**目标：** 在前端 API 客户端添加调用新接口的方法

**Files:**
- Modify: `src/web/public/js/api.js`

**Step 1: 添加获取关注分组列表方法**

在 `api.js` 的 `getFollowings` 方法后添加：

```javascript
async getFollowingGroups(groupId) {
  const params = new URLSearchParams();
  if (groupId) params.append('groupId', groupId);
  const query = params.toString();
  return this.request('GET', `/bilibili/following-groups${query ? '?' + query : ''}`);
}
```

**Step 2: 修改 refreshFollowings 方法支持 groupId**

修改现有方法：

```javascript
async refreshFollowings(groupId) {
  const params = new URLSearchParams();
  if (groupId) params.append('groupId', groupId);
  const query = params.toString();
  return this.request('POST', `/bilibili/followings/refresh${query ? '?' + query : ''}`);
}
```

**Step 3: 修改 getFollowings 方法**

```javascript
async getFollowings(groupId) {
  const params = new URLSearchParams();
  if (groupId) params.append('groupId', groupId);
  const query = params.toString();
  return this.request('GET', `/bilibili/followings${query ? '?' + query : ''}`);
}
```

**Step 4: 测试浏览器控制台**

Run: 启动服务器，在浏览器控制台测试
```javascript
api.getFollowingGroups('123456').then(console.log)
api.getFollowings('123456').then(console.log)
```

Expected: 返回对应的 JSON 数据

**Step 5: 提交**

```bash
git add src/web/public/js/api.js
git commit -m "feat(webui): add API methods for following groups and cache"
```

---

## Task 7: HTML - 添加群组面板 Bilibili 账号区域

**目标：** 在群组面板中添加 Bilibili 账号状态显示和登录按钮

**Files:**
- Modify: `src/web/public/index.html`

**Step 1: 在群组面板模板中添加 Bilibili 账号卡片**

在 `index.html` 中，找到 `<div class="group-panel">` 或在 `app.js` 的 `renderGroupPanel` 方法中添加 HTML 模板：

由于群组面板是动态生成的，我们需要修改 `app.js` 中的模板（下一个 Task），这里先在 HTML 中准备 Modal 结构。

在 `index.html` 的 Following Sync Modal 之后，添加群组登录 Modal：

```html
<!-- Group Bilibili Login Modal -->
<div class="modal-overlay hidden" id="groupBiliLoginModal">
  <div class="modal-content">
    <div class="modal-header">
      <h2>Bilibili 账号登录 - <span id="loginModalGroupName"></span></h2>
      <button class="btn-icon" id="closeGroupBiliLoginBtn">×</button>
    </div>
    <div class="modal-body">
      <div class="login-status" id="groupLoginStatus">
        <p class="info-text">使用 Bilibili 手机 APP 扫描二维码登录</p>
        <button class="btn btn-primary" id="getGroupQrcodeBtn">获取登录二维码</button>
      </div>
      <div class="qrcode-container hidden" id="groupQrcodeContainer">
        <div class="qrcode-wrapper" id="groupQrcodeWrapper">
          <!-- QR code will be generated here -->
        </div>
        <p class="qrcode-hint">请使用 Bilibili APP 扫描二维码</p>
        <div class="login-progress" id="groupLoginProgress">
          <div class="spinner"></div>
          <p>等待扫码...</p>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" id="cancelGroupBiliLoginBtn">关闭</button>
    </div>
  </div>
</div>
```

**Step 2: 修改 Following Sync Modal 结构**

替换现有的 Following Sync Modal 为新的两 Tab 结构：

```html
<!-- Following Sync Modal (New Structure) -->
<div class="modal-overlay hidden" id="followingSyncModal">
  <div class="modal-content modal-large">
    <div class="modal-header">
      <h2>从关注同步 - <span id="syncModalGroupName"></span></h2>
      <button class="btn-icon" id="closeFollowingSyncBtn">×</button>
    </div>
    <div class="modal-body">
      <!-- 两个 Tab 切换 -->
      <div class="sync-tabs">
        <button class="tab-btn active" data-sync-tab="groups">
          📁 按分组同步
        </button>
        <button class="tab-btn" data-sync-tab="users">
          👤 按用户选择
        </button>
      </div>

      <!-- Tab 1: 分组列表 -->
      <div class="sync-tab-content" id="syncGroupsTab">
        <p class="hint-text">
          💡 勾选分组后，系统将自动同步这些分组的关注用户订阅
        </p>

        <div class="groups-list" id="followingGroupsList">
          <!-- 动态生成 -->
        </div>

        <div class="current-sync-groups">
          <strong>当前已配置：</strong>
          <span id="currentSyncGroupsText">无</span>
        </div>
      </div>

      <!-- Tab 2: 用户列表 -->
      <div class="sync-tab-content hidden" id="syncUsersTab">
        <!-- 缓存信息和控制栏 -->
        <div class="cache-controls">
          <div class="cache-info">
            <span>上次刷新: </span>
            <span id="cacheLastRefreshTime">从未</span>
          </div>
          <button class="btn btn-secondary btn-sm" id="refreshFollowingsListBtn">
            🔄 刷新列表
          </button>
        </div>

        <!-- 用户选择控制 -->
        <div class="user-controls">
          <button class="btn btn-secondary btn-sm" id="selectAllUsersBtn">全选</button>
          <button class="btn btn-secondary btn-sm" id="unselectAllUsersBtn">取消全选</button>
          <span class="selected-count">已选: <strong id="selectedUserCount">0</strong></span>
        </div>

        <!-- 用户卡片网格 -->
        <div class="followings-grid" id="followingsUserGrid">
          <!-- 动态生成 -->
        </div>
      </div>
    </div>

    <div class="modal-footer">
      <button class="btn btn-secondary" id="cancelFollowingSyncBtn">取消</button>

      <!-- Tab 1 显示 -->
      <button class="btn btn-primary" id="saveSyncGroupsBtn">
        保存配置
      </button>

      <!-- Tab 2 显示 -->
      <button class="btn btn-primary hidden" id="batchSubscribeUsersBtn">
        批量订阅
      </button>
    </div>
  </div>
</div>
```

**Step 3: 提交**

```bash
git add src/web/public/index.html
git commit -m "feat(webui): add group Bilibili login modal and new sync modal structure"
```

---

## Task 8: CSS - 添加新组件样式

**目标：** 为新增的 UI 组件添加样式

**Files:**
- Modify: `src/web/public/css/app.css`

**Step 1: 添加 Bilibili 账号卡片样式**

在 `app.css` 末尾添加：

```css
/* Bilibili Account Section */
.bili-account-section {
  margin-bottom: 2rem;
  padding: 1.5rem;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-radius: var(--radius);
  border: 1px solid var(--glass-border);
}

.bili-account-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}

.account-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.status-label {
  font-weight: 500;
  color: var(--text-secondary);
}

.status-value {
  font-weight: 600;
  color: var(--text-primary);
}

.account-uid {
  font-family: 'Consolas', 'Monaco', monospace;
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.account-actions {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.last-login-time {
  font-size: 0.85rem;
  color: var(--text-secondary);
}

/* Sync Tabs */
.sync-tabs {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
  border-bottom: 2px solid var(--border-color);
}

.sync-tabs .tab-btn {
  padding: 0.75rem 1.5rem;
  border: none;
  background-color: transparent;
  color: var(--text-secondary);
  font-size: 0.95rem;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  transition: all 0.3s ease;
  font-weight: 500;
}

.sync-tabs .tab-btn:hover {
  color: var(--primary-color);
  background-color: rgba(0, 161, 214, 0.05);
}

.sync-tabs .tab-btn.active {
  color: var(--primary-color);
  border-bottom-color: var(--primary-color);
  font-weight: 600;
}

/* Sync Tab Content */
.sync-tab-content {
  min-height: 300px;
  padding: 1rem 0;
}

.hint-text {
  font-size: 0.9rem;
  color: var(--text-secondary);
  margin-bottom: 1.5rem;
  padding: 0.75rem 1rem;
  background: rgba(0, 161, 214, 0.1);
  border-left: 3px solid var(--primary-color);
  border-radius: var(--radius-sm);
}

/* Groups List */
.groups-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
  max-height: 400px;
  overflow-y: auto;
}

.group-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem;
  background: rgba(255, 255, 255, 0.6);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.3s ease;
}

.group-item:hover {
  background: rgba(255, 255, 255, 0.8);
  transform: translateX(2px);
  box-shadow: var(--shadow);
}

.group-item input[type="checkbox"] {
  width: 20px;
  height: 20px;
  cursor: pointer;
}

.group-name {
  flex: 1;
  font-weight: 500;
  color: var(--text-primary);
}

.group-count {
  font-size: 0.85rem;
  color: var(--text-secondary);
}

/* Current Sync Groups */
.current-sync-groups {
  padding: 1rem;
  background: rgba(255, 255, 255, 0.5);
  border-radius: var(--radius-sm);
  border: 1px solid var(--glass-border);
}

.current-sync-groups strong {
  color: var(--text-primary);
  margin-right: 0.5rem;
}

/* Cache Controls */
.cache-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  padding: 0.75rem 1rem;
  background: rgba(255, 255, 255, 0.5);
  border-radius: var(--radius-sm);
}

.cache-info {
  font-size: 0.9rem;
  color: var(--text-secondary);
}

/* User Controls */
.user-controls {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  margin-bottom: 1rem;
}

.selected-count {
  margin-left: auto;
  font-size: 0.9rem;
  color: var(--text-secondary);
}

.selected-count strong {
  color: var(--primary-color);
  font-size: 1rem;
}

/* Button Disabled State */
.btn-disabled {
  opacity: 0.6;
  cursor: not-allowed !important;
  background: var(--border-color) !important;
  color: var(--text-secondary) !important;
}

/* Section Header */
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.section-header h3 {
  margin: 0;
}

/* Small Button */
.btn-sm {
  padding: 0.4rem 0.8rem;
  font-size: 0.85rem;
}
```

**Step 2: 测试样式**

Run: 启动服务器查看样式效果
```bash
npm start
```

Expected: 新增的 CSS 类应用正确，无样式冲突

**Step 3: 提交**

```bash
git add src/web/public/css/app.css
git commit -m "style(webui): add styles for Bilibili account and sync components"
```

---

## Task 9: 前端 - 修改群组面板模板添加 Bilibili 账号区域

**目标：** 在动态生成的群组面板中添加 Bilibili 账号状态和登录按钮

**Files:**
- Modify: `src/web/public/js/app.js` (renderGroupPanel 方法)

**Step 1: 找到 renderGroupPanel 方法**

在 `app.js` 中找到渲染群组面板的方法（通常是 `renderGroupPanel` 或 `selectGroup`）

**Step 2: 在群组信息后添加 Bilibili 账号区域**

修改模板，在群组基本信息卡片之后、订阅管理之前添加：

```javascript
renderGroupPanel(group) {
  const panel = document.getElementById('groupPanel');

  panel.innerHTML = `
    <h2>${group.groupName || group.groupId}</h2>

    <!-- 群组信息 -->
    <div class="group-info">
      <p><strong>群组 ID:</strong> ${group.groupId}</p>
      <p><strong>状态:</strong> ${group.enabled ? '已启用' : '已禁用'}</p>
      <!-- ... 其他信息 ... -->
    </div>

    <!-- Bilibili 账号卡片 -->
    <div class="management-section bili-account-section">
      <h3>🅱️ Bilibili 账号</h3>
      <div class="bili-account-info">
        <div class="account-status">
          <span class="status-label">登录状态：</span>
          <span class="status-value" id="biliLoginStatus">未登录</span>
          <span class="account-uid hidden" id="biliAccountUid"></span>
        </div>
        <div class="account-actions">
          <button class="btn btn-primary btn-sm" id="groupBiliLoginBtn">
            登录/重新登录
          </button>
          <span class="last-login-time" id="lastLoginTime"></span>
        </div>
      </div>
    </div>

    <!-- 订阅管理 -->
    <div class="subscriptions-section">
      <div class="section-header">
        <h3>订阅管理</h3>
        <button class="btn btn-secondary" id="syncFromFollowingBtn">
          📋 从关注同步
        </button>
      </div>

      <!-- ... 现有的订阅 Tab 内容 ... -->
    </div>

    <!-- ... 其他管理区域 ... -->
  `;

  // 绑定事件监听器
  this.bindGroupPanelEvents(group.groupId);
}
```

**Step 3: 添加事件监听器绑定方法**

在 App 类中添加：

```javascript
bindGroupPanelEvents(groupId) {
  // Bilibili 登录按钮
  const loginBtn = document.getElementById('groupBiliLoginBtn');
  if (loginBtn) {
    loginBtn.addEventListener('click', () => {
      this.showGroupBiliLoginModal(groupId);
    });
  }

  // 从关注同步按钮
  const syncBtn = document.getElementById('syncFromFollowingBtn');
  if (syncBtn) {
    syncBtn.addEventListener('click', () => {
      this.showFollowingSyncModal(groupId);
    });
  }

  // ... 其他事件监听器 ...
}
```

**Step 4: 测试界面显示**

Run: 启动服务器，选择一个群组
```bash
npm start
```

Expected: 群组面板中显示 Bilibili 账号区域和"从关注同步"按钮

**Step 5: 提交**

```bash
git add src/web/public/js/app.js
git commit -m "feat(webui): add Bilibili account section to group panel"
```

---

## Task 10: 前端 - 实现群组登录 Modal 功能

**目标：** 实现群组级别的 Bilibili 登录 Modal，使用 QRCode.js 生成二维码

**Files:**
- Modify: `src/web/public/js/app.js`

**Step 1: 添加 showGroupBiliLoginModal 方法**

```javascript
showGroupBiliLoginModal(groupId) {
  const modal = document.getElementById('groupBiliLoginModal');
  const groupNameSpan = document.getElementById('loginModalGroupName');

  // 设置群组名称
  const group = this.state.groups.find(g => g.groupId === groupId);
  groupNameSpan.textContent = group?.groupName || groupId;

  // 显示 Modal
  modal.classList.remove('hidden');

  // 重置状态
  document.getElementById('groupLoginStatus').classList.remove('hidden');
  document.getElementById('groupQrcodeContainer').classList.add('hidden');

  // 绑定事件
  this.bindLoginModalEvents(groupId);
}
```

**Step 2: 添加获取二维码方法**

```javascript
async getGroupLoginQrcode(groupId) {
  try {
    const response = await api.getLoginQrcode();

    if (response.success) {
      // 隐藏初始状态
      document.getElementById('groupLoginStatus').classList.add('hidden');
      document.getElementById('groupQrcodeContainer').classList.remove('hidden');

      // 清空容器
      const qrcodeWrapper = document.getElementById('groupQrcodeWrapper');
      qrcodeWrapper.innerHTML = '';

      // 生成二维码
      new QRCode(qrcodeWrapper, {
        text: response.data.qrcodeUrl,
        width: 256,
        height: 256
      });

      // 保存 key 并开始轮询
      this.currentQrcodeKey = response.data.qrcodeKey;
      this.currentLoginGroupId = groupId;
      this.startGroupLoginPolling();
    } else {
      showToast('获取二维码失败: ' + response.message, 'error');
    }
  } catch (error) {
    showToast('获取二维码失败: ' + error.message, 'error');
  }
}
```

**Step 3: 添加轮询检查登录状态方法**

```javascript
startGroupLoginPolling() {
  // 清除之前的轮询
  if (this.loginCheckInterval) {
    clearInterval(this.loginCheckInterval);
  }

  this.loginCheckInterval = setInterval(async () => {
    try {
      const response = await api.checkLogin(this.currentQrcodeKey, this.currentLoginGroupId);

      if (response.success && response.data.logged_in) {
        // 登录成功
        clearInterval(this.loginCheckInterval);
        showToast('登录成功！', 'success');
        this.hideGroupBiliLoginModal();

        // 更新登录状态显示
        this.updateBiliLoginStatus(this.currentLoginGroupId);

      } else if (response.data.code === 86038) {
        // 二维码过期
        clearInterval(this.loginCheckInterval);
        document.getElementById('groupLoginProgress').innerHTML = `
          <p class="error-text">⏰ 二维码已过期</p>
          <button class="btn btn-primary" onclick="window.app.getGroupLoginQrcode('${this.currentLoginGroupId}')">
            重新获取
          </button>
        `;
      } else if (response.data.code === 86090) {
        // 已扫码，等待确认
        document.getElementById('groupLoginProgress').innerHTML = `
          <div class="spinner"></div>
          <p>已扫码，请在手机上确认</p>
        `;
      }
    } catch (error) {
      console.error('Check login error:', error);
    }
  }, 2000); // 每 2 秒检查一次
}
```

**Step 4: 添加更新登录状态方法**

```javascript
updateBiliLoginStatus(groupId) {
  // TODO: 调用 API 获取登录状态
  // 暂时显示为已登录
  document.getElementById('biliLoginStatus').textContent = '已登录';
  document.getElementById('biliAccountUid').classList.remove('hidden');
  document.getElementById('biliAccountUid').textContent = `(UID: ***)`;
}
```

**Step 5: 添加关闭 Modal 方法**

```javascript
hideGroupBiliLoginModal() {
  const modal = document.getElementById('groupBiliLoginModal');
  modal.classList.add('hidden');

  // 清除轮询
  if (this.loginCheckInterval) {
    clearInterval(this.loginCheckInterval);
  }
}

bindLoginModalEvents(groupId) {
  // 获取二维码按钮
  document.getElementById('getGroupQrcodeBtn').onclick = () => {
    this.getGroupLoginQrcode(groupId);
  };

  // 关闭按钮
  document.getElementById('closeGroupBiliLoginBtn').onclick = () => {
    this.hideGroupBiliLoginModal();
  };

  document.getElementById('cancelGroupBiliLoginBtn').onclick = () => {
    this.hideGroupBiliLoginModal();
  };
}
```

**Step 6: 测试登录流程**

Run: 启动服务器，点击登录按钮
```bash
npm start
```

Expected:
1. 弹出登录 Modal
2. 点击"获取二维码"生成 QR code
3. 扫码后轮询检测登录状态
4. 登录成功后关闭 Modal

**Step 7: 提交**

```bash
git add src/web/public/js/app.js
git commit -m "feat(webui): implement group-level Bilibili login with QR code"
```

---

## Task 11: 前端 - 实现关注同步 Modal 的 Tab 切换

**目标：** 实现 Modal 中两个 Tab 的切换逻辑

**Files:**
- Modify: `src/web/public/js/app.js`

**Step 1: 添加 showFollowingSyncModal 方法**

```javascript
showFollowingSyncModal(groupId) {
  const modal = document.getElementById('followingSyncModal');
  const groupNameSpan = document.getElementById('syncModalGroupName');

  // 设置群组名称
  const group = this.state.groups.find(g => g.groupId === groupId);
  groupNameSpan.textContent = group?.groupName || groupId;

  // 显示 Modal
  modal.classList.remove('hidden');

  // 重置为 Tab 1
  this.switchSyncTab('groups');

  // 加载数据
  this.loadFollowingGroups(groupId);

  // 绑定事件
  this.bindSyncModalEvents(groupId);
}
```

**Step 2: 添加 Tab 切换方法**

```javascript
switchSyncTab(tabName) {
  // 更新 Tab 按钮状态
  document.querySelectorAll('.sync-tabs .tab-btn').forEach(btn => {
    if (btn.dataset.syncTab === tabName) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // 显示/隐藏 Tab 内容
  if (tabName === 'groups') {
    document.getElementById('syncGroupsTab').classList.remove('hidden');
    document.getElementById('syncUsersTab').classList.add('hidden');
    document.getElementById('saveSyncGroupsBtn').classList.remove('hidden');
    document.getElementById('batchSubscribeUsersBtn').classList.add('hidden');
  } else {
    document.getElementById('syncGroupsTab').classList.add('hidden');
    document.getElementById('syncUsersTab').classList.remove('hidden');
    document.getElementById('saveSyncGroupsBtn').classList.add('hidden');
    document.getElementById('batchSubscribeUsersBtn').classList.remove('hidden');
  }
}
```

**Step 3: 绑定 Modal 事件**

```javascript
bindSyncModalEvents(groupId) {
  // Tab 切换
  document.querySelectorAll('.sync-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.syncTab;
      this.switchSyncTab(tab);

      // 切换到用户 Tab 时加载数据
      if (tab === 'users') {
        this.loadFollowingsForSync(groupId);
      }
    });
  });

  // 关闭按钮
  document.getElementById('closeFollowingSyncBtn').onclick = () => {
    this.hideFollowingSyncModal();
  };

  document.getElementById('cancelFollowingSyncBtn').onclick = () => {
    this.hideFollowingSyncModal();
  };

  // 保存分组配置按钮
  document.getElementById('saveSyncGroupsBtn').onclick = () => {
    this.saveSyncGroupsConfig(groupId);
  };

  // 批量订阅按钮
  document.getElementById('batchSubscribeUsersBtn').onclick = () => {
    this.batchSubscribeUsers(groupId);
  };
}
```

**Step 4: 添加关闭 Modal 方法**

```javascript
hideFollowingSyncModal() {
  const modal = document.getElementById('followingSyncModal');
  modal.classList.add('hidden');
}
```

**Step 5: 测试 Tab 切换**

Run: 启动服务器，打开关注同步 Modal
```bash
npm start
```

Expected: 点击 Tab 按钮能正确切换显示内容和底部按钮

**Step 6: 提交**

```bash
git add src/web/public/js/app.js
git commit -m "feat(webui): implement sync modal tab switching"
```

---

## Task 12: 前端 - 实现 Tab 1 按分组同步功能

**目标：** 加载关注分组列表，回显当前配置，保存分组配置

**Files:**
- Modify: `src/web/public/js/app.js`

**Step 1: 添加加载分组列表方法**

```javascript
async loadFollowingGroups(groupId) {
  try {
    const groupsList = document.getElementById('followingGroupsList');
    groupsList.innerHTML = '<p class="loading">加载中...</p>';

    const response = await api.getFollowingGroups(groupId);

    if (response.success) {
      const groups = response.data;

      // 获取当前配置
      const group = this.state.groups.find(g => g.groupId === groupId);
      const currentSyncGroups = group?.config?.cookieSyncGroupNames || [];

      if (groups.length === 0) {
        groupsList.innerHTML = `
          <div class="empty-state">
            <p>📁 暂无关注分组</p>
            <p class="hint">在 Bilibili 创建关注分组后刷新</p>
          </div>
        `;
      } else {
        groupsList.innerHTML = groups.map(g => `
          <label class="group-item">
            <input type="checkbox"
                   value="${g.name}"
                   ${currentSyncGroups.includes(g.name) ? 'checked' : ''}
                   class="sync-group-checkbox" />
            <span class="group-name">${g.name}</span>
            <span class="group-count">(${g.count}人)</span>
          </label>
        `).join('');
      }

      // 更新当前配置显示
      this.updateCurrentSyncGroupsDisplay(currentSyncGroups);

    } else {
      groupsList.innerHTML = `<p class="error-text">加载失败: ${response.message}</p>`;
    }
  } catch (error) {
    showToast('加载分组失败: ' + error.message, 'error');
  }
}
```

**Step 2: 添加更新当前配置显示方法**

```javascript
updateCurrentSyncGroupsDisplay(syncGroups) {
  const text = document.getElementById('currentSyncGroupsText');
  if (syncGroups && syncGroups.length > 0) {
    text.textContent = syncGroups.join(', ');
  } else {
    text.textContent = '无';
  }
}
```

**Step 3: 添加保存分组配置方法**

```javascript
async saveSyncGroupsConfig(groupId) {
  try {
    // 获取勾选的分组
    const checkboxes = document.querySelectorAll('.sync-group-checkbox:checked');
    const selectedGroups = Array.from(checkboxes).map(cb => cb.value);

    // 更新配置
    const config = {
      enableCookieSync: selectedGroups.length > 0,
      cookieSyncGroupNames: selectedGroups
    };

    const response = await api.updateGroupConfig(groupId, config);

    if (response.success) {
      showToast('配置已保存', 'success');
      this.hideFollowingSyncModal();

      // 刷新群组列表
      await this.loadGroups();
    } else {
      showToast('保存失败: ' + response.message, 'error');
    }
  } catch (error) {
    showToast('保存失败: ' + error.message, 'error');
  }
}
```

**Step 4: 测试分组同步功能**

Run: 启动服务器测试
```bash
npm start
```

Expected:
1. 打开 Modal 显示分组列表
2. 已配置的分组自动勾选
3. 勾选/取消勾选后点击"保存配置"成功更新

**Step 5: 提交**

```bash
git add src/web/public/js/app.js
git commit -m "feat(webui): implement Tab 1 following groups sync"
```

---

## Task 13: 前端 - 实现 Tab 2 按用户选择功能

**目标：** 加载关注用户列表（带缓存），刷新列表，批量订阅

**Files:**
- Modify: `src/web/public/js/app.js`
- Modify: `src/web/public/js/utils.js` (添加时间格式化工具)

**Step 1: 在 utils.js 添加相对时间格式化函数**

```javascript
function formatRelativeTime(date) {
  const now = new Date();
  const diff = now - date;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;
  return date.toLocaleDateString('zh-CN');
}
```

**Step 2: 添加加载关注用户列表方法**

```javascript
async loadFollowingsForSync(groupId) {
  try {
    const grid = document.getElementById('followingsUserGrid');
    grid.innerHTML = '<p class="loading">加载中...</p>';

    const response = await api.getFollowings(groupId);

    if (response.success) {
      const followings = response.data;

      // 更新缓存信息
      this.updateCacheInfo(response.cache);

      if (followings.length === 0) {
        grid.innerHTML = `
          <div class="empty-state">
            <p>😊 暂无关注用户</p>
            <p class="hint">在 Bilibili 关注一些UP主后刷新列表</p>
          </div>
        `;
      } else {
        grid.innerHTML = followings.map(f => `
          <label class="following-card">
            <input type="checkbox"
                   class="following-checkbox"
                   data-uid="${f.uid}" />
            <img class="following-avatar"
                 src="${f.face}"
                 onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22><rect fill=%22%23ddd%22 width=%22100%22 height=%22100%22/></svg>'" />
            <div class="following-info">
              <div class="following-name">${f.name}</div>
              <div class="following-uid">UID: ${f.uid}</div>
            </div>
          </label>
        `).join('');

        // 绑定全选/取消全选
        this.bindUserSelectionEvents();
      }
    } else {
      grid.innerHTML = `<p class="error-text">加载失败: ${response.message}</p>`;
    }
  } catch (error) {
    showToast('加载用户列表失败: ' + error.message, 'error');
  }
}
```

**Step 3: 添加更新缓存信息方法**

```javascript
updateCacheInfo(cacheData) {
  const { lastRefresh, canRefresh, nextRefreshIn } = cacheData;

  // 显示上次刷新时间
  const timeSpan = document.getElementById('cacheLastRefreshTime');
  if (lastRefresh) {
    const time = formatRelativeTime(new Date(lastRefresh));
    timeSpan.textContent = time;
  } else {
    timeSpan.textContent = '从未';
  }

  // 刷新按钮状态
  const btn = document.getElementById('refreshFollowingsListBtn');
  if (canRefresh) {
    btn.disabled = false;
    btn.textContent = '🔄 刷新列表';
    btn.classList.remove('btn-disabled');
  } else {
    btn.disabled = true;
    const minutes = Math.ceil(nextRefreshIn / 60);
    btn.textContent = `⏱ 冷却中 (${minutes}分钟)`;
    btn.classList.add('btn-disabled');
  }
}
```

**Step 4: 添加刷新列表方法**

```javascript
async refreshFollowingsList(groupId) {
  try {
    const response = await api.refreshFollowings(groupId);

    if (response.success) {
      showToast('刷新成功', 'success');
      // 重新加载列表
      await this.loadFollowingsForSync(groupId);
    } else {
      showToast(response.message || '刷新失败', 'warning');
      // 即使失败也更新缓存信息（显示冷却状态）
      if (response.cache) {
        this.updateCacheInfo(response.cache);
      }
    }
  } catch (error) {
    showToast('刷新失败: ' + error.message, 'error');
  }
}
```

**Step 5: 添加用户选择事件绑定**

```javascript
bindUserSelectionEvents() {
  // 全选
  document.getElementById('selectAllUsersBtn').onclick = () => {
    document.querySelectorAll('.following-checkbox').forEach(cb => {
      cb.checked = true;
    });
    this.updateSelectedCount();
  };

  // 取消全选
  document.getElementById('unselectAllUsersBtn').onclick = () => {
    document.querySelectorAll('.following-checkbox').forEach(cb => {
      cb.checked = false;
    });
    this.updateSelectedCount();
  };

  // 复选框变化时更新计数
  document.querySelectorAll('.following-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      this.updateSelectedCount();
    });
  });

  // 刷新按钮
  document.getElementById('refreshFollowingsListBtn').onclick = () => {
    const groupId = this.currentLoginGroupId || this.state.selectedGroupId;
    this.refreshFollowingsList(groupId);
  };
}

updateSelectedCount() {
  const count = document.querySelectorAll('.following-checkbox:checked').length;
  document.getElementById('selectedUserCount').textContent = count;
}
```

**Step 6: 添加批量订阅方法**

```javascript
async batchSubscribeUsers(groupId) {
  try {
    const checkboxes = document.querySelectorAll('.following-checkbox:checked');
    const uids = Array.from(checkboxes).map(cb => parseInt(cb.dataset.uid));

    if (uids.length === 0) {
      showToast('请至少选择一个用户', 'warning');
      return;
    }

    const response = await api.batchSubscribeFollowings(groupId, uids);

    if (response.success) {
      const { success, failed } = response.data;
      const message = failed.length > 0
        ? `成功订阅 ${success.length} 个，失败 ${failed.length} 个`
        : `成功订阅 ${success.length} 个`;

      showToast(message, failed.length > 0 ? 'warning' : 'success');

      // 关闭 Modal
      this.hideFollowingSyncModal();

      // 刷新订阅列表
      await this.loadGroups();
      if (this.state.selectedGroupId === groupId) {
        await this.loadSubscriptions(groupId);
        this.updateSubscriptionCounts(groupId);
      }
    } else {
      showToast('批量订阅失败: ' + response.message, 'error');
    }
  } catch (error) {
    showToast('批量订阅失败: ' + error.message, 'error');
  }
}
```

**Step 7: 测试用户选择和批量订阅**

Run: 启动服务器测试
```bash
npm start
```

Expected:
1. 切换到 Tab 2 加载用户列表
2. 显示缓存时间和刷新按钮状态
3. 全选/取消全选正常工作
4. 批量订阅成功并刷新订阅列表

**Step 8: 提交**

```bash
git add src/web/public/js/app.js src/web/public/js/utils.js
git commit -m "feat(webui): implement Tab 2 user selection and batch subscribe"
```

---

## Task 14: 测试和优化

**目标：** 全面测试所有功能，修复 bug，优化用户体验

**Step 1: 完整功能测试清单**

测试以下场景：

1. ✅ Header 中不再显示全局按钮
2. ✅ 群组面板显示 Bilibili 账号区域
3. ✅ 点击登录按钮弹出 Modal
4. ✅ 获取二维码并显示（使用 QRCode.js）
5. ✅ 扫码后轮询检测登录状态
6. ✅ 登录成功后更新状态
7. ✅ 二维码过期显示重新获取按钮
8. ✅ 点击"从关注同步"打开 Modal
9. ✅ Tab 1 显示分组列表并回显配置
10. ✅ 保存分组配置成功
11. ✅ Tab 2 显示用户列表和缓存信息
12. ✅ 刷新按钮冷却期正常工作
13. ✅ 全选/取消全选正常
14. ✅ 批量订阅成功并更新订阅列表

**Step 2: 边界情况测试**

1. 未登录时点击"从关注同步" → 应提示先登录
2. 关注列表为空 → 显示空状态
3. 分组列表为空 → 显示空状态
4. 网络错误 → 显示错误提示
5. 批量订阅部分失败 → 显示成功和失败统计

**Step 3: 添加未登录检查**

在 `showFollowingSyncModal` 中添加：

```javascript
showFollowingSyncModal(groupId) {
  // TODO: 检查是否已登录
  // 暂时允许打开，后续根据实际情况添加登录检查

  // ... 现有代码 ...
}
```

**Step 4: 优化 Loading 状态**

在各个异步操作中添加 Loading 提示，改善用户体验。

**Step 5: 最终测试**

Run: 完整测试流程
```bash
npm start
# 测试所有功能点
```

Expected: 所有功能正常工作，无明显 bug

**Step 6: 提交**

```bash
git add .
git commit -m "test(webui): complete testing and optimization"
```

---

## Task 15: 文档更新和最终清理

**目标：** 更新文档，清理代码，准备合并

**Step 1: 检查代码质量**

- 移除 console.log
- 检查代码格式
- 添加必要的注释

**Step 2: 更新 README（如果需要）**

记录新功能的使用说明

**Step 3: 最终提交**

```bash
git add .
git commit -m "docs: update documentation for new Bilibili login and sync features"
```

**Step 4: 合并到主分支**

```bash
git checkout main
git merge webui
git push origin main
```

---

## 总结

本实施计划分为 15 个主要任务，涵盖：

1. **清理工作** - 移除旧的全局按钮
2. **后端扩展** - Python 新增分组列表功能，Node.js 添加缓存管理器和 API 路由
3. **前端基础** - 引入 QRCode.js，添加 HTML 结构和 CSS 样式
4. **核心功能** - 实现群组登录、Tab 切换、分组同步、用户批量订阅
5. **测试优化** - 完整测试和边界情况处理
6. **文档清理** - 更新文档，代码清理

每个任务都包含详细的步骤、代码示例、测试方法和提交信息。遵循 TDD 原则，频繁提交，确保每一步都可验证。
