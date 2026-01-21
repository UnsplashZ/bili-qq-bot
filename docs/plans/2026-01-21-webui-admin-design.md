# WebUI 管理后台设计文档

## 文档信息
- **创建日期**: 2026-01-21
- **设计目标**: 为 Bili QQ Bot 提供可视化管理后台，简化 Root 用户的配置操作
- **技术栈**: Express.js + 原生 JavaScript + CSS

---

## 一、设计目标与定位

### 1.1 核心目标
- **简化配置操作**: 让 Root 用户通过可视化界面快速管理功能开关、群权限、订阅等
- **避免命令行操作**: 替代在 QQ 群内敲命令或手动编辑配置文件的方式
- **实时配置管理**: 与 Bot 主进程共享配置，修改立即生效

### 1.2 功能优先级
1. **群组权限管理** (P0)
   - 启用/禁用群组
   - 设置群管理员
   - 管理全局和分群黑名单

2. **订阅管理** (P0)
   - 按群组管理 UP 主订阅
   - 按群组管理番剧订阅
   - 设置订阅轮询间隔

3. **功能开关面板** (P1)
   - 深色模式配置
   - 标签显示开关
   - UID 显示开关
   - 链接缓存时间

4. **AI 参数配置** (P1)
   - 上下文条数
   - 随机回复概率
   - 向量记忆参数

### 1.3 非目标（暂不实现）
- ❌ 数据监控与统计
- ❌ 日志查看功能
- ❌ Bot 运行状态监控
- ❌ 消息发送功能

---

## 二、技术架构设计

### 2.1 整体架构

```
┌─────────────────┐
│   浏览器客户端   │
│  (原生 JS/CSS)  │
└────────┬────────┘
         │ HTTP/HTTPS
         │ Basic Auth
┌────────▼────────┐
│  Express Server │
│   (WebUI API)   │
├─────────────────┤
│  认证中间件      │
│  路由层          │
│  - /api/groups  │
│  - /api/subs    │
│  - /api/config  │
└────────┬────────┘
         │ 共享模块
┌────────▼────────┐
│  config.js      │
│  (配置管理模块)  │
└─────────────────┘
         │
┌────────▼────────┐
│  config.json    │
│  (持久化存储)    │
└─────────────────┘
```

### 2.2 目录结构

```
src/
├── web/                          # WebUI 模块
│   ├── server.js                 # Express 服务器主文件
│   ├── middleware/
│   │   └── auth.js              # Basic Auth 认证中间件
│   ├── routes/
│   │   ├── groups.js            # 群组管理 API
│   │   ├── subscriptions.js     # 订阅管理 API
│   │   └── config.js            # 全局配置 API
│   └── public/                   # 静态资源
│       ├── index.html           # 主页面
│       ├── css/
│       │   └── app.css          # 样式文件
│       └── js/
│           ├── app.js           # 主应用逻辑
│           ├── api.js           # API 调用封装
│           ├── components/
│           │   ├── groupCard.js # 群组卡片组件
│           │   ├── groupPanel.js # 群组详情面板
│           │   └── modal.js     # 模态框组件
│           └── utils.js         # 工具函数
├── bot.js                        # Bot 主文件（需修改，启动 WebUI）
└── config.js                     # 配置管理模块（已存在）
```

### 2.3 技术选型

| 层级 | 技术 | 说明 |
|------|------|------|
| 后端框架 | Express.js | 轻量、易集成到现有项目 |
| 认证方式 | HTTP Basic Auth | 简单可靠，适合内网访问 |
| 前端框架 | 原生 JavaScript | 无构建依赖，轻量快速 |
| 样式方案 | 原生 CSS + CSS Variables | 支持主题切换，无框架依赖 |
| 数据交互 | Fetch API | 现代浏览器原生支持 |
| 状态管理 | 简单对象 + 事件发布订阅 | 轻量级状态管理 |

### 2.4 部署方案

**访问方式**: 内网访问 + SSH 隧道

- **监听地址**: 默认 `127.0.0.1:3100`（可配置为 `0.0.0.0` 用于内网访问）
- **认证方式**: HTTP Basic Auth（用户名/密码配置在 `.env`）
- **远程访问**: 通过 SSH 隧道转发端口
  ```bash
  ssh -L 8080:localhost:3100 user@server
  # 本地浏览器访问 http://localhost:8080
  ```
- **HTTPS**: 可选，通过 Nginx 反向代理实现

---

## 三、界面设计

### 3.1 整体布局

采用**卡片 + 主从结构**结合的方式：

```
┌──────────────────────────────────────────────────────────┐
│  Header (顶栏)                                            │
│  Bili QQ Bot 管理后台          [全局配置] [退出登录]      │
├──────────────────┬───────────────────────────────────────┤
│                  │                                       │
│  Left Sidebar    │  Main Content Area                    │
│  (群组卡片列表)   │  (详情面板)                            │
│                  │                                       │
│  ┌────────────┐  │  ┌─────────────────────────────────┐ │
│  │ 群组 A     │  │  │  群组详情 - 123456789           │ │
│  │ ID: 123... │◄─┼─▶│                                 │ │
│  │ 订阅: 5    │  │  │  [基本信息] [订阅管理] [功能配置]│ │
│  │ [已启用]   │  │  │                                 │ │
│  └────────────┘  │  │  基本信息：                      │ │
│                  │  │  群号: 123456789                │ │
│  ┌────────────┐  │  │  状态: [启用/禁用] 开关         │ │
│  │ 群组 B     │  │  │  管理员: user1, user2 [添加]   │ │
│  │ ID: 456... │  │  │  黑名单: 3 人 [管理]            │ │
│  │ 订阅: 2    │  │  │                                 │ │
│  │ [已禁用]   │  │  │  订阅管理：                      │ │
│  └────────────┘  │  │  UP主订阅 (3)   [+ 添加订阅]    │ │
│                  │  │  - UP主A (UID: xxx) [删除]      │ │
│  [+ 添加群组]    │  │  - UP主B (UID: yyy) [删除]      │ │
│                  │  │  番剧订阅 (2)   [+ 添加订阅]    │ │
│                  │  │  - 番剧X (SS: zzz) [删除]       │ │
│                  │  │                                 │ │
└──────────────────┴───────────────────────────────────────┘
```

