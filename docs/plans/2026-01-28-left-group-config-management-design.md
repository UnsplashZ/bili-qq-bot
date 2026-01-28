# 退群后配置管理设计方案（2026-01-28）

## 问题背景

当前系统存在问题：Bot 退出群组后，该群的配置和订阅数据仍然保留，但后台仍会继续进行订阅查询和推送尝试，造成资源浪费。同时 WebUI 无法显示已退出的群组，导致无法管理这些历史配置。

## 设计目标

1. **停止无效查询**：退群后立即停止该群的所有订阅检查和推送
2. **保留配置数据**：配置和订阅数据完整保留，重新加群时自动恢复
3. **透明可控**：WebUI 清晰展示群组状态，允许管理员查看/删除历史配置
4. **自动同步**：检测退群和重新加群事件，自动更新状态

## 整体架构

### 核心流程

```
┌─────────────────────────────────────────────────────────────┐
│ 退群/加群检测                                                │
├─────────────────────────────────────────────────────────────┤
│ 1. 实时事件监听 (group_decrease/group_increase)             │
│ 2. 启动时初始化检查 (对比 groupList vs groupConfigs)        │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 状态存储                                                     │
├─────────────────────────────────────────────────────────────┤
│ config.json → groupConfigs[groupId].isInGroup (bool)        │
│   - true: 正常在群                                           │
│   - false: 已退群                                            │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 订阅过滤                                                     │
├─────────────────────────────────────────────────────────────┤
│ UpdateChecker 构建 activeGroups = {gid | isInGroup !== false}│
│ 所有订阅检查前过滤目标群组                                   │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ WebUI 展示                                                   │
├─────────────────────────────────────────────────────────────┤
│ - 合并返回在群 + 已退群的群组                                │
│ - 已退群群组：灰色背景 + "已退群"徽章 + 删除按钮            │
└─────────────────────────────────────────────────────────────┘
```

## 详细设计

### 1. 双向状态同步（bot.js）

**实时事件监听**

- **退群检测**：监听 `notice.group_decrease` 事件
  - 条件：`user_id === self_id` && `sub_type === 'leave' | 'kick'`
  - 动作：设置 `groupConfigs[groupId].isInGroup = false`
  - 日志：`logger.warn('[Bot] Left group {groupId}, marked as isInGroup=false')`

- **重新加群检测**：监听 `notice.group_increase` 事件
  - 条件：`user_id === self_id` && `sub_type === 'invite' | 'approve'`
  - 动作：如果 `groupConfigs[groupId]` 已存在，设置 `isInGroup = true`
  - 日志：`logger.info('[Bot] Rejoined group {groupId}, restored config')`

**启动时初始化检查**

```javascript
// 在 bot 连接成功后执行
function syncGroupStates() {
    const groupList = global.bot.groupList;
    const groupConfigs = sysConfig.groupConfigs || {};

    // 1. 标记已退出的群
    for (const configGroupId in groupConfigs) {
        if (!groupList.has(configGroupId)) {
            if (groupConfigs[configGroupId].isInGroup !== false) {
                groupConfigs[configGroupId].isInGroup = false;
                logger.warn(`[Bot] Group ${configGroupId} not in list, marked as left`);
            }
        }
    }

    // 2. 恢复重新加入的群
    for (const groupId of groupList.keys()) {
        if (groupConfigs[groupId] && groupConfigs[groupId].isInGroup === false) {
            groupConfigs[groupId].isInGroup = true;
            logger.info(`[Bot] Group ${groupId} rejoined, config restored`);
        }
    }

    sysConfig.save();
}
```

### 2. 配置存储扩展（config.json）

**新增字段**

```json
{
  "groupConfigs": {
    "123456789": {
      "isInGroup": false,
      "linkCacheTimeout": 300,
      "aiProbability": 0.3,
      ...
    }
  }
}
```

**配置迁移**

对于已有配置缺少 `isInGroup` 字段的情况，在启动时兜底：

```javascript
// 在 bot.js 启动检查前执行
function migrateGroupConfigs() {
    const groupConfigs = sysConfig.groupConfigs || {};

    for (const groupId in groupConfigs) {
        if (groupConfigs[groupId].isInGroup === undefined) {
            groupConfigs[groupId].isInGroup = true; // 默认为在群
        }
    }
}
```

### 3. 订阅检查过滤（updateChecker.js）

**构建活跃群组集合**

在 `checkAll()` 开始时：

