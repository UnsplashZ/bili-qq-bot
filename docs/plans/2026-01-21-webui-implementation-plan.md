# WebUI 管理后台实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标**: 为 Bili QQ Bot 构建可视化管理后台，让 Root 用户通过 Web 界面管理群组权限、订阅和配置

**架构**: Express.js 后端 + 原生 JavaScript 前端，采用卡片+主从布局，通过 HTTP Basic Auth 认证，与 Bot 主进程共享配置模块

**技术栈**: Express.js, 原生 JavaScript, CSS, Fetch API

---

## 前置准备

### 依赖安装

**安装 Express.js**:
```bash
npm install express
```

**验证安装**:
```bash
npm list express
```

预期输出: `express@4.x.x`

---

## 阶段一：基础框架搭建

### Task 1: 创建目录结构

**文件**:
- Create: `src/web/server.js`
- Create: `src/web/middleware/auth.js`
- Create: `src/web/routes/groups.js`
- Create: `src/web/routes/subscriptions.js`
- Create: `src/web/routes/config.js`
- Create: `src/web/public/index.html`
- Create: `src/web/public/css/app.css`
- Create: `src/web/public/js/app.js`
- Create: `src/web/public/js/api.js`
- Create: `src/web/public/js/utils.js`

**Step 1: 创建目录**

```bash
mkdir -p src/web/middleware
mkdir -p src/web/routes
mkdir -p src/web/public/css
mkdir -p src/web/public/js
```

**Step 2: 验证目录结构**

```bash
tree src/web -L 3
```

预期输出: 显示完整的目录树

**Step 3: Commit**

```bash
git add src/web/
git commit -m "chore: create WebUI directory structure"
```

---

### Task 2: 实现认证中间件

**文件**:
- Create: `src/web/middleware/auth.js`

**Step 1: 编写认证中间件代码**

```javascript
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

**Step 2: 验证语法**

```bash
node -c src/web/middleware/auth.js
```

预期输出: 无输出（表示语法正确）

**Step 3: Commit**

```bash
git add src/web/middleware/auth.js
git commit -m "feat: add HTTP Basic Auth middleware for WebUI"
```

---

### Task 3: 实现 Express Server 主文件

**文件**:
- Create: `src/web/server.js`

**Step 1: 编写 Server 类**

```javascript
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

**Step 2: 验证语法**

```bash
node -c src/web/server.js
```

**Step 3: Commit**

```bash
git add src/web/server.js
git commit -m "feat: add Express WebUI server with middleware setup"
```

---

### Task 4: 添加环境变量配置

**文件**:
- Modify: `config/.env.example`
- Modify: `src/config.js:40-48`

**Step 1: 更新 .env.example**

在 `config/.env.example` 末尾添加:

```bash
# WebUI Configuration
WEBUI_ENABLED=true
WEBUI_PORT=3100
WEBUI_HOST=127.0.0.1
WEBUI_USERNAME=root
WEBUI_PASSWORD=
```

**Step 2: 更新 config.js**

在 `src/config.js` 的 `adminQQ` 配置后添加:

```javascript
    // WebUI Config
    webuiEnabled: process.env.WEBUI_ENABLED !== 'false',
    webuiPort: parseInt(process.env.WEBUI_PORT || '3100'),
    webuiHost: process.env.WEBUI_HOST || '127.0.0.1',
    webuiUsername: process.env.WEBUI_USERNAME || 'root',
    webuiPassword: process.env.WEBUI_PASSWORD || '',
```

**Step 3: 验证配置加载**

```bash
node -e "const config = require('./src/config'); console.log(config.webuiPort);"
```

预期输出: `3100`

**Step 4: Commit**

```bash
git add config/.env.example src/config.js
git commit -m "feat: add WebUI environment variables configuration"
```

---

### Task 5: 集成 WebUI Server 到 Bot

**文件**:
- Modify: `src/bot.js`

**Step 1: 在 bot.js 顶部添加导入**

在 `src/bot.js` 的 require 部分添加:

```javascript
const WebUIServer = require('./web/server');
```