### 3.2 左侧边栏 - 群组卡片列表

**功能特性**:
- 搜索/过滤群组（按群号、群名）
- 快速查看群组状态
- 点击卡片展开右侧详情面板
- 新增群组按钮

**卡片内容**:
```
┌──────────────────────┐
│ 群组名称              │
│ ID: 123456789        │
│ 订阅: 5 | 管理员: 2  │
│ [●已启用] 或 [○已禁用]│
└──────────────────────┘
```

**状态指示**:
- 启用: 绿色边框 + 绿色圆点
- 禁用: 灰色边框 + 灰色圆点
- 选中: 蓝色高亮背景

### 3.3 右侧主面板 - 群组详情

采用 **Tab 切换** 的方式组织内容：

#### Tab 1: 基本信息
```
┌─────────────────────────────────┐
│ 基本信息                         │
├─────────────────────────────────┤
│ 群号: 123456789                 │
│ 群名: 测试群组                   │
│ 状态: [启用 ●━━━○ 禁用]         │
│                                 │
│ 群管理员 (2人):                  │
│ ┌─────────────────────────────┐ │
│ │ QQ: 111111 [删除]           │ │
│ │ QQ: 222222 [删除]           │ │
│ └─────────────────────────────┘ │
│ [+ 添加管理员]                   │
│                                 │
│ 黑名单 (本群, 3人):              │
│ ┌─────────────────────────────┐ │
│ │ QQ: 333333 [移除]           │ │
│ │ QQ: 444444 [移除]           │ │
│ └─────────────────────────────┘ │
│ [+ 添加到黑名单]                 │
└─────────────────────────────────┘
```

#### Tab 2: 订阅管理
```
┌─────────────────────────────────┐
│ UP主订阅 (3)      [+ 添加UP主]   │
├─────────────────────────────────┤
│ ┌─────────────────────────────┐ │
│ │ UP主A                       │ │
│ │ UID: 401742377             │ │
│ │ 最后动态: 2小时前            │ │
│ │ 直播状态: 未开播  [删除订阅] │ │
│ └─────────────────────────────┘ │
│ ┌─────────────────────────────┐ │
│ │ UP主B                       │ │
│ │ UID: 123456                │ │
│ │ 最后动态: 1天前              │ │
│ │ 直播状态: 未开播  [删除订阅] │ │
│ └─────────────────────────────┘ │
├─────────────────────────────────┤
│ 番剧订阅 (2)      [+ 添加番剧]   │
├─────────────────────────────────┤
│ ┌─────────────────────────────┐ │
│ │ 某某番剧                     │ │
│ │ Season ID: 21542           │ │
│ │ 最新一集: EP12              │ │
│ │ 更新状态: 已完结  [删除订阅] │ │
│ └─────────────────────────────┘ │
└─────────────────────────────────┘
```

#### Tab 3: 功能配置
```
┌─────────────────────────────────┐
│ 显示设置                         │
├─────────────────────────────────┤
│ 深色模式: [关闭 ○━━━● 开启]     │
│ 定时模式: □ 启用 (21:00-06:00)  │
│                                 │
│ 标签显示:                        │
│   视频标签: [●] 开启             │
│   番剧标签: [●] 开启             │
│   动态标签: [●] 开启             │
│   直播标签: [●] 开启             │
│   用户标签: [●] 开启             │
│                                 │
│ UID 显示: [●━━━○] 开启          │
│ 链接缓存: [600] 秒              │
├─────────────────────────────────┤
│ AI 配置 (本群)                   │
├─────────────────────────────────┤
│ 上下文条数: [10] (1-50)         │
│ 回复概率: [0.1] (0.0-1.0)       │
│                                 │
│ [重置为全局默认]                 │
└─────────────────────────────────┘
```

### 3.4 全局配置页面

点击顶栏的"全局配置"按钮，弹出模态框或切换到独立页面：

```
┌─────────────────────────────────┐
│ 全局配置                         │
├─────────────────────────────────┤
│ [黑名单管理] [AI全局参数] [系统] │
├─────────────────────────────────┤
│ 全局黑名单 (5人):                │
│ ┌─────────────────────────────┐ │
│ │ QQ: 111111 [移除]           │ │
│ │ QQ: 222222 [移除]           │ │
│ └─────────────────────────────┘ │
│ [+ 添加到全局黑名单]             │
├─────────────────────────────────┤
│ AI 全局参数:                     │
│ 向量相似度阈值: [0.4] (0-1)      │
│ 向量搜索数量: [3] (1-10)         │
│ 短消息过滤: [5] 字符             │
│ 向量缓存: [●] 开启               │
│ 智能保留: [●] 开启               │
├─────────────────────────────────┤
│ 系统配置:                        │
│ 订阅轮询间隔: [60] 秒            │
│                                 │
│ [保存全局配置]                   │
└─────────────────────────────────┘
```

### 3.5 视觉设计规范

