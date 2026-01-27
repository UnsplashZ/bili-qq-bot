# WebUI 功能改进实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复WebUI中的4个bug并新增3个功能增强，包括配置单位优化、群组显示修复、AI配置扩展、B站登录状态持久化和订阅推送数据完整性修复。

**Architecture:** 采用三层配置架构（群组配置 > 全局配置 > 环境变量/默认值），前端使用React进行UI增强，后端扩展API端点和配置字段，Python服务优化数据获取逻辑。

**Tech Stack:**
- Frontend: React (Groups.jsx, Settings.jsx), Axios
- Backend: Express (api.js), Node.js config system
- Python: bilibili_api, aiohttp
- Storage: JSON files (config.json, cookies_map.json)

---

## 需求概览

### Bug修复 (4个)
1. ✅ AI配置单位：历史记录体积 Bytes → MB
2. ✅ 群组列表：禁用后刷新不消失
3. ✅ 自动创建：Bot加入新群自动创建 groupConfigs
4. 🐛 订阅推送：动态缺少文本内容（`get_user_dynamic()` 数据不完整）

### 功能增强 (3个)
5. ⚡ 群组配置：添加 aiProbability 和 aiContextLimit 到WebUI
6. ⚡ B站登录：显示"已登录：用户名"状态
7. ⚡ AI配置：新增对话/向量化API分离配置（端点+Key+模型+代理+系统提示词）

---

## Task 1: AI配置单位转换 (Bytes → MB)

**Priority:** P0 (简单bug修复)
**Estimated Time:** 10分钟

**Files:**
- Modify: `dashboard/src/pages/Settings.jsx:463-471`

**Step 1: 修改显示逻辑**

在 Settings.jsx 第463-471行，修改历史记录最大体积的输入框：

```jsx
{/* 原代码：
<input
  type="number"
  value={aiHistoryMaxSize}
  onChange={(e) => setAiHistoryMaxSize(parseInt(e.target.value) || 0)}
  className="..."
/>
<span className="ml-2 text-white/70">Bytes</span>
<p className="text-xs text-white/50 mt-1">
  例如: 209715200 (200MB)
</p>
*/}

{/* 新代码： */}
<div className="space-y-2">
  <label className="block text-sm font-medium text-white/90">
    历史记录最大体积
  </label>
  <div className="flex items-center gap-2">
    <input
      type="number"
      min="1"
      value={Math.round(aiHistoryMaxSize / (1024 * 1024))}
      onChange={(e) => {
        const mb = parseInt(e.target.value) || 0;
        setAiHistoryMaxSize(mb * 1024 * 1024);
      }}
      className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white"
    />
    <span className="text-white/70 font-medium">MB</span>
  </div>
  <p className="text-xs text-white/50">
    默认: 200 MB (用于存储AI对话历史)
  </p>
</div>
```

**Step 2: 测试显示效果**

1. 启动开发服务器: `npm start`
2. 访问 http://localhost:3000/settings
3. 检查：
   - 默认值显示为 `200` 而非 `209715200`
   - 单位显示为 `MB`
   - 输入 `500` 能正确保存为 `524288000` bytes
4. 保存配置，刷新页面确认值正确显示

**Step 3: Commit**

```bash
git add dashboard/src/pages/Settings.jsx
git commit -m "fix(ui): 改进历史记录体积单位显示 (Bytes → MB)

- 输入框改为MB单位，自动转换为bytes存储
- 更新提示文本，移除混淆的bytes示例
- 添加最小值限制(1MB)"
```

---

## Task 2: 群组列表显示修复

**Priority:** P0 (关键bug修复)
**Estimated Time:** 20分钟

**Files:**
- Modify: `src/dashboard/routes/api.js:103-119`
- Modify: `dashboard/src/pages/Groups.jsx:378-412`

**Step 1: 修改后端API - 返回所有群组**

修改 `src/dashboard/routes/api.js` 第103-119行：

```javascript
// GET /api/groups - List all groups (including disabled ones)
router.get('/groups', authenticateToken, async (req, res) => {
    try {
        const bot = global.bot;
        if (!bot || !bot.groupList) {
            return res.json([]);
        }

        // 获取所有群组（不过滤 enabledGroups）
        const allGroups = Array.from(bot.groupList.keys());

        const groupsData = allGroups.map(groupId => {
            const groupInfo = bot.groupList.get(groupId);
            const isEnabled = config.enabledGroups.includes(groupId);
            const groupConfig = config.groupConfigs[groupId] || {};

            return {
                id: groupId,
                name: groupInfo?.group_name || `群组 ${groupId}`,
                isEnabled: isEnabled,  // 添加启用状态
                config: groupConfig
            };
        });

        res.json(groupsData);
    } catch (error) {
        logger.error('Error fetching groups:', error);
        res.status(500).json({ error: 'Failed to fetch groups' });
    }
});
```

**Step 2: 修改前端UI - 半透明显示禁用群组**

修改 `dashboard/src/pages/Groups.jsx` 第378-412行：

```jsx
{/* 群组列表 */}
<div className="space-y-2">
  {groups.map((group) => (
    <button
      key={group.id}
      onClick={() => setSelectedGroupId(group.id)}
      className={clsx(
        'w-full flex items-center gap-3 p-3 rounded-lg transition-all',
        'hover:bg-white/5',
        selectedGroupId === group.id
          ? 'bg-blue-500/20 ring-2 ring-blue-500'
          : 'bg-white/5',
        !group.isEnabled && 'opacity-50'  // 禁用时半透明
      )}
    >
      <Power
        className={clsx(
          'w-4 h-4',
          group.isEnabled ? 'text-green-400' : 'text-gray-400'
        )}
      />
      <div className="flex-1 text-left">
        <div className="font-medium text-white">{group.name}</div>
        <div className="text-xs text-white/50">ID: {group.id}</div>
      </div>
      {!group.isEnabled && (
        <span className="text-xs text-white/40 px-2 py-1 bg-white/5 rounded">
          已禁用
        </span>
      )}
    </button>
  ))}
</div>
```

**Step 3: 测试功能**

1. 启动服务: `npm start`
2. 访问群组管理页面
3. 测试场景：
   - 禁用一个群组（点击电源按钮）
   - 刷新页面 → 群组仍在列表中，显示为半透明+灰色电源图标
   - 启用群组 → 恢复正常显示
4. 检查控制台无错误

**Step 4: Commit**