**Step 2: 在 bot.js 启动部分添加 WebUI 启动逻辑**

在合适的位置（建议在 WebSocket 连接建立后）添加:

```javascript
// 启动 WebUI Server
if (config.webuiEnabled !== false) {
  const webui = new WebUIServer(config);
  webui.start();
}
```

**Step 3: 测试 Bot 启动（不会成功，因为路由未实现）**

```bash
npm start
```

预期: 应该看到错误提示缺少路由模块

**Step 4: Commit**

```bash
git add src/bot.js
git commit -m "feat: integrate WebUI server into Bot startup"
```

---

## 阶段二：API 路由实现

### Task 6: 实现群组管理路由

**文件**:
- Create: `src/web/routes/groups.js`

**Step 1: 编写群组路由完整代码**

创建 `src/web/routes/groups.js`:

```javascript
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

module.exports = router;
```

**Step 2: 验证语法**

```bash
node -c src/web/routes/groups.js
```

**Step 3: Commit**

```bash
git add src/web/routes/groups.js
git commit -m "feat: implement group management API routes"
```

---

### Task 7: 实现订阅管理路由

**文件**:
- Create: `src/web/routes/subscriptions.js`

**Step 1: 编写订阅路由代码**

```javascript
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

**Step 2: 验证语法**

```bash
node -c src/web/routes/subscriptions.js
```

**Step 3: Commit**

```bash
git add src/web/routes/subscriptions.js
git commit -m "feat: implement subscription management API routes"
```

---

### Task 8: 实现全局配置路由

**文件**:
- Create: `src/web/routes/config.js`

**Step 1: 编写配置路由代码**

```javascript
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

**Step 2: 验证语法**

```bash
node -c src/web/routes/config.js
```

**Step 3: Commit**

```bash
git add src/web/routes/config.js
git commit -m "feat: implement global configuration API routes"
```

---

### Task 9: 测试后端 API

**Step 1: 启动 Bot**

```bash
npm start
```

预期: 应该看到 `[WebUI] Server started on http://127.0.0.1:3100`

**Step 2: 测试 API 端点（需要设置密码）**

```bash
# 设置临时密码
export WEBUI_PASSWORD=test123

# 重启 Bot
npm start
```

**Step 3: 使用 curl 测试认证**

```bash
curl -u root:test123 http://localhost:3100/api/groups
```

预期: 返回 JSON 格式的群组列表

**Step 4: 测试配置 API**

```bash
curl -u root:test123 http://localhost:3100/api/config
```

预期: 返回 JSON 格式的全局配置

**Step 5: 记录测试结果**

如果测试通过，继续；如果失败，检查日志并修复

**Step 6: Commit（如果有修复）**

```bash
git add .
git commit -m "fix: resolve API endpoint issues"
```

---

## 阶段三：前端基础实现

### Task 10: 创建 HTML 主页面

**文件**:
- Create: `src/web/public/index.html`

**Step 1: 编写 HTML 结构**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bili QQ Bot 管理后台</title>
  <link rel="stylesheet" href="/css/app.css">
</head>
<body>
  <!-- Header -->
  <header class="header">
    <div class="header-content">
      <h1 class="header-title">Bili QQ Bot 管理后台</h1>
      <div class="header-actions">
        <button class="btn btn-secondary" id="globalConfigBtn">全局配置</button>
        <button class="btn btn-secondary" id="logoutBtn">退出登录</button>
      </div>
    </div>
  </header>

  <!-- Main Container -->
  <div class="main-container">
    <!-- Left Sidebar -->
    <aside class="sidebar">
      <div class="sidebar-header">
        <input type="text" class="search-input" id="groupSearch" placeholder="搜索群组...">
      </div>
      <div class="group-list" id="groupList">
        <!-- Group cards will be inserted here -->
      </div>
    </aside>

    <!-- Main Content -->
    <main class="content">
      <div class="empty-state" id="emptyState">
        <p>请选择一个群组</p>
      </div>
      <div class="group-panel hidden" id="groupPanel">
        <!-- Group details will be inserted here -->
      </div>
    </main>
  </div>

  <!-- Toast Container -->
  <div class="toast-container" id="toastContainer"></div>

  <!-- Scripts -->
  <script src="/js/utils.js"></script>
  <script src="/js/api.js"></script>
  <script src="/js/app.js"></script>