**配色方案** (基于项目现有设计系统):
- 主色调: `#00A1D6` (Bilibili 蓝)
- 成功色: `#52C41A`
- 警告色: `#FAAD14`
- 危险色: `#F5222D`
- 背景色: `#F5F7FA` (浅色) / `#1A1A1A` (深色)
- 卡片背景: `#FFFFFF` (浅色) / `#2C2C2C` (深色)

**字体**:
- 主字体: `'MiSans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
- 代码字体: `'SF Mono', 'Consolas', monospace`

**圆角与阴影**:
- 卡片圆角: `8px`
- 按钮圆角: `4px`
- 卡片阴影: `0 2px 8px rgba(0, 0, 0, 0.1)`

**动画**:
- 过渡时间: `0.3s ease`
- 悬停效果: 轻微放大 + 阴影加深

---

## 四、API 设计

### 4.1 认证相关

#### POST `/api/auth/login`
- **功能**: Basic Auth 认证（实际由中间件处理）
- **响应**:
  ```json
  {
    "success": true,
    "user": "root"
  }
  ```

#### POST `/api/auth/logout`
- **功能**: 退出登录
- **响应**:
  ```json
  {
    "success": true
  }
  ```

### 4.2 群组管理

#### GET `/api/groups`
- **功能**: 获取所有群组列表
- **响应**:
  ```json
  {
    "success": true,
    "data": [
      {
        "groupId": "123456789",
        "groupName": "测试群组", // 可选，通过 NapCat API 获取
        "enabled": true,
        "admins": ["111111", "222222"],
        "blacklist": ["333333"],
        "subscriptions": {
          "users": 3,
          "bangumi": 2
        },
        "config": {
          "nightMode": { "mode": "off" },
          "labelConfig": { "video": true },
          "aiContextLimit": 10,
          "aiProbability": 0.1
        }
      }
    ]
  }
  ```

#### GET `/api/groups/:groupId`
- **功能**: 获取单个群组详情
- **响应**: 同上单个对象

#### POST `/api/groups/:groupId/enable`
- **功能**: 启用群组
- **请求体**: 无
- **响应**:
  ```json
  {
    "success": true,
    "message": "群组已启用"
  }
  ```

#### POST `/api/groups/:groupId/disable`
- **功能**: 禁用群组
- **请求体**: 无
- **响应**: 同上

#### POST `/api/groups/:groupId/admins`
- **功能**: 添加群管理员
- **请求体**:
  ```json
  {
    "userId": "111111"
  }
  ```
- **响应**:
  ```json
  {
    "success": true,
    "message": "管理员已添加"
  }
  ```

#### DELETE `/api/groups/:groupId/admins/:userId`
- **功能**: 删除群管理员
- **响应**: 同上

#### POST `/api/groups/:groupId/blacklist`
- **功能**: 添加到群黑名单
- **请求体**:
  ```json
  {
    "userId": "333333"
  }
  ```

#### DELETE `/api/groups/:groupId/blacklist/:userId`
- **功能**: 从群黑名单移除

#### PUT `/api/groups/:groupId/config`
- **功能**: 更新群组配置
- **请求体**:
  ```json
  {
    "nightMode": { "mode": "on" },
    "labelConfig": { "video": false },
    "aiContextLimit": 15,
    "aiProbability": 0.2
  }
  ```

### 4.3 订阅管理

#### GET `/api/groups/:groupId/subscriptions`
- **功能**: 获取群组订阅列表
- **响应**:
  ```json
  {
    "success": true,
    "data": {
      "users": [
        {
          "uid": "401742377",
          "name": "UP主A",
          "lastDynamicId": "123456",
          "lastLiveStatus": 0,
          "lastCheckTime": "2026-01-21T10:00:00Z"
        }
      ],
      "bangumi": [
        {
          "seasonId": "21542",
          "title": "某某番剧",
          "lastEpId": "285026",
          "lastCheckTime": "2026-01-21T10:00:00Z"
        }
      ]
    }
  }
  ```

#### POST `/api/groups/:groupId/subscriptions/user`
- **功能**: 添加 UP 主订阅
- **请求体**:
  ```json
  {
    "uid": "401742377"
  }
  ```
- **响应**:
  ```json
  {
    "success": true,
    "message": "订阅已添加",
    "data": {
      "uid": "401742377",
      "name": "UP主A"
    }
  }
  ```

#### DELETE `/api/groups/:groupId/subscriptions/user/:uid`
- **功能**: 删除 UP 主订阅

#### POST `/api/groups/:groupId/subscriptions/bangumi`
- **功能**: 添加番剧订阅
- **请求体**:
  ```json
  {
    "seasonId": "21542"
  }
  ```

#### DELETE `/api/groups/:groupId/subscriptions/bangumi/:seasonId`
- **功能**: 删除番剧订阅

### 4.4 全局配置

#### GET `/api/config`
- **功能**: 获取全局配置
- **响应**:
  ```json
  {
    "success": true,
    "data": {
      "blacklistedQQs": ["111111", "222222"],
      "subscriptionCheckInterval": 60,
      "aiVectorSimilarityThreshold": 0.4,
      "aiVectorSearchLimit": 3,
      "aiShortMessageThreshold": 5,
      "aiEnableVectorCache": true,
      "aiEnableSmartTrim": true
    }
  }
  ```

#### PUT `/api/config`
- **功能**: 更新全局配置
- **请求体**: 同上 data 部分

#### POST `/api/config/blacklist`
- **功能**: 添加到全局黑名单
- **请求体**:
  ```json
  {
    "userId": "111111"
  }
  ```

#### DELETE `/api/config/blacklist/:userId`
- **功能**: 从全局黑名单移除

### 4.5 AI 对话管理

#### POST `/api/groups/:groupId/ai/reset`
- **功能**: 重置群组 AI 对话记忆
- **响应**:
  ```json
  {
    "success": true,
    "message": "对话记忆已重置"
  }
  ```

---

## 五、前端实现细节

### 5.1 组件化设计

虽然使用原生 JS，但采用组件化思想：

```javascript
// components/groupCard.js
class GroupCard {
  constructor(groupData) {
    this.data = groupData;
    this.element = null;
  }

