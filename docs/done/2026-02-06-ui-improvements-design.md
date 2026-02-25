# Dashboard UI改进和功能优化设计文档

**日期：** 2026-02-06
**类型：** UI改进 + 功能优化
**优先级：** P2

## 问题概述

本次改进涉及四个相关问题：

1. **AI配置开关UI风格不统一** - Dashboard中AI配置开关使用Tailwind标准样式，与其他玻璃态UI元素不协调
2. **关注列表同步页面需要调整** - 群组页面保留了扫码登录功能，但应改为使用全局Cookie
3. **后端服务兼容性检查** - 确保全局Cookie相关API正确工作
4. **推送链接自动加入冷却** - 订阅推送的B站链接应自动加入缓存，避免重复解析

## 设计方案

### 第一部分：前端UI调整

#### 1.1 AI配置开关样式统一

**文件：** `dashboard/src/components/AiConfigSection.jsx`

**修改内容：**
- 移除所有 `dark:` 前缀的Tailwind类名
- 统一使用玻璃态深色风格

**样式映射：**
| 当前样式 | 修改为 |
|---------|--------|
| `bg-gray-50 dark:bg-gray-800` | `bg-white/5` |
| `text-gray-900 dark:text-white` | `text-white` |
| `text-gray-600 dark:text-gray-400` | `text-gray-400` |
| `bg-gray-200 dark:bg-gray-700` | `bg-gray-700` |
| `peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800` | `peer-focus:ring-blue-800` |
| `border-gray-300 dark:border-gray-600` | `border-gray-600` |
| `bg-blue-50 dark:bg-blue-900/20` | `bg-blue-500/10` |
| `text-blue-800 dark:text-blue-300` | `text-blue-300` |

**修改位置：**
- 第23-46行：AI功能开关容器
- 第49-76行：RAG功能开关容器
- 第80-86行：重置按钮
- 第90-95行：提示信息容器

---

#### 1.2 关注列表同步页面重构

**文件：** `dashboard/src/pages/Groups.jsx`

**需要移除的内容：**

1. **State变量（第64-74行附近）：**
   ```javascript
   const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
   const [loginQrCode, setLoginQrCode] = useState('');
   const [loginStatus, setLoginStatus] = useState('idle');
   const checkLoginTimerRef = useRef(null);
   const [biliUserInfo, setBiliUserInfo] = useState(null);
   ```

2. **函数（第531-633行）：**
   - `startLogin()`
   - `checkLoginStatus()`
   - `closeLoginModal()`
   - `handleLogout()`

3. **useEffect清理（第636-643行）：**
   - 定时器清理的useEffect

4. **Modal组件（第1326-1365行）：**
   - 登录QR码Modal

5. **UI内容（第1203-1256行）：**
   - 第1205-1208行：提示文字
   - 第1210-1256行：整个"Bilibili 账号"section

**需要新增的内容：**

1. **全局状态State：**
   ```javascript
   const [globalBiliStatus, setGlobalBiliStatus] = useState({
       isLoggedIn: false,
       uid: null,
       username: ''
   });
   ```

2. **全局状态检测函数：**
   ```javascript
   const checkGlobalBiliStatus = useCallback(async () => {
       try {
           const res = await api.get('/api/bili/global-status');
           setGlobalBiliStatus({
               isLoggedIn: res.data.isLoggedIn,
               uid: res.data.uid,
               username: res.data.username
           });
       } catch (error) {
           console.error('Failed to check global bili status:', error);
           setGlobalBiliStatus({ isLoggedIn: false, uid: null, username: '' });
       }
   }, []);
   ```

3. **在useEffect中调用（第246行附近）：**
   ```javascript
   if (selectedTabIndex === 5) {
       fetchBiliGroups(selectedGroupId);
       checkGlobalBiliStatus(); // 新增
   }
   ```

