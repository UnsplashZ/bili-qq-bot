# Feed去重修复 & 移动端适配方案

**日期**: 2026-02-06
**问题**: Issue #1 (Feed去重破坏视频推送) & Issue #3 (移动端适配缺失)
**方案**: 问题1采用方案B（独立监控），问题3采用汉堡菜单方案

---

## API测试结果 ✅

已验证 bilibili-api-python 支持独立的视频/专栏监控：

```
视频列表API: ✅ user.get_videos()
  - 返回结构: {list: {vlist: [{bvid, title, created, ...}]}}
  - 每页30个视频

专栏列表API: ✅ user.get_articles()
  - 返回结构: {articles: [{id, title, publish_time, ...}]}
  - 每页30篇专栏
```

**结论**: 方案B完全可行！

---

## 问题1：Feed去重修复方案（方案B）

### 设计思路

**当前问题**：
- 动态流中的视频/专栏被完全过滤，导致不推送
- 原设计假设有独立监控，但实际没有实现

**方案B核心**：
1. 添加独立的视频/专栏监控API
2. 保留动态流的去重逻辑（避免重复推送）
3. 订阅系统同时检查：动态 + 视频 + 专栏

**监控逻辑**：
```
checkAll() {
  for (user in userSubs) {
    checkUserDynamic(user)   // 检查动态（过滤视频/专栏）
    checkUserVideo(user)     // 独立检查视频
    checkUserArticle(user)   // 独立检查专栏
  }
}
```

---

### 实施步骤

#### Step 1: 后端Python API（bili_server.py）

**新增函数1: get_user_videos**

```python
# 在 bili_server.py 中添加（建议在 get_user_dynamic 后面）

async def get_user_videos(uid, group_id=None):
    """
    获取用户视频列表

    Args:
        uid: 用户UID
        group_id: 群组ID（用于Cookie）

    Returns:
        {
            "status": "success",
            "data": {
                "videos": [
                    {
                        "bvid": "BV...",
                        "aid": 123456,
                        "title": "视频标题",
                        "created": 1234567890,  # Unix时间戳
                        "pic": "封面URL",
                        "description": "简介",
                        "play": 1000,
                        "video_review": 100
                    },
                    ...
                ]
            }
        }
    """
    try:
        u = user.User(uid=int(uid), credential=load_credential(group_id))

        # 获取视频列表（只获取第一页，pn=1）
        result = await u.get_videos(pn=1, ps=30)

        # 提取视频列表
        if 'list' in result and 'vlist' in result['list']:
            videos = result['list']['vlist']

            return {
                "status": "success",
                "data": {
                    "videos": videos
                }
            }
        else:
            return {
                "status": "success",
                "data": {"videos": []}
            }

    except Exception as e:
        logger.error(f"获取用户视频列表失败 (UID: {uid}): {e}")
        return {
            "status": "error",
            "message": str(e)
        }


async def handle_user_videos(request):
    """HTTP处理器：获取用户视频列表"""
    data = await request.json()
    uid = data.get('uid')
    group_id = data.get('group_id')

    if not uid:
        return web.json_response({
            "status": "error",
            "message": "缺少参数: uid"
        })

    result = await get_user_videos(uid, group_id)
    return web.json_response(result)
```

**新增函数2: get_user_articles**

