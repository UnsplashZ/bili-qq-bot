# WebUI Bilibili 登录和关注同步功能重构设计

## 概述

**目标：** 重构 WebUI 的 Bilibili 登录和关注同步功能，将其从全局 header 移至群组面板，修复二维码显示问题，并实现混合模式的关注同步（分组自动同步 + 用户手动选择）。

**背景问题：**
1. 登录和关注同步功能应该跟随群组，而非全局
2. 二维码显示为破裂图片（URL 字符串未转换为 QR code 图片）
3. 关注同步需要支持两种模式：按分组配置自动同步、按用户一次性批量订阅
4. 用户列表需要缓存机制，避免频繁 API 调用

---

## 设计部分 1: 架构和组件重定位

### 核心变更
- 将 Bilibili 登录和关注同步从全局 header 移至群组面板
- 每个群组可以有独立的 Bilibili 账号关联
- 前端使用 `qrcodejs2` 库生成二维码

### 组件结构

**群组面板 (`#groupPanel`) 新增区域：**

```
[群组信息卡片]
  ├─ 群组 ID、名称、状态
  └─ 启用/禁用开关

[Bilibili 账号卡片] ← 新增
  ├─ 登录状态: "未登录" 或 "已登录 (UID: xxxxx)"
  ├─ [登录/重新登录] 按钮
  └─ 上次登录时间

[订阅管理]
  ├─ 现有 Tab: "UP主订阅"、"番剧订阅"
  └─ 新增按钮: "📋 从关注同步" → 打开 Modal

[管理员管理]
[黑名单管理]
[配置区域...]
```

### 为什么按群组设计？
- 不同群组可能使用不同的 Bilibili 账号（cookie）
- 符合现有架构：`biliApi` 方法都接受 `groupId` 参数
- 每个群组的订阅管理是独立的

---

## 设计部分 2: 二维码登录实现

### 前端 QR Code 生成

**引入库：**
```html
<script src="https://cdn.jsdelivr.net/npm/qrcodejs2@0.0.1/qrcode.min.js"></script>
```

### 登录流程

1. 用户点击群组面板中的"登录/重新登录"按钮
2. 弹出登录 Modal（携带当前 groupId）
3. 前端调用：
   ```
   GET /api/bilibili/login/qrcode?groupId={groupId}
   ```
4. 后端返回：
   ```json
   {
     "success": true,
     "data": {
       "qrcodeUrl": "https://passport.bilibili.com/x/...",  // URL 字符串
       "qrcodeKey": "abc123..."
     }
   }
   ```
5. 前端使用 QRCode.js 生成图片：
   ```javascript
   // 清空容器
   document.getElementById("qrcodeContainer").innerHTML = '';

   // 生成二维码
   new QRCode(document.getElementById("qrcodeContainer"), {
     text: response.data.qrcodeUrl,
     width: 256,
     height: 256
   });
   ```
6. 开始轮询检查登录状态（每 2 秒）
7. 调用：
   ```
   POST /api/bilibili/login/check
   Body: { qrcodeKey, groupId }
   ```
8. 登录成功后：
   - 停止轮询
   - 关闭 Modal
   - 更新群组面板的登录状态显示
   - Toast 提示成功

### 状态管理
```javascript
{
  currentLoginGroupId: null,        // 当前正在登录的群组 ID
  loginStatus: {                    // 每个群组的登录状态缓存
    [groupId]: {
      logged_in: true,
      uid: 123456,
      lastLoginTime: '2026-01-21T10:00:00Z'
    }
  }
}
```

---

## 设计部分 3: 关注同步混合模式

### Modal 结构

点击"📋 从关注同步"按钮后，打开 Modal，包含两个 Tab：

#### Tab 1: 按分组同步（配置自动同步）

**功能说明：**
- 显示用户的 Bilibili 关注分组列表（如"特别关注"、"日常关注"）
- 勾选分组后保存配置
- 后台自动定期同步这些分组的用户到订阅列表
- 等同于执行 `/设置 关注同步 添加 <分组名>` 命令

**显示内容：**
```
提示文字: "勾选分组后，系统将自动同步这些分组的关注用户订阅"

分组列表:
  [✓] 特别关注 (15人)
  [ ] 日常关注 (50人)
  [✓] 游戏主播 (8人)

当前已配置: 特别关注, 游戏主播
```

