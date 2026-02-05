# Feature Enhancements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add AI function toggles (global+group), optimize feed deduplication, restrict private chat to root admin, simplify cookie management, and fix groupId type consistency.

**Architecture:** Five independent modules with minimal cross-dependencies. GroupId fix is foundational and should be completed first. AI toggles use config layer with getter functions. Feed deduplication uses type filtering in subscription checker. Private chat uses early-return pattern. Cookie simplification removes group-level logic.

**Tech Stack:** Node.js, Express, React, Python (bilibili-api), WebSocket (OneBot v11), Puppeteer

---

## Prerequisites

**Branch:** `feature-enhancements-2026` (create from `security-fixes-2026` or `main`)

**Design Document:** `docs/plans/2026-02-05-feature-enhancements-design.md`

**Testing Tool:** `test_dynamic_types.js` (already created and verified)

---

## Task 1: GroupId Type Unification

**Files:**
- Modify: `src/handlers/messageHandler.js:16`
- Modify: `src/dashboard/routes/api.js` (multiple locations)
- Modify: `src/services/subscription/updateChecker.js:140-146`

### Step 1.1: Fix messageHandler.js groupId conversion

**Edit:** `src/handlers/messageHandler.js:16`

```javascript
// OLD:
let groupId = messageData.group_id;

// NEW:
let groupId = messageData.group_id ? String(messageData.group_id) : null;
```

### Step 1.2: Add groupId conversion helper to Dashboard API

**Edit:** `src/dashboard/routes/api.js` - Add at top of file after requires

```javascript
// Helper: Convert groupId from request params to string
function normalizeGroupId(groupId) {
    return groupId ? String(groupId) : null;
}
```

### Step 1.3: Apply normalizeGroupId to all Dashboard API routes

**Edit:** `src/dashboard/routes/api.js` - Find all occurrences of `req.params.groupId`

Add normalization at the start of each route handler:

```javascript
// Example pattern (apply to all routes):
router.get('/groups/:groupId/config', authenticateToken, (req, res) => {
    const groupId = normalizeGroupId(req.params.groupId);  // ADD THIS LINE
    // ... rest of handler
});
```

**Routes to modify:**
- GET `/groups/:groupId`
- GET `/groups/:groupId/config`
- PUT `/groups/:groupId/config`
- DELETE `/groups/:groupId/cookies` (will be removed later, but fix for now)
- Any other route using `:groupId` parameter

### Step 1.4: Verify updateChecker.js already handles strings

**Read:** `src/services/subscription/updateChecker.js:140-146`

Verify that groupIds from `config.groupConfigs` are already strings (they are, since config.js stores string keys). No changes needed here.

### Step 1.5: Test groupId conversion

**Manual Test:**
1. Send a group message via QQ
2. Check logs: `[MessageHandler] Received message from User X in Group Y`
3. Verify Y is logged as a string (no type error in subsequent operations)
4. Test Dashboard: Open group config for a numeric groupId
5. Verify config loads correctly

### Step 1.6: Commit

```bash
git add src/handlers/messageHandler.js src/dashboard/routes/api.js
git commit -m "fix: 统一groupId类型为字符串

- messageHandler入口立即转换为字符串
- Dashboard API添加normalizeGroupId辅助函数
- 确保全局类型一致性，修复config访问问题"
```

---

## Task 2: AI Function Toggles - Backend Config Layer

**Files:**
- Modify: `src/config.js:91-104` (META section)
- Modify: `src/config.js:490` (after module.exports, add helper functions)

### Step 2.1: Add global AI toggle config to META

**Edit:** `src/config.js:91-104` - Add after existing AI config

```javascript
// AI Function Toggles
aiEnabled: { env: 'AI_ENABLED', def: true, type: 'bool' },
aiRagEnabled: { env: 'AI_RAG_ENABLED', def: true, type: 'bool' },
```

### Step 2.2: Add AI toggle helper functions

**Edit:** `src/config.js:490` - Add before `module.exports`

```javascript
/**
 * Check if AI is enabled for a specific group
 * @param {string} groupId - Group ID
 * @returns {boolean} - True if AI is enabled for this group
 */
function isAiEnabledForGroup(groupId) {
    // 1. Global AI switch must be on
    if (!sysConfig.aiEnabled) {
        return false;
    }

    // 2. Check group-level override
    const groupConfig = sysConfig.groupConfigs[String(groupId)];
    if (groupConfig && 'aiEnabled' in groupConfig) {
        return groupConfig.aiEnabled;
    }

    // 3. Default: inherit global setting
    return true;
}

/**
 * Check if RAG is enabled for a specific group
 * @param {string} groupId - Group ID
 * @returns {boolean} - True if RAG is enabled for this group
 */
function isRagEnabledForGroup(groupId) {
    // 1. AI must be enabled first
    if (!isAiEnabledForGroup(groupId)) {
        return false;
    }

    // 2. Global RAG switch must be on
    if (!sysConfig.aiRagEnabled) {
        return false;
    }

    // 3. Check group-level override
    const groupConfig = sysConfig.groupConfigs[String(groupId)];
    if (groupConfig && 'aiRagEnabled' in groupConfig) {
        return groupConfig.aiRagEnabled;
    }

    // 4. Default: inherit global setting
    return true;
}
```

### Step 2.3: Export helper functions

**Edit:** `src/config.js` - Find `module.exports` and add:

```javascript
module.exports = sysConfig;
module.exports.isAiEnabledForGroup = isAiEnabledForGroup;
module.exports.isRagEnabledForGroup = isRagEnabledForGroup;
```

### Step 2.4: Test config functions

**Create test file:** `test_ai_toggles.js`

```javascript
const config = require('./src/config');

console.log('Testing AI toggle functions...\n');

// Test 1: Global AI enabled (default)
console.log('Test 1: Global AI enabled');
console.log('  aiEnabled:', config.aiEnabled);
console.log('  aiRagEnabled:', config.aiRagEnabled);
console.log('  isAiEnabledForGroup("test"):', config.isAiEnabledForGroup('test'));
console.log('  isRagEnabledForGroup("test"):', config.isRagEnabledForGroup('test'));

// Test 2: Global AI disabled
config.aiEnabled = false;
console.log('\nTest 2: Global AI disabled');
console.log('  isAiEnabledForGroup("test"):', config.isAiEnabledForGroup('test'));
console.log('  isRagEnabledForGroup("test"):', config.isRagEnabledForGroup('test'));

// Test 3: Global AI enabled, group override disabled
config.aiEnabled = true;
config.ensureGroupConfig('test');
config.groupConfigs['test'].aiEnabled = false;
console.log('\nTest 3: Global enabled, group disabled');
console.log('  isAiEnabledForGroup("test"):', config.isAiEnabledForGroup('test'));
console.log('  isRagEnabledForGroup("test"):', config.isRagEnabledForGroup('test'));

console.log('\n✅ All tests completed');
```