</body>
</html>
```

**Step 2: 验证 HTML**

在浏览器中访问 `http://localhost:3100`（使用 Basic Auth 登录）

预期: 看到空白页面，无样式

**Step 3: Commit**

```bash
git add src/web/public/index.html
git commit -m "feat: add WebUI HTML structure"
```

---

### Task 11: 实现基础 CSS 样式

**文件**:
- Create: `src/web/public/css/app.css`

**Step 1: 编写 CSS（完整代码较长，这里提供核心部分）**

```css
/* Reset and Base Styles */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

:root {
  --primary-color: #00A1D6;
  --success-color: #52C41A;
  --warning-color: #FAAD14;
  --danger-color: #F5222D;
  --bg-color: #F5F7FA;
  --card-bg: #FFFFFF;
  --text-primary: #333333;
  --text-secondary: #666666;
  --border-color: #E0E0E0;
  --shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  --radius: 8px;
  --radius-sm: 4px;
}

body {
  font-family: 'MiSans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background-color: var(--bg-color);
  color: var(--text-primary);
  line-height: 1.6;
}

/* Header */
.header {
  background-color: var(--card-bg);
  border-bottom: 1px solid var(--border-color);
  padding: 1rem 2rem;
  box-shadow: var(--shadow);
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  max-width: 1400px;
  margin: 0 auto;
}

.header-title {
  font-size: 1.5rem;
  font-weight: 600;
}

.header-actions {
  display: flex;
  gap: 1rem;
}

/* Main Container */
.main-container {
  display: flex;
  max-width: 1400px;
  margin: 2rem auto;
  gap: 2rem;
  padding: 0 2rem;
  height: calc(100vh - 120px);
}

/* Sidebar */
.sidebar {
  width: 300px;
  background-color: var(--card-bg);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar-header {
  padding: 1rem;
  border-bottom: 1px solid var(--border-color);
}

.search-input {
  width: 100%;
  padding: 0.5rem 1rem;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  font-size: 0.9rem;
}

.group-list {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
}

/* Group Card */
.group-card {
  background-color: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius);
  padding: 1rem;
  margin-bottom: 1rem;
  cursor: pointer;
  transition: all 0.3s ease;
}

.group-card:hover {
  box-shadow: var(--shadow);
  transform: translateY(-2px);
}

.group-card.selected {
  border-color: var(--primary-color);
  background-color: rgba(0, 161, 214, 0.05);
}

.group-card.enabled {
  border-left: 4px solid var(--success-color);
}

.group-card.disabled {
  border-left: 4px solid var(--border-color);
  opacity: 0.7;
}

/* Content Area */
.content {
  flex: 1;
  background-color: var(--card-bg);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 2rem;
  overflow-y: auto;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary);
  font-size: 1.2rem;
}

.hidden {
  display: none;
}

/* Buttons */
.btn {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.3s ease;
}

.btn-primary {
  background-color: var(--primary-color);
  color: white;
}

.btn-primary:hover {
  background-color: #008BB8;
}

.btn-secondary {
  background-color: transparent;
  border: 1px solid var(--border-color);
  color: var(--text-primary);
}

.btn-secondary:hover {
  background-color: var(--bg-color);
}

.btn-danger {
  background-color: var(--danger-color);
  color: white;
}

.btn-danger:hover {
  background-color: #D91C1C;
}

/* Toast */
.toast-container {
  position: fixed;
  top: 2rem;
  right: 2rem;
  z-index: 1000;
}

.toast {
  background-color: var(--card-bg);
  border-radius: var(--radius-sm);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 1rem 1.5rem;
  margin-bottom: 0.5rem;
  opacity: 0;
  transform: translateX(100%);
  transition: all 0.3s ease;
}

.toast.show {
  opacity: 1;
  transform: translateX(0);
}

.toast-success {
  border-left: 4px solid var(--success-color);
}

.toast-error {
  border-left: 4px solid var(--danger-color);
}

.toast-info {
  border-left: 4px solid var(--primary-color);
}
```