**交互流程：**
1. 打开 Tab → 获取分组列表 + 当前配置
2. 勾选/取消勾选分组
3. 点击"保存配置" → 更新 `cookieSyncGroupNames`
4. 后台自动同步生效

**API 调用：**
- 获取分组：`GET /api/bilibili/following-groups?groupId={groupId}`
- 保存配置：`PUT /api/groups/{groupId}/config`

#### Tab 2: 按用户选择（一次性批量订阅）

**功能说明：**
- 显示所有关注用户的卡片网格
- 支持多选、全选/取消全选
- 点击"批量订阅"后，一次性将选中用户添加到订阅列表
- 不配置自动同步，仅执行一次

**显示内容：**
```
缓存信息栏:
  上次刷新: 15分钟前  [🔄 刷新列表]
  或
  上次刷新: 48分钟前  [⏱ 冷却中 (12分钟)]

控制按钮:
  [全选] [取消全选] [已选: 0]

用户卡片网格:
  [ ] [头像] UP主名称
      UID: 123456
  ...
```

**交互流程：**
1. 打开 Tab → 从缓存加载用户列表
2. 显示缓存状态和刷新按钮状态
3. 多选用户
4. 点击"批量订阅" → 显示进度 → 成功/失败统计

**API 调用：**
- 获取用户列表：`GET /api/bilibili/followings?groupId={groupId}`
- 刷新列表：`POST /api/bilibili/followings/refresh?groupId={groupId}`
- 批量订阅：`POST /api/bilibili/followings/subscribe`

### 数据流

```
Tab 1: 打开 → GET /following-groups → 显示分组列表
       勾选 → PUT /groups/{id}/config → 后台自动同步

Tab 2: 打开 → GET /followings (缓存) → 显示用户列表
       刷新 → POST /followings/refresh (检查冷却) → 更新列表
       订阅 → POST /followings/subscribe → 批量添加
```

---

## 设计部分 4: API 端点和数据流

### 新增/修改的 API 端点

#### 1. 获取关注分组列表 (新增)

```
GET /api/bilibili/following-groups?groupId={groupId}

Response:
{
  "success": true,
  "data": [
    { "tagid": 123, "name": "特别关注", "count": 15 },
    { "tagid": 456, "name": "日常关注", "count": 50 }
  ]
}
```

**后端实现要点：**
- 需要在 `bili_service.py` 中新增 `get_following_groups()` 函数
- 调用 Bilibili API: `https://api.bilibili.com/x/relation/tags`
- 返回分组的 tagid、名称、用户数量

#### 2. 配置分组自动同步 (修改现有)

```
PUT /api/groups/{groupId}/config

Body:
{
  "enableCookieSync": true,
  "cookieSyncGroupNames": ["特别关注", "日常关注"]
}

Response:
{
  "success": true,
  "message": "配置已更新"
}
```

**后端实现要点：**
- 更新群组配置
- 触发后台关注同步刷新

#### 3. 获取所有关注用户 (修改现有，添加缓存信息)

```
GET /api/bilibili/followings?groupId={groupId}

Response:
{
  "success": true,
  "data": [
    { "uid": 123, "name": "UP主", "face": "...", "sign": "..." },
    ...
  ],
  "cache": {
    "lastRefresh": "2026-01-21T10:30:00Z",
    "canRefresh": false,
    "nextRefreshIn": 2700  // 秒数
  }
}
```

#### 4. 刷新关注列表 (修改现有，添加冷却检查)

```
POST /api/bilibili/followings/refresh?groupId={groupId}

Response (成功):
{
  "success": true,
  "message": "刷新成功",
  "data": [...],
  "cache": {
    "lastRefresh": "2026-01-21T10:45:00Z",
    "canRefresh": false,
    "nextRefreshIn": 3600
  }
}

Response (冷却期内):
{
  "success": false,
  "message": "刷新过于频繁，请 45 分钟后再试",
  "cache": {
    "lastRefresh": "2026-01-21T10:00:00Z",
    "canRefresh": false,
    "nextRefreshIn": 2700
  }
}
```

#### 5. 批量订阅用户 (已有)

```
POST /api/bilibili/followings/subscribe

Body:
{
  "groupId": "123456",
  "uids": [111, 222, 333]
}

Response:
{
  "success": true,
  "message": "成功添加 3 个订阅",
  "data": {
    "success": [111, 222, 333],
    "failed": []
  }
}
```