**Run:**
```bash
node test_ai_toggles.js
```

**Expected output:**
- Test 1: Both return true
- Test 2: Both return false
- Test 3: Both return false

### Step 2.5: Commit

```bash
git add src/config.js test_ai_toggles.js
git commit -m "feat: 添加AI功能分级开关配置

- 新增全局aiEnabled和aiRagEnabled配置项
- 实现isAiEnabledForGroup和isRagEnabledForGroup辅助函数
- 支持群级override，严格依赖模式（全局>群级，AI>RAG）
- 添加测试脚本验证逻辑"
```

---

## Task 3: AI Function Toggles - Backend Integration

**Files:**
- Modify: `src/handlers/aiHandler.js:180-200` (shouldReply function)
- Modify: `src/handlers/aiHandler.js:250-270` (getReply function)

### Step 3.1: Integrate AI toggle in shouldReply

**Edit:** `src/handlers/aiHandler.js` - Find `shouldReply` function

**Add at the beginning of shouldReply:**

```javascript
shouldReply(message, isAt, groupId) {
    // Check if AI is enabled for this group
    if (!config.isAiEnabledForGroup(groupId)) {
        logger.debug(`[AiHandler] AI disabled for group ${groupId}`);
        return false;
    }

    // ... existing logic
}
```

### Step 3.2: Integrate RAG toggle in getReply

**Edit:** `src/handlers/aiHandler.js` - Find `getReply` function

**Find the vector memory search section** (around line with `vectorMemoryService.searchSimilar`):

```javascript
// OLD:
const memories = await vectorMemoryService.searchSimilar(groupId, cleanMsg);

// NEW:
let memories = [];
if (config.isRagEnabledForGroup(groupId)) {
    memories = await vectorMemoryService.searchSimilar(groupId, cleanMsg);
    logger.debug(`[AiHandler] RAG enabled, retrieved ${memories.length} memories`);
} else {
    logger.debug(`[AiHandler] RAG disabled for group ${groupId}`);
}
```

### Step 3.3: Ensure context recording still happens when AI is disabled

**Edit:** `src/handlers/messageHandler.js` - Find AI context recording section

**Verify this code exists** (around line 77):

```javascript
// Record message to AI context (regardless of AI reply)
aiHandler.addMessageToContext(groupId || userId, 'user', rawMessage, userId, userName);
```

This should already be outside the AI reply conditional, so no changes needed. Just verify it's not inside an `if (aiEnabled)` block.

### Step 3.4: Test AI toggles

**Manual Test:**

1. **Test AI disabled globally:**
   - Add to `.env`: `AI_ENABLED=false`
   - Restart bot
   - Send message in group with `@bot` mention
   - Verify: No AI reply (check logs for "AI disabled")

2. **Test RAG disabled globally:**
   - Change `.env`: `AI_ENABLED=true` and `AI_RAG_ENABLED=false`
   - Restart bot
   - Send message to trigger AI
   - Verify: AI replies but logs show "RAG disabled"

3. **Test group-level override:**
   - Set global `AI_ENABLED=true`
   - In config.json, add to a group: `"aiEnabled": false`
   - Restart bot
   - Send message in that group
   - Verify: AI doesn't reply in that group, but works in others

### Step 3.5: Commit

```bash
git add src/handlers/aiHandler.js
git commit -m "feat: 集成AI功能开关到业务逻辑

- shouldReply中检查isAiEnabledForGroup
- getReply中检查isRagEnabledForGroup控制向量搜索
- AI关闭时仍记录消息到context（不影响历史记录）"
```

---

## Task 4: Feed Deduplication Logic

**Files:**
- Modify: `src/services/subscription/updateChecker.js:500` (add new function after isLiveDynamic)
- Modify: `src/services/subscription/updateChecker.js:590` (checkUserDynamic function)
- Modify: `src/services/subscription/updateChecker.js:260` (checkFeedUpdate function)

### Step 4.1: Add shouldSkipDynamic function

**Edit:** `src/services/subscription/updateChecker.js:505` - Add after `isLiveDynamic` function:

```javascript
/**
 * Check if a dynamic should be skipped (video/article auto-post dynamics)
 * @param {object} item - Dynamic item from API
 * @returns {boolean} - True if should skip this dynamic
 */
shouldSkipDynamic(item) {
    if (!item) return false;

    const major = item?.modules?.module_dynamic?.major;

    // Skip video post auto-dynamic
    if (major?.type === 'MAJOR_TYPE_ARCHIVE' || item.type === 'DYNAMIC_TYPE_AV') {
        logger.debug(`[UpdateChecker] Skipping video dynamic: ${item.id_str}`);
        return true;
    }

    // Skip article post auto-dynamic (check for cv ID in jump URL)
    if (major?.type === 'MAJOR_TYPE_OPUS') {
        const jumpUrl = major.opus?.jump_url || '';
        if (/\/read\/cv\d+/i.test(jumpUrl)) {
            logger.debug(`[UpdateChecker] Skipping article dynamic: ${item.id_str}`);
            return true;
        }
    }

    return false;
}
```

### Step 4.2: Apply filter in checkUserDynamic

**Edit:** `src/services/subscription/updateChecker.js` - Find `checkUserDynamic` function

**Find the loop that processes dynamics** (around line 600-650):

```javascript
// Find this pattern:
const data = res.data || {};
const items = data.cards || [];

// Add filter after getting items:
const data = res.data || {};
const allItems = data.cards || [];
const items = allItems.filter(item => !this.shouldSkipDynamic(item));

if (items.length < allItems.length) {
    logger.info(`[UpdateChecker] Filtered ${allItems.length - items.length} auto-post dynamics for ${sub.name}`);
}
```

### Step 4.3: Apply filter in checkFeedUpdate

**Edit:** `src/services/subscription/updateChecker.js` - Find `checkFeedUpdate` function

**Find where feed items are processed** (around line 260-360):

Look for the loop processing feed items. Add the same filter:

```javascript
// Find pattern like:
const feedItems = feedData.items || [];

// Add filter:
const allFeedItems = feedData.items || [];
const feedItems = allFeedItems.filter(item => !this.shouldSkipDynamic(item));

if (feedItems.length < allFeedItems.length) {
    logger.info(`[UpdateChecker] Feed: Filtered ${allFeedItems.length - feedItems.length} auto-post dynamics`);
}
```

### Step 4.4: Test deduplication with test tool

**Run test tool:**
```bash
node test_dynamic_types.js 15156331
```

**Expected output:**
- Should identify 1 video dynamic as "should skip"
- Should identify 4 other dynamics as "should push"

**Verify summary:**
```
- 视频投稿自动动态: 1 条 (应跳过)
- 专栏投稿自动动态: 0 条 (应跳过)
- 其他动态: 4 条 (应推送)
```

### Step 4.5: Test in live subscription

**Manual Test:**

1. Subscribe to an active UP主: `/订阅用户 <UID>`
2. Wait for UP主 to post a video
3. Check notifications:
   - Should receive: Video subscription notification (with video card)
   - Should NOT receive: Dynamic notification for that video
4. If UP主 posts a text/image dynamic: Should receive dynamic notification

### Step 4.6: Commit

```bash
git add src/services/subscription/updateChecker.js
git commit -m "feat: Feed流去重 - 跳过视频/专栏投稿自动动态

- 新增shouldSkipDynamic函数识别自动动态
- 识别规则：MAJOR_TYPE_ARCHIVE（视频）和带cvId的MAJOR_TYPE_OPUS（专栏）
- 应用于checkUserDynamic和checkFeedUpdate
- 已通过test_dynamic_types.js验证识别逻辑"
```

---

## Task 5: Private Chat Restriction

**Files:**
- Modify: `src/handlers/messageHandler.js:14-35` (handleMessage function start)

### Step 5.1: Add sendPrivateMessage helper function

**Edit:** `src/handlers/messageHandler.js` - Add after class definition starts, before `handleMessage`:

```javascript
/**
 * Send a private message to a user
 * @param {WebSocket} ws - WebSocket connection
 * @param {string} userId - User ID
 * @param {string} message - Message text
 */
sendPrivateMessage(ws, userId, message) {
    if (!ws || ws.readyState !== ws.OPEN) {
        logger.warn(`[MessageHandler] Cannot send private message: WebSocket not open`);
        return;
    }

    ws.send(JSON.stringify({
        action: 'send_private_msg',
        params: {
            user_id: userId,
            message: [{ type: 'text', data: { text: message } }]
        }
    }));
}
```

### Step 5.2: Add private chat permission check

**Edit:** `src/handlers/messageHandler.js` - Find `handleMessage` function start

**Add this check right after getting userId** (around line 20-30):

```javascript
async handleMessage(ws, messageData) {
    let userId = String(messageData.user_id || messageData.sender?.user_id);
    let groupId = messageData.group_id ? String(messageData.group_id) : null;
    const userName = messageData.sender?.nickname || messageData.sender?.card || '未知用户';
    const isGroupMessage = messageData.message_type === 'group';

    // 🆕 Private chat permission check
    if (messageData.message_type === 'private') {
        const isRootAdmin = config.isRootAdmin(userId);

        if (!isRootAdmin) {
            // Non-root admin: reject with message
            this.sendPrivateMessage(ws, userId, '此功能仅限管理员使用');
            logger.info(`[MessageHandler] Rejected private message from non-admin user ${userId}`);
            return;
        }

        // Root admin: allow and use virtual groupId
        groupId = `private_${userId}`;
        logger.info(`[MessageHandler] Processing private message from Root Admin ${userId} as virtual group ${groupId}`);
    }

    // ... rest of existing code
}
```

### Step 5.3: Remove old private chat logic (if any)

**Search:** `src/handlers/messageHandler.js` for any other private message handling

Look for patterns like:
- `if (messageType === 'private')`
- `groupId.startsWith('private_')`

**Verify** the existing code around line 30-40 handles the virtual groupId pattern correctly. The code should already check:

```javascript
const isPrivateMsg = typeof groupId === 'string' && groupId.startsWith('private_');
```

This is fine - keep it. Just ensure we don't have duplicate/conflicting private chat logic.

### Step 5.4: Test private chat restriction

**Manual Test:**

1. **Test non-root user:**
   - From a non-root QQ account, send private message to bot
   - Expected: Receive reply "此功能仅限管理员使用"
   - Check logs: See "Rejected private message from non-admin user"

2. **Test root admin:**
   - From ADMIN_QQ account, send private message to bot
   - Expected: Bot processes message normally
   - Check logs: See "Processing private message from Root Admin ... as virtual group private_..."

3. **Test group admin (not root):**
   - From a group admin QQ (in admins list but not ADMIN_QQ)
   - Send private message to bot
   - Expected: Receive rejection message (same as non-root)

### Step 5.5: Commit

```bash
git add src/handlers/messageHandler.js
git commit -m "feat: 私聊限制为仅Root管理员可用

- 新增sendPrivateMessage辅助函数
- handleMessage开头添加私聊权限检查
- 非Root用户收到提示信息并拒绝处理
- Root管理员使用虚拟groupId模式继续处理"
```

---

## Task 6: Cookie Management Simplification - Backend

**Files:**
- Modify: `src/services/bili_server.py:100-150` (load_credential function)
- Modify: `src/dashboard/routes/api.js` (remove group cookie routes)

### Step 6.1: Simplify load_credential to only use global cookie

**Edit:** `src/services/bili_server.py` - Find `load_credential` function

**Find the section that loads group-specific cookies** (look for `cookies_{group_id}.json`):

```python
# OLD CODE (remove or comment out the group cookie logic):
# if group_id:
#     group_cookie_path = os.path.join(cookie_dir, f'cookies_{group_id}.json')
#     if os.path.exists(group_cookie_path):
#         # Load group cookie
#         ...

# Keep only global cookie loading:
def load_credential(group_id=None):
    """Load credential from global cookies.json only"""
    cookie_dir = os.path.join(os.path.dirname(__file__), '../../data')
    cookie_path = os.path.join(cookie_dir, 'cookies.json')

    if os.path.exists(cookie_path):
        with open(cookie_path, 'r', encoding='utf-8') as f:
            cookie_data = json.load(f)
            return Credential(
                sessdata=cookie_data.get('SESSDATA'),
                bili_jct=cookie_data.get('bili_jct'),
                buvid3=cookie_data.get('buvid3'),
                dedeuserid=cookie_data.get('DedeUserID'),
                ac_time_value=cookie_data.get('ac_time_value')
            )

    return Credential()  # Return empty credential if no cookies
```

