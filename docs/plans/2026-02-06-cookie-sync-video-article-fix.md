# Cookie同步用户视频/专栏推送修复方案

**日期**: 2026-02-06
**版本**: v1.0
**优先级**: 高（功能缺失）

## 问题描述

### 现象
Cookie同步（关注同步）的用户发布视频和专栏时，系统不推送通知。只推送动态和直播。

### 根本原因
视频检查（`checkUserVideo`）和专栏检查（`checkUserArticle`）只遍历手动订阅列表（`subscriptionManager.userSubs`），不检查Cookie同步的关注列表（`subscriptionManager.cookieFollowings`）。

### 影响范围
- ❌ Cookie同步用户的视频不推送
- ❌ Cookie同步用户的专栏不推送
- ✅ Cookie同步用户的动态正常推送（通过Feed流）
- ✅ Cookie同步用户的直播正常推送（通过Live Feed流）
- ✅ 手动订阅用户的所有内容正常推送

### 证据
测试用户 UID 1340190821（崩坏星穹铁道）：
- 在Cookie关注列表中：✅
- `lastDynamicId`: 1166135461139185671（有值）
- `lastVideoId`: undefined（缺失）
- 最新视频 BV1TgFYzREzZ 未推送

---

## 设计目标

### 功能目标
1. **完整覆盖**：Cookie同步用户的视频和专栏应该被检查和推送
2. **去重保证**：同一用户既在Cookie同步列表又在手动订阅列表时，不重复推送
3. **群组过滤**：支持Cookie同步的标签过滤（`cookieSyncGroupNames`）
4. **状态同步**：Cookie同步用户的`lastVideoId`和`lastArticleId`需要持久化

### 性能目标
1. **避免重复调用**：同一用户只调用一次API
2. **批量处理**：保持现有的批量检查逻辑
3. **延迟控制**：API调用间保持合理延迟（1500ms）

### 兼容性目标
1. **向后兼容**：不影响手动订阅的现有功能
2. **配置兼容**：尊重现有的Cookie同步配置
3. **数据迁移**：平滑处理现有数据（无需手动迁移）

---

## 技术方案

### 方案A：统一用户列表（推荐）

**核心思路**：在检查前，合并手动订阅和Cookie同步的用户，生成统一的检查列表。

#### 实现步骤

**1. 新增辅助方法：构建统一用户检查列表**

```javascript
/**
 * 构建需要检查视频/专栏的用户列表
 * 包括手动订阅用户 + Cookie同步用户
 * @param {Set} activeGroups - 活跃群组集合
 * @returns {Array<{uid, name, targetGroups, source}>} 用户检查列表
 */
buildUserCheckList(activeGroups) {
    const userMap = new Map(); // uid -> {uid, name, targetGroups, source}

    // 1. 添加手动订阅用户
    for (const sub of subscriptionManager.userSubs) {
        const targetGroups = sub.groupIds.filter(gid => activeGroups.has(gid));
        if (targetGroups.length === 0) continue;

        userMap.set(sub.uid, {
            uid: sub.uid,
            name: sub.name,
            targetGroups: targetGroups,
            source: 'manual',
            manualSub: sub // 保留原始订阅对象的引用
        });
    }

    // 2. 添加Cookie同步用户
    for (const [accountUid, followers] of Object.entries(subscriptionManager.cookieFollowings)) {
        for (const follower of followers) {
            const fid = subscriptionManager.getFollowerId(follower);
            if (!fid) continue;

            // 使用 findTargetGroupsForUser 判断哪些群组需要推送
            const targetGroups = this.findTargetGroupsForUser(accountUid, follower, activeGroups);
            if (targetGroups.length === 0) continue;

            // 如果用户已存在（手动订阅），合并目标群组
            if (userMap.has(fid)) {
                const existing = userMap.get(fid);
                // 合并群组（去重）
                const mergedGroups = [...new Set([...existing.targetGroups, ...targetGroups])];
                existing.targetGroups = mergedGroups;
                existing.source = 'both'; // 标记为双重来源
                existing.cookieFollower = follower; // 添加Cookie follower引用
            } else {
                userMap.set(fid, {
                    uid: fid,
                    name: follower.uname,
                    targetGroups: targetGroups,
                    source: 'cookie',
                    cookieFollower: follower,
                    accountUid: accountUid // Cookie所属账号
                });
            }
        }
    }

    return Array.from(userMap.values());
}
```

