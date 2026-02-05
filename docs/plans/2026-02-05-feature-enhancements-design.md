# Feature Enhancements Design Document

**日期**: 2026-02-05
**状态**: 已验证设计
**类型**: 功能增强 + Bug修复

## 概述

本次增强包含5个主要功能模块，旨在提升系统的配置灵活性、修复类型一致性问题、优化订阅推送体验、加强权限控制和简化Cookie管理。

## 需求来源

用户提出的四个核心需求：
1. AI功能调整：分级开关（全局+群级，AI+RAG）
2. Feed流优化：去重视频/专栏投稿的自动动态
3. 私聊限制：仅Root管理员可用
4. Cookie管理：移除群级关联，统一全局管理

附加发现：
5. GroupId类型不一致问题（数字vs字符串）

## 设计方案

### 1. GroupId类型统一修复

**问题分析**：
- WebSocket消息中的`group_id`可能是数字类型
- `config.js`中存储的key是字符串类型
- 导致`groupConfigs[groupId]`访问可能失败（数字123 !== 字符串"123"）

**解决方案**：
- 在所有入口点立即转换为字符串
- 统一规则：存储层、传输层、使用层都使用字符串

**改动位置**：
- `src/handlers/messageHandler.js:16` - `String(messageData.group_id)`
- `src/dashboard/routes/api.js` - 所有`req.params.groupId`转换
- `src/services/subscription/updateChecker.js` - 确保类型一致

---

### 2. AI功能分级开关

**配置架构**：

```javascript
// 全局配置（META）
aiEnabled: { env: 'AI_ENABLED', def: true, type: 'bool' }
aiRagEnabled: { env: 'AI_RAG_ENABLED', def: true, type: 'bool' }

// 群级配置（groupConfigs[groupId]）
{
  aiEnabled?: boolean,      // 可选，不设置则继承全局
  aiRagEnabled?: boolean    // 可选，不设置则继承全局
}
```

**权限检查函数**：

```javascript
// config.js 新增
function isAiEnabledForGroup(groupId) {
    // 1. 全局AI开关必须打开
    if (!sysConfig.aiEnabled) return false;

    // 2. 检查群级override
    const groupConfig = sysConfig.groupConfigs[groupId];
    if (groupConfig && 'aiEnabled' in groupConfig) {
        return groupConfig.aiEnabled;
    }

    // 3. 默认继承全局设置
    return true;
}

function isRagEnabledForGroup(groupId) {
    // 1. AI功能必须启用
    if (!isAiEnabledForGroup(groupId)) return false;

    // 2. 全局RAG开关必须打开
    if (!sysConfig.aiRagEnabled) return false;

    // 3. 检查群级override
    const groupConfig = sysConfig.groupConfigs[groupId];
    if (groupConfig && 'aiRagEnabled' in groupConfig) {
        return groupConfig.aiRagEnabled;
    }

    // 4. 默认继承全局设置
    return true;
}
```

**调用位置**：
- `aiHandler.js` - `shouldReply()`中检查`isAiEnabledForGroup()`
- `aiHandler.js` - `getReply()`中检查`isRagEnabledForGroup()`决定是否使用向量搜索
- `messageHandler.js` - AI回复触发前增加开关检查

**特殊要求**：
- AI关闭时仍然记录消息到context（用于未来分析）
- 不影响消息记录到向量数据库

---

### 3. Feed流去重优化

**问题场景**：
UP主发布视频/专栏时，B站自动生成一条包含该内容的动态，导致：
- 订阅系统检测到"新动态"
- 订阅系统检测到"新视频/专栏"
- 结果：重复推送两次

**识别规则**（已通过测试验证）：

**跳过的动态类型**：
1. 视频投稿自动动态：
   - `major.type === 'MAJOR_TYPE_ARCHIVE'`
   - 或 `item.type === 'DYNAMIC_TYPE_AV'`

2. 专栏投稿自动动态：
   - `major.type === 'MAJOR_TYPE_OPUS'`
   - 且 `opus.jump_url` 匹配 `/read/cv\d+` 格式

**保留推送的动态**：
- 图文动态（Opus但不含专栏链接）
- 转发动态（DYNAMIC_TYPE_FORWARD）
- 纯文字动态（DYNAMIC_TYPE_WORD）
- 直播推荐等其他类型

**实现代码**：