  render() {
    this.element = document.createElement('div');
    this.element.className = 'group-card';
    this.element.innerHTML = `
      <div class="group-card-header">
        <h3>${this.data.groupName || `群组 ${this.data.groupId}`}</h3>
        <span class="status-badge ${this.data.enabled ? 'enabled' : 'disabled'}">
          ${this.data.enabled ? '已启用' : '已禁用'}
        </span>
      </div>
      <div class="group-card-body">
        <p>ID: ${this.data.groupId}</p>
        <p>订阅: ${this.data.subscriptions.users + this.data.subscriptions.bangumi}</p>
        <p>管理员: ${this.data.admins.length}</p>
      </div>
    `;

    this.element.addEventListener('click', () => {
      this.onClick();
    });

    return this.element;
  }

  onClick() {
    // 触发事件，让主应用处理
    window.dispatchEvent(new CustomEvent('group-selected', {
      detail: { groupId: this.data.groupId }
    }));
  }
}
```

### 5.2 状态管理

使用简单的发布订阅模式：

```javascript
// app.js
class App {
  constructor() {
    this.state = {
      groups: [],
      selectedGroup: null,
      globalConfig: null
    };

    this.listeners = new Map();
  }

  // 订阅状态变化
  subscribe(key, callback) {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, []);
    }
    this.listeners.get(key).push(callback);
  }

  // 更新状态
  setState(key, value) {
    this.state[key] = value;
    this.notify(key, value);
  }

  // 通知订阅者
  notify(key, value) {
    const callbacks = this.listeners.get(key) || [];
    callbacks.forEach(cb => cb(value));
  }
}

const app = new App();

// 使用示例
app.subscribe('selectedGroup', (group) => {
  renderGroupPanel(group);
});

app.setState('selectedGroup', groupData);
```

### 5.3 API 调用封装

```javascript
// api.js
class API {
  constructor(baseURL = '/api') {
    this.baseURL = baseURL;
  }

  async request(method, endpoint, data = null) {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (data) {
      options.body = JSON.stringify(data);
    }

    const response = await fetch(`${this.baseURL}${endpoint}`, options);

    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`);
    }

    return response.json();
  }

  // 群组相关
  async getGroups() {
    return this.request('GET', '/groups');
  }

  async getGroup(groupId) {
    return this.request('GET', `/groups/${groupId}`);
  }

  async enableGroup(groupId) {
    return this.request('POST', `/groups/${groupId}/enable`);
  }

  async disableGroup(groupId) {
    return this.request('POST', `/groups/${groupId}/disable`);
  }

  async addGroupAdmin(groupId, userId) {
    return this.request('POST', `/groups/${groupId}/admins`, { userId });
  }

  async removeGroupAdmin(groupId, userId) {
    return this.request('DELETE', `/groups/${groupId}/admins/${userId}`);
  }

  // 订阅相关
  async getSubscriptions(groupId) {
    return this.request('GET', `/groups/${groupId}/subscriptions`);
  }

  async subscribeUser(groupId, uid) {
    return this.request('POST', `/groups/${groupId}/subscriptions/user`, { uid });
  }

  async unsubscribeUser(groupId, uid) {
    return this.request('DELETE', `/groups/${groupId}/subscriptions/user/${uid}`);
  }

  async subscribeBangumi(groupId, seasonId) {
    return this.request('POST', `/groups/${groupId}/subscriptions/bangumi`, { seasonId });
  }

  async unsubscribeBangumi(groupId, seasonId) {
    return this.request('DELETE', `/groups/${groupId}/subscriptions/bangumi/${seasonId}`);
  }

  // 全局配置
  async getGlobalConfig() {
    return this.request('GET', '/config');
  }

  async updateGlobalConfig(config) {
    return this.request('PUT', '/config', config);
  }
}

const api = new API();
```

### 5.4 工具函数

```javascript
// utils.js

// 防抖
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// 节流
function throttle(func, limit) {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

// 格式化时间
function formatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = Math.floor((now - date) / 1000);

  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}天前`;

  return date.toLocaleDateString('zh-CN');
}

// 显示提示消息
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('show');
  }, 10);

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// 确认对话框
function showConfirm(message) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content">
        <p>${message}</p>
        <div class="modal-buttons">
          <button class="btn btn-cancel">取消</button>
          <button class="btn btn-primary">确认</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('.btn-cancel').addEventListener('click', () => {
      modal.remove();
      resolve(false);
    });

    modal.querySelector('.btn-primary').addEventListener('click', () => {
      modal.remove();
      resolve(true);
    });
  });
}
```

---

## 六、后端实现细节

### 6.1 Express Server 主文件

```javascript
// src/web/server.js
const express = require('express');
const path = require('path');
const logger = require('../utils/logger');
const authMiddleware = require('./middleware/auth');
const groupsRouter = require('./routes/groups');
const subscriptionsRouter = require('./routes/subscriptions');
const configRouter = require('./routes/config');

class WebUIServer {
  constructor(config) {
    this.config = config;
    this.app = express();
    this.server = null;

    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    // 解析 JSON
    this.app.use(express.json());

    // 静态文件服务
    this.app.use(express.static(path.join(__dirname, 'public')));

    // Basic Auth 认证
    this.app.use(authMiddleware(this.config));

    // 日志中间件
    this.app.use((req, res, next) => {
      logger.info(`[WebUI] ${req.method} ${req.path}`);
      next();
    });
  }