**2. 修改 checkAll() 方法**

```javascript
async checkAll() {
    logger.info('[UpdateChecker] Starting scheduled check...');

    // ... 现有代码 ...

    // 构建统一的用户检查列表（手动订阅 + Cookie同步）
    const userCheckList = this.buildUserCheckList(activeGroups);
    logger.info(`[UpdateChecker] Built unified user check list: ${userCheckList.length} users`);

    // 3. Check User Videos (Manual Subs + Cookie Sync)
    logger.info('[UpdateChecker] Checking user videos...');
    for (const userItem of userCheckList) {
        await this.checkUserVideoUnified(userItem);
        await new Promise(r => setTimeout(r, 1500));
    }

    // 4. Check User Articles (Manual Subs + Cookie Sync)
    logger.info('[UpdateChecker] Checking user articles...');
    for (const userItem of userCheckList) {
        await this.checkUserArticleUnified(userItem);
        await new Promise(r => setTimeout(r, 1500));
    }

    // ... 其余代码保持不变 ...
}
```

**3. 新增统一检查方法**

```javascript
/**
 * 统一的视频检查方法（支持手动订阅和Cookie同步）
 * @param {Object} userItem - 从buildUserCheckList返回的用户对象
 * @param {boolean} force - 是否强制检查
 */
async checkUserVideoUnified(userItem, force = false) {
    const { uid, name, targetGroups, source, manualSub, cookieFollower, accountUid } = userItem;

    try {
        const groupId = targetGroups[0];
        const res = await biliApi.getUserVideos(uid, groupId);

        if (res.status !== 'success' || !res.data.videos || res.data.videos.length === 0) {
            return;
        }

        const videos = res.data.videos;
        videos.sort((a, b) => b.created - a.created);
        const latestVideo = videos[0];
        const latestBvid = latestVideo.bvid;

        // 获取lastVideoId（优先从手动订阅，其次从Cookie follower）
        let lastVideoId = null;
        if (manualSub) {
            lastVideoId = manualSub.lastVideoId;
        } else if (cookieFollower) {
            lastVideoId = cookieFollower.lastVideoId;
        }

        // 首次检查：记录最新视频但不推送
        if (!lastVideoId && !force) {
            await this.updateVideoState(userItem, latestBvid);
            logger.info(`[UpdateChecker] Initialized lastVideoId for ${name} (${source}): ${latestBvid}`);
            return;
        }

        // 检查是否有新视频
        if (latestBvid !== lastVideoId || force) {
            const newVideos = [];
            for (const video of videos) {
                if (video.bvid === lastVideoId) break;
                newVideos.push(video);
            }

            let videoToPush;
            if (newVideos.length === 0) {
                if (!force) {
                    await this.updateVideoState(userItem, latestBvid);
                    logger.debug(`[UpdateChecker] No new videos for ${name}, updated tracking to ${latestBvid}`);
                    return;
                } else {
                    logger.debug(`[UpdateChecker] Force check: pushing latest video for ${name}: ${latestBvid}`);
                    videoToPush = [latestVideo];
                }
            } else {
                videoToPush = [newVideos[0]];
                logger.debug(`[UpdateChecker] Found ${newVideos.length} new video(s) for ${name}, pushing latest: ${newVideos[0].bvid}`);
            }

            for (const video of videoToPush) {
                try {
                    const bvid = video.bvid;
                    const info = await biliApi.getVideoInfo(bvid, groupId);

                    if (info.status !== 'success') {
                        logger.warn(`[UpdateChecker] Failed to get video detail for ${bvid}`);
                        continue;
                    }

                    const notificationText = `${name} 投稿了新视频：\n${info.data.title}`;
                    const url = `https://www.bilibili.com/video/${bvid}`;
                    await this.notifyGroupsWithImageAndCache(targetGroups, info, 'video', url, notificationText);

                    logger.info(`[UpdateChecker] Pushed new video for ${name} (${source}): ${bvid}`);
                } catch (e) {
                    logger.error(`[UpdateChecker] Failed to push video ${video.bvid}:`, e);
                }
            }

            await this.updateVideoState(userItem, latestBvid);
        }
    } catch (e) {
        logger.error(`[UpdateChecker] Error checking videos for ${name}:`, e);
    }
}