**Note:** You may need to adjust based on actual implementation. The goal is to remove any `cookies_{group_id}.json` loading logic.

### Step 6.2: Remove group cookie API routes

**Edit:** `src/dashboard/routes/api.js` - Find and remove these routes:

```javascript
// REMOVE these routes:
// router.get('/groups/:groupId/cookies', authenticateToken, async (req, res) => { ... });
// router.post('/groups/:groupId/cookies', authenticateToken, async (req, res) => { ... });
// router.delete('/groups/:groupId/cookies', authenticateToken, async (req, res) => { ... });
```

**Search for:** `/groups/:groupId/cookies` and delete the entire route handler for GET, POST, DELETE.

### Step 6.3: Add comment about deprecated group cookies

**Edit:** `src/dashboard/routes/api.js` - Add comment where routes were removed:

```javascript
// ============================================================================
// Group Cookie Management (REMOVED in 2026-02-05)
// Group-level cookies are no longer supported. Use global cookies only.
// Old files like cookies_{groupId}.json will be ignored.
// ============================================================================
```

### Step 6.4: Test cookie functionality

**Manual Test:**

1. **Verify global cookie works:**
   - Ensure `/data/cookies.json` exists with valid SESSDATA
   - Parse a bilibili link that requires authentication
   - Expected: Link parses successfully

2. **Verify group cookie is ignored:**
   - Create a dummy `/data/cookies_123456.json` file
   - Parse a link in group 123456
   - Check logs: Should use global cookie, not group cookie
   - Verify Python service logs don't mention group-specific cookie

3. **Test Dashboard API:**
   - Try to access `GET /api/groups/123456/cookies`
   - Expected: 404 Not Found

### Step 6.5: Commit

```bash
git add src/services/bili_server.py src/dashboard/routes/api.js
git commit -m "feat: 简化Cookie管理 - 移除群级Cookie支持

- load_credential只加载全局cookies.json
- 移除Dashboard API中的群级Cookie路由
- 群级Cookie文件（cookies_{groupId}.json）将被忽略
- 用户需手动删除旧的群级Cookie文件"
```

---

## Task 7: Dashboard Frontend - AI Toggle UI

**Files:**
- Modify: `dashboard/src/pages/Groups.jsx` (add AI config tab)
- Modify: `dashboard/src/pages/Settings.jsx` (add global AI toggles)
- Create: `dashboard/src/components/AiConfigSection.jsx` (reusable component)

### Step 7.1: Create AiConfigSection component

**Create:** `dashboard/src/components/AiConfigSection.jsx`

```jsx
import React from 'react';

/**
 * AI Configuration Section Component
 * Displays AI and RAG toggle switches with inheritance status
 */
export default function AiConfigSection({
    config,
    globalConfig,
    onToggle,
    onReset,
    isGroup = false
}) {
    const aiEnabled = config.aiEnabled ?? globalConfig?.aiEnabled ?? true;
    const ragEnabled = config.aiRagEnabled ?? globalConfig?.aiRagEnabled ?? true;

    const aiIsInherited = config.aiEnabled === undefined || config.aiEnabled === null;
    const ragIsInherited = config.aiRagEnabled === undefined || config.aiRagEnabled === null;

    return (
        <div className="space-y-4">
            {/* AI Enable Toggle */}
            <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div className="flex-1">
                    <h4 className="font-medium text-gray-900 dark:text-white">
                        AI功能
                        {isGroup && aiIsInherited && (
                            <span className="ml-2 text-sm text-gray-500">(继承全局)</span>
                        )}
                    </h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                        {isGroup
                            ? "控制该群是否启用AI聊天功能"
                            : "全局控制所有群的AI聊天功能"}
                    </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                    <input
                        type="checkbox"
                        checked={aiEnabled}
                        onChange={(e) => onToggle('aiEnabled', e.target.checked)}
                        className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                </label>
            </div>

            {/* RAG Enable Toggle */}
            <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div className="flex-1">
                    <h4 className="font-medium text-gray-900 dark:text-white">
                        RAG记忆功能
                        {isGroup && ragIsInherited && (
                            <span className="ml-2 text-sm text-gray-500">(继承全局)</span>
                        )}
                    </h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                        使用向量记忆增强AI回复（需要AI功能开启）
                    </p>
                    {!aiEnabled && (
                        <p className="text-sm text-amber-600 dark:text-amber-400 mt-1">
                            ⚠️ AI功能已关闭，RAG功能不可用
                        </p>
                    )}
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                    <input
                        type="checkbox"
                        checked={ragEnabled}
                        onChange={(e) => onToggle('aiRagEnabled', e.target.checked)}
                        disabled={!aiEnabled}
                        className="sr-only peer disabled:opacity-50"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600 peer-disabled:opacity-50"></div>
                </label>
            </div>

            {/* Reset Button (Group only) */}
            {isGroup && (!aiIsInherited || !ragIsInherited) && (
                <button
                    onClick={onReset}
                    className="w-full px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-600"
                >
                    重置为全局设置
                </button>
            )}

            {/* Info Messages */}
            {!isGroup && (
                <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                    <p className="text-sm text-blue-800 dark:text-blue-300">
                        💡 这些设置会影响所有未自定义的群组
                    </p>
                </div>
            )}
        </div>
    );
}
```

### Step 7.2: Add AI config tab to Groups.jsx

**Edit:** `dashboard/src/pages/Groups.jsx`

**Import the component:**

```jsx
import AiConfigSection from '../components/AiConfigSection';
```

**Find the tab list** (around where other tabs are defined) and add:

```jsx
// Add new tab after "管理员" tab
const tabs = [
    // ... existing tabs ...
    { id: 'ai', label: 'AI配置' },  // ADD THIS
    // ... rest of tabs ...
];
```

**Add tab content in the render section:**

```jsx
{activeTab === 'ai' && selectedGroup && (
    <div className="p-6">
        <h3 className="text-lg font-semibold mb-4">AI功能配置</h3>
        <AiConfigSection
            config={groupConfig}
            globalConfig={{
                aiEnabled: globalConfig.aiEnabled,
                aiRagEnabled: globalConfig.aiRagEnabled
            }}
            onToggle={handleAiToggle}
            onReset={handleAiReset}
            isGroup={true}
        />
    </div>
)}
```

**Add handler functions:**