```bash
git add src/dashboard/routes/api.js dashboard/src/pages/Groups.jsx
git commit -m "fix(ui): 修复禁用群组刷新后消失的问题

- 后端API返回所有群组，不再过滤disabled
- 前端使用半透明样式区分禁用状态
- 添加'已禁用'标签提示"
```

---

## Task 3: 自动创建群组配置

**Priority:** P1 (重要功能)
**Estimated Time:** 15分钟

**Files:**
- Modify: `src/bot.js:90-120` (群组消息处理部分)
- Modify: `src/config.js:450-470` (添加辅助方法)

**Step 1: 在config.js添加初始化方法**

在 `src/config.js` 添加辅助方法（约450行附近）：

```javascript
// 确保群组配置存在（自动初始化）
function ensureGroupConfig(groupId) {
    const key = String(groupId);

    if (!this.groupConfigs[key]) {
        logger.info(`[Config] 自动创建群组 ${groupId} 的配置`);

        this.groupConfigs[key] = {
            linkCacheTimeout: 5,
            labelConfig: {
                video: true,
                dynamic: true,
                live: true,
                article: true,
                bangumi: true
            },
            enableCookieSync: false,
            cookieSyncGroupNames: [],
            blacklistedQQs: []
        };

        // 触发保存
        this.save();
    }

    return this.groupConfigs[key];
}

// 导出方法
config.ensureGroupConfig = ensureGroupConfig.bind(config);
```

**Step 2: 在bot.js群组消息处理中调用**

修改 `src/bot.js` 的群组消息处理部分（约90-120行）：

```javascript
// 监听群组消息
bot.on('message.group', async (e) => {
    const groupId = e.group_id;

    // 自动创建群组配置（如果不存在）
    config.ensureGroupConfig(groupId);

    // 检查群组是否启用
    if (!config.enabledGroups.includes(groupId)) {
        return; // 群组未启用，忽略消息
    }

    // ... 其他消息处理逻辑
});
```

**Step 3: 测试功能**

1. 停止Bot: `Ctrl+C`
2. 编辑 `config.json`，删除某个群组的配置
3. 启动Bot: `npm start`
4. 让Bot加入新群或在现有群发消息
5. 检查 `config.json` 自动创建了该群组的配置
6. 检查日志输出: `[Config] 自动创建群组 XXX 的配置`

**Step 4: Commit**

```bash
git add src/config.js src/bot.js
git commit -m "feat(config): Bot加入新群自动创建群组配置

- 添加 config.ensureGroupConfig() 方法
- 群组消息处理时自动初始化配置
- 使用默认值创建配置，避免运行时错误"
```

---

## Task 4: 修复订阅推送动态缺少文本

**Priority:** P0 (严重bug)
**Estimated Time:** 30分钟

**Files:**
- Modify: `src/services/bili_server.py:440-551`

**Background:**
订阅推送使用 `get_user_dynamic()` 获取动态列表，但返回的数据结构不完整，导致 `modules.module_dynamic.desc` 缺失文本内容。对比 `get_dynamic_detail()` 函数，需要对数据进行规范化处理。

**Step 1: 分析现有代码差异**

阅读两个函数：
- `get_user_dynamic()` (第440-551行) - 简化处理
- `get_dynamic_detail()` (第579-720行) - 完整处理

关键差异：
- `get_dynamic_detail()` 对 `modules` 进行了话题修复（第604-633行）
- `get_dynamic_detail()` 构造了完整的 `author_obj`（第635-702行）

**Step 2: 增强 get_user_dynamic() 的数据处理**

修改 `src/services/bili_server.py` 第519-549行：

```python
# 在遍历动态列表时，规范化 modules 数据
for item in dynamics['items']:
    item_id = item.get('id_str', '')
    item_type = item.get('type', '')

    # 获取模块数据
    modules = item.get('modules') or {}

    # === 关键修复：确保 module_dynamic 包含完整数据 ===
    module_dynamic = modules.get('module_dynamic')
    if module_dynamic:
        # 如果没有 desc，尝试从 major.opus.summary 提取
        if not module_dynamic.get('desc'):
            major = module_dynamic.get('major') or {}
            opus = major.get('opus')
            if opus and opus.get('summary'):
                # 构造 desc 结构
                module_dynamic['desc'] = {
                    'text': opus['summary'].get('text', ''),
                    'rich_text_nodes': opus['summary'].get('rich_text_nodes', [])
                }

        # 话题修复（与 get_dynamic_detail 保持一致）
        topic = modules.get('module_dynamic', {}).get('topic')
        if topic and isinstance(topic, dict):
            topic_name = topic.get('name', '')
            topic_id = topic.get('id', 0)
            if topic_name and topic_id:
                # 确保 desc 存在
                if not module_dynamic.get('desc'):
                    module_dynamic['desc'] = {'text': '', 'rich_text_nodes': []}

                # 在文本开头添加话题标签
                desc = module_dynamic['desc']
                topic_tag = f"#{topic_name}#"
                if not desc['text'].startswith(topic_tag):
                    desc['text'] = topic_tag + desc['text']

                # 在 rich_text_nodes 开头添加话题节点
                if not desc.get('rich_text_nodes'):
                    desc['rich_text_nodes'] = []

                topic_node = {
                    'type': 'RICH_TEXT_NODE_TYPE_TOPIC',
                    'text': topic_tag,
                    'jump_url': f"https://www.bilibili.com/v/topic/detail/?topic_id={topic_id}",
                    'orig_text': topic_tag
                }

                # 检查是否已存在话题节点
                if not any(n.get('type') == 'RICH_TEXT_NODE_TYPE_TOPIC' for n in desc['rich_text_nodes']):
                    desc['rich_text_nodes'].insert(0, topic_node)

    # 构造 author 信息（使用之前获取的统一信息）
    author_info = {
        "name": author_name,
        "mid": uid,
        "face": author_face,
        "level": author_level,
        "pendant": {"image": pendant_url} if pendant_url else None,
        "decorate_card": decoration_card if decoration_card else None,
        "fan_color": fan_color
    }

    # 构造返回项
    result_items.append({
        "desc": {
            "dynamic_id_str": item_id,
            "type": item_type,
            "timestamp": pub_ts
        },
        "card": item.get('card'),
        "extend_json": item.get('extend_json'),
        # New API fields
        "id_str": item_id,
        "type": item_type,
        "modules": modules,  # 已增强的 modules
        "orig": item.get('orig'),
        "pub_ts": pub_ts,
        "author": author_info
    })
```

**Step 3: 测试订阅推送**