/**
 * 统一的专栏检查方法（支持手动订阅和Cookie同步）
 * @param {Object} userItem - 从buildUserCheckList返回的用户对象
 * @param {boolean} force - 是否强制检查
 */
async checkUserArticleUnified(userItem, force = false) {
    // 实现逻辑与 checkUserVideoUnified 类似
    // ... 详细代码略（与视频检查逻辑平行）
}

/**
 * 更新用户的视频状态
 * @param {Object} userItem - 用户对象
 * @param {string} videoId - 最新视频ID
 */
async updateVideoState(userItem, videoId) {
    const { source, manualSub, cookieFollower, accountUid } = userItem;

    // 更新手动订阅的状态
    if (manualSub) {
        await subscriptionManager.updateUserSub(userItem.uid, { lastVideoId: videoId });
    }

    // 更新Cookie follower的状态
    if (cookieFollower) {
        cookieFollower.lastVideoId = videoId;
        const followers = subscriptionManager.cookieFollowings[accountUid];
        if (followers) {
            await subscriptionManager.setCookieFollowings(accountUid, followers);
        }
    }
}

/**
 * 更新用户的专栏状态
 * @param {Object} userItem - 用户对象
 * @param {string} articleId - 最新专栏ID
 */
async updateArticleState(userItem, articleId) {
    // 实现逻辑与 updateVideoState 类似
    // ... 详细代码略
}
```

#### 优点
- ✅ 统一处理手动订阅和Cookie同步
- ✅ 自动去重（同一用户只调用一次API）
- ✅ 支持群组合并（用户同时在两个来源时）
- ✅ 状态同步到正确的数据结构

#### 缺点
- ⚠️ 代码改动较大（需要新增多个方法）
- ⚠️ 需要仔细处理状态更新逻辑

---

### 方案B：双路径处理（备选）

**核心思路**：保持手动订阅和Cookie同步的独立检查路径，但在Cookie同步路径中增加视频/专栏检查。

#### 实现步骤

**1. 在 checkAll() 中增加Cookie同步用户的视频/专栏检查**

```javascript
async checkAll() {
    // ... 现有代码 ...

    // 3. Check User Videos (Manual Subs)
    logger.info('[UpdateChecker] Checking user videos (manual subs)...');
    for (const sub of subscriptionManager.userSubs) {
        const targetGroups = sub.groupIds.filter(gid => activeGroups.has(gid));
        if (targetGroups.length === 0) continue;
        await this.checkUserVideo(sub, targetGroups);
        await new Promise(r => setTimeout(r, 1500));
    }

    // 3.5. Check User Videos (Cookie Sync) - 新增
    logger.info('[UpdateChecker] Checking user videos (cookie sync)...');
    await this.checkCookieSyncVideos(activeGroups);

    // 4. Check User Articles (Manual Subs)
    logger.info('[UpdateChecker] Checking user articles (manual subs)...');
    for (const sub of subscriptionManager.userSubs) {
        const targetGroups = sub.groupIds.filter(gid => activeGroups.has(gid));
        if (targetGroups.length === 0) continue;
        await this.checkUserArticle(sub, targetGroups);
        await new Promise(r => setTimeout(r, 1500));
    }

    // 4.5. Check User Articles (Cookie Sync) - 新增
    logger.info('[UpdateChecker] Checking user articles (cookie sync)...');
    await this.checkCookieSyncArticles(activeGroups);

    // ... 其余代码保持不变 ...
}
```

**2. 新增Cookie同步用户的视频/专栏检查方法**

```javascript
/**
 * 检查Cookie同步用户的视频
 */