  setupRoutes() {
    // API 路由
    this.app.use('/api/groups', groupsRouter);
    this.app.use('/api/subscriptions', subscriptionsRouter);
    this.app.use('/api/config', configRouter);

    // SPA fallback
    this.app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    // 错误处理
    this.app.use((err, req, res, next) => {
      logger.error('[WebUI] Error:', err);
      res.status(500).json({
        success: false,
        message: err.message || 'Internal Server Error'
      });
    });
  }

  start() {
    const host = this.config.webuiHost || '127.0.0.1';
    const port = this.config.webuiPort || 3100;

    this.server = this.app.listen(port, host, () => {
      logger.info(`[WebUI] Server started on http://${host}:${port}`);
    });
  }

  stop() {
    if (this.server) {
      this.server.close(() => {
        logger.info('[WebUI] Server stopped');
      });
    }
  }
}

module.exports = WebUIServer;
```

### 6.2 认证中间件

```javascript
// src/web/middleware/auth.js
const logger = require('../../utils/logger');

function authMiddleware(config) {
  const username = config.webuiUsername || 'root';
  const password = config.webuiPassword;

  if (!password) {
    logger.warn('[WebUI] WEBUI_PASSWORD not set, authentication disabled!');
    return (req, res, next) => next();
  }

  return (req, res, next) => {
    // 跳过静态资源
    if (req.path.startsWith('/css') || req.path.startsWith('/js')) {
      return next();
    }

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Basic ')) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Bili QQ Bot WebUI"');
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const credentials = Buffer.from(authHeader.substring(6), 'base64').toString();
    const [user, pass] = credentials.split(':');

    if (user !== username || pass !== password) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    next();
  };
}

module.exports = authMiddleware;
```

### 6.3 群组管理路由

```javascript
// src/web/routes/groups.js
const express = require('express');
const router = express.Router();
const config = require('../../config');
const subscriptionManager = require('../../services/subscription/subscriptionManager');
const logger = require('../../utils/logger');

// 获取所有群组
router.get('/', async (req, res, next) => {
  try {
    await subscriptionManager._ensureSubscriptionsLoaded();

    const groupIds = new Set();

    // 从 enabledGroups 获取
    if (config.enabledGroups && config.enabledGroups.length > 0) {
      config.enabledGroups.forEach(id => groupIds.add(id));
    }

    // 从 groupConfigs 获取
    Object.keys(config.groupConfigs).forEach(id => groupIds.add(id));

    // 从订阅中获取
    subscriptionManager.userSubs.forEach(sub => {
      sub.groupIds.forEach(id => groupIds.add(id.toString()));
    });
    subscriptionManager.bangumiSubs.forEach(sub => {
      sub.groupIds.forEach(id => groupIds.add(id.toString()));
    });

    const groups = Array.from(groupIds).map(groupId => {
      const groupConfig = config.groupConfigs[groupId] || {};

      // 统计订阅数
      const userSubs = subscriptionManager.userSubs.filter(sub =>
        sub.groupIds.includes(parseInt(groupId))
      ).length;
      const bangumiSubs = subscriptionManager.bangumiSubs.filter(sub =>
        sub.groupIds.includes(parseInt(groupId))
      ).length;

      return {
        groupId,
        enabled: config.isGroupEnabled(groupId),
        admins: groupConfig.admins || [],
        blacklist: groupConfig.blacklistedQQs || [],
        subscriptions: {
          users: userSubs,
          bangumi: bangumiSubs
        },
        config: {
          nightMode: config.getGroupConfig(groupId, 'nightMode'),
          labelConfig: config.getGroupConfig(groupId, 'labelConfig'),
          showId: config.getGroupConfig(groupId, 'showId'),
          linkCacheTimeout: config.getGroupConfig(groupId, 'linkCacheTimeout'),
          aiContextLimit: config.getGroupConfig(groupId, 'aiContextLimit'),
          aiProbability: config.getGroupConfig(groupId, 'aiProbability')
        }
      };
    });

    res.json({
      success: true,
      data: groups
    });
  } catch (error) {
    next(error);
  }
});

// 获取单个群组详情
router.get('/:groupId', async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const groupConfig = config.groupConfigs[groupId] || {};

    await subscriptionManager._ensureSubscriptionsLoaded();

    const userSubs = subscriptionManager.userSubs.filter(sub =>
      sub.groupIds.includes(parseInt(groupId))
    ).length;
    const bangumiSubs = subscriptionManager.bangumiSubs.filter(sub =>
      sub.groupIds.includes(parseInt(groupId))
    ).length;

    res.json({
      success: true,
      data: {
        groupId,
        enabled: config.isGroupEnabled(groupId),
        admins: groupConfig.admins || [],
        blacklist: groupConfig.blacklistedQQs || [],
        subscriptions: {
          users: userSubs,
          bangumi: bangumiSubs
        },
        config: {
          nightMode: config.getGroupConfig(groupId, 'nightMode'),
          labelConfig: config.getGroupConfig(groupId, 'labelConfig'),
          showId: config.getGroupConfig(groupId, 'showId'),
          linkCacheTimeout: config.getGroupConfig(groupId, 'linkCacheTimeout'),
          aiContextLimit: config.getGroupConfig(groupId, 'aiContextLimit'),
          aiProbability: config.getGroupConfig(groupId, 'aiProbability')
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// 启用群组
router.post('/:groupId/enable', (req, res, next) => {
  try {
    const { groupId } = req.params;
    config.enableGroup(groupId);

    res.json({
      success: true,
      message: '群组已启用'
    });
  } catch (error) {
    next(error);
  }
});

// 禁用群组
router.post('/:groupId/disable', (req, res, next) => {
  try {
    const { groupId } = req.params;
    config.disableGroup(groupId);

    res.json({
      success: true,
      message: '群组已禁用'
    });
  } catch (error) {
    next(error);
  }
});

// 添加群管理员
router.post('/:groupId/admins', (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: '缺少 userId 参数'
      });
    }

    const success = config.addGroupAdmin(groupId, userId);

    res.json({
      success,
      message: success ? '管理员已添加' : '该用户已是管理员'
    });
  } catch (error) {
    next(error);
  }
});

// 删除群管理员
router.delete('/:groupId/admins/:userId', (req, res, next) => {
  try {
    const { groupId, userId } = req.params;
    const success = config.removeGroupAdmin(groupId, userId);

    res.json({
      success,
      message: success ? '管理员已删除' : '该用户不是管理员'
    });
  } catch (error) {
    next(error);
  }
});

// 添加到群黑名单
router.post('/:groupId/blacklist', (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: '缺少 userId 参数'
      });
    }

    const success = config.appendGroupConfigArray(groupId, 'blacklistedQQs', userId);

    res.json({
      success,
      message: success ? '已添加到黑名单' : '该用户已在黑名单中'
    });
  } catch (error) {
    next(error);
  }
});