```python
async def get_user_articles(uid, group_id=None):
    """
    获取用户专栏列表

    Args:
        uid: 用户UID
        group_id: 群组ID（用于Cookie）

    Returns:
        {
            "status": "success",
            "data": {
                "articles": [
                    {
                        "id": 45123193,
                        "title": "专栏标题",
                        "publish_time": 1234567890,
                        "summary": "摘要",
                        "banner_url": "封面URL",
                        "view": 1000,
                        "reply": 100
                    },
                    ...
                ]
            }
        }
    """
    try:
        u = user.User(uid=int(uid), credential=load_credential(group_id))

        # 获取专栏列表（只获取第一页，pn=1）
        result = await u.get_articles(pn=1, ps=30)

        # 提取专栏列表
        if 'articles' in result:
            articles = result['articles']

            return {
                "status": "success",
                "data": {
                    "articles": articles
                }
            }
        else:
            return {
                "status": "success",
                "data": {"articles": []}
            }

    except Exception as e:
        logger.error(f"获取用户专栏列表失败 (UID: {uid}): {e}")
        return {
            "status": "error",
            "message": str(e)
        }


async def handle_user_articles(request):
    """HTTP处理器：获取用户专栏列表"""
    data = await request.json()
    uid = data.get('uid')
    group_id = data.get('group_id')

    if not uid:
        return web.json_response({
            "status": "error",
            "message": "缺少参数: uid"
        })

    result = await get_user_articles(uid, group_id)
    return web.json_response(result)
```

**注册路由（在 app.add_routes 中添加）**

```python
# 在 bili_server.py 的路由注册部分（约第1700行）添加：

app.add_routes([
    # ... 现有路由 ...

    # 新增：用户视频/专栏列表
    web.post('/user_videos', handle_user_videos),
    web.post('/user_articles', handle_user_articles),
])
```

---

#### Step 2: 后端Node.js封装（biliApi.js）

**文件**: `src/services/biliApi.js`

**新增方法**（在文件末尾，module.exports之前添加）：

```javascript
/**
 * 获取用户视频列表
 * @param {string|number} uid - 用户UID
 * @param {string} groupId - 群组ID（用于Cookie）
 * @returns {Promise<Object>} 视频列表
 */
async function getUserVideos(uid, groupId = null) {
    try {
        const response = await axios.post(`${PYTHON_API_URL}/user_videos`, {
            uid: String(uid),
            group_id: groupId
        }, {
            timeout: 15000,
            headers: { 'Content-Type': 'application/json' }
        });

        return response.data;
    } catch (error) {
        logger.error(`[BiliApi] Failed to get user videos (UID: ${uid}):`, error.message);
        return {
            status: 'error',
            message: error.message
        };
    }
}

/**
 * 获取用户专栏列表
 * @param {string|number} uid - 用户UID
 * @param {string} groupId - 群组ID（用于Cookie）
 * @returns {Promise<Object>} 专栏列表
 */
async function getUserArticles(uid, groupId = null) {
    try {
        const response = await axios.post(`${PYTHON_API_URL}/user_articles`, {
            uid: String(uid),
            group_id: groupId
        }, {
            timeout: 15000,
            headers: { 'Content-Type': 'application/json' }
        });

        return response.data;
    } catch (error) {
        logger.error(`[BiliApi] Failed to get user articles (UID: ${uid}):`, error.message);
        return {
            status: 'error',
            message: error.message
        };
    }
}
```

**更新导出**（在 module.exports 中添加）：

```javascript
module.exports = {
    // ... 现有导出 ...
    getUserVideos,
    getUserArticles,
}
```

---

#### Step 3: 订阅检查器（updateChecker.js）

**文件**: `src/services/subscription/updateChecker.js`

**修改1: 添加视频检查方法**（在 checkUserDynamic 后面添加）