async checkCookieSyncVideos(activeGroups) {
    for (const [accountUid, followers] of Object.entries(subscriptionManager.cookieFollowings)) {
        for (const follower of followers) {
            const uid = subscriptionManager.getFollowerId(follower);
            if (!uid) continue;

            // 跳过已在手动订阅列表中的用户（避免重复）
            const manualSub = subscriptionManager.userSubs.find(s => String(s.uid) === uid);
            if (manualSub) continue;

            // 使用 findTargetGroupsForUser 判断哪些群组需要推送
            const targetGroups = this.findTargetGroupsForUser(accountUid, follower, activeGroups);
            if (targetGroups.length === 0) continue;

            // 构造类似手动订阅的对象
            const pseudoSub = {
                uid: uid,
                name: follower.uname || `User_${uid}`,
                lastVideoId: follower.lastVideoId,
                groupIds: targetGroups,
                _source: 'cookie', // 标记来源
                _accountUid: accountUid,
                _follower: follower
            };

            await this.checkUserVideo(pseudoSub, targetGroups);
            await new Promise(r => setTimeout(r, 1500));
        }
    }
}

/**
 * 检查Cookie同步用户的专栏
 */
async checkCookieSyncArticles(activeGroups) {
    // 实现逻辑与 checkCookieSyncVideos 类似
    // ... 详细代码略
}
```

**3. 修改 checkUserVideo 方法支持Cookie来源**

```javascript
async checkUserVideo(sub, targetGroups = null, force = false) {
    // ... 现有代码 ...

    // 更新lastVideoId时，需要判断来源
    if (sub._source === 'cookie') {
        // 更新Cookie follower的状态
        sub._follower.lastVideoId = latestBvid;
        const followers = subscriptionManager.cookieFollowings[sub._accountUid];
        if (followers) {
            await subscriptionManager.setCookieFollowings(sub._accountUid, followers);
        }
    } else {
        // 更新手动订阅的状态（原有逻辑）
        await subscriptionManager.updateUserSub(sub.uid, { lastVideoId: latestBvid });
    }
}
```

#### 优点
- ✅ 代码改动较小（主要是增量）
- ✅ 保持手动订阅和Cookie同步的独立性
- ✅ 易于理解和维护

#### 缺点
- ⚠️ 存在重复代码（checkCookieSyncVideos 和现有逻辑类似）
- ⚠️ 需要在多处判断来源（增加复杂度）

---

## 推荐方案

**推荐使用方案A（统一用户列表）**

### 理由
1. **更清晰的架构**：统一处理所有用户，无论来源
2. **自动去重**：天然避免重复检查和推送
3. **易于扩展**：未来如果有新的用户来源，只需修改`buildUserCheckList`
4. **状态管理集中**：`updateVideoState`统一处理状态更新
5. **性能更优**：同一用户只调用一次API

### 实施步骤

#### 第一阶段：核心功能（必需）
1. 实现`buildUserCheckList()`方法
2. 实现`checkUserVideoUnified()`方法
3. 实现`checkUserArticleUnified()`方法
4. 实现`updateVideoState()`和`updateArticleState()`方法
5. 修改`checkAll()`调用新方法

#### 第二阶段：兼容和优化（推荐）
6. 保留旧的`checkUserVideo`和`checkUserArticle`方法（用于强制检查命令）
7. 添加详细的日志输出（区分来源）
8. 添加性能监控（API调用次数、耗时）

#### 第三阶段：测试和验证（必需）
9. 单元测试：`buildUserCheckList`去重逻辑
10. 集成测试：Cookie同步用户视频推送
11. 回归测试：手动订阅用户功能不受影响

---

## 边界情况处理

### 1. 用户既在手动订阅又在Cookie关注中
**场景**：用户同时通过`/订阅用户`和Cookie同步添加

**处理**：
- 合并目标群组（去重）
- 状态同时更新两个数据结构
- 推送只发送一次（通过`notifyGroupsWithImageAndCache`的去重机制）

### 2. Cookie同步的用户没有用户名
**场景**：`follower.uname`为空

**处理**：
- 使用占位符：`User_{uid}`
- 后台异步获取用户信息并更新（通过`refreshMissingNames`）

### 3. Cookie同步用户被取消关注
**场景**：用户在B站取消关注后，下次同步时被移除

**处理**：
- 自动从`cookieFollowings`中移除
- 不影响手动订阅的用户
- `lastVideoId`等状态会丢失（符合预期）

### 4. 多个账号关注同一用户
**场景**：多个Cookie账号关注同一UP主

**处理**：
- `buildUserCheckList`会自动合并
- 只调用一次API
- 根据每个账号的标签过滤推送到不同群组

### 5. Cookie同步用户没有标签
**场景**：关注列表中的用户没有分组标签

**处理**：
- 如果配置了`cookieSyncGroupNames`（标签过滤），该用户不会推送
- 如果未配置（空数组），推送给所有启用Cookie同步的群组

### 6. API返回空列表
**场景**：`getUserVideos`返回空数组

**处理**：
- 直接返回，不做任何推送和状态更新
- 记录debug日志（不是error）

### 7. 状态更新失败
**场景**：`setCookieFollowings`写入文件失败

**处理**：
- 记录error日志
- 不阻断后续检查
- 下次检查时可能重复推送（可接受的降级行为）

---

## 性能影响分析

### API调用量变化

**修复前**：
- 动态检查：所有关注用户（通过Feed流，1次API）
- 视频检查：只检查手动订阅用户（每用户1次API）
- 专栏检查：只检查手动订阅用户（每用户1次API）

**修复后**：
- 动态检查：所有关注用户（通过Feed流，1次API）✅ 无变化
- 视频检查：手动订阅 + Cookie同步用户（每用户1次API，自动去重）⚠️ **增加API调用**
- 专栏检查：手动订阅 + Cookie同步用户（每用户1次API，自动去重）⚠️ **增加API调用**

### 数量估算

假设：
- 手动订阅用户：5人
- Cookie关注用户：50人
- 重复用户（既订阅又关注）：2人

**修复前**：
- 视频API调用：5次/周期
- 专栏API调用：5次/周期

**修复后**：
- 视频API调用：53次/周期（5 + 50 - 2）
- 专栏API调用：53次/周期（5 + 50 - 2）

**检查周期**：默认60秒，每天1440次

**每天增加API调用**：
- 视频：(53 - 5) × 1440 = 69,120次
- 专栏：(53 - 5) × 1440 = 69,120次
- **总计**：138,240次/天

### 性能优化建议

#### 短期优化（修复时实施）
1. **保持现有延迟**：视频和专栏检查间延迟1500ms
2. **批量处理**：按顺序检查，不并发（避免rate limit）
3. **早期返回**：API失败或无内容时立即返回

#### 中期优化（后续改进）
1. **智能调度**：根据UP主活跃度动态调整检查频率
   - 活跃UP（1周内发过视频）：每60秒检查
   - 普通UP（1月内发过视频）：每5分钟检查
   - 不活跃UP（1月内无视频）：每30分钟检查

2. **批量API**：如果B站支持批量查询，改用批量接口
   - 当前：每用户1次API调用
   - 优化：每20用户1次API调用

3. **缓存优化**：视频列表缓存（TTL=5分钟）
   - 减少重复查询
   - 特别适合多群订阅同一UP主的场景

#### 长期优化（架构改进）
1. **WebHook替代轮询**：使用B站Webhook（如果可用）
2. **分布式调度**：多实例协作，分担API压力
3. **优先队列**：根据UP主重要性排序检查

### 风险评估

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| API rate limit | 部分用户检查失败 | 中 | 保持1500ms延迟，添加重试逻辑 |
| 内存占用增加 | 服务响应变慢 | 低 | 数据结构优化，增量加载 |
| 检查周期延长 | 推送延迟增加 | 中 | 调整检查间隔（60s → 120s） |
| 数据库写入压力 | 文件写入冲突 | 低 | 使用现有的防抖机制 |

---

## 测试计划

### 单元测试

#### 1. buildUserCheckList() 测试
```javascript
describe('buildUserCheckList', () => {
    it('应该包含所有手动订阅用户', () => {
        // ...
    });

    it('应该包含所有Cookie同步用户', () => {
        // ...
    });

    it('应该正确去重重复用户', () => {
        // 同一UID在两个来源中
        // 验证只出现一次，且群组已合并
    });

    it('应该正确应用标签过滤', () => {
        // Cookie用户有标签，配置了标签过滤
        // 验证不匹配的用户被过滤
    });

    it('应该过滤掉不活跃的群组', () => {
        // 用户订阅的群组已退出
        // 验证targetGroups为空时不包含该用户
    });
});
```

#### 2. checkUserVideoUnified() 测试
```javascript
describe('checkUserVideoUnified', () => {
    it('首次检查应初始化lastVideoId但不推送', () => {
        // ...
    });

    it('有新视频时应推送', () => {
        // ...
    });

    it('无新视频时应更新状态但不推送', () => {
        // ...
    });

    it('应正确更新手动订阅用户的状态', () => {
        // ...
    });

    it('应正确更新Cookie用户的状态', () => {
        // ...
    });

    it('双来源用户应同时更新两个状态', () => {
        // ...
    });
});
```

### 集成测试

#### 测试场景1：纯Cookie同步用户
**前置条件**：
- 用户A (UID: 1340190821) 只在Cookie关注列表中
- 启用Cookie同步
- 配置标签过滤：`['米哈游']`
- 用户A有标签：`['米哈游']`

**操作**：
1. 用户A发布新视频 BV_TEST_001
2. 等待下一个检查周期（60秒）

**预期结果**：
- ✅ 群组收到视频推送通知
- ✅ `cookieFollowings[accountUid]`中用户A的`lastVideoId`更新为BV_TEST_001
- ✅ 日志显示：`Pushed new video for 崩坏星穹铁道 (cookie): BV_TEST_001`

#### 测试场景2：手动订阅用户
**前置条件**：
- 用户B (UID: 15156331) 只在手动订阅列表中

**操作**：
1. 用户B发布新视频 BV_TEST_002
2. 等待下一个检查周期

**预期结果**：
- ✅ 群组收到视频推送通知
- ✅ `subscriptions.json`中用户B的`lastVideoId`更新为BV_TEST_002
- ✅ 日志显示：`Pushed new video for Zzz做个好梦 (manual): BV_TEST_002`

#### 测试场景3：双来源用户（去重）
**前置条件**：
- 用户C既在手动订阅又在Cookie关注中
- 手动订阅群组：[G1, G2]
- Cookie同步群组：[G2, G3]（标签匹配）

**操作**：
1. 用户C发布新视频 BV_TEST_003
2. 等待下一个检查周期

**预期结果**：
- ✅ 群组G1收到推送（仅手动订阅）
- ✅ 群组G2收到推送（合并后，只推送1次）
- ✅ 群组G3收到推送（仅Cookie同步）
- ✅ 两个数据结构的`lastVideoId`都更新
- ✅ API只调用1次（去重成功）
- ✅ 日志显示：`Pushed new video for User_C (both): BV_TEST_003`

#### 测试场景4：标签过滤
**前置条件**：
- 用户D在Cookie关注中，标签：`['游戏']`
- 配置标签过滤：`['米哈游']`（不匹配）

**操作**：
1. 用户D发布新视频 BV_TEST_004
2. 等待下一个检查周期

**预期结果**：
- ❌ 不推送到任何群组
- ✅ `buildUserCheckList`中不包含用户D
- ✅ 不调用API

#### 测试场景5：专栏推送
**前置条件**：
- 用户E在Cookie关注中

**操作**：
1. 用户E发布新专栏 cv123456
2. 等待下一个检查周期

**预期结果**：
- ✅ 群组收到专栏推送通知
- ✅ `lastArticleId`更新为cv123456

### 回归测试

| 测试项 | 描述 | 预期结果 |
|--------|------|----------|
| 动态推送 | Cookie用户发布普通动态 | ✅ 正常推送 |
| 直播推送 | Cookie用户开始直播 | ✅ 正常推送 |
| 手动订阅视频 | 手动订阅用户发布视频 | ✅ 正常推送 |
| 视频动态跳过 | 视频投稿的自动动态 | ✅ 正确跳过 |
| 专栏动态跳过 | 专栏投稿的自动动态 | ✅ 正确跳过 |
| 番剧推送 | 订阅的番剧更新 | ✅ 正常推送 |
| Dashboard管理 | 通过Dashboard管理订阅 | ✅ 功能正常 |

### 性能测试

#### 测试用例
- **小规模**：5个手动订阅 + 10个Cookie关注
- **中规模**：5个手动订阅 + 50个Cookie关注（典型场景）
- **大规模**：10个手动订阅 + 200个Cookie关注（压力测试）

#### 测试指标
1. **检查周期耗时**：从checkAll开始到结束的时间
2. **API调用次数**：每个周期的实际API调用数
3. **内存占用**：userCheckList的内存大小
4. **推送延迟**：从视频发布到推送的时间

#### 性能基准
- 中规模场景下，检查周期耗时应 < 120秒
- API调用次数应等于去重后的用户数
- 内存占用应 < 10MB（假设每用户200字节）
- 推送延迟应 < 检查间隔 + 检查周期耗时（< 3分钟）

---

## 回滚方案

### 回滚触发条件
1. 生产环境出现严重bug（推送错误、重复推送）
2. 性能问题导致服务不可用（API rate limit）
3. 数据损坏（状态更新错误）

### 回滚步骤

#### 代码回滚
```bash
# 1. 回退到修复前的commit
git revert <fix-commit-hash>