```javascript
// updateChecker.js 新增
shouldSkipDynamic(item) {
    const major = item?.modules?.module_dynamic?.major;

    // 跳过视频投稿自动动态
    if (major?.type === 'MAJOR_TYPE_ARCHIVE' || item.type === 'DYNAMIC_TYPE_AV') {
        logger.debug(`[UpdateChecker] Skipping video dynamic: ${item.id_str}`);
        return true;
    }

    // 跳过专栏投稿自动动态
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

**调用位置**：
- `checkUserDynamic()` - 在推送前过滤动态
- `checkFeedUpdate()` - 在feed处理时过滤动态

**测试验证**：
- 已创建测试工具 `test_dynamic_types.js`
- 测试UID 15156331结果：5条动态，1条视频投稿动态被正确识别为应跳过

---

### 4. 私聊权限限制

**需求**：
仅Root管理员（ADMIN_QQ）可以私聊bot，非Root用户私聊时收到提示。

**实现逻辑**：

```javascript
// messageHandler.js - handleMessage()开头
if (messageData.message_type === 'private') {
    const isRootAdmin = config.isRootAdmin(userId);

    if (!isRootAdmin) {
        // 非Root管理员，发送提示并返回
        this.sendPrivateMessage(ws, userId, '此功能仅限管理员使用');
        logger.info(`[MessageHandler] Rejected private message from non-admin user ${userId}`);
        return;
    }

    // Root管理员，继续处理
    groupId = `private_${userId}`;
    logger.info(`[MessageHandler] Processing private message from Root Admin ${userId}`);
}
```

**辅助函数**：

```javascript
sendPrivateMessage(ws, userId, message) {
    ws.send(JSON.stringify({
        action: 'send_private_msg',
        params: {
            user_id: userId,
            message: [{ type: 'text', data: { text: message } }]
        }
    }));
}
```

**现有代码调整**：
- 移除"任意群管理员可以私聊"的逻辑
- 保持虚拟groupId模式（`private_${userId}`）用于上下文隔离
- 确保AI上下文、向量记忆在私聊中正常工作

---

### 5. Cookie管理简化

**目标**：
移除群级Cookie管理，统一使用全局Cookie。

**后端改动**：

1. **bili_server.py**：
   - `load_credential()` 函数：移除 `cookies_{group_id}.json` 读取逻辑
   - 只保留全局 `cookies.json` 读取

2. **Dashboard API** (`src/dashboard/routes/api.js`)：
   - 移除接口：
     - `GET /api/groups/:groupId/cookies`
     - `POST /api/groups/:groupId/cookies`
     - `DELETE /api/groups/:groupId/cookies`
   - 保留接口：
     - `GET /api/cookies` - 全局Cookie读取
     - `POST /api/cookies` - 全局Cookie设置

**前端改动**：

1. **Groups.jsx**：
   - 移除"Cookie管理"标签页
   - 移除群级Cookie上传/删除功能
   - 在订阅同步标签页添加说明："关注同步使用全局Cookie，请在设置页面管理Cookie"

2. **Settings.jsx**：
   - 保留全局Cookie管理页面
   - 添加说明："全局Cookie用于所有群组的订阅和API请求"

**数据处理策略**：
- 方案A（已确认）：保留现有数据，仅移除功能
- 不删除现有 `cookies_{groupId}.json` 文件
- 用户手动删除或保留
- 启动时不检查、不警告、不迁移

---

## 前端Dashboard调整

### Groups.jsx 改动

**移除内容**：
- Cookie管理标签页（原第5个tab）
- 群级Cookie上传组件
- 群级Cookie状态显示
- 群级Cookie删除按钮

**新增/调整内容**：

1. **AI配置标签页**（新增）：
   - 群AI开关（aiEnabled）toggle
   - 群RAG开关（aiRagEnabled）toggle
   - 显示继承状态：
     - "当前使用全局设置" - 未自定义
     - "已自定义" - 有群级override
   - 重置按钮：清除群级override，恢复继承全局
   - 说明文字：
     - "AI总开关关闭时，该群AI功能不可用"
     - "AI功能关闭时，RAG功能自动不可用"

2. **订阅同步标签页**（调整）：
   - 保持原有功能
   - 添加说明："关注同步使用全局Cookie，请在设置页面管理"
   - 保持 `enableCookieSync` 开关

3. **管理员标签页**（调整）：
   - 保持原有群管理员配置
   - 添加说明："群管理员可管理群配置，Root管理员可使用私聊功能"

### Settings.jsx 改动

**AI配置区域新增**：
- 全局AI开关（aiEnabled）
- 全局RAG开关（aiRagEnabled）
- 显示影响范围："影响所有未自定义的群组"
- 说明：
  - "全局AI开关关闭后，所有群的AI功能将不可用"
  - "RAG功能需要AI功能开启才能使用"

### API路由调整

**新增接口**：

```javascript
// 获取群级AI配置
GET /api/groups/:groupId/ai-config
Response: {
  aiEnabled: boolean | null,     // null表示继承全局
  aiRagEnabled: boolean | null,
  global: {
    aiEnabled: boolean,
    aiRagEnabled: boolean
  }
}