1. 重启Python服务（Bot会自动重启）
2. 等待订阅检查触发（或手动触发）
3. 观察推送的动态截图是否包含文本内容
4. 对比：手动发送同一条动态链接，检查两者截图一致

测试命令：
```bash
# 查看日志
tail -f logs/bot.log | grep "UpdateChecker"

# 手动测试Python函数
curl -X POST http://localhost:10001/user_dynamic \
  -H "Content-Type: application/json" \
  -d '{"uid": "15156331"}'
```

**Step 4: 验证数据结构**

在 UpdateChecker 中添加临时日志：
```javascript
// src/services/subscription/updateChecker.js 第507行
const info = {
    id: cardId,
    type: 'dynamic',
    data: { ... }
};

// 临时调试
console.log('[DEBUG] Dynamic modules:', JSON.stringify(card.modules?.module_dynamic?.desc, null, 2));
```

检查输出包含 `text` 和 `rich_text_nodes` 字段。

**Step 5: Commit**

```bash
git add src/services/bili_server.py
git commit -m "fix(bili): 修复订阅推送动态缺少文本内容

- get_user_dynamic() 增强 modules 数据处理
- 从 opus.summary 提取缺失的 desc 字段
- 添加话题修复逻辑（与 get_dynamic_detail 保持一致）
- 确保返回数据结构与手动链接解析一致"
```

---

## Task 5: 群组配置添加AI字段

**Priority:** P1 (功能增强)
**Estimated Time:** 25分钟

**Files:**
- Modify: `dashboard/src/pages/Groups.jsx:20-32` (formData)
- Modify: `dashboard/src/pages/Groups.jsx:112-152` (加载配置)
- Modify: `dashboard/src/pages/Groups.jsx:176-202` (保存配置)
- Create: `dashboard/src/pages/Groups.jsx:545-620` (新增AI配置UI)
- Modify: `src/dashboard/routes/api.js:145-160` (保存端点)

**Step 1: 扩展formData状态**

修改 `dashboard/src/pages/Groups.jsx` 第20-32行：

```javascript
const [formData, setFormData] = useState({
    linkCacheTimeout: 5,
    labelConfig: {
      video: true,
      dynamic: true,
      live: true,
      article: true,
      bangumi: true,
    },
    enableCookieSync: false,
    cookieSyncGroupNames: [],
    blacklistedQQs: [],
    // 新增：AI配置覆盖（null表示使用全局默认）
    aiProbability: null,
    aiContextLimit: null
});
```

**Step 2: 添加全局配置状态**

在 `Groups.jsx` 顶部添加全局配置状态（约第50行）：

```javascript
// 全局AI配置（用于显示默认值占位符）
const [globalAiConfig, setGlobalAiConfig] = useState({
    aiProbability: 0.1,
    aiContextLimit: 10
});

// 在 useEffect 中加载全局配置
useEffect(() => {
    const fetchGlobalConfig = async () => {
        try {
            const res = await api.get('/api/config');
            if (res.data) {
                setGlobalAiConfig({
                    aiProbability: res.data.aiProbability || 0.1,
                    aiContextLimit: res.data.aiContextLimit || 10
                });
            }
        } catch (err) {
            console.error('Failed to fetch global config:', err);
        }
    };
    fetchGlobalConfig();
}, []);
```

**Step 3: 加载群组配置时读取AI字段**

修改 `dashboard/src/pages/Groups.jsx` 第112-152行的配置加载：

```javascript
useEffect(() => {
    if (selectedGroupId !== null && groups.length > 0) {
        const group = groups.find(g => g.id === selectedGroupId);
        if (group && group.config) {
            setFormData({
                linkCacheTimeout: group.config.linkCacheTimeout || 5,
                labelConfig: group.config.labelConfig || { ... },
                enableCookieSync: group.config.enableCookieSync || false,
                cookieSyncGroupNames: group.config.cookieSyncGroupNames || [],
                blacklistedQQs: group.config.blacklistedQQs || [],
                // 加载AI配置（可能为 null）
                aiProbability: group.config.aiProbability ?? null,
                aiContextLimit: group.config.aiContextLimit ?? null
            });
        }
        // ...
    }
}, [selectedGroupId, groups, selectedTabIndex]);
```

**Step 4: 添加AI配置UI（在"群组设置"Tab中）**

在 `dashboard/src/pages/Groups.jsx` 的群组设置Tab中添加（约第545-620行，在黑名单配置之后）：

```jsx
{/* AI 响应配置 */}
<div className="space-y-4">
  <div className="flex items-center gap-2">
    <Cpu className="w-5 h-5 text-purple-400" />
    <h3 className="text-lg font-semibold text-white">AI 响应配置</h3>
  </div>

  <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
    <p className="text-sm text-white/70">
      配置此群组专属的AI响应行为。留空则使用全局默认值。
    </p>
  </div>

  {/* 响应概率 */}
  <div className="space-y-2">
    <label className="block text-sm font-medium text-white/90">
      响应概率 (留空使用全局默认)
    </label>
    <div className="flex items-center gap-4">
      <input
        type="number"
        step="0.01"
        min="0"
        max="1"
        value={formData.aiProbability ?? ''}
        placeholder={`全局默认: ${Math.round(globalAiConfig.aiProbability * 100)}%`}
        onChange={(e) => setFormData({
          ...formData,
          aiProbability: e.target.value ? parseFloat(e.target.value) : null
        })}
        className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/30"
      />
      <span className="text-white/70 min-w-[60px]">
        {formData.aiProbability !== null
          ? `${Math.round(formData.aiProbability * 100)}%`
          : '使用默认'}
      </span>
    </div>
    <p className="text-xs text-white/50">
      AI响应普通消息的概率 (0.0-1.0)，设置为0则完全不响应
    </p>
  </div>

  {/* 上下文限制 */}
  <div className="space-y-2">
    <label className="block text-sm font-medium text-white/90">
      上下文对话轮数 (留空使用全局默认)
    </label>
    <input
      type="number"
      min="1"
      max="100"
      value={formData.aiContextLimit ?? ''}
      placeholder={`全局默认: ${globalAiConfig.aiContextLimit}`}
      onChange={(e) => setFormData({
        ...formData,
        aiContextLimit: e.target.value ? parseInt(e.target.value) : null
      })}
      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/30"
    />
    <p className="text-xs text-white/50">
      AI对话时记忆的上下文轮数，影响token消耗
    </p>
  </div>
</div>
```

**Step 5: 保存时包含AI字段**

修改 `dashboard/src/pages/Groups.jsx` 第176-202行的保存函数：