```javascript
/**
 * 检查用户视频更新
 */
async checkUserVideo(sub, targetGroups = null, force = false) {
    const groupsToNotify = targetGroups || sub.groupIds;
    try {
        const groupId = groupsToNotify[0];
        const res = await biliApi.getUserVideos(sub.uid, groupId);

        if (res.status !== 'success' || !res.data.videos || res.data.videos.length === 0) {
            return;
        }

        const videos = res.data.videos;

        // 按时间排序（最新的在前）
        videos.sort((a, b) => b.created - a.created);

        const latestVideo = videos[0];
        const latestBvid = latestVideo.bvid;

        // 首次检查：记录最新视频但不推送
        if (!sub.lastVideoId && !force) {
            await subscriptionManager.updateUserSub(sub.uid, { lastVideoId: latestBvid });
            logger.info(`[UpdateChecker] Initialized lastVideoId for ${sub.name}: ${latestBvid}`);
            return;
        }

        // 检查是否有新视频
        if (latestBvid !== sub.lastVideoId || force) {
            // 找出所有新视频
            const newVideos = [];
            for (const video of videos) {
                if (video.bvid === sub.lastVideoId) break;
                newVideos.push(video);
            }

            // 只推送最新的一个（避免订阅时推送历史视频）
            const videoToPush = force ? [latestVideo] : [newVideos[0]];

            for (const video of videoToPush) {
                try {
                    const bvid = video.bvid;

                    // 使用linkHandler的逻辑获取视频详情
                    const info = await biliApi.getVideoInfo(bvid, groupId);

                    if (info.status !== 'success') {
                        logger.warn(`[UpdateChecker] Failed to get video detail for ${bvid}`);
                        continue;
                    }

                    // 生成通知文本
                    const notificationText = `${sub.name} 投稿了新视频：\n${info.data.title}`;

                    // 推送
                    const url = `https://www.bilibili.com/video/${bvid}`;
                    await this.notifyGroupsWithImage(groupsToNotify, info, 'video', url, notificationText);

                    logger.info(`[UpdateChecker] Pushed new video for ${sub.name}: ${bvid}`);

                } catch (e) {
                    logger.error(`[UpdateChecker] Failed to push video ${video.bvid}:`, e);
                }
            }

            // 更新lastVideoId
            if (!force) {
                await subscriptionManager.updateUserSub(sub.uid, { lastVideoId: latestBvid });
            }
        }
    } catch (e) {
        logger.error(`[UpdateChecker] Error checking videos for ${sub.name}:`, e);
    }
}
```

**修改2: 添加专栏检查方法**

```javascript
/**
 * 检查用户专栏更新
 */