```javascript
async checkAll() {
    logger.info('[UpdateChecker] Starting scheduled check...');

    await subscriptionManager._ensureSubscriptionsLoaded();

    // 构建活跃群组集合
    const activeGroups = new Set();
    const groupConfigs = config.groupConfigs || {};

    for (const [groupId, groupConfig] of Object.entries(groupConfigs)) {
        if (groupConfig.isInGroup !== false) {
            activeGroups.add(groupId);
        }
    }

    logger.debug(`[UpdateChecker] Active groups: ${activeGroups.size}`);

    const feedMonitoredUids = new Set();

    await this.checkFeedUpdate(feedMonitoredUids, activeGroups);

    // 检查用户动态/直播时过滤
    for (const sub of subscriptionManager.userSubs) {
        if (feedMonitoredUids.has(String(sub.uid))) continue;

        // 过滤出活跃的目标群
        const targetGroups = sub.groupIds.filter(gid => activeGroups.has(gid));
        if (targetGroups.length === 0) {
            logger.debug(`[UpdateChecker] Skipped UID ${sub.uid}, all groups left`);
            continue;
        }

        await this.checkUserDynamic(sub, targetGroups);
        await new Promise(r => setTimeout(r, 1000));
    }

    // ... 其他检查类似处理
}
```

**方法签名修改**

需要为以下方法添加 `activeGroups` 或 `targetGroups` 参数：
- `checkFeedUpdate(monitoredUidsSet, activeGroups)`
- `checkUserDynamic(sub, targetGroups)`
- `checkUserLive(sub, targetGroups)`
- `checkBangumi(sub, targetGroups)`

在发送通知前，只对 `targetGroups` 中的群发送消息。

### 4. 后端 API 扩展（api.js）

**修改 GET /api/groups 接口**