```javascript
const handleSave = async () => {
    // ...
    try {
        await api.post(`/api/groups/${selectedGroupId}/config`, {
            linkCacheTimeout: formData.linkCacheTimeout,
            labelConfig: formData.labelConfig,
            enableCookieSync: formData.enableCookieSync,
            cookieSyncGroupNames: formData.cookieSyncGroupNames,
            blacklistedQQs: formData.blacklistedQQs,
            // 包含AI配置（null值也要发送，表示清除覆盖）
            aiProbability: formData.aiProbability,
            aiContextLimit: formData.aiContextLimit
        });
        // ...
    }
};
```

**Step 6: 后端保存端点接受AI字段**

修改 `src/dashboard/routes/api.js` 第145-160行：

```javascript
// POST /api/groups/:id/config - Update group config
router.post('/groups/:id/config', authenticateToken, async (req, res) => {
    try {
        const groupId = parseInt(req.params.id);
        const {
            linkCacheTimeout,
            labelConfig,
            enableCookieSync,
            cookieSyncGroupNames,
            blacklistedQQs,
            aiProbability,      // 新增
            aiContextLimit      // 新增
        } = req.body;

        // 更新配置
        config.setGroupConfig(groupId, 'linkCacheTimeout', linkCacheTimeout);
        config.setGroupConfig(groupId, 'labelConfig', labelConfig);
        config.setGroupConfig(groupId, 'enableCookieSync', enableCookieSync);
        config.setGroupConfig(groupId, 'cookieSyncGroupNames', cookieSyncGroupNames);
        config.setGroupConfig(groupId, 'blacklistedQQs', blacklistedQQs);

        // 保存AI配置（null表示清除覆盖，使用全局默认）
        if (aiProbability !== undefined) {
            if (aiProbability === null) {
                delete config.groupConfigs[groupId].aiProbability;
            } else {
                config.setGroupConfig(groupId, 'aiProbability', aiProbability);
            }
        }

        if (aiContextLimit !== undefined) {
            if (aiContextLimit === null) {
                delete config.groupConfigs[groupId].aiContextLimit;
            } else {
                config.setGroupConfig(groupId, 'aiContextLimit', aiContextLimit);
            }
        }

        res.json({ success: true });
    } catch (error) {
        logger.error('Error updating group config:', error);
        res.status(500).json({ error: 'Failed to update config' });
    }
});
```

**Step 7: 测试功能**

1. 启动服务: `npm start`
2. 访问群组管理页面
3. 选择一个群组，切换到"群组设置"Tab
4. 滚动到底部，应看到"AI 响应配置"区域
5. 测试场景：
   - 留空：显示占位符"全局默认: 10%"
   - 输入 `0.5`：显示"50%"
   - 保存后刷新，值正确显示
   - 清空输入框，保存，刷新后显示为空（使用全局默认）
6. 检查 `config.json` 中该群组的配置

**Step 8: Commit**

```bash
git add dashboard/src/pages/Groups.jsx src/dashboard/routes/api.js
git commit -m "feat(ui): 群组配置添加AI响应字段

- 添加 aiProbability 和 aiContextLimit 群组级配置
- UI显示全局默认值占位符
- null值表示使用全局默认
- 支持保存和清除群组级覆盖"
```

---

## Task 6: B站登录状态持久化显示

**Priority:** P1 (功能增强)
**Estimated Time:** 35分钟

**Files:**
- Modify: `dashboard/src/pages/Groups.jsx:43-48` (新增状态)
- Modify: `dashboard/src/pages/Groups.jsx:147-159` (加载登录状态)
- Modify: `dashboard/src/pages/Groups.jsx:314-338` (登录成功后获取用户信息)
- Modify: `dashboard/src/pages/Groups.jsx:688-735` (UI显示)
- Modify: `src/services/bili_server.py:1143-1152` (确保API正常)

**Step 1: 添加用户信息状态**

修改 `dashboard/src/pages/Groups.jsx` 第43-48行：

```javascript
// Login State
const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
const [loginQrCode, setLoginQrCode] = useState('');
const [loginKey, setLoginKey] = useState('');
const [loginStatus, setLoginStatus] = useState('idle'); // idle, waiting, success, expired
const checkLoginTimerRef = useRef(null);

// 新增：B站用户信息状态
const [biliUserInfo, setBiliUserInfo] = useState(null); // { mid, name, face }
```

**Step 2: 页面加载时检查现有登录**

修改 `dashboard/src/pages/Groups.jsx` 第147-159行的useEffect：

```javascript
useEffect(() => {
    if (selectedGroupId !== null && groups.length > 0) {
        // ... 加载群组配置

        // 检查Tab切换
        if (selectedTabIndex === 1) {
            fetchSubscriptions(selectedGroupId);
        } else if (selectedTabIndex === 2) {
            fetchBiliGroups(selectedGroupId);

            // 新增：检查B站登录状态
            checkExistingLogin(selectedGroupId);
        }
    }
}, [selectedGroupId, groups, selectedTabIndex]);

// 新增函数：检查现有登录
const checkExistingLogin = async (groupId) => {
    try {
        const res = await api.get(`/api/bili/my-info?groupId=${groupId}`);
        if (res.data && res.data.status === 'success' && res.data.data) {
            setBiliUserInfo({
                mid: res.data.data.mid,
                name: res.data.data.name,
                face: res.data.data.face
            });
        } else {
            // 未登录或cookie过期
            setBiliUserInfo(null);
        }
    } catch (err) {
        // API调用失败，视为未登录
        setBiliUserInfo(null);
    }
};
```

**Step 3: 登录成功后获取用户信息**

修改 `dashboard/src/pages/Groups.jsx` 第314-338行的checkLoginStatus：

```javascript
const checkLoginStatus = async (key) => {
    try {
        const res = await api.post('/api/bili/check-login', { key, groupId: selectedGroupId });
        const status = res.data.data ? res.data.data.status : res.data.status;

        if (status === 'success') {
            clearInterval(checkLoginTimerRef.current);
            setLoginStatus('success');
            show('登录成功！', 'success');

            // 新增：获取用户信息
            try {
                const userRes = await api.get(`/api/bili/my-info?groupId=${selectedGroupId}`);
                if (userRes.data && userRes.data.status === 'success') {
                    setBiliUserInfo({
                        mid: userRes.data.data.mid,
                        name: userRes.data.data.name,
                        face: userRes.data.data.face
                    });
                }
            } catch (err) {
                console.error('Failed to fetch user info:', err);
            }

            setTimeout(() => {
                setIsLoginModalOpen(false);
                fetchBiliGroups(selectedGroupId);
            }, 1500);
        } else if (status === 'expired') {
            // handle expiry
        }
    } catch (err) {
        console.error('Check login error', err);
    }
};
```