async checkUserArticle(sub, targetGroups = null, force = false) {
    const groupsToNotify = targetGroups || sub.groupIds;
    try {
        const groupId = groupsToNotify[0];
        const res = await biliApi.getUserArticles(sub.uid, groupId);

        if (res.status !== 'success' || !res.data.articles || res.data.articles.length === 0) {
            return;
        }

        const articles = res.data.articles;

        // 按时间排序（最新的在前）
        articles.sort((a, b) => b.publish_time - a.publish_time);

        const latestArticle = articles[0];
        const latestCvid = `cv${latestArticle.id}`;

        // 首次检查：记录最新专栏但不推送
        if (!sub.lastArticleId && !force) {
            await subscriptionManager.updateUserSub(sub.uid, { lastArticleId: latestCvid });
            logger.info(`[UpdateChecker] Initialized lastArticleId for ${sub.name}: ${latestCvid}`);
            return;
        }

        // 检查是否有新专栏
        if (latestCvid !== sub.lastArticleId || force) {
            // 找出所有新专栏
            const newArticles = [];
            for (const article of articles) {
                const cvid = `cv${article.id}`;
                if (cvid === sub.lastArticleId) break;
                newArticles.push(article);
            }

            // 只推送最新的一个
            const articleToPush = force ? [latestArticle] : [newArticles[0]];

            for (const article of articleToPush) {
                try {
                    const cvid = `cv${article.id}`;

                    // 使用linkHandler的逻辑获取专栏详情
                    const info = await biliApi.getArticleInfo(cvid, groupId);

                    if (info.status !== 'success') {
                        logger.warn(`[UpdateChecker] Failed to get article detail for ${cvid}`);
                        continue;
                    }

                    // 生成通知文本
                    const notificationText = `${sub.name} 发布了新专栏：\n${info.data.title}`;

                    // 推送
                    const url = `https://www.bilibili.com/read/${cvid}`;
                    await this.notifyGroupsWithImage(groupsToNotify, info, 'article', url, notificationText);

                    logger.info(`[UpdateChecker] Pushed new article for ${sub.name}: ${cvid}`);

                } catch (e) {
                    logger.error(`[UpdateChecker] Failed to push article cv${article.id}:`, e);
                }
            }

            // 更新lastArticleId
            if (!force) {
                await subscriptionManager.updateUserSub(sub.uid, { lastArticleId: latestCvid });
            }
        }
    } catch (e) {
        logger.error(`[UpdateChecker] Error checking articles for ${sub.name}:`, e);
    }
}
```

**修改3: 更新checkAll方法**（在 Step 2 后面添加）

```javascript
async checkAll() {
    logger.info('[UpdateChecker] Starting scheduled check...');

    // ... 现有的初始化代码 ...

    // 1. Check Dynamic Feed (Group-Based)
    // ... 现有代码 ...

    // 2. Check User Dynamics (Manual Subs)
    for (const sub of subscriptionManager.userSubs) {
        // ... 现有动态检查代码 ...
    }

    // 3. Check User Videos (Manual Subs) - 🆕 新增
    logger.info('[UpdateChecker] Checking user videos...');
    for (const sub of subscriptionManager.userSubs) {
        const targetGroups = [];
        for (const groupId of sub.groupIds) {
            if (activeGroups.has(groupId)) {
                targetGroups.push(groupId);
            }
        }

        if (targetGroups.length === 0) continue;

        await this.checkUserVideo(sub, targetGroups);
        // Small delay to be nice to API
        await new Promise(r => setTimeout(r, 1500));
    }

    // 4. Check User Articles (Manual Subs) - 🆕 新增
    logger.info('[UpdateChecker] Checking user articles...');
    for (const sub of subscriptionManager.userSubs) {
        const targetGroups = [];
        for (const groupId of sub.groupIds) {
            if (activeGroups.has(groupId)) {
                targetGroups.push(groupId);
            }
        }

        if (targetGroups.length === 0) continue;

        await this.checkUserArticle(sub, targetGroups);
        // Small delay to be nice to API
        await new Promise(r => setTimeout(r, 1500));
    }

    // 5. Check User Live Status (Manual Subs)
    // ... 现有代码保持不变 ...

    logger.info('[UpdateChecker] Scheduled check completed');
}
```

---

#### Step 4: 订阅管理器数据结构更新（subscriptionManager.js）

**文件**: `src/services/subscription/subscriptionManager.js`

订阅数据结构自动兼容，无需修改代码。新字段会在首次检查时自动添加：

```javascript
// userSubs 的数据结构（自动扩展）
{
    uid: 946974,
    name: "影视飓风",
    groupIds: ["123456789"],
    type: "user",
    lastDynamicId: "123456789",  // 现有字段
    lastLiveStatus: 0,            // 现有字段
    lastVideoId: "BV1xx411c7mD", // 🆕 新增字段（自动添加）
    lastArticleId: "cv12345678"   // 🆕 新增字段（自动添加）
}
```

---

### 配置调整

**检查间隔优化建议**（可选）：

由于现在要检查3种内容（动态、视频、专栏），建议适当增加检查间隔：

```javascript
// src/config.js - META配置
subscriptionCheckInterval: {
    env: 'SUBSCRIPTION_CHECK_INTERVAL',
    def: 120,  // 从60秒改为120秒（2分钟）
    type: 'int'
}
```

或在 `.env` 中设置：
```
SUBSCRIPTION_CHECK_INTERVAL=120
```

---

### 测试计划

**手动测试步骤**：

1. **订阅一个活跃UP主**（如 UID 946974）
   ```
   /订阅用户 946974
   ```

2. **强制检查一次**（触发初始化）
   ```
   /强制检查
   ```

3. **观察日志**
   ```
   tail -f logs/application.log | grep UpdateChecker
   ```

   期待看到：
   ```
   [UpdateChecker] Initialized lastVideoId for 影视飓风: BV1xx411c7mD
   [UpdateChecker] Initialized lastArticleId for 影视飓风: cv12345678
   ```

4. **等待UP主发布新内容**（或手动删除lastVideoId测试）

5. **验证推送**：
   - 新视频 → 收到视频卡片推送
   - 新专栏 → 收到专栏卡片推送
   - 新图文动态 → 收到动态卡片推送
   - ✅ 无重复推送

---

## 问题3：移动端适配方案

### 设计思路

**响应式断点**（遵循Tailwind标准）：
- `sm`: ≥640px（大屏手机横屏）
- `md`: ≥768px（平板）
- `lg`: ≥1024px（桌面）

**布局策略**：
- **<768px（移动端）**：隐藏侧边栏，顶部汉堡菜单，全屏overlay菜单
- **≥768px（桌面）**：显示固定侧边栏，隐藏汉堡菜单

---

### 实施步骤

#### Step 1: 创建MobileMenu组件

**新文件**: `dashboard/src/components/MobileMenu.jsx`

```jsx
import React from 'react';
import { X, Home, Users, Settings, Terminal } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