**Step 2: 验证样式**

刷新浏览器，应该看到带样式的界面框架

**Step 3: Commit**

```bash
git add src/web/public/css/app.css
git commit -m "feat: add WebUI base CSS styles"
```

---

### Task 12: 实现工具函数

**文件**:
- Create: `src/web/public/js/utils.js`

**Step 1: 编写工具函数**

```javascript
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
  if (!timestamp) return '未知';

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
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  container.appendChild(toast);

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
  return confirm(message); // 简化版，后续可以改为自定义模态框
}

// HTML 转义
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
```

**Step 2: 验证语法**

在浏览器控制台测试:

```javascript
showToast('测试消息', 'success');
```

预期: 右上角出现成功提示

**Step 3: Commit**

```bash
git add src/web/public/js/utils.js
git commit -m "feat: add utility functions for WebUI"
```

---

### Task 13: 实现 API 调用封装

**文件**:
- Create: `src/web/public/js/api.js`

**Step 1: 编写 API 类**

```javascript
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

    try {
      const response = await fetch(`${this.baseURL}${endpoint}`, options);

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || response.statusText);
      }

      return response.json();
    } catch (error) {
      console.error('API Error:', error);
      throw error;
    }
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

  async updateGroupConfig(groupId, config) {
    return this.request('PUT', `/groups/${groupId}/config`, config);
  }

  // 订阅相关
  async getSubscriptions(groupId) {
    return this.request('GET', `/subscriptions/${groupId}`);
  }

  async subscribeUser(groupId, uid) {
    return this.request('POST', `/subscriptions/${groupId}/user`, { uid });
  }

  async unsubscribeUser(groupId, uid) {
    return this.request('DELETE', `/subscriptions/${groupId}/user/${uid}`);
  }

  async subscribeBangumi(groupId, seasonId) {
    return this.request('POST', `/subscriptions/${groupId}/bangumi`, { seasonId });
  }

  async unsubscribeBangumi(groupId, seasonId) {
    return this.request('DELETE', `/subscriptions/${groupId}/bangumi/${seasonId}`);
  }

  // 全局配置
  async getGlobalConfig() {
    return this.request('GET', '/config');
  }

  async updateGlobalConfig(config) {
    return this.request('PUT', '/config', config);
  }

  async addGlobalBlacklist(userId) {
    return this.request('POST', '/config/blacklist', { userId });
  }

  async removeGlobalBlacklist(userId) {
    return this.request('DELETE', `/config/blacklist/${userId}`);
  }
}

const api = new API();
```

**Step 2: 在浏览器控制台测试**

```javascript
api.getGroups().then(console.log);
```

预期: 返回群组数据

**Step 3: Commit**

```bash
git add src/web/public/js/api.js
git commit -m "feat: add API client for WebUI"
```

---

### Task 14: 实现主应用逻辑（基础版）

**文件**:
- Create: `src/web/public/js/app.js`

**Step 1: 编写基础应用逻辑**