**Step 4: 添加登出功能**

在 `dashboard/src/pages/Groups.jsx` 添加登出处理（约第350行）：

```javascript
const handleLogout = async () => {
    if (!window.confirm('确定要登出吗？这将清除该群组的B站登录信息。')) {
        return;
    }

    try {
        await api.post(`/api/bili/logout`, { groupId: selectedGroupId });
        setBiliUserInfo(null);
        setBiliGroups([]);
        setFormData({
            ...formData,
            enableCookieSync: false,
            cookieSyncGroupNames: []
        });
        show('已登出', 'success');
    } catch (err) {
        console.error('Logout error:', err);
        show('登出失败', 'error');
    }
};
```

**Step 5: 修改UI显示（登录/已登录状态）**

修改 `dashboard/src/pages/Groups.jsx` 第688-735行（登录按钮区域）：

```jsx
{/* B站登录状态 */}
<div className="space-y-4">
  {biliUserInfo ? (
    /* 已登录状态 */
    <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
      <div className="flex items-center gap-3">
        <img
          src={biliUserInfo.face}
          alt={biliUserInfo.name}
          className="w-12 h-12 rounded-full border-2 border-green-400"
        />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
            <span className="text-green-400 text-sm font-medium">已登录</span>
          </div>
          <div className="text-white font-medium mt-1">{biliUserInfo.name}</div>
          <div className="text-white/50 text-xs">UID: {biliUserInfo.mid}</div>
        </div>
        <button
          onClick={handleLogout}
          className="px-3 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition-colors flex items-center gap-2"
        >
          <LogOut className="w-4 h-4" />
          <span className="text-sm">登出</span>
        </button>
      </div>
    </div>
  ) : (
    /* 未登录状态 */
    <button
      onClick={startLogin}
      className="w-full px-4 py-3 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded-lg transition-colors flex items-center justify-center gap-2"
    >
      <QrCode className="w-5 h-5" />
      <span>扫码登录 Bilibili</span>
    </button>
  )}

  {/* 关注分组列表（仅登录后显示） */}
  {biliUserInfo && (
    <div className="space-y-2">
      {/* ... 现有的关注分组UI ... */}
    </div>
  )}
</div>
```

**Step 6: 添加后端API端点**

在 `src/dashboard/routes/api.js` 添加（约第250行）：

```javascript
// GET /api/bili/my-info - Get current logged-in user info
router.get('/bili/my-info', async (req, res) => {
    try {
        const groupId = req.query.groupId ? parseInt(req.query.groupId) : null;
        const result = await biliApi.getMyInfo(groupId);
        res.json(result);
    } catch (error) {
        logger.error('Error getting my info:', error);
        res.status(500).json({ error: 'Failed to get user info' });
    }
});

// POST /api/bili/logout - Logout (clear cookies)
router.post('/bili/logout', async (req, res) => {
    try {
        const { groupId } = req.body;

        // 删除cookie文件
        const fs = require('fs').promises;
        const cookieFile = groupId
            ? `data/cookies_${groupId}.json`
            : 'data/cookies.json';

        try {
            await fs.unlink(cookieFile);
        } catch (err) {
            // 文件不存在也算成功
        }

        // 如果是群组cookie，更新映射文件
        if (groupId) {
            const mapFile = 'data/cookies_map.json';
            try {
                const mapData = JSON.parse(await fs.readFile(mapFile, 'utf-8'));
                delete mapData[String(groupId)];
                await fs.writeFile(mapFile, JSON.stringify(mapData, null, 4));
            } catch (err) {
                // 映射文件不存在或格式错误，忽略
            }
        }

        res.json({ success: true });
    } catch (error) {
        logger.error('Error logging out:', error);
        res.status(500).json({ error: 'Failed to logout' });
    }
});
```

**Step 7: 导入LogOut图标**

在 `dashboard/src/pages/Groups.jsx` 第7行添加：

```javascript
import { Save, Power, Settings, Cpu, RefreshCw, MessageSquare, Bell, Ban, Trash2, Plus, QrCode, Loader2, LogOut } from 'lucide-react';
```

**Step 8: 测试功能**

1. 清除现有cookie: `rm data/cookies_*.json data/cookies_map.json`
2. 启动服务: `npm start`
3. 访问群组管理 -> 同步分组Tab
4. 测试场景：
   - 未登录：显示"扫码登录 Bilibili"按钮
   - 点击登录，扫码成功后：
     - 显示用户头像、名称、UID
     - 显示绿色"已登录"状态点
     - 显示"登出"按钮
   - 刷新页面：登录状态保持
   - 点击登出：清除状态，显示登录按钮
   - 重启Bot：登录状态保持

**Step 9: Commit**

```bash
git add dashboard/src/pages/Groups.jsx src/dashboard/routes/api.js
git commit -m "feat(ui): B站登录状态持久化显示

- 登录后显示用户头像、名称、UID
- 页面加载时自动检查登录状态
- 添加登出功能，清除cookie文件
- 新增 /api/bili/my-info 和 /api/bili/logout 端点
- 优化UI：绿色状态指示器+动画"
```

---

## Task 7: 新增对话/向量化API配置

**Priority:** P2 (功能增强)
**Estimated Time:** 45分钟

**Files:**
- Modify: `src/config.js:97-110` (新增META字段)
- Modify: `dashboard/src/pages/Settings.jsx:74-91` (状态)
- Modify: `dashboard/src/pages/Settings.jsx:432-532` (UI)
- Modify: `src/dashboard/routes/api.js:290-320` (重置端点)

**Step 1: 后端添加配置字段**

修改 `src/config.js` 第97-110行，在AI配置区域添加：