---

## 设计部分 5: 缓存机制详细设计

### 后端缓存管理器

**新建 `FollowingsCacheManager` 类：**

```javascript
class FollowingsCacheManager {
  constructor() {
    this.cache = {
      data: [],                  // 关注用户列表
      lastRefresh: null,         // 上次刷新时间戳 (毫秒)
      cooldownMs: 3600000        // 冷却时间 1小时（可配置）
    };

    this.cacheFile = path.join(process.cwd(), 'data', 'followings-cache.json');
    this.loadCache();  // 启动时加载缓存
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

    // 调用 biliApi.getMyFollowings()
    const result = await biliApi.getMyFollowings(null, groupId);

    if (result.status === 'success') {
      this.cache.data = result.data;
      this.cache.lastRefresh = Date.now();
      await this.saveCache();  // 持久化
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
    await fs.writeFile(this.cacheFile, JSON.stringify(this.cache, null, 2));
  }

  // 加载缓存
  async loadCache() {
    try {
      const data = await fs.readFile(this.cacheFile, 'utf-8');
      const loaded = JSON.parse(data);

      // 检查缓存是否过期（超过 7 天自动失效）
      if (loaded.lastRefresh && Date.now() - loaded.lastRefresh < 7 * 24 * 60 * 60 * 1000) {
        this.cache = loaded;
      }
    } catch (e) {
      // 文件不存在或解析失败，使用默认值
    }
  }
}
```

### 前端显示

**缓存信息栏：**
```javascript
function updateCacheInfo(cacheData) {
  const { lastRefresh, canRefresh, nextRefreshIn } = cacheData;

  // 显示上次刷新时间
  if (lastRefresh) {
    const time = formatRelativeTime(new Date(lastRefresh));
    document.getElementById('lastRefreshTime').textContent = time;  // "15分钟前"
  } else {
    document.getElementById('lastRefreshTime').textContent = '从未';
  }

  // 刷新按钮状态
  const btn = document.getElementById('refreshFollowingsBtn');
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

### 持久化策略
- 缓存数据保存到 `data/followings-cache.json`
- 服务器重启后自动加载缓存
- 缓存超过 7 天自动失效
- 冷却时间可通过配置文件调整

---

## 设计部分 6: UI/UX 细节

### 群组面板新增 UI

```html
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

<!-- 订阅管理区域修改 -->
<div class="subscriptions-section">
  <div class="section-header">
    <h3>订阅管理</h3>
    <button class="btn btn-secondary" id="syncFromFollowingBtn">
      📋 从关注同步
    </button>
  </div>

  <!-- 现有的 Tab: UP主订阅、番剧订阅 -->
  <div class="subscription-tabs">
    <button class="tab-btn active" data-tab="users">UP主订阅 (0)</button>
    <button class="tab-btn" data-tab="bangumi">番剧订阅 (0)</button>
  </div>

  <div class="tab-content">
    <!-- 订阅列表内容 -->
  </div>
</div>
```

### 关注同步 Modal 完整布局

```html
<div class="modal-overlay hidden" id="followingSyncModal">
  <div class="modal-content modal-large">
    <div class="modal-header">
      <h2>从关注同步 - <span id="syncModalGroupName"></span></h2>
      <button class="btn-icon" id="closeFollowingSyncModalBtn">×</button>
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
          <!--
          <label class="group-item">
            <input type="checkbox" value="特别关注" />
            <span class="group-name">特别关注</span>
            <span class="group-count">(15人)</span>
          </label>
          -->
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
          <!--
          <label class="following-card">
            <input type="checkbox" class="following-checkbox" data-uid="123456" />
            <img class="following-avatar" src="..." />
            <div class="following-info">
              <div class="following-name">UP主名称</div>
              <div class="following-uid">UID: 123456</div>
            </div>
          </label>
          -->
        </div>
      </div>
    </div>

    <div class="modal-footer">
      <button class="btn btn-secondary" id="cancelSyncModalBtn">取消</button>

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

### 交互细节

**Tab 切换：**
- 点击 Tab 按钮 → 切换 active 状态 → 显示/隐藏对应内容
- Tab 2 切换到 Tab 1 → Footer 按钮从"批量订阅"切换为"保存配置"

**Tab 1 交互流程：**
1. 打开 Modal → 加载分组列表 → 回显当前配置（勾选已配置的分组）
2. 用户勾选/取消勾选分组
3. 点击"保存配置" → 调用 API → Toast 提示 → 关闭 Modal