```jsx
const handleAiToggle = async (field, value) => {
    try {
        const response = await fetch(`/api/groups/${selectedGroup}/ai-config`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({ [field]: value })
        });

        if (response.ok) {
            // Reload group config
            fetchGroupConfig(selectedGroup);
        }
    } catch (error) {
        console.error('Failed to update AI config:', error);
    }
};

const handleAiReset = async () => {
    try {
        const response = await fetch(`/api/groups/${selectedGroup}/ai-config`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });

        if (response.ok) {
            fetchGroupConfig(selectedGroup);
        }
    } catch (error) {
        console.error('Failed to reset AI config:', error);
    }
};
```

### Step 7.3: Update Settings.jsx for global AI config

**Edit:** `dashboard/src/pages/Settings.jsx`

**Import:**
```jsx
import AiConfigSection from '../components/AiConfigSection';
```

**Find the AI configuration section and add:**

```jsx
{/* Global AI Toggle Section */}
<div className="mb-6">
    <h3 className="text-lg font-semibold mb-4">全局AI功能</h3>
    <AiConfigSection
        config={{
            aiEnabled: globalConfig.aiEnabled,
            aiRagEnabled: globalConfig.aiRagEnabled
        }}
        globalConfig={null}
        onToggle={handleGlobalAiToggle}
        onReset={null}
        isGroup={false}
    />
</div>
```

**Add handler:**

```jsx
const handleGlobalAiToggle = async (field, value) => {
    try {
        const response = await fetch('/api/config', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({ [field]: value })
        });

        if (response.ok) {
            fetchGlobalConfig();
        }
    } catch (error) {
        console.error('Failed to update global AI config:', error);
    }
};
```

### Step 7.4: Remove Cookie tab from Groups.jsx

**Edit:** `dashboard/src/pages/Groups.jsx`

**Find and remove:**
- Cookie tab from tabs array
- Cookie tab content section
- Any cookie-related state/handlers

**Add note in subscription tab:**

Find the subscription sync section and add:

```jsx
<div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg mb-4">
    <p className="text-sm text-blue-800 dark:text-blue-300">
        💡 关注同步使用全局Cookie，请在设置页面管理Cookie
    </p>
</div>
```

### Step 7.5: Test Dashboard UI

**Manual Test:**

1. **Global AI Config (Settings page):**
   - Toggle global AI switch
   - Verify RAG toggle is disabled when AI is off
   - Check that changes persist after refresh

2. **Group AI Config (Groups page):**
   - Select a group
   - Go to "AI配置" tab
   - Toggle group AI switch
   - Verify "(继承全局)" label disappears
   - Click "重置为全局设置"
   - Verify label reappears

3. **Cookie Tab Removed:**
   - Verify no "Cookie管理" tab in Groups page
   - Verify subscription tab has the info message about global cookies

### Step 7.6: Build frontend

```bash
cd dashboard
npm run build
cd ..
```

### Step 7.7: Commit

```bash
git add dashboard/src/components/AiConfigSection.jsx dashboard/src/pages/Groups.jsx dashboard/src/pages/Settings.jsx
git commit -m "feat: Dashboard AI配置UI

- 新增AiConfigSection可复用组件
- Groups页面添加AI配置标签页，支持群级override和重置
- Settings页面添加全局AI配置区域
- 移除Groups页面的Cookie管理标签页
- 订阅同步添加全局Cookie说明"
```

---

## Task 8: Dashboard Backend - AI Config API

**Files:**
- Modify: `src/dashboard/routes/api.js` (add AI config routes)

### Step 8.1: Add GET group AI config endpoint

**Edit:** `src/dashboard/routes/api.js` - Add route:

```javascript
// Get group AI configuration
router.get('/groups/:groupId/ai-config', authenticateToken, (req, res) => {
    try {
        const groupId = normalizeGroupId(req.params.groupId);
        const groupConfig = config.groupConfigs[groupId] || {};

        res.json({
            aiEnabled: groupConfig.aiEnabled ?? null,  // null = inheriting
            aiRagEnabled: groupConfig.aiRagEnabled ?? null,
            global: {
                aiEnabled: config.aiEnabled,
                aiRagEnabled: config.aiRagEnabled
            }
        });
    } catch (error) {
        logger.error('[API] Failed to get group AI config:', error);
        res.status(500).json({ error: 'Failed to get AI configuration' });
    }
});
```

### Step 8.2: Add PUT group AI config endpoint

**Edit:** `src/dashboard/routes/api.js` - Add route:

```javascript
// Update group AI configuration
router.put('/groups/:groupId/ai-config', authenticateToken, async (req, res) => {
    try {
        const groupId = normalizeGroupId(req.params.groupId);
        const { aiEnabled, aiRagEnabled } = req.body;

        // Ensure group config exists
        config.ensureGroupConfig(groupId);
        const groupConfig = config.groupConfigs[groupId];

        // Update only provided fields
        if (aiEnabled !== undefined) {
            if (aiEnabled === null) {
                delete groupConfig.aiEnabled;  // Remove override
            } else {
                groupConfig.aiEnabled = aiEnabled;
            }
        }

        if (aiRagEnabled !== undefined) {
            if (aiRagEnabled === null) {
                delete groupConfig.aiRagEnabled;  // Remove override
            } else {
                groupConfig.aiRagEnabled = aiRagEnabled;
            }
        }

        await config.save();

        res.json({
            success: true,
            config: {
                aiEnabled: groupConfig.aiEnabled ?? null,
                aiRagEnabled: groupConfig.aiRagEnabled ?? null
            }
        });
    } catch (error) {
        logger.error('[API] Failed to update group AI config:', error);
        res.status(500).json({ error: 'Failed to update AI configuration' });
    }
});
```

### Step 8.3: Add DELETE group AI config endpoint (reset)

**Edit:** `src/dashboard/routes/api.js` - Add route:

```javascript
// Reset group AI configuration (remove all overrides)
router.delete('/groups/:groupId/ai-config', authenticateToken, async (req, res) => {
    try {
        const groupId = normalizeGroupId(req.params.groupId);
        const groupConfig = config.groupConfigs[groupId];

        if (groupConfig) {
            delete groupConfig.aiEnabled;
            delete groupConfig.aiRagEnabled;
            await config.save();
        }

        res.json({
            success: true,
            message: 'AI configuration reset to global settings'
        });
    } catch (error) {
        logger.error('[API] Failed to reset group AI config:', error);
        res.status(500).json({ error: 'Failed to reset AI configuration' });
    }
});
```

### Step 8.4: Update global config endpoint to support AI toggles

**Edit:** `src/dashboard/routes/api.js` - Find `PUT /api/config` route