```javascript
// === AI 配置 ===
// 现有字段保留
aiApiUrl: { env: 'AI_API_URL', def: null, type: 'string' },
aiApiKey: { env: 'AI_API_KEY', def: null, type: 'string' },
aiModel: { env: 'AI_MODEL', def: 'gpt-3.5-turbo', type: 'string' },
aiSystemPrompt: { env: 'AI_SYSTEM_PROMPT', def: '你是一个有用的助手', type: 'string' },

// 新增：对话服务配置（优先级高于上述通用配置）
aiChatApiUrl: { env: 'AI_CHAT_API_URL', def: null, type: 'string' },
aiChatApiKey: { env: 'AI_CHAT_API_KEY', def: null, type: 'string' },
aiChatModel: { env: 'AI_CHAT_MODEL', def: 'gpt-3.5-turbo', type: 'string' },
aiChatProxy: { env: 'AI_CHAT_PROXY', def: null, type: 'string' },
aiChatSystemPrompt: { env: 'AI_CHAT_SYSTEM_PROMPT', def: '你是一个有用的助手', type: 'string' },

// 新增：向量化服务配置
aiEmbeddingApiUrl: { env: 'AI_EMBEDDING_API_URL', def: null, type: 'string' },
aiEmbeddingApiKey: { env: 'AI_EMBEDDING_API_KEY', def: null, type: 'string' },
aiEmbeddingModel: { env: 'AI_EMBEDDING_MODEL', def: 'text-embedding-3-small', type: 'string' },
aiEmbeddingProxy: { env: 'AI_EMBEDDING_PROXY', def: null, type: 'string' },

// 现有其他AI配置...
aiProbability: { env: 'AI_PROBABILITY', def: 0.1, type: 'float' },
aiContextLimit: { env: null, def: 10, type: 'int' },
// ...
```

**Step 2: 前端添加配置状态**

修改 `dashboard/src/pages/Settings.jsx` 第74-91行：

```javascript
const [aiProbability, setAiProbability] = useState(0.1);
const [aiContextLimit, setAiContextLimit] = useState(10);
const [aiHistoryMaxSize, setAiHistoryMaxSize] = useState(200 * 1024 * 1024);
const [aiEnableVectorCache, setAiEnableVectorCache] = useState(true);
const [aiVectorSimilarityThreshold, setAiVectorSimilarityThreshold] = useState(0.4);
const [aiVectorSearchLimit, setAiVectorSearchLimit] = useState(3);
const [aiMemorySafetyLimit, setAiMemorySafetyLimit] = useState(5000);

// 新增：对话服务配置
const [aiChatApiUrl, setAiChatApiUrl] = useState('');
const [aiChatApiKey, setAiChatApiKey] = useState('');
const [aiChatModel, setAiChatModel] = useState('gpt-3.5-turbo');
const [aiChatProxy, setAiChatProxy] = useState('');
const [aiChatSystemPrompt, setAiChatSystemPrompt] = useState('你是一个有用的助手');

// 新增：向量化服务配置
const [aiEmbeddingApiUrl, setAiEmbeddingApiUrl] = useState('');
const [aiEmbeddingApiKey, setAiEmbeddingApiKey] = useState('');
const [aiEmbeddingModel, setAiEmbeddingModel] = useState('text-embedding-3-small');
const [aiEmbeddingProxy, setAiEmbeddingProxy] = useState('');
```

**Step 3: 加载配置时读取新字段**

修改 `dashboard/src/pages/Settings.jsx` 的fetchConfig函数（约第120行）：

```javascript
const fetchConfig = async () => {
    try {
        const res = await api.get('/api/config');
        if (res.data) {
            // ... 现有字段加载

            // 对话服务配置
            setAiChatApiUrl(res.data.aiChatApiUrl || '');
            setAiChatApiKey(res.data.aiChatApiKey || '');
            setAiChatModel(res.data.aiChatModel || 'gpt-3.5-turbo');
            setAiChatProxy(res.data.aiChatProxy || '');
            setAiChatSystemPrompt(res.data.aiChatSystemPrompt || '你是一个有用的助手');

            // 向量化服务配置
            setAiEmbeddingApiUrl(res.data.aiEmbeddingApiUrl || '');
            setAiEmbeddingApiKey(res.data.aiEmbeddingApiKey || '');
            setAiEmbeddingModel(res.data.aiEmbeddingModel || 'text-embedding-3-small');
            setAiEmbeddingProxy(res.data.aiEmbeddingProxy || '');
        }
    } catch (err) {
        console.error('Failed to fetch config:', err);
    }
};
```

**Step 4: 添加UI组件（在AI配置Tab中）**

修改 `dashboard/src/pages/Settings.jsx` 第432-532行，在现有AI配置后添加：

```jsx
{/* === 对话服务配置 === */}
<div className="space-y-4 pt-6 border-t border-white/10">
  <div className="flex items-center gap-2">
    <MessageSquare className="w-5 h-5 text-blue-400" />
    <h3 className="text-lg font-semibold text-white">对话服务配置</h3>
  </div>

  <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
    <p className="text-sm text-white/70">
      配置AI对话API。留空则使用通用AI配置 (aiApiUrl/aiApiKey)。
    </p>
  </div>

  {/* API端点 */}
  <div className="space-y-2">
    <label className="block text-sm font-medium text-white/90">
      API 端点
    </label>
    <input
      type="text"
      value={aiChatApiUrl}
      onChange={(e) => setAiChatApiUrl(e.target.value)}
      placeholder="https://api.openai.com/v1"
      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/30"
    />
  </div>

  {/* API Key */}
  <div className="space-y-2">
    <label className="block text-sm font-medium text-white/90">
      API Key
    </label>
    <input
      type="password"
      value={aiChatApiKey}
      onChange={(e) => setAiChatApiKey(e.target.value)}
      placeholder="sk-..."
      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/30"
    />
  </div>

  {/* 模型 */}
  <div className="space-y-2">
    <label className="block text-sm font-medium text-white/90">
      模型名称
    </label>
    <input
      type="text"
      value={aiChatModel}
      onChange={(e) => setAiChatModel(e.target.value)}
      placeholder="gpt-3.5-turbo"
      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/30"
    />
  </div>

  {/* 代理 */}
  <div className="space-y-2">
    <label className="block text-sm font-medium text-white/90">
      代理地址 (可选)
    </label>
    <input
      type="text"
      value={aiChatProxy}
      onChange={(e) => setAiChatProxy(e.target.value)}
      placeholder="http://proxy.example.com:7890"
      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/30"
    />
    <p className="text-xs text-white/50">
      HTTP/HTTPS代理，格式: http://host:port
    </p>
  </div>

  {/* 系统提示词 */}
  <div className="space-y-2">
    <label className="block text-sm font-medium text-white/90">
      系统提示词
    </label>
    <textarea
      value={aiChatSystemPrompt}
      onChange={(e) => setAiChatSystemPrompt(e.target.value)}
      rows={4}
      placeholder="你是一个有用的助手"
      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/30 resize-none"
    />
    <p className="text-xs text-white/50">
      定义AI的角色和行为方式
    </p>
  </div>
</div>

{/* === 向量化服务配置 === */}
<div className="space-y-4 pt-6 border-t border-white/10">
  <div className="flex items-center gap-2">
    <Cpu className="w-5 h-5 text-purple-400" />
    <h3 className="text-lg font-semibold text-white">向量化服务配置</h3>
  </div>

  <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-4">
    <p className="text-sm text-white/70">
      配置文本向量化API（用于相似度搜索）。留空则使用对话服务配置。
    </p>
  </div>

  {/* API端点 */}
  <div className="space-y-2">
    <label className="block text-sm font-medium text-white/90">
      API 端点
    </label>
    <input
      type="text"
      value={aiEmbeddingApiUrl}
      onChange={(e) => setAiEmbeddingApiUrl(e.target.value)}
      placeholder="https://api.openai.com/v1"
      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/30"
    />
  </div>

  {/* API Key */}
  <div className="space-y-2">
    <label className="block text-sm font-medium text-white/90">
      API Key
    </label>
    <input
      type="password"
      value={aiEmbeddingApiKey}
      onChange={(e) => setAiEmbeddingApiKey(e.target.value)}
      placeholder="sk-..."
      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/30"
    />
  </div>

  {/* 模型 */}
  <div className="space-y-2">
    <label className="block text-sm font-medium text-white/90">
      模型名称
    </label>
    <input
      type="text"
      value={aiEmbeddingModel}
      onChange={(e) => setAiEmbeddingModel(e.target.value)}
      placeholder="text-embedding-3-small"
      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/30"
    />
  </div>

  {/* 代理 */}
  <div className="space-y-2">
    <label className="block text-sm font-medium text-white/90">
      代理地址 (可选)
    </label>
    <input
      type="text"
      value={aiEmbeddingProxy}
      onChange={(e) => setAiEmbeddingProxy(e.target.value)}
      placeholder="http://proxy.example.com:7890"
      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/30"
    />
  </div>
</div>
```