4. **新的UI结构（替换第1203-1313行）：**
   ```javascript
   <Tab.Panel className="space-y-8 focus:outline-none">
       {/* 未登录提示 */}
       {!globalBiliStatus.isLoggedIn && (
           <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg mb-4">
               <p className="text-sm text-yellow-300 mb-2">
                   ⚠️ 未检测到全局B站登录
               </p>
               <p className="text-sm text-white/70 mb-3">
                   关注列表同步需要先在系统设置中登录B站账号
               </p>
               <a
                   href="#/settings"
                   className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors text-sm"
               >
                   前往系统设置
               </a>
           </div>
       )}

       {/* 已登录时显示同步配置 */}
       {globalBiliStatus.isLoggedIn && (
           <div>
               {/* 登录状态显示 */}
               <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg mb-4">
                   <div className="flex items-center gap-2 text-green-400 text-sm">
                       <div className="w-2 h-2 rounded-full bg-green-400"></div>
                       <span>已使用全局B站账号：{globalBiliStatus.username} (UID: {globalBiliStatus.uid})</span>
                   </div>
               </div>

               {/* 同步开关 */}
               <div className="p-4 bg-white/5 rounded-lg border border-white/10 mb-4">
                   <label className="flex items-center justify-between cursor-pointer">
                       <div>
                           <span className="text-white font-medium block">启用关注列表同步</span>
                           <span className="text-gray-400 text-sm">自动同步所选分组的 UP 主更新</span>
                       </div>
                       <div className="relative inline-flex items-center cursor-pointer">
                           <input
                               type="checkbox"
                               checked={formData.enableCookieSync}
                               onChange={(e) => setFormData({...formData, enableCookieSync: e.target.checked})}
                               className="sr-only peer"
                           />
                           <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                       </div>
                   </label>
               </div>

               {/* 分组选择（保持不变，第1279-1311行的内容） */}
               {/* ... */}
           </div>
       )}
   </Tab.Panel>
   ```

---

### 第二部分：后端API调整

#### 2.1 API路由层修改

**文件：** `src/dashboard/routes/api.js`

**修改位置：** 第627行

**当前代码：**
```javascript
const result = await biliApi.getFollowGroups(groupId);
```

**修改为：**
```javascript
const result = await biliApi.getFollowGroups(null);  // 使用全局Cookie
```

**日志优化（第635行）：**
```javascript
// 当前
logger.error(`Error fetching Bilibili groups for group ${req.params.id}:`, error);

// 修改为
logger.error('Error fetching Bilibili groups (global cookie):', error);
```

#### 2.2 后端兼容性验证结果

经过检查，以下API已正确支持全局Cookie：

| API端点 | 验证结果 | 说明 |
|---------|---------|------|
| `/api/bili/global-status` | ✅ 正确 | 查询全局Cookie状态 |
| `/api/bili/login-url` | ✅ 正确 | 生成登录二维码（不传groupId） |
| `/api/bili/check-login` | ✅ 正确 | groupId为undefined时保存到全局Cookie |
| `/api/bili/logout` | ✅ 正确 | groupId为undefined时删除全局Cookie |
| `/api/bili/my-info` | ✅ 正确 | load_credential()忽略groupId，只用全局Cookie |
| `/api/groups/:id/bili-groups` | ⚠️ 需修改 | 改为传入null |

**Python服务层验证：**

`bili_server.py` 中的 `load_credential(group_id)` 函数已在 2026-02-05 修改为仅使用全局Cookie：

```python
def load_credential(group_id=None):
    """
    加载B站凭证，仅使用全局Cookie (cookies.json)

    注意：group_id参数保留用于兼容性，但已被忽略。
    自2026-02-05起，群级Cookie支持已移除。
    """
    # 仅加载全局Cookie (cookies.json)
    if os.path.exists(CREDENTIAL_FILE):
        # ... 只读取 cookies.json，忽略group_id
```

因此所有API已完全兼容全局Cookie机制。

---

### 第三部分：推送链接缓存机制

#### 3.1 linkHandler新增方法

**文件：** `src/handlers/linkHandler.js`

**新增位置：** 在现有方法之后（约第400行附近）