// 从群黑名单移除
router.delete('/:groupId/blacklist/:userId', (req, res, next) => {
  try {
    const { groupId, userId } = req.params;
    const success = config.removeGroupConfigArray(groupId, 'blacklistedQQs', userId);

    res.json({
      success,
      message: success ? '已从黑名单移除' : '该用户不在黑名单中'
    });
  } catch (error) {
    next(error);
  }
});

// 更新群组配置
router.put('/:groupId/config', (req, res, next) => {
  try {
    const { groupId } = req.params;
    const updates = req.body;

    // 允许更新的配置项
    const allowedKeys = [
      'nightMode', 'labelConfig', 'showId', 'linkCacheTimeout',
      'aiContextLimit', 'aiProbability'
    ];

    Object.keys(updates).forEach(key => {
      if (allowedKeys.includes(key)) {
        config.setGroupConfig(groupId, key, updates[key]);
      }
    });

    res.json({
      success: true,
      message: '配置已更新'
    });
  } catch (error) {
    next(error);
  }
});

// 重置 AI 对话
router.post('/:groupId/ai/reset', async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const aiContextService = require('../../services/aiContextService');
    const vectorMemoryService = require('../../services/vectorMemoryService');

    // 清空上下文
    await aiContextService.clearContext(groupId);

    // 清空向量记忆
    await vectorMemoryService.clearMemory(groupId);

    res.json({
      success: true,
      message: '对话记忆已重置'
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
```

### 6.4 订阅管理路由

```javascript
// src/web/routes/subscriptions.js
const express = require('express');
const router = express.Router();
const subscriptionManager = require('../../services/subscription/subscriptionManager');
const biliApi = require('../../services/biliApi');
const logger = require('../../utils/logger');

// 获取群组订阅列表
router.get('/:groupId', async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const groupIdNum = parseInt(groupId);

    await subscriptionManager._ensureSubscriptionsLoaded();

    const userSubs = subscriptionManager.userSubs
      .filter(sub => sub.groupIds.includes(groupIdNum))
      .map(sub => ({
        uid: sub.uid,
        name: sub.name,
        lastDynamicId: sub.lastDynamicId,
        lastLiveStatus: sub.lastLiveStatus,
        lastCheckTime: sub.lastCheckTime
      }));

    const bangumiSubs = subscriptionManager.bangumiSubs
      .filter(sub => sub.groupIds.includes(groupIdNum))
      .map(sub => ({
        seasonId: sub.seasonId,
        title: sub.title,
        lastEpId: sub.lastEpId,
        lastCheckTime: sub.lastCheckTime
      }));

    res.json({
      success: true,
      data: {
        users: userSubs,
        bangumi: bangumiSubs
      }
    });
  } catch (error) {
    next(error);
  }
});

// 添加 UP 主订阅
router.post('/:groupId/user', async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { uid } = req.body;

    if (!uid) {
      return res.status(400).json({
        success: false,
        message: '缺少 uid 参数'
      });
    }

    // 获取 UP 主信息
    const userInfo = await biliApi.getUserInfo(uid, groupId);

    if (!userInfo || !userInfo.name) {
      return res.status(404).json({
        success: false,
        message: 'UP 主不存在或无法获取信息'
      });
    }

    // 添加订阅
    await subscriptionManager.subscribeUser(parseInt(groupId), uid, userInfo.name);

    res.json({
      success: true,
      message: '订阅已添加',
      data: {
        uid,
        name: userInfo.name
      }
    });
  } catch (error) {
    logger.error('[WebUI] Failed to subscribe user:', error);
    next(error);
  }
});

// 删除 UP 主订阅
router.delete('/:groupId/user/:uid', async (req, res, next) => {
  try {
    const { groupId, uid } = req.params;
    await subscriptionManager.unsubscribeUser(parseInt(groupId), uid);

    res.json({
      success: true,
      message: '订阅已删除'
    });
  } catch (error) {
    next(error);
  }
});

// 添加番剧订阅
router.post('/:groupId/bangumi', async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { seasonId } = req.body;

    if (!seasonId) {
      return res.status(400).json({
        success: false,
        message: '缺少 seasonId 参数'
      });
    }

    // 获取番剧信息
    const bangumiInfo = await biliApi.getBangumiInfo(seasonId, groupId);

    if (!bangumiInfo || !bangumiInfo.title) {
      return res.status(404).json({
        success: false,
        message: '番剧不存在或无法获取信息'
      });
    }

    // 添加订阅
    await subscriptionManager.subscribeBangumi(
      parseInt(groupId),
      seasonId,
      bangumiInfo.title
    );

    res.json({
      success: true,
      message: '订阅已添加',
      data: {
        seasonId,
        title: bangumiInfo.title
      }
    });
  } catch (error) {
    logger.error('[WebUI] Failed to subscribe bangumi:', error);
    next(error);
  }
});