**Ensure it handles aiEnabled and aiRagEnabled:**

```javascript
router.put('/config', authenticateToken, async (req, res) => {
    // ... existing code ...

    // Add handling for AI toggles
    if ('aiEnabled' in req.body) {
        config.aiEnabled = req.body.aiEnabled;
    }
    if ('aiRagEnabled' in req.body) {
        config.aiRagEnabled = req.body.aiRagEnabled;
    }

    // ... save and return ...
});
```

### Step 8.5: Test API endpoints

**Test with curl:**

```bash
# Get JWT token first (login via Dashboard or extract from localStorage)
TOKEN="your-jwt-token"

# Test GET group AI config
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/groups/123456/ai-config

# Test PUT group AI config (disable AI)
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"aiEnabled": false}' \
  http://localhost:3000/api/groups/123456/ai-config

# Test DELETE (reset to global)
curl -X DELETE -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/groups/123456/ai-config

# Test PUT global config
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"aiEnabled": true, "aiRagEnabled": false}' \
  http://localhost:3000/api/config
```

### Step 8.6: Commit

```bash
git add src/dashboard/routes/api.js
git commit -m "feat: Dashboard API支持AI配置管理

- 新增GET /groups/:groupId/ai-config获取群AI配置
- 新增PUT /groups/:groupId/ai-config更新群AI配置
- 新增DELETE /groups/:groupId/ai-config重置为全局设置
- 更新PUT /config支持全局AI开关"
```

---

## Task 9: Integration Testing

**Files:**
- None (testing only)

### Step 9.1: End-to-end AI toggle test

**Test scenario:**

1. **Setup:**
   - Ensure bot is running
   - Have 2 test groups: GroupA and GroupB

2. **Test global AI disable:**
   - Set global AI to OFF via Dashboard
   - Send `@bot hello` in both groups
   - Expected: No AI reply in either group
   - Check logs: "AI disabled for group"

3. **Test group override:**
   - Set global AI to ON
   - Set GroupA AI to OFF (via Dashboard)
   - Keep GroupB at default (inheriting ON)
   - Send `@bot hello` in both groups
   - Expected: GroupA no reply, GroupB replies

4. **Test RAG dependency:**
   - Set global AI to ON, global RAG to OFF
   - Send messages to trigger AI in GroupB
   - Expected: AI replies but without RAG context
   - Check logs: "RAG disabled for group"

5. **Test group RAG override:**
   - Set global RAG to ON
   - Set GroupA RAG to OFF
   - GroupB inherits (ON)
   - Send messages with historical context
   - Expected: GroupA replies without context, GroupB uses context

### Step 9.2: End-to-end feed deduplication test

**Test scenario:**

1. **Setup:**
   - Subscribe to an active UP主: `/订阅用户 <UID>`
   - UP主 should have recent video posts

2. **Test video deduplication:**
   - Wait for UP主 to post a new video
   - Expected notifications:
     - ✅ One notification with video card (from video subscription)
     - ❌ No notification about "new dynamic"
   - Verify in logs: "Skipping video dynamic"

3. **Test article deduplication:**
   - Find UP主 who posts articles
   - Subscribe: `/订阅用户 <UID>`
   - Wait for article post
   - Expected:
     - ✅ One notification with article card
     - ❌ No dynamic notification

4. **Test normal dynamic still works:**
   - Wait for UP主 to post text/image dynamic
   - Expected: Dynamic notification received

### Step 9.3: End-to-end private chat test

**Test scenario:**

1. **Non-root user:**
   - From non-ADMIN_QQ account
   - Send private message: "hello"
   - Expected: Reply "此功能仅限管理员使用"

2. **Group admin (not root):**
   - Add user as group admin in one group
   - From that QQ account, send private message
   - Expected: Still rejected (not root)

3. **Root admin:**
   - From ADMIN_QQ account
   - Send private message: "/帮助"
   - Expected: Help message displayed
   - AI works: Send "hello"
   - Expected: AI replies

4. **Context isolation:**
   - Root admin sends private: "remember: my favorite color is blue"
   - In group, ask bot: "what's my favorite color?"
   - Expected: Bot doesn't know (context isolated)

### Step 9.4: End-to-end cookie simplification test

**Test scenario:**

1. **Global cookie works:**
   - Ensure `/data/cookies.json` has valid SESSDATA
   - Parse any bilibili link requiring auth
   - Expected: Parses successfully

2. **Group cookie ignored:**
   - Create `/data/cookies_999999.json` with dummy data
   - Parse link in group 999999
   - Check Python logs: Should NOT load `cookies_999999.json`
   - Expected: Uses global cookie

3. **Dashboard API removed:**
   - Try: `curl http://localhost:3000/api/groups/123456/cookies`
   - Expected: 404 Not Found

### Step 9.5: GroupId type consistency test

**Test scenario:**

1. **Message handling:**
   - Send message from group with numeric ID
   - Check logs: GroupId appears as string "123456"
   - Verify no type errors in config access

2. **Dashboard:**
   - Access group config via Dashboard
   - Verify config loads correctly
   - Make changes, verify they save

3. **Subscription:**
   - Subscribe to user in group
   - Receive subscription notification
   - Verify groupId matching works correctly

### Step 9.6: Document test results

**Create:** `docs/plans/2026-02-05-test-results.md`

```markdown
# Feature Enhancements Test Results

**Date:** 2026-02-05
**Tester:** [Your Name]
**Branch:** feature-enhancements-2026

## Test Summary

- [ ] GroupId type unification
- [ ] AI function toggles
- [ ] Feed deduplication
- [ ] Private chat restriction
- [ ] Cookie simplification

## Detailed Results

### 1. GroupId Type Unification

**Test:** [Pass/Fail]
**Notes:** [Any issues found]

### 2. AI Function Toggles

**Test:** [Pass/Fail]
**Scenarios Tested:**
- Global AI disable: [Pass/Fail]
- Group override: [Pass/Fail]
- RAG dependency: [Pass/Fail]
- Group RAG override: [Pass/Fail]

**Notes:** [Any issues found]

### 3. Feed Deduplication

**Test:** [Pass/Fail]
**Scenarios Tested:**
- Video deduplication: [Pass/Fail]
- Article deduplication: [Pass/Fail]
- Normal dynamic works: [Pass/Fail]

**Notes:** [Any issues found]

### 4. Private Chat Restriction

**Test:** [Pass/Fail]
**Scenarios Tested:**
- Non-root rejected: [Pass/Fail]
- Group admin rejected: [Pass/Fail]
- Root admin works: [Pass/Fail]
- Context isolation: [Pass/Fail]

**Notes:** [Any issues found]

### 5. Cookie Simplification

**Test:** [Pass/Fail]
**Scenarios Tested:**
- Global cookie works: [Pass/Fail]
- Group cookie ignored: [Pass/Fail]
- Dashboard API removed: [Pass/Fail]

**Notes:** [Any issues found]

## Regression Tests

- [ ] Link parsing (video, dynamic, article, live, bangumi)
- [ ] Subscription push (user, bangumi)
- [ ] AI chat (with RAG)
- [ ] Dashboard login and config

## Performance Tests

- [ ] Dynamic deduplication overhead: [Negligible/Acceptable/Issue]
- [ ] GroupId conversion overhead: [Negligible/Acceptable/Issue]
- [ ] AI toggle check overhead: [Negligible/Acceptable/Issue]

## Issues Found

1. [Issue description]
   - Severity: [Critical/High/Medium/Low]
   - Status: [Open/Fixed]

## Recommendations

[Any recommendations for improvements or follow-up work]
```