// 更新群级AI配置
PUT /api/groups/:groupId/ai-config
Body: {
  aiEnabled?: boolean | null,    // null清除override
  aiRagEnabled?: boolean | null
}

// 重置群级AI配置（删除所有override）
DELETE /api/groups/:groupId/ai-config
```

**移除接口**：
- `GET /api/groups/:groupId/cookies`
- `POST /api/groups/:groupId/cookies`
- `DELETE /api/groups/:groupId/cookies`

---

## 测试策略

### 单元测试清单

**1. GroupId类型统一**：
- [ ] 数字groupId正确转换为字符串
- [ ] groupConfigs访问正常
- [ ] Dashboard API路径参数解析正确
- [ ] 订阅推送groupId匹配准确

**2. AI功能开关**：
- [ ] 全局AI关闭 → 所有群AI不可用
- [ ] 全局AI开启，群级关闭 → 该群AI不可用
- [ ] RAG依赖AI（AI关闭时RAG自动不可用）
- [ ] AI关闭时仍记录消息到context
- [ ] Dashboard显示继承/自定义状态正确

**3. Feed流去重**：
- [ ] 视频投稿自动动态被跳过
- [ ] 专栏投稿自动动态被跳过
- [ ] 图文动态正常推送
- [ ] 转发动态正常推送
- [ ] 直接订阅仍能检测新视频/专栏
- [ ] `test_dynamic_types.js`验证准确性

**4. 私聊权限限制**：
- [ ] Root管理员可以私聊
- [ ] 非Root管理员收到提示
- [ ] 群管理员私聊被拒绝
- [ ] 私聊AI上下文隔离正常

**5. Cookie管理简化**：
- [ ] 全局Cookie正常工作
- [ ] 群级Cookie文件被忽略
- [ ] Dashboard不显示群级Cookie管理
- [ ] 订阅同步使用全局Cookie正常

### 回归测试

**核心功能验证**：
- [ ] 链接解析（视频、动态、专栏等）
- [ ] 订阅推送（用户、番剧）
- [ ] AI聊天（with/without RAG）
- [ ] Dashboard登录和配置管理

### 性能测试

- [ ] 动态去重无性能影响
- [ ] groupId转换开销可忽略
- [ ] AI开关检查无延迟

---

## 实施计划

详见独立实施计划文档（将由 writing-plans 生成）。

预估工作量：
- 后端实现：3-4小时
- 前端实现：2-3小时
- 测试验证：1-2小时
- 总计：6-9小时

---

## 风险评估

### 高风险项

1. **GroupId类型统一**：
   - 风险：可能遗漏某些使用groupId的地方
   - 缓解：全局搜索`group_id`和`groupId`，逐一检查

2. **Feed流去重**：
   - 风险：可能误判某些动态类型
   - 缓解：已通过测试工具验证，且保留日志便于调试

### 中风险项

1. **AI功能开关**：
   - 风险：逻辑复杂度增加，可能有边界情况
   - 缓解：明确的优先级规则，充分的单元测试

2. **Cookie管理简化**：
   - 风险：用户可能不知道群级Cookie已失效
   - 缓解：Dashboard添加明确说明，日志记录清晰

### 低风险项

1. **私聊权限限制**：
   - 风险：较低，逻辑简单
   - 缓解：早期检查，清晰的日志

---

## 兼容性说明

### 向后兼容

- **配置文件**：新增字段有默认值，旧配置自动兼容
- **API接口**：移除的接口不影响现有部署（群级Cookie本就是可选功能）
- **数据文件**：不删除任何现有数据

### 破坏性变更

1. **群级Cookie失效**：
   - 影响：使用群级Cookie的部署需要迁移到全局Cookie
   - 迁移路径：手动合并Cookie到全局文件

2. **非Root管理员私聊被阻止**：
   - 影响：之前可以私聊的群管理员将无法继续使用
   - 迁移路径：添加到ADMIN_QQ环境变量成为Root管理员

---

## 附录

### 测试工具

**test_dynamic_types.js**：
- 用途：分析UP主动态类型，验证去重逻辑
- 使用：`node test_dynamic_types.js <UID>`
- 输出：动态分类、去重判断、统计摘要

### 相关文档

- CLAUDE.md - 项目架构文档
- docs/done/SECURITY_FIX_PLAN.md - 之前的安全修复计划
- src/services/subscription/README.md - 订阅系统文档（如存在）

---

**文档版本**: 1.0
**最后更新**: 2026-02-05
**下一步**: 创建详细实施计划（writing-plans）