**Tab 2 交互流程：**
1. 打开 Tab → 从缓存加载用户列表 → 显示缓存状态
2. 用户多选、全选/取消全选
3. 点击"批量订阅" → 显示进度 Loading → 完成后显示统计 → 刷新订阅列表

**刷新按钮状态：**
```css
/* 可用状态 */
.btn-refresh {
  background: var(--primary-color);
  color: white;
  cursor: pointer;
}

/* 冷却状态 */
.btn-refresh.btn-disabled {
  background: var(--border-color);
  color: var(--text-secondary);
  cursor: not-allowed;
}
```

**登录 Modal 交互：**
1. 点击"登录/重新登录" → 打开 Modal
2. 点击"获取二维码" → 显示 QR code + 开始轮询
3. 轮询状态：
   - 等待扫码：显示"等待扫码..."
   - 已扫码待确认：显示"已扫码，请在手机上确认"
   - 登录成功：Toast 提示 → 关闭 Modal → 更新账号状态
   - 二维码过期：显示"二维码已过期" → 提供"重新获取"按钮

---

## 设计部分 7: 错误处理和边界情况

### 错误场景处理

#### 1. 未登录 B站账号
**场景：** 用户点击"从关注同步"但未登录

**处理：**
```javascript
if (!isBiliLoggedIn(groupId)) {
  showToast('请先登录 Bilibili 账号', 'warning');
  // 可选：自动打开登录 Modal
  return;
}
```

**UI 提示：**
- Toast 警告："请先登录 Bilibili 账号"
- 或 Modal 内显示："⚠️ 未登录，请先点击上方登录按钮"

#### 2. 二维码过期
**场景：** 轮询检测到 code 86038

**处理：**
```javascript
if (response.data.code === 86038) {
  clearInterval(loginCheckInterval);
  document.getElementById('loginProgress').innerHTML = `
    <p class="error-text">⏰ 二维码已过期</p>
    <button class="btn btn-primary" onclick="regenerateQrcode()">
      重新获取
    </button>
  `;
}
```

#### 3. 刷新冷却中
**场景：** 用户点击刷新按钮但在冷却期内

**处理：**
```javascript
if (!response.success && response.cache.nextRefreshIn > 0) {
  const minutes = Math.ceil(response.cache.nextRefreshIn / 60);
  showToast(`刷新过于频繁，请 ${minutes} 分钟后再试`, 'warning');
  updateCacheInfo(response.cache);  // 更新按钮状态
}
```

**UI 状态：**
- 按钮置灰
- 显示倒计时："⏱ 冷却中 (12分钟)"
- 可选：每分钟更新倒计时显示

#### 4. 分组不存在
**场景：** 用户配置的分组在 B站被删除

**后台处理：**
- 同步时检测到分组不存在
- 记录错误日志：`logger.warn('[Sync] Group "XXX" not found')`
- 不中断其他分组的同步

**WebUI 显示：**
- 在配置区域显示警告徽章
- 鼠标悬停显示："分组 'XXX' 不存在，请更新配置"

#### 5. 批量订阅部分失败
**场景：** 批量订阅 50 个用户，其中 5 个失败

**处理：**
```javascript
const { success, failed } = response.data;
const message = failed.length > 0
  ? `成功订阅 ${success.length} 个，失败 ${failed.length} 个`
  : `成功订阅 ${success.length} 个`;

showToast(message, failed.length > 0 ? 'warning' : 'success');

// 可选：显示失败详情
if (failed.length > 0) {
  console.log('Failed subscriptions:', failed);
  // 或显示在 Modal 中
}
```

#### 6. 网络错误
**场景：** API 调用超时或失败

**处理：**
```javascript
try {
  const response = await api.getFollowingGroups(groupId);
} catch (error) {
  showToast(`网络错误：${error.message}`, 'error');

  // 提供重试按钮
  showRetryButton(() => {
    loadFollowingGroups(groupId);
  });
}
```

### 边界情况处理

#### 关注列表为空
```html
<div class="empty-state">
  <p>😊 暂无关注用户</p>
  <p class="hint">在 Bilibili 关注一些UP主后刷新列表</p>
</div>
```

#### 分组列表为空
```html
<div class="empty-state">
  <p>📁 暂无关注分组</p>
  <p class="hint">在 Bilibili 创建关注分组后刷新</p>
</div>
```