### Step 9.7: Commit test results

```bash
git add docs/plans/2026-02-05-test-results.md
git commit -m "test: 功能增强集成测试结果"
```

---

## Task 10: Documentation and Cleanup

**Files:**
- Update: `CLAUDE.md` (project documentation)
- Update: `docs/plans/2026-02-05-feature-enhancements-design.md`
- Remove: `test_ai_toggles.js` (cleanup test script)
- Keep: `test_dynamic_types.js` (useful utility)

### Step 10.1: Update CLAUDE.md with new features

**Edit:** `CLAUDE.md` - Add to appropriate sections:

**In "Configuration System Deep Dive" section:**

```markdown
### AI Function Toggles (Added 2026-02-05)

**Global toggles:**
- `aiEnabled` (env: AI_ENABLED, default: true) - Master AI switch
- `aiRagEnabled` (env: AI_RAG_ENABLED, default: true) - Master RAG switch

**Group-level overrides:**
- `groupConfigs[groupId].aiEnabled` - Group AI override
- `groupConfigs[groupId].aiRagEnabled` - Group RAG override

**Behavior:**
- Strict dependency: Global > Group, AI > RAG
- Global AI off → All groups AI disabled
- Group AI off → That group AI disabled (others unaffected)
- AI off → RAG automatically disabled
- AI off → Messages still recorded to context

**Helper functions:**
```javascript
config.isAiEnabledForGroup(groupId)  // Check if AI enabled
config.isRagEnabledForGroup(groupId) // Check if RAG enabled
```
```

**In "Subscription System" section:**

```markdown
### Feed Deduplication (Added 2026-02-05)

UP主发布视频/专栏时，B站会自动生成包含该内容的动态。为避免重复推送：

**跳过的动态类型:**
- 视频投稿自动动态: `MAJOR_TYPE_ARCHIVE` 或 `DYNAMIC_TYPE_AV`
- 专栏投稿自动动态: `MAJOR_TYPE_OPUS` + cvId

**保留推送:**
- 图文动态 (Opus without cvId)
- 转发动态 (DYNAMIC_TYPE_FORWARD)
- 纯文字动态 (DYNAMIC_TYPE_WORD)
- 其他类型

**实现:** `updateChecker.js` 的 `shouldSkipDynamic()` 函数
```

**In "Security Considerations" section:**

```markdown
### Private Chat Restriction (Added 2026-02-05)

- Only Root Admin (ADMIN_QQ) can send private messages to bot
- Non-root users receive: "此功能仅限管理员使用"
- Group admins do NOT have private chat access
- Root admin uses virtual groupId: `private_{userId}`
```

**In "Cookie Management" section:**

```markdown
### Cookie Simplification (Changed 2026-02-05)

**Before:** Group-level cookies (`cookies_{groupId}.json`) supported
**After:** Global cookie only (`cookies.json`)

- Group-level cookie files are ignored
- All API requests use global cookie
- Dashboard removed group cookie management
- Existing `cookies_{groupId}.json` files should be manually deleted
```

### Step 10.2: Add usage examples to design doc

**Edit:** `docs/plans/2026-02-05-feature-enhancements-design.md`

**Add "Usage Examples" section at the end:**

```markdown
## Usage Examples

### AI Toggles

**Disable AI globally for maintenance:**
```bash
# In .env or Dashboard Settings
AI_ENABLED=false
```

**Disable AI for specific group:**
```javascript
// Via Dashboard Groups > AI配置
// Or in config.json:
{
  "groupConfigs": {
    "123456": {
      "aiEnabled": false
    }
  }
}
```

**Enable AI but disable RAG for cost savings:**
```bash
AI_ENABLED=true
AI_RAG_ENABLED=false
```

### Feed Deduplication

**Test dynamic types:**
```bash
node test_dynamic_types.js <UID>
```

**Check deduplication in logs:**
```
[UpdateChecker] Skipping video dynamic: 1234567890
[UpdateChecker] Feed: Filtered 2 auto-post dynamics
```

### Private Chat

**Only root admin can use:**
```
Root (ADMIN_QQ): hello bot
Bot: [AI Reply]

Non-root user: hello bot
Bot: 此功能仅限管理员使用
```

### Cookie Management

**Global cookie location:**
```
/data/cookies.json
```

**Old group cookies (ignored):**
```
/data/cookies_123456.json  # No longer used, can be deleted
```
```

### Step 10.3: Clean up test scripts

**Keep useful tools:**
```bash
# Keep test_dynamic_types.js - useful for debugging
git add test_dynamic_types.js
```

**Remove temporary test scripts:**
```bash
rm test_ai_toggles.js
```

### Step 10.4: Update README if exists

**If `README.md` exists, add changelog:**

```markdown
## Changelog

### 2026-02-05 - Feature Enhancements

**New Features:**
- AI功能分级开关 (全局+群级，AI+RAG)
- Feed流去重优化 (跳过视频/专栏投稿自动动态)
- 私聊限制 (仅Root管理员)
- Cookie管理简化 (移除群级，统一全局)

**Bug Fixes:**
- GroupId类型统一为字符串，修复config访问问题

**Breaking Changes:**
- 群级Cookie不再支持 (需迁移到全局Cookie)
- 非Root管理员私聊被拒绝

详见: `docs/plans/2026-02-05-feature-enhancements-design.md`
```

### Step 10.5: Commit documentation updates