```javascript
router.get('/groups', async (req, res) => {
    try {
        const bot = global.bot;
        const groupConfigs = sysConfig.groupConfigs || {};
        const enabledGroups = new Set(sysConfig.enabledGroups || []);

        // 收集所有需要显示的群 ID（在群的 + 有配置的）
        const allGroupIds = new Set();

        // 1. 添加当前在群的
        if (bot && bot.groupList) {
            bot.groupList.forEach((info, groupId) => {
                allGroupIds.add(groupId);
            });
        }

        // 2. 添加有配置的（可能已退群）
        Object.keys(groupConfigs).forEach(groupId => {
            allGroupIds.add(groupId);
        });

        // 3. 构建返回数据
        const groupsData = Array.from(allGroupIds).map(groupId => {
            const groupInfo = bot?.groupList?.get(groupId);
            const groupConfig = groupConfigs[groupId] || {};
            const isInGroup = groupConfig.isInGroup !== false;

            return {
                id: groupId,
                name: groupInfo?.group_name || `群组 ${groupId}`,
                isEnabled: enabledGroups.has(groupId),
                isInGroup: isInGroup,
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

**新增 DELETE /api/groups/:id 接口**

用于删除已退群的配置：

```javascript
router.delete('/groups/:id', async (req, res) => {
    try {
        const groupId = req.params.id;
        const groupConfig = sysConfig.groupConfigs?.[groupId];

        // 只允许删除已退群的配置
        if (!groupConfig || groupConfig.isInGroup !== false) {
            return res.status(400).json({
                error: 'Can only delete left group configs'
            });
        }

        // 1. 删除群组配置
        delete sysConfig.groupConfigs[groupId];

        // 2. 从启用列表中移除
        if (sysConfig.enabledGroups) {
            const index = sysConfig.enabledGroups.indexOf(groupId);
            if (index !== -1) {
                sysConfig.enabledGroups.splice(index, 1);
            }
        }

        // 3. 清理订阅数据（从所有订阅的 groupIds 中移除该群）
        const subscriptionManager = require('../../services/subscription/subscriptionManager');
        await subscriptionManager.removeGroupFromAllSubscriptions(groupId);

        await sysConfig.save();

        logger.info(`[API] Deleted config for left group ${groupId}`);
        res.json({ success: true });
    } catch (error) {
        logger.error('Error deleting group config:', error);
        res.status(500).json({ error: 'Failed to delete group config' });
    }
});
```

**subscriptionManager 新增辅助方法**

```javascript
// 在 SubscriptionManager 类中添加
async removeGroupFromAllSubscriptions(groupId) {
    let modified = false;

    // 遍历所有订阅，移除该群
    for (const sub of this.userSubs) {
        const index = sub.groupIds.indexOf(groupId);
        if (index !== -1) {
            sub.groupIds.splice(index, 1);
            modified = true;
        }
    }

    for (const sub of this.bangumiSubs) {
        const index = sub.groupIds.indexOf(groupId);
        if (index !== -1) {
            sub.groupIds.splice(index, 1);
            modified = true;
        }
    }

    if (modified) {
        await this._saveSubscriptions();
        logger.info(`[SubscriptionManager] Removed group ${groupId} from all subscriptions`);
    }
}
```

### 5. 前端 WebUI 展示（Groups.jsx）

**视觉设计**

对于 `isInGroup === false` 的群组：

1. **群组卡片样式**：添加灰色遮罩和特殊边框
2. **状态徽章**：显示红色"已退群"标签
3. **功能限制**：禁用开关按钮，显示"删除配置"按钮
4. **悬浮提示**：说明配置已保留，重新加群后自动恢复

**示例实现**

```jsx
// 在 Groups.jsx 的群组列表渲染中
{groups.map(group => (
  <div
    key={group.id}
    className={`glass-card p-4 ${!group.isInGroup ? 'opacity-60 grayscale' : ''}`}
  >
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div>
          <h3 className="font-medium">
            {group.name}
            {!group.isInGroup && (
              <span className="ml-2 px-2 py-0.5 text-xs bg-red-500/20 text-red-400 rounded">
                已退群
              </span>
            )}
          </h3>
          <p className="text-sm text-gray-400">ID: {group.id}</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {group.isInGroup ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleToggleGroup(group.id);
            }}
            className="btn-icon"
            title={group.isEnabled ? '禁用群组' : '启用群组'}
          >
            <Power className={group.isEnabled ? 'text-green-400' : 'text-gray-400'} />
          </button>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDeleteConfig(group.id);
            }}
            className="btn btn-error btn-sm"
            title="Bot已退出此群，点击删除配置和订阅数据"
          >
            删除配置
          </button>
        )}
      </div>
    </div>
  </div>
))}
```

**添加删除配置功能**

```jsx
const handleDeleteConfig = async (groupId) => {
  if (!confirm(`确认删除群组 ${groupId} 的所有配置和订阅数据？此操作不可恢复。`)) {
    return;
  }

  try {
    const response = await fetch(`/api/groups/${groupId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to delete config');
    }

    // 刷新群组列表
    await fetchGroups();

    alert('配置已删除');
  } catch (error) {
    console.error('Delete config error:', error);
    alert('删除失败: ' + error.message);
  }
};
```

## 边界情况处理

### 1. 配置迁移

- 已有配置缺少 `isInGroup` 字段 → 启动时设为 `true`，然后执行检查自动修正

### 2. WebSocket 断线

- 断线期间的退群/加群事件会丢失 → 依赖启动时的初始化检查兜底

### 3. 新群加入

- Bot 被邀请加入全新的群 → 保持现有逻辑，首次配置时自动创建配置对象

### 4. 删除配置安全性

- 只允许删除 `isInGroup === false` 的群配置
- 删除前二次确认
- 同时清理 `groupConfigs`、`enabledGroups`、订阅数据

### 5. 日志记录

关键操作日志：
- 检测到退群：`logger.warn('[Bot] Left group {groupId}, marked as isInGroup=false')`
- 检测到重新加群：`logger.info('[Bot] Rejoined group {groupId}, restored config')`
- 订阅检查跳过：`logger.debug('[UpdateChecker] Skipped {count} inactive groups')`
- 启动检查同步：`logger.info('[Bot] Synced group states: {left} left, {rejoined} rejoined')`

## 预期效果

✅ 退群后立即停止所有订阅查询和推送，节省 API 请求和资源
✅ 配置和订阅数据完整保留在 config.json 和 subscriptions.json
✅ 重新加群时自动恢复所有功能，无需重新配置
✅ WebUI 清晰展示所有群组状态（在群/已退群）
✅ 管理员可主动清理不再需要的历史配置
✅ 启动时自动同步状态，确保数据一致性

## 实现清单

- [ ] bot.js：添加事件监听器（group_decrease/group_increase）
- [ ] bot.js：添加启动时状态同步逻辑
- [ ] config.js：添加配置迁移逻辑（可选，或在 bot.js 中处理）
- [ ] updateChecker.js：添加活跃群组过滤逻辑
- [ ] updateChecker.js：修改各检查方法的签名和实现
- [ ] subscriptionManager.js：添加 removeGroupFromAllSubscriptions 方法
- [ ] api.js：修改 GET /api/groups 接口
- [ ] api.js：添加 DELETE /api/groups/:id 接口
- [ ] Groups.jsx：修改群组列表渲染逻辑
- [ ] Groups.jsx：添加删除配置功能

## 测试计划

1. **退群检测**：让 Bot 退出测试群，检查 config.json 中 `isInGroup` 是否变为 `false`
2. **订阅停止**：确认退群后该群不再收到订阅推送
3. **重新加群**：重新邀请 Bot 进群，检查 `isInGroup` 是否恢复为 `true`，功能是否正常
4. **WebUI 展示**：打开群组管理页面，确认已退群群组显示灰色且有"已退群"标签
5. **删除配置**：点击"删除配置"按钮，确认配置和订阅数据被清理
6. **启动检查**：手动修改 config.json 模拟不一致状态，重启 Bot 检查是否自动修正