# 2. 重启服务
npm run restart
```

#### 数据修复（如需要）
```bash
# 1. 恢复 subfollowers.json 备份
cp data/subfollowers.json.backup data/subfollowers.json

# 2. 清理错误的 lastVideoId
node scripts/cleanup-video-state.js
```

#### 降级方案
如果无法立即回滚，使用临时配置禁用Cookie同步的视频/专栏检查：

```javascript
// 在 updateChecker.js 的 checkAll() 开头添加
const DISABLE_COOKIE_VIDEO_CHECK = process.env.DISABLE_COOKIE_VIDEO_CHECK === 'true';
if (DISABLE_COOKIE_VIDEO_CHECK) {
    logger.warn('[UpdateChecker] Cookie sync video/article check is disabled');
    // 跳过新增的检查逻辑
}
```

启动时设置环境变量：
```bash
DISABLE_COOKIE_VIDEO_CHECK=true npm start
```

---

## 后续优化建议

### 短期（1-2周内）
1. **监控和告警**
   - 添加检查周期耗时监控
   - API调用失败率告警
   - 推送延迟监控

2. **日志优化**
   - 增加来源标识（manual/cookie/both）
   - 记录API调用统计
   - 记录去重效果

### 中期（1-2个月内）
1. **智能调度**
   - 根据UP主活跃度调整检查频率
   - 实现优先队列（热门UP优先）

2. **性能优化**
   - 实现视频列表缓存
   - 批量API调用（如果支持）

3. **用户体验**
   - Dashboard显示Cookie同步状态
   - 支持单独禁用某个Cookie用户的视频推送

### 长期（3个月以上）
1. **架构优化**
   - 考虑使用消息队列（Redis Stream）
   - 实现分布式调度
   - WebHook替代轮询

2. **数据分析**
   - 统计推送效果（打开率、互动率）
   - 优化推送策略

---

## 文档更新

修复完成后需要更新以下文档：

1. **CLAUDE.md**
   - 更新订阅系统说明
   - 添加Cookie同步视频/专栏推送的说明

2. **README.md**
   - 更新功能列表
   - 添加Cookie同步的完整功能说明

3. **用户手册**
   - 说明Cookie同步的完整功能
   - 添加FAQ：Cookie同步和手动订阅的区别

4. **API文档**
   - 更新订阅系统API说明
   - 添加统计接口（查看Cookie同步状态）

---

## 总结

### 关键决策
- ✅ **推荐方案A**（统一用户列表）：架构更清晰，易于维护
- ✅ **状态同步**：Cookie用户的lastVideoId持久化到subfollowers.json
- ✅ **自动去重**：通过userMap实现，避免重复检查和推送
- ✅ **性能可控**：保持现有延迟机制，增加的API调用在可接受范围内

### 风险控制
- ⚠️ **API调用量增加**：通过智能调度和缓存优化缓解
- ⚠️ **测试覆盖**：完整的单元测试和集成测试
- ⚠️ **回滚准备**：明确的回滚步骤和降级方案

### 成功标准
1. ✅ Cookie同步用户的视频和专栏正常推送
2. ✅ 手动订阅功能不受影响
3. ✅ 检查周期耗时在可接受范围内（< 120秒）
4. ✅ 无重复推送
5. ✅ 状态持久化正确

### 下一步
- 等待批准后开始实施
- 建议在测试环境先验证
- 灰度发布：先上线部分群组，观察1-2天
- 全量发布：确认无问题后全量上线