```bash
git add CLAUDE.md docs/plans/2026-02-05-feature-enhancements-design.md README.md
git commit -m "docs: 更新项目文档 - 功能增强说明

- CLAUDE.md添加AI开关、Feed去重、私聊限制、Cookie简化说明
- 设计文档添加使用示例
- README添加变更日志
- 清理临时测试脚本"
```

---

## Task 11: Final Review and Merge

**Files:**
- None (review and merge process)

### Step 11.1: Review all commits

```bash
git log --oneline feature-enhancements-2026
```

**Expected commits (11 total):**
1. fix: 统一groupId类型为字符串
2. feat: 添加AI功能分级开关配置
3. feat: 集成AI功能开关到业务逻辑
4. feat: Feed流去重 - 跳过视频/专栏投稿自动动态
5. feat: 私聊限制为仅Root管理员可用
6. feat: 简化Cookie管理 - 移除群级Cookie支持
7. feat: Dashboard AI配置UI
8. feat: Dashboard API支持AI配置管理
9. test: 功能增强集成测试结果
10. docs: 更新项目文档 - 功能增强说明
11. (Any fix commits from testing)

### Step 11.2: Run final regression tests

**Quick smoke test:**

1. Start bot: `npm start`
2. Parse a video link
3. Subscribe to a user
4. Trigger AI chat
5. Access Dashboard
6. Toggle AI config in Dashboard

**All should work without errors.**

### Step 11.3: Create pull request or merge to main

**Option A: Create PR (if using security-fixes-2026 as base):**

```bash
git push origin feature-enhancements-2026
# Create PR on GitHub: feature-enhancements-2026 → security-fixes-2026
```

**Option B: Merge to main (if ready for production):**

```bash
git checkout main
git merge feature-enhancements-2026
git push origin main
```

### Step 11.4: Tag release

```bash
git tag -a v3.14.0 -m "Release v3.14.0: Feature Enhancements

- AI功能分级开关 (全局+群级)
- Feed流去重优化
- 私聊限制为Root管理员
- Cookie管理简化
- GroupId类型统一修复"

git push origin v3.14.0
```

### Step 11.5: Write release notes

**Create:** `docs/releases/v3.14.0.md`

```markdown
# Release v3.14.0 - Feature Enhancements

**Release Date:** 2026-02-05
**Branch:** feature-enhancements-2026

## New Features

### AI Function Toggles
- 全局AI开关和RAG开关
- 群级override支持
- Dashboard UI配置界面
- 严格依赖模式（全局>群级，AI>RAG）

### Feed Deduplication
- 自动跳过视频投稿的自动动态
- 自动跳过专栏投稿的自动动态
- 避免重复推送，提升用户体验

### Private Chat Restriction
- 仅Root管理员可使用私聊功能
- 非Root用户收到明确提示
- 提升安全性

### Cookie Management Simplification
- 移除群级Cookie支持
- 统一使用全局Cookie
- 简化配置和维护

## Bug Fixes

### GroupId Type Unification
- 修复groupId类型不一致问题（数字 vs 字符串）
- 统一转换为字符串类型
- 解决config访问潜在错误

## Breaking Changes

⚠️ **Important:** Please read before upgrading

1. **群级Cookie不再支持**
   - 迁移方案：合并群级Cookie到 `/data/cookies.json`
   - 手动删除 `/data/cookies_{groupId}.json` 文件

2. **非Root管理员私聊被阻止**
   - 影响：之前可以私聊的群管理员将无法继续使用
   - 迁移方案：添加到 `ADMIN_QQ` 环境变量

## Migration Guide

### Cookie Migration

**If you have group-specific cookies:**

1. Backup all cookie files:
   ```bash
   cp data/cookies*.json data/backup/
   ```

2. Merge to global cookie:
   - Open `data/cookies_123456.json` (your most important group)
   - Copy SESSDATA, bili_jct, buvid3 to `data/cookies.json`
   - Test by parsing links

3. Delete old group cookies:
   ```bash
   rm data/cookies_*.json
   ```

### AI Configuration

**New config keys (optional):**

In `.env` or Dashboard:
```bash
AI_ENABLED=true         # Default: true
AI_RAG_ENABLED=true     # Default: true
```

In `config.json` for group override:
```json
{
  "groupConfigs": {
    "123456": {
      "aiEnabled": false,      // Optional: override for this group
      "aiRagEnabled": false    // Optional: override for this group
    }
  }
}
```

## Testing

All features tested and verified:
- ✅ GroupId type consistency
- ✅ AI toggles (global + group)
- ✅ Feed deduplication
- ✅ Private chat restriction
- ✅ Cookie simplification
- ✅ Regression tests passed

## Documentation

- Updated: `CLAUDE.md`
- Design doc: `docs/plans/2026-02-05-feature-enhancements-design.md`
- Implementation plan: `docs/plans/2026-02-05-feature-enhancements.md`
- Test results: `docs/plans/2026-02-05-test-results.md`

## Known Issues

None at release time.

## Contributors

[Your Name]

---

For detailed implementation details, see:
- Design: `docs/plans/2026-02-05-feature-enhancements-design.md`
- Implementation: `docs/plans/2026-02-05-feature-enhancements.md`
```

### Step 11.6: Final commit

```bash
git add docs/releases/v3.14.0.md
git commit -m "release: v3.14.0 - 功能增强版本

- AI功能分级开关
- Feed流去重优化
- 私聊限制
- Cookie管理简化
- GroupId类型统一"

git push origin feature-enhancements-2026
```

---

## Completion Checklist

Before marking this plan as complete, verify:

- [ ] All 11 tasks completed
- [ ] All commits pushed to branch
- [ ] Integration tests passed
- [ ] Regression tests passed
- [ ] Documentation updated
- [ ] Release notes written
- [ ] Breaking changes documented
- [ ] Migration guide provided
- [ ] PR created or merged to main
- [ ] Tagged release (if applicable)

## Estimated Time

- **Task 1-6 (Backend):** 3-4 hours
- **Task 7-8 (Frontend):** 2-3 hours
- **Task 9 (Testing):** 1-2 hours
- **Task 10-11 (Docs & Release):** 1 hour
- **Total:** 7-10 hours

## Notes

- Tasks 1-6 can be done independently (backend focus)
- Tasks 7-8 require frontend rebuild
- Task 9 requires full integration
- Frequent commits recommended for easy rollback
- Test after each task completion

---

**Plan Status:** Ready for Execution
**Last Updated:** 2026-02-05
**Next Step:** Execute using superpowers:executing-plans or superpowers:subagent-driven-development