**Step 5: 保存时包含新字段**

修改 `dashboard/src/pages/Settings.jsx` 的handleSaveAI函数（约第184行）：

```javascript
const handleSaveAI = async () => {
    setSaving(true);
    try {
        await api.post('/api/ai', {
            aiProbability,
            aiContextLimit,
            aiHistoryMaxSize,
            aiEnableVectorCache,
            aiVectorSimilarityThreshold,
            aiVectorSearchLimit,
            aiMemorySafetyLimit,
            // 新增字段
            aiChatApiUrl,
            aiChatApiKey,
            aiChatModel,
            aiChatProxy,
            aiChatSystemPrompt,
            aiEmbeddingApiUrl,
            aiEmbeddingApiKey,
            aiEmbeddingModel,
            aiEmbeddingProxy
        });
        show('AI配置已保存', 'success');
    } catch (err) {
        console.error('Failed to save AI config:', err);
        show('保存失败', 'error');
    } finally {
        setSaving(false);
    }
};
```

**Step 6: 更新重置端点**

修改 `src/dashboard/routes/api.js` 第290-320行的重置端点：

```javascript
// POST /api/ai/reset - Reset AI settings to .env defaults
router.post('/ai/reset', authenticateToken, async (req, res) => {
    try {
        const aiFields = [
            // 通用配置
            'aiApiUrl', 'aiApiKey', 'aiModel', 'aiSystemPrompt',
            // 对话服务
            'aiChatApiUrl', 'aiChatApiKey', 'aiChatModel', 'aiChatProxy', 'aiChatSystemPrompt',
            // 向量化服务
            'aiEmbeddingApiUrl', 'aiEmbeddingApiKey', 'aiEmbeddingModel', 'aiEmbeddingProxy',
            // 其他AI配置
            'aiProbability', 'aiContextLimit', 'aiHistoryMaxSize',
            'aiEnableVectorCache', 'aiVectorSimilarityThreshold',
            'aiVectorSearchLimit', 'aiMemorySafetyLimit', 'aiVectorMaxSize'
        ];

        // 删除config.json中的覆盖值，回退到.env或默认值
        aiFields.forEach(field => {
            delete config._overrides[field];
        });

        // 触发保存
        config.save();

        // 返回重置后的值
        const resetValues = {};
        aiFields.forEach(field => {
            resetValues[field] = config[field];
        });

        res.json({ success: true, values: resetValues });
    } catch (error) {
        logger.error('Error resetting AI config:', error);
        res.status(500).json({ error: 'Failed to reset AI config' });
    }
});
```

**Step 7: 更新重置按钮处理**

修改 `dashboard/src/pages/Settings.jsx` 的handleResetAI函数（约第202行）：

```javascript
const handleResetAI = async () => {
    if (!window.confirm('确定要重置所有AI配置为默认值吗？')) {
        return;
    }

    try {
        const res = await api.post('/api/ai/reset');
        if (res.data && res.data.values) {
            // 使用返回的重置值更新状态
            const v = res.data.values;
            setAiProbability(v.aiProbability || 0.1);
            setAiContextLimit(v.aiContextLimit || 10);
            setAiHistoryMaxSize(v.aiHistoryMaxSize || 200 * 1024 * 1024);
            setAiEnableVectorCache(v.aiEnableVectorCache ?? true);
            setAiVectorSimilarityThreshold(v.aiVectorSimilarityThreshold || 0.4);
            setAiVectorSearchLimit(v.aiVectorSearchLimit || 3);
            setAiMemorySafetyLimit(v.aiMemorySafetyLimit || 5000);

            // 对话服务
            setAiChatApiUrl(v.aiChatApiUrl || '');
            setAiChatApiKey(v.aiChatApiKey || '');
            setAiChatModel(v.aiChatModel || 'gpt-3.5-turbo');
            setAiChatProxy(v.aiChatProxy || '');
            setAiChatSystemPrompt(v.aiChatSystemPrompt || '你是一个有用的助手');

            // 向量化服务
            setAiEmbeddingApiUrl(v.aiEmbeddingApiUrl || '');
            setAiEmbeddingApiKey(v.aiEmbeddingApiKey || '');
            setAiEmbeddingModel(v.aiEmbeddingModel || 'text-embedding-3-small');
            setAiEmbeddingProxy(v.aiEmbeddingProxy || '');
        }

        show('已重置为默认值', 'success');
    } catch (err) {
        console.error('Failed to reset AI config:', err);
        show('重置失败', 'error');
    }
};
```