```javascript
class App {
  constructor() {
    this.state = {
      groups: [],
      selectedGroupId: null
    };

    this.init();
  }

  async init() {
    await this.loadGroups();
    this.bindEvents();
  }

  async loadGroups() {
    try {
      const response = await api.getGroups();
      this.state.groups = response.data;
      this.renderGroupList();
    } catch (error) {
      showToast('加载群组列表失败: ' + error.message, 'error');
    }
  }

  renderGroupList() {
    const container = document.getElementById('groupList');
    container.innerHTML = '';

    this.state.groups.forEach(group => {
      const card = this.createGroupCard(group);
      container.appendChild(card);
    });
  }

  createGroupCard(group) {
    const card = document.createElement('div');
    card.className = `group-card ${group.enabled ? 'enabled' : 'disabled'}`;
    card.dataset.groupId = group.groupId;

    const totalSubs = group.subscriptions.users + group.subscriptions.bangumi;

    card.innerHTML = `
      <div class="group-card-header">
        <h3>群组 ${group.groupId}</h3>
        <span class="status-badge ${group.enabled ? 'enabled' : 'disabled'}">
          ${group.enabled ? '已启用' : '已禁用'}
        </span>
      </div>
      <div class="group-card-body">
        <p>订阅: ${totalSubs}</p>
        <p>管理员: ${group.admins.length}</p>
      </div>
    `;

    card.addEventListener('click', () => {
      this.selectGroup(group.groupId);
    });

    return card;
  }

  selectGroup(groupId) {
    // 更新选中状态
    document.querySelectorAll('.group-card').forEach(card => {
      card.classList.remove('selected');
    });

    const selectedCard = document.querySelector(`[data-group-id="${groupId}"]`);
    if (selectedCard) {
      selectedCard.classList.add('selected');
    }

    this.state.selectedGroupId = groupId;
    this.renderGroupPanel(groupId);
  }

  renderGroupPanel(groupId) {
    const group = this.state.groups.find(g => g.groupId === groupId);
    if (!group) return;

    const emptyState = document.getElementById('emptyState');
    const panel = document.getElementById('groupPanel');

    emptyState.classList.add('hidden');
    panel.classList.remove('hidden');

    panel.innerHTML = `
      <h2>群组详情 - ${group.groupId}</h2>
      <div class="group-info">
        <p>状态: ${group.enabled ? '已启用' : '已禁用'}</p>
        <button class="btn btn-primary" id="toggleGroupBtn">
          ${group.enabled ? '禁用群组' : '启用群组'}
        </button>
      </div>
      <div class="subscriptions-section">
        <h3>订阅管理</h3>
        <p>UP主订阅: ${group.subscriptions.users}</p>
        <p>番剧订阅: ${group.subscriptions.bangumi}</p>
      </div>
    `;

    // 绑定切换按钮
    document.getElementById('toggleGroupBtn').addEventListener('click', () => {
      this.toggleGroup(groupId, group.enabled);
    });
  }

  async toggleGroup(groupId, currentlyEnabled) {
    try {
      if (currentlyEnabled) {
        await api.disableGroup(groupId);
        showToast('群组已禁用', 'success');
      } else {
        await api.enableGroup(groupId);
        showToast('群组已启用', 'success');
      }

      // 重新加载
      await this.loadGroups();
      this.selectGroup(groupId);
    } catch (error) {
      showToast('操作失败: ' + error.message, 'error');
    }
  }

  bindEvents() {
    // 搜索功能
    const searchInput = document.getElementById('groupSearch');
    searchInput.addEventListener('input', debounce((e) => {
      this.filterGroups(e.target.value);
    }, 300));

    // 全局配置按钮
    document.getElementById('globalConfigBtn').addEventListener('click', () => {
      showToast('全局配置功能待实现', 'info');
    });

    // 退出登录
    document.getElementById('logoutBtn').addEventListener('click', () => {
      if (confirm('确定要退出登录吗？')) {
        window.location.reload();
      }
    });
  }

  filterGroups(query) {
    const cards = document.querySelectorAll('.group-card');
    cards.forEach(card => {
      const groupId = card.dataset.groupId;
      if (groupId.includes(query)) {
        card.style.display = 'block';
      } else {
        card.style.display = 'none';
      }
    });
  }
}

// 启动应用
document.addEventListener('DOMContentLoaded', () => {
  const app = new App();
});
```

**Step 2: 测试完整流程**

1. 启动 Bot: `npm start`
2. 在浏览器访问 `http://localhost:3100`
3. 使用 Basic Auth 登录
4. 应该看到群组列表
5. 点击群组，右侧显示详情
6. 点击"启用/禁用"按钮，测试功能

**Step 3: Commit**

```bash
git add src/web/public/js/app.js
git commit -m "feat: implement basic WebUI application logic"
```

---