// 删除番剧订阅
router.delete('/:groupId/bangumi/:seasonId', async (req, res, next) => {
  try {
    const { groupId, seasonId } = req.params;
    await subscriptionManager.unsubscribeBangumi(parseInt(groupId), seasonId);

    res.json({
      success: true,
      message: '订阅已删除'
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
```

### 6.5 全局配置路由

```javascript
// src/web/routes/config.js
const express = require('express');
const router = express.Router();
const config = require('../../config');

// 获取全局配置
router.get('/', (req, res, next) => {
  try {
    res.json({
      success: true,
      data: {
        blacklistedQQs: config.blacklistedQQs,
        subscriptionCheckInterval: config.subscriptionCheckInterval,
        aiVectorSimilarityThreshold: config.aiVectorSimilarityThreshold,
        aiVectorSearchLimit: config.aiVectorSearchLimit,
        aiShortMessageThreshold: config.aiShortMessageThreshold,
        aiEnableVectorCache: config.aiEnableVectorCache,
        aiEnableSmartTrim: config.aiEnableSmartTrim
      }
    });
  } catch (error) {
    next(error);
  }
});

// 更新全局配置
router.put('/', (req, res, next) => {
  try {
    const updates = req.body;

    // 允许更新的配置项
    const allowedKeys = [
      'subscriptionCheckInterval',
      'aiVectorSimilarityThreshold',
      'aiVectorSearchLimit',
      'aiShortMessageThreshold',
      'aiEnableVectorCache',
      'aiEnableSmartTrim'
    ];

    Object.keys(updates).forEach(key => {
      if (allowedKeys.includes(key)) {
        config[key] = updates[key];
      }
    });

    config.save();

    res.json({
      success: true,
      message: '全局配置已更新'
    });
  } catch (error) {
    next(error);
  }
});

// 添加到全局黑名单
router.post('/blacklist', (req, res, next) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: '缺少 userId 参数'
      });
    }

    if (!config.blacklistedQQs.includes(userId)) {
      config.blacklistedQQs.push(userId);
      config.save();

      res.json({
        success: true,
        message: '已添加到全局黑名单'
      });
    } else {
      res.json({
        success: false,
        message: '该用户已在全局黑名单中'
      });
    }
  } catch (error) {
    next(error);
  }
});

// 从全局黑名单移除
router.delete('/blacklist/:userId', (req, res, next) => {
  try {
    const { userId } = req.params;
    const index = config.blacklistedQQs.indexOf(userId);

    if (index > -1) {
      config.blacklistedQQs.splice(index, 1);
      config.save();

      res.json({
        success: true,
        message: '已从全局黑名单移除'
      });
    } else {
      res.json({
        success: false,
        message: '该用户不在全局黑名单中'
      });
    }
  } catch (error) {
    next(error);
  }
});

module.exports = router;
```

---

## 七、集成与部署

### 7.1 修改 bot.js 启动 WebUI

```javascript
// src/bot.js (在现有代码基础上添加)

const WebUIServer = require('./web/server');
const config = require('./config');

// ... 现有代码 ...

// 启动 WebUI Server
if (config.webuiEnabled !== false) {
  const webui = new WebUIServer(config);
  webui.start();
}

// ... 现有代码 ...
```

### 7.2 环境变量配置

在 `config/.env.example` 中添加：

```bash
# WebUI Configuration
WEBUI_ENABLED=true
WEBUI_PORT=3100
WEBUI_HOST=127.0.0.1
WEBUI_USERNAME=root
WEBUI_PASSWORD=
```

在 `src/config.js` 中添加：

```javascript
// WebUI Config
webuiEnabled: process.env.WEBUI_ENABLED !== 'false',
webuiPort: parseInt(process.env.WEBUI_PORT || '3100'),
webuiHost: process.env.WEBUI_HOST || '127.0.0.1',
webuiUsername: process.env.WEBUI_USERNAME || 'root',
webuiPassword: process.env.WEBUI_PASSWORD || '',
```

### 7.3 Docker 配置

在 `docker-compose.yml` 中添加端口映射：

```yaml
services:
  bili-bot:
    # ... 现有配置 ...
    ports:
      - "3100:3100"  # WebUI 端口