**Step 8: 测试功能**

1. 启动服务: `npm start`
2. 访问系统设置 -> AI配置Tab
3. 滚动查看新增的两个配置区域
4. 测试场景：
   - 填写对话服务配置，保存，刷新页面确认保存成功
   - 填写向量化服务配置，保存
   - 点击"重置为默认值"，确认所有字段清空或恢复默认
   - 检查 `config.json` 文件中的字段
5. 测试配置读取优先级（可选）：
   - 配置 `.env` 中的 `AI_CHAT_API_URL`
   - 重置配置，确认读取到环境变量值

**Step 9: Commit**

```bash
git add src/config.js dashboard/src/pages/Settings.jsx src/dashboard/routes/api.js
git commit -m "feat(ai): 新增对话/向量化API分离配置

- 添加对话服务配置: URL, Key, Model, Proxy, SystemPrompt
- 添加向量化服务配置: URL, Key, Model, Proxy
- 支持独立配置或回退到通用配置
- 重置功能包含所有新增字段
- UI分区显示，清晰区分对话和向量化服务"
```

---

## 测试与验证

### 集成测试清单

**基础功能测试：**

1. **单位转换**
   - [ ] AI配置显示200 MB而非bytes
   - [ ] 输入500，保存后为524288000 bytes
   - [ ] 刷新页面值正确显示

2. **群组列表**
   - [ ] 禁用群组后刷新仍显示（半透明）
   - [ ] 启用/禁用状态正确切换
   - [ ] 样式正确（绿色/灰色电源图标）

3. **自动创建配置**
   - [ ] Bot加入新群自动创建配置
   - [ ] 配置包含所有默认字段
   - [ ] 日志输出创建提示

4. **订阅推送文本**
   - [ ] 订阅推送包含完整文本
   - [ ] 手动链接和订阅推送截图一致
   - [ ] 话题标签正确显示

**功能增强测试：**

5. **群组AI配置**
   - [ ] 显示全局默认值占位符
   - [ ] 保存群组级配置
   - [ ] 清空输入框回退到全局默认
   - [ ] 后端 `getGroupConfig()` 正确读取优先级

6. **B站登录状态**
   - [ ] 未登录显示登录按钮
   - [ ] 扫码登录后显示用户信息
   - [ ] 刷新页面状态保持
   - [ ] 重启Bot状态保持
   - [ ] 登出功能正常

7. **AI API配置**
   - [ ] 对话服务配置保存/加载
   - [ ] 向量化服务配置保存/加载
   - [ ] 重置功能清空所有字段
   - [ ] .env环境变量正确读取

**回归测试：**

- [ ] 现有功能未受影响（链接解析、消息发送等）
- [ ] 配置文件格式正确
- [ ] 无JavaScript错误
- [ ] 无内存泄漏

---

## 部署与回滚

### 部署步骤

```bash
# 1. 停止服务
pm2 stop bili-qq-bot

# 2. 备份配置
cp config.json config.json.bak
cp data/cookies_map.json data/cookies_map.json.bak

# 3. 拉取代码
git pull origin main

# 4. 安装依赖（如有变更）
npm install
cd dashboard && npm install && npm run build && cd ..

# 5. 启动服务
pm2 start bili-qq-bot

# 6. 监控日志
pm2 logs bili-qq-bot
```

### 回滚步骤

```bash
# 1. 停止服务
pm2 stop bili-qq-bot

# 2. 回滚代码
git reset --hard <previous-commit>

# 3. 恢复配置
cp config.json.bak config.json
cp data/cookies_map.json.bak data/cookies_map.json

# 4. 重新构建（如需要）
cd dashboard && npm run build && cd ..

# 5. 启动服务
pm2 start bili-qq-bot
```

---

## 附录

### 文件修改清单

| 文件 | 修改类型 | 任务 |
|------|---------|------|
| `dashboard/src/pages/Settings.jsx` | 修改 | Task 1, 7 |
| `src/dashboard/routes/api.js` | 修改 | Task 2, 5, 6, 7 |
| `dashboard/src/pages/Groups.jsx` | 修改 | Task 2, 5, 6 |
| `src/config.js` | 修改 | Task 3, 7 |
| `src/bot.js` | 修改 | Task 3 |
| `src/services/bili_server.py` | 修改 | Task 4 |

### 配置优先级示意图

```
运行时读取AI配置:
┌─────────────────────────────────────────┐
│ aiHandler.js 调用:                      │
│ config.getGroupConfig(groupId, 'xxx')  │
└──────────────┬──────────────────────────┘
               │
               ▼
    ┌──────────────────────┐
    │ 群组配置存在？        │
    └──────┬───────────┬───┘
           │ Yes       │ No
           ▼           ▼
    ┌──────────┐  ┌──────────┐
    │ 返回群组值│  │ 返回全局值│
    └──────────┘  └─────┬────┘
                        │
                        ▼
                 ┌──────────────┐
                 │ 全局值存在？  │
                 └──┬────────┬──┘
                    │ Yes    │ No
                    ▼        ▼
              ┌─────────┐ ┌─────┐
              │config.xxx│ │.env │
              └─────────┘ └──┬──┘
                             │ No
                             ▼
                          ┌─────┐
                          │ def │
                          └─────┘
```

### 数据库结构（JSON配置文件）

**config.json 示例：**
```json
{
  "enabledGroups": [123456, 789012],
  "groupConfigs": {
    "123456": {
      "linkCacheTimeout": 5,
      "labelConfig": { ... },
      "aiProbability": 0.3,
      "aiContextLimit": 20
    }
  },
  "aiChatApiUrl": "https://api.deepseek.com/v1",
  "aiChatApiKey": "sk-...",
  "aiEmbeddingApiUrl": "https://api.openai.com/v1",
  "aiEmbeddingApiKey": "sk-..."
}
```

**cookies_map.json 示例：**
```json
{
  "123456": "data/cookies_123456.json",
  "789012": "data/cookies_789012.json"
}
```

---

## 预期成果

完成本计划后，系统将具备：

1. ✅ **更友好的UI** - 单位显示优化，群组列表稳定
2. ✅ **更智能的配置** - 自动初始化，分层架构
3. ✅ **完整的数据** - 订阅推送包含完整文本内容
4. ✅ **灵活的AI配置** - 群组级覆盖，服务分离配置
5. ✅ **持久化登录** - B站登录状态跨重启保持

总代码变更：约800行（新增400行，修改400行）
预计测试时间：2小时
预计上线时间：所有测试通过后立即上线