```javascript
/**
 * 🆕 添加链接到缓存（供外部调用）
 * 用于订阅推送后，将链接加入缓存避免重复解析
 *
 * @param {string} url - B站链接
 * @param {string} groupId - 群组ID
 */
addUrlToCache(url, groupId) {
    if (!url || !groupId) {
        logger.warn('[LinkHandler] Invalid url or groupId for cache');
        return;
    }

    // 提取链接信息
    const links = this.extractLinks(url, groupId);
    if (links.length === 0) {
        logger.debug('[LinkHandler] No valid bili links found in url:', url);
        return;
    }

    // 获取群组的缓存超时配置
    const groupConfig = config.groupConfigs[groupId] || {};
    const timeout = (groupConfig.linkCacheTimeout ?? config.linkCacheTimeout ?? 600) * 1000;

    // 添加所有提取到的链接到缓存
    for (const link of links) {
        const { cacheKey } = link;
        this.linkCache.set(cacheKey, Date.now() + timeout);
        logger.debug(`[LinkHandler] Added to cache: ${cacheKey} (timeout: ${timeout}ms)`);
    }
}
```

#### 3.2 updateChecker调整

**文件：** `src/services/subscription/updateChecker.js`

**方案1：在每个推送点单独调用（直接修改）**

需要在以下6个位置添加缓存调用：

1. **第392行 - 动态推送（Feed检查）**
2. **第467行 - 直播推送**
3. **第787行 - 动态推送（订阅检查）**
4. **第885行 - 番剧更新**
5. **第978-979行 - 视频投稿**
6. **第1073-1074行 - 专栏投稿**

每个位置添加：
```javascript
// 🆕 添加链接到缓存
for (const groupId of targetGroups) {  // 或 groupsToNotify
    linkHandler.addUrlToCache(url, groupId);
}
```

**方案2：封装为helper方法（推荐）**

在updateChecker类中新增方法：

```javascript
/**
 * 🆕 推送消息并添加链接到缓存
 */
async notifyGroupsWithImageAndCache(groups, info, type, url, text) {
    // 推送消息
    await this.notifyGroupsWithImage(groups, info, type, url, text);

    // 添加到缓存
    const linkHandler = require('../../handlers/linkHandler');
    for (const groupId of groups) {
        linkHandler.addUrlToCache(url, groupId);
    }
}
```

然后在6个位置将：
```javascript
await this.notifyGroupsWithImage(groups, info, type, url, text);
```

替换为：
```javascript
await this.notifyGroupsWithImageAndCache(groups, info, type, url, text);
```

**推荐使用方案2**，代码更简洁，避免重复。

---

## 实施顺序

1. **第一步：前端UI调整**
   - 修改 AiConfigSection.jsx
   - 修改 Groups.jsx

2. **第二步：后端API调整**
   - 修改 api.js（一行代码）

3. **第三步：推送链接缓存**
   - 修改 linkHandler.js（新增方法）
   - 修改 updateChecker.js（6处调用或新增helper方法）

4. **第四步：测试验证**
   - 测试AI配置开关显示
   - 测试关注列表同步页面
   - 测试订阅推送后的链接缓存

---

## 测试要点

### UI测试
- [ ] AI配置开关样式与其他元素统一
- [ ] 关注列表同步页面未登录时显示引导提示
- [ ] 关注列表同步页面已登录时显示分组选择
- [ ] 点击"前往系统设置"链接可正常跳转

### 功能测试
- [ ] 群组页面可以正常获取关注分组列表（使用全局Cookie）
- [ ] 订阅推送视频后，群友发送相同链接不重复解析
- [ ] 订阅推送动态后，群友发送相同链接不重复解析
- [ ] 订阅推送专栏后，群友发送相同链接不重复解析
- [ ] 订阅推送直播后，群友发送相同链接不重复解析
- [ ] 缓存超时后，链接可以正常重新解析

### 兼容性测试
- [ ] 全局Cookie API正常工作
- [ ] 后端正确处理不传groupId的情况
- [ ] Python服务正确使用全局Cookie

---

## 风险评估

### 低风险
- UI样式调整：纯视觉变更，不影响功能
- API调整：只改一行代码，且后端已完全兼容

### 中风险
- 推送链接缓存：新增功能，需要充分测试
  - 缓解措施：先在测试环境验证，观察缓存命中率

---

## 后续优化建议

1. **缓存统计**：添加缓存命中率统计，监控缓存效果
2. **UI优化**：考虑在Groups页面添加"刷新关注分组"按钮
3. **性能监控**：监控推送链接缓存对系统性能的影响

---

## 变更记录

- 2026-02-06: 初始设计文档