```

### 7.4 依赖安装

确保安装 Express：

```bash
npm install express
```

在 `package.json` 中已有的依赖基础上添加（如果没有）：

```json
{
  "dependencies": {
    "express": "^4.18.2"
  }
}
```

---

## 八、开发计划与里程碑

### 阶段一：基础框架搭建 (预计 2-3 天)

**目标**: 搭建 WebUI 基础架构，实现认证和基本页面

- [ ] 创建目录结构
- [ ] 实现 Express Server 和认证中间件
- [ ] 创建基础 HTML/CSS 页面框架
- [ ] 实现 Basic Auth 登录
- [ ] 测试服务器启动和访问

**交付物**:
- 可访问的空白 WebUI 页面
- 工作的认证系统

### 阶段二：群组权限管理 (预计 3-4 天)

**目标**: 实现群组管理的核心功能（P0 功能）

- [ ] 实现群组列表 API (`GET /api/groups`)
- [ ] 实现群组启用/禁用 API
- [ ] 实现群管理员管理 API
- [ ] 实现群黑名单管理 API
- [ ] 前端：群组卡片列表
- [ ] 前端：群组详情面板（基本信息 Tab）
- [ ] 前端：管理员和黑名单 UI
- [ ] 测试完整流程

**交付物**:
- 完整的群组权限管理功能
- 可以通过 WebUI 启用/禁用群组、管理管理员和黑名单

### 阶段三：订阅管理 (预计 3-4 天)

**目标**: 实现订阅管理功能（P0 功能）

- [ ] 实现订阅列表 API (`GET /api/groups/:id/subscriptions`)
- [ ] 实现添加/删除 UP 主订阅 API
- [ ] 实现添加/删除番剧订阅 API
- [ ] 前端：订阅管理 Tab
- [ ] 前端：添加订阅对话框
- [ ] 前端：订阅列表展示
- [ ] 集成 Bilibili API 获取 UP 主/番剧信息
- [ ] 测试订阅添加/删除流程

**交付物**:
- 完整的订阅管理功能
- 可以通过 WebUI 管理群组的 UP 主和番剧订阅

### 阶段四：功能开关与配置 (预计 2-3 天)

**目标**: 实现功能开关和配置管理（P1 功能）

- [ ] 实现群组配置更新 API (`PUT /api/groups/:id/config`)
- [ ] 实现全局配置 API (`GET/PUT /api/config`)
- [ ] 前端：功能配置 Tab
- [ ] 前端：深色模式、标签、UID 开关
- [ ] 前端：AI 参数配置
- [ ] 前端：全局配置页面
- [ ] 测试配置更新和保存

**交付物**:
- 完整的功能配置界面
- 全局配置管理页面

### 阶段五：优化与完善 (预计 2-3 天)

**目标**: 优化用户体验，修复 Bug

- [ ] 添加加载状态和错误提示
- [ ] 优化界面响应速度
- [ ] 添加操作确认对话框
- [ ] 优化移动端适配
- [ ] 完善错误处理
- [ ] 编写使用文档
- [ ] 全面测试

**交付物**:
- 稳定可用的 WebUI 系统
- 用户使用文档

---

## 九、风险与挑战

### 9.1 技术风险

1. **NapCat API 限制**
   - **风险**: 无法通过 API 获取群名称等详细信息
   - **缓解**: 允许手动输入群名称，或仅显示群号

2. **配置同步问题**
   - **风险**: WebUI 修改配置后，Bot 主进程可能需要重启才能生效
   - **缓解**: 使用共享的 `config` 模块，配置立即生效；部分功能（如 AI）需要重新初始化

3. **认证安全性**
   - **风险**: Basic Auth 在 HTTP 下不安全
   - **缓解**: 推荐使用 SSH 隧道或 HTTPS 反向代理

### 9.2 用户体验风险

1. **学习曲线**
   - **风险**: 用户需要学习新的管理界面
   - **缓解**: 提供清晰的文档和提示信息

2. **移动端适配**
   - **风险**: 原生 CSS 在移动端可能体验不佳
   - **缓解**: 使用响应式设计，优先保证桌面端体验

### 9.3 维护成本

1. **代码维护**
   - **风险**: 原生 JS 代码可能随着功能增加变得难以维护
   - **缓解**: 采用组件化思想，保持代码模块化；未来可重构为 React

2. **API 变更**
   - **风险**: Bot 核心功能变更可能导致 WebUI API 需要调整
   - **缓解**: 保持 API 设计的灵活性，使用版本控制

---

## 十、未来扩展方向

### 10.1 短期扩展 (1-3 个月)

- [ ] 数据统计与可视化
  - 订阅推送统计
  - AI 对话次数统计
  - 群组活跃度分析

- [ ] 日志查看功能
  - 实时日志流
  - 日志过滤和搜索
  - 错误日志高亮

- [ ] 批量操作
  - 批量启用/禁用群组
  - 批量添加订阅
  - 导入/导出配置

### 10.2 中期扩展 (3-6 个月)

- [ ] 用户权限系统
  - 多用户支持
  - 角色权限管理
  - 操作日志审计

- [ ] 定时任务管理
  - 可视化配置定时推送
  - 定时消息发送
  - 任务执行历史

- [ ] 插件市场
  - 插件上传和下载
  - 插件配置界面
  - 插件版本管理

### 10.3 长期扩展 (6+ 个月)

- [ ] React 重构
  - 使用 React + TypeScript 重写前端
  - 引入状态管理库（Zustand/Redux）
  - 使用 UI 组件库（Ant Design/Material-UI）

- [ ] 移动应用
  - 开发 React Native 移动端
  - 推送通知支持
  - 移动端专属功能

- [ ] 多 Bot 管理
  - 支持管理多个 Bot 实例
  - 跨 Bot 配置同步
  - 集中式监控面板

---

## 十一、总结

本设计文档详细规划了 Bili QQ Bot WebUI 管理后台的实现方案。主要特点：

1. **简洁实用**: 专注于简化配置操作，避免功能膨胀
2. **技术轻量**: 使用原生 JS/CSS，无构建依赖，易于维护
3. **安全可靠**: Basic Auth + 内网访问，适合个人使用
4. **渐进增强**: 分阶段实现，优先级明确，可根据需求调整

通过本 WebUI，Root 用户将能够：
- ✅ 快速管理群组权限和黑名单
- ✅ 可视化管理订阅（UP 主、番剧）
- ✅ 调整功能开关和 AI 参数
- ✅ 避免手动编辑配置文件或在 QQ 群敲命令

预计总开发时间：**12-18 天**（按每天 4-6 小时开发时间计算）

未来可根据实际使用情况，逐步扩展数据统计、日志查看等高级功能，或使用 React 进行重构以支持更复杂的交互需求。