const MobileMenuItem = ({ icon: Icon, label, href, active, onClick }) => {
  return (
    <Link
      to={href}
      onClick={onClick}
      className={`flex items-center gap-4 px-6 py-4 rounded-lg transition-colors ${
        active
          ? 'bg-white/10 text-white'
          : 'text-gray-400 hover:bg-white/5 hover:text-white'
      }`}
    >
      <Icon size={24} />
      <span className="text-lg font-medium">{label}</span>
    </Link>
  );
};

const MobileMenu = ({ isOpen, onClose }) => {
  const location = useLocation();
  const path = location.pathname;

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 md:hidden"
        onClick={onClose}
      />

      {/* Menu Panel */}
      <div className="fixed inset-y-0 left-0 w-80 max-w-[85vw] bg-gradient-to-br from-gray-900 via-slate-800 to-black border-r border-white/10 z-50 md:hidden overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-600">
            控制面板
          </h1>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X size={24} className="text-gray-400" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="p-4 space-y-2">
          <MobileMenuItem
            icon={Home}
            label="运行状态"
            href="/"
            active={path === '/'}
            onClick={onClose}
          />
          <MobileMenuItem
            icon={Users}
            label="群组管理"
            href="/groups"
            active={path === '/groups'}
            onClick={onClose}
          />
          <MobileMenuItem
            icon={Settings}
            label="系统设置"
            href="/settings"
            active={path === '/settings'}
            onClick={onClose}
          />
          <MobileMenuItem
            icon={Terminal}
            label="系统日志"
            href="/logs"
            active={path === '/logs'}
            onClick={onClose}
          />
        </nav>
      </div>
    </>
  );
};

export default MobileMenu;
```

---

#### Step 2: 更新Layout.jsx

**文件**: `dashboard/src/components/Layout.jsx`

**完整替换为响应式版本**：

```jsx
import React, { useState } from 'react';
import { Home, Users, Settings, Terminal, Menu } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import MobileMenu from './MobileMenu';