## 阶段四：功能完善

### Task 15: 更新 Docker 配置

**文件**:
- Modify: `docker-compose.yml`

**Step 1: 添加端口映射**

在 `docker-compose.yml` 的 `bili-bot` 服务中添加:

```yaml
    ports:
      - "3100:3100"  # WebUI 端口
```

**Step 2: 验证配置**

```bash
docker-compose config
```

预期: 无错误输出

**Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add WebUI port mapping to Docker Compose"
```

---

### Task 16: 更新 README 文档

**文件**:
- Modify: `README.md`

**Step 1: 在 README 中添加 WebUI 说明**

在合适的位置（建议在"配置说明"之后）添加:

```markdown
## WebUI 管理后台

本项目提供了可视化的 Web 管理界面，方便 Root 用户管理群组权限、订阅和配置。

### 访问方式

1. **本地访问**: 直接访问 `http://localhost:3100`
2. **远程访问**: 通过 SSH 隧道转发端口
   ```bash
   ssh -L 8080:localhost:3100 user@your-server
   # 然后在本地浏览器访问 http://localhost:8080
   ```

### 配置说明

在 `config/.env` 中配置以下变量:

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `WEBUI_ENABLED` | 是否启用 WebUI | `true` |
| `WEBUI_PORT` | WebUI 监听端口 | `3100` |
| `WEBUI_HOST` | 监听地址 | `127.0.0.1` |
| `WEBUI_USERNAME` | 登录用户名 | `root` |
| `WEBUI_PASSWORD` | 登录密码 | 必须设置 |

### 功能特性

- ✅ 群组权限管理（启用/禁用、管理员、黑名单）
- ✅ 订阅管理（UP 主、番剧）
- ✅ 功能配置（深色模式、标签、AI 参数）
- ✅ 全局配置管理

### 安全建议

- 设置强密码
- 使用 SSH 隧道访问
- 可选：通过 Nginx 配置 HTTPS
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add WebUI documentation to README"
```

---

### Task 17: 创建最终提交

**Step 1: 检查所有文件**

```bash
git status
```

**Step 2: 运行完整测试**

```bash
# 设置密码
export WEBUI_PASSWORD=test123

# 启动 Bot
npm start

# 访问 WebUI 并测试所有功能
```

**Step 3: 创建功能总结提交**

```bash
git add .
git commit -m "feat: complete WebUI admin panel implementation

- Add Express server with Basic Auth
- Implement group management API
- Implement subscription management API
- Implement global configuration API
- Add responsive frontend with vanilla JS
- Support group enable/disable
- Support subscription management
- Add Docker port mapping
- Update documentation"
```

---

## 验收标准

完成后，应该能够:

1. ✅ 通过浏览器访问 WebUI（使用 Basic Auth 登录）
2. ✅ 查看所有群组列表
3. ✅ 点击群组查看详情
4. ✅ 启用/禁用群组
5. ✅ 查看订阅列表
6. ✅ 操作有即时反馈（Toast 提示）
7. ✅ 搜索过滤群组
8. ✅ Docker 部署正常工作

---

## 后续扩展

完成基础功能后，可以继续实现:

- [ ] 群组详情 Tab 切换（基本信息、订阅管理、功能配置）
- [ ] 添加/删除订阅功能
- [ ] 管理员管理界面
- [ ] 黑名单管理界面
- [ ] 全局配置模态框
- [ ] 更完善的错误处理
- [ ] 加载状态指示
- [ ] 移动端适配优化

---

## 参考资料

- Express.js 文档: https://expressjs.com/
- Fetch API 文档: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
- HTTP Basic Auth: https://developer.mozilla.org/en-US/docs/Web/HTTP/Authentication

---

**开发时间估算**: 3-5 天（基础功能）

**技术债务**:
- 前端代码可能随功能增加变得复杂，建议未来重构为 React
- 缺少单元测试，建议添加测试覆盖

**安全考虑**:
- 使用 HTTPS（通过 Nginx 反向代理）
- 定期更新依赖包
- 限制访问 IP（防火墙规则）