#### 重复订阅
**后端去重：**
```javascript
async addUserSubscription(uid, groupId) {
  // 检查是否已订阅
  const existing = this.userSubs.find(sub =>
    sub.uid === uid && sub.groupIds.includes(groupId)
  );

  if (existing) {
    throw new Error('该用户已在订阅列表中');
  }

  // 添加订阅...
}
```

#### 同时多个群组登录
**状态隔离：**
- 每个群组的登录状态独立存储
- Cookie 文件按 groupId 分别保存：`cookies-{groupId}.json`
- 登录 Modal 携带 groupId 参数

#### 数据一致性
**配置变更：**
```javascript
async updateGroupSyncConfig(groupId, syncGroups) {
  // 1. 更新配置文件
  await config.setGroupConfig(groupId, 'cookieSyncGroupNames', syncGroups);

  // 2. 触发后台同步刷新
  await subscriptionService.refreshCookieFollowings();

  // 3. 重新加载群组信息
  await this.loadGroups();

  // 4. 如果当前选中该群组，刷新面板
  if (this.state.selectedGroupId === groupId) {
    this.selectGroup(groupId);
  }
}
```

**订阅成功后：**
```javascript
async batchSubscribeUsers(groupId, uids) {
  const result = await api.batchSubscribeFollowings(groupId, uids);

  if (result.success) {
    // 1. Toast 提示
    showToast(result.message, 'success');

    // 2. 刷新群组列表（更新订阅数量）
    await this.loadGroups();

    // 3. 如果当前在该群组面板，刷新订阅列表
    if (this.state.selectedGroupId === groupId) {
      await this.loadSubscriptions(groupId);
      this.updateSubscriptionCounts(groupId);
    }

    // 4. 关闭 Modal
    this.closeFollowingSyncModal();
  }
}
```

---

## 实现优先级

### Phase 1: 核心功能（高优先级）
1. ✅ 二维码登录修复（前端使用 qrcodejs2）
2. ✅ 将登录功能移至群组面板
3. ✅ 实现关注同步 Modal 基础结构（两个 Tab）
4. ✅ Tab 1: 按分组同步功能
5. ✅ Tab 2: 按用户选择功能（已有，需整合）

### Phase 2: 缓存和优化（中优先级）
6. ✅ 实现关注列表缓存机制
7. ✅ 添加刷新冷却功能
8. ✅ 持久化缓存到文件

### Phase 3: 用户体验（中优先级）
9. ✅ 完善错误提示和边界情况处理
10. ✅ 添加 Loading 状态
11. ✅ 优化 UI 交互（倒计时、进度显示等）

### Phase 4: 后端扩展（低优先级）
12. ✅ 新增 `get_following_groups` Python 函数
13. ✅ 添加对应的 API 路由

---

## 技术栈

**前端：**
- Vanilla JavaScript
- qrcodejs2 (QR code 生成)
- 现有的 glassmorphism CSS

**后端：**
- Node.js + Express
- Python (bilibili-api-python)
- 现有的 subscriptionService

**数据持久化：**
- config.json (群组配置)
- followings-cache.json (关注列表缓存)
- cookies-{groupId}.json (每个群组的 Bilibili cookie)

---

## 后续优化建议

1. **缓存过期策略优化：**
   - 支持配置文件设置冷却时间
   - 不同时段不同冷却时间（高峰期更长）

2. **批量订阅性能优化：**
   - 并发控制（每次最多 5 个并发请求）
   - 失败重试机制

3. **UI 增强：**
   - 添加搜索/筛选功能（按用户名搜索）
   - 分组同步进度实时显示

4. **监控和日志：**
   - 记录每次同步的详细日志
   - 统计同步成功率

---

## 总结

本次重构主要解决以下问题：

1. ✅ **功能定位问题：** 登录和同步从全局移至群组，符合业务逻辑
2. ✅ **二维码显示问题：** 使用前端 QR code 库生成图片
3. ✅ **功能缺失问题：** 实现混合模式的关注同步（分组配置 + 用户选择）
4. ✅ **性能问题：** 添加缓存机制和刷新冷却，避免频繁 API 调用
5. ✅ **用户体验问题：** 完善错误处理、边界情况、状态反馈

设计遵循 YAGNI 原则，优先实现核心功能，为后续扩展留有空间。