const SidebarItem = ({ icon: Icon, label, href, active }) => {
  return (
    <Link
      to={href}
      className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
        active
          ? 'bg-white/10 text-white'
          : 'text-gray-400 hover:bg-white/5 hover:text-white'
      }`}
    >
      <Icon size={20} />
      <span className="font-medium">{label}</span>
    </Link>
  );
};

const Layout = ({ children }) => {
  const location = useLocation();
  const path = location.pathname;
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-800 to-black text-white">
      {/* Mobile Header */}
      <header className="md:hidden fixed top-0 left-0 right-0 h-16 bg-black/20 backdrop-blur-xl border-b border-white/10 z-30 flex items-center px-4">
        <button
          onClick={() => setMobileMenuOpen(true)}
          className="p-2 rounded-lg hover:bg-white/10 transition-colors"
        >
          <Menu size={24} className="text-white" />
        </button>
        <h1 className="ml-3 text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-600">
          控制面板
        </h1>
      </header>

      {/* Desktop Sidebar */}
      <aside className="hidden md:block fixed left-0 top-0 h-full w-64 bg-black/20 backdrop-blur-xl border-r border-white/10 z-50">
        <div className="p-6">
          <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-600">
            控制面板
          </h1>
        </div>

        <nav className="px-4 space-y-2 mt-4">
          <SidebarItem
            icon={Home}
            label="运行状态"
            href="/"
            active={path === '/'}
          />
          <SidebarItem
            icon={Users}
            label="群组管理"
            href="/groups"
            active={path === '/groups'}
          />
          <SidebarItem
            icon={Settings}
            label="系统设置"
            href="/settings"
            active={path === '/settings'}
          />
          <SidebarItem
            icon={Terminal}
            label="系统日志"
            href="/logs"
            active={path === '/logs'}
          />
        </nav>
      </aside>

      {/* Mobile Menu */}
      <MobileMenu
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
      />

      {/* Main Content */}
      <main className="pt-16 md:pt-0 md:ml-64 p-4 md:p-8">
        <div className="max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
};

export default Layout;
```

**关键改动说明**：
1. **移动端Header**：`md:hidden` - 仅在小屏幕显示，包含汉堡菜单按钮
2. **桌面侧边栏**：`hidden md:block` - 仅在中等及以上屏幕显示
3. **主内容区**：
   - `pt-16 md:pt-0` - 移动端顶部留空16单位（Header高度），桌面无顶部留空
   - `md:ml-64` - 桌面左边距256px，移动端无左边距
   - `p-4 md:p-8` - 移动端4单位padding，桌面8单位

---

#### Step 3: 响应式组件优化

**文件**: `dashboard/src/components/GlassCard.jsx`

**优化padding**：

```jsx
// 找到 className 行，修改为：
<div className={`backdrop-blur-xl bg-white/5 border border-white/10 rounded-xl p-4 md:p-6 ${className}`}>
  {children}
</div>
```

**改动**：`p-6` → `p-4 md:p-6`（移动端减小内边距）

---

**文件**: `dashboard/src/pages/Groups.jsx`

**优化标签页滚动**（在 categories 所在的 div 添加）：

找到标签栏（第519行附近）：
```jsx
<div className="flex gap-2 mb-6 border-b border-white/10 pb-4">
```

改为：
```jsx
<div className="flex gap-2 mb-6 border-b border-white/10 pb-4 overflow-x-auto scrollbar-thin scrollbar-thumb-white/20">
```

**改动说明**：标签页过多时在移动端可横向滚动

---

**文件**: `dashboard/src/pages/Settings.jsx`

**优化表单布局**（在输入框容器添加响应式网格）：

找到类似这样的输入框容器：
```jsx
<div className="grid grid-cols-2 gap-4">
```

改为：
```jsx
<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
```

**改动说明**：移动端单列显示，桌面双列显示

---

#### Step 4: 添加CSS优化（可选）

**文件**: `dashboard/src/index.css`

在文件末尾添加：

```css
/* 移动端优化 */
@media (max-width: 768px) {
  /* 防止横向滚动 */
  body {
    overflow-x: hidden;
  }

  /* 优化按钮点击区域 */
  button {
    min-height: 44px;
  }

  /* 优化表单输入框 */
  input, textarea, select {
    font-size: 16px; /* 防止iOS自动缩放 */
  }
}

/* 自定义滚动条 */
.scrollbar-thin::-webkit-scrollbar {
  height: 4px;
}

.scrollbar-thin::-webkit-scrollbar-track {
  background: transparent;
}

.scrollbar-thin::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
}

.scrollbar-thin::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.3);
}
```

---

### 测试计划

**移动端测试清单**：

1. **iPhone SE (375px)**
   - [ ] 侧边栏完全隐藏
   - [ ] 顶部Header正常显示
   - [ ] 汉堡菜单可打开
   - [ ] 菜单overlay全屏显示
   - [ ] 主内容可正常滚动

2. **iPhone 12 (390px)**
   - [ ] 标签页可横向滚动
   - [ ] 表单单列显示
   - [ ] 按钮可正常点击

3. **iPad (768px)**
   - [ ] 侧边栏正常显示
   - [ ] 无顶部Header
   - [ ] 表单双列显示

4. **桌面 (1024px+)**
   - [ ] 布局与原版一致
   - [ ] 无功能退化

---

## 实施顺序建议

### 优先级1：问题1修复（视频/专栏推送）

**原因**：核心功能缺陷，影响订阅功能使用

**步骤**：
1. 修改 `bili_server.py` - 添加API（30分钟）
2. 修改 `biliApi.js` - 添加封装（15分钟）
3. 修改 `updateChecker.js` - 添加检查逻辑（45分钟）
4. 测试验证（30分钟）

**总计**：约2小时

### 优先级2：问题3修复（移动端适配）

**原因**：用户体验问题，不影响核心功能

**步骤**：
1. 创建 `MobileMenu.jsx`（20分钟）
2. 更新 `Layout.jsx`（15分钟）
3. 优化其他组件（30分钟）
4. 测试各尺寸屏幕（30分钟）

**总计**：约1.5小时

---

## 回滚方案

如果出现问题，可以快速回滚：

**问题1回滚**：
```bash
# 移除新增的检查调用
git diff HEAD src/services/subscription/updateChecker.js
# 手动删除 checkUserVideo 和 checkUserArticle 的调用

# 或完全回滚
git checkout HEAD -- src/services/subscription/updateChecker.js
git checkout HEAD -- src/services/biliApi.js
git checkout HEAD -- src/services/bili_server.py
```

**问题3回滚**：
```bash
git checkout HEAD -- dashboard/src/components/Layout.jsx
git checkout HEAD -- dashboard/src/components/MobileMenu.jsx
```

---

## 预期效果

### 问题1修复后

**订阅推送行为**：
- UP主发视频 → ✅ 推送视频卡片（通过checkUserVideo）
- UP主发专栏 → ✅ 推送专栏卡片（通过checkUserArticle）
- UP主发图文动态 → ✅ 推送动态卡片（通过checkUserDynamic）
- UP主发转发 → ✅ 推送动态卡片（通过checkUserDynamic）
- **无重复推送** ✅（动态流已过滤视频/专栏）

### 问题3修复后

**移动端体验**：
- iPhone：✅ 汉堡菜单流畅，内容全屏显示
- iPad：✅ 自动切换到桌面布局
- 横竖屏切换：✅ 自动适配

---

## 文件清单

### 新增文件
- `test_bili_api_capabilities.py` - API能力测试脚本
- `dashboard/src/components/MobileMenu.jsx` - 移动端菜单组件

### 修改文件
- `src/services/bili_server.py` - 添加视频/专栏API
- `src/services/biliApi.js` - 添加Node.js封装
- `src/services/subscription/updateChecker.js` - 添加检查逻辑
- `dashboard/src/components/Layout.jsx` - 响应式改造
- `dashboard/src/components/GlassCard.jsx` - padding优化
- `dashboard/src/pages/Groups.jsx` - 标签页滚动
- `dashboard/src/pages/Settings.jsx` - 表单布局
- `dashboard/src/index.css` - 移动端样式（可选）

---

**文档版本**: 1.0
**创建日期**: 2026-02-06
**预计工作量**: 3.5小时（问题1: 2h + 问题3: 1.5h）
