# Cookie同步状态保留修复方案

**日期**: 2026-02-06
**版本**: v1.1（补丁）
**优先级**: P0（关键bug）

## 问题描述

### [P0] 状态会被定时刷新覆盖

**现象**：
- `setCookieFollowings()` 在合并新旧数据时，只保留 `lastDynamicId` 和 `lastLiveStatus`
- **不保留** `lastVideoId` 和 `lastArticleId`
- `refreshCookieFollowings()` 每小时执行一次，会重建关注列表
- 导致新增的视频/专栏状态字段被清空
- 随后第一次检查会"初始化并静默跳过"，无法推送

**影响**：
- ❌ 刚修复的Cookie同步视频/专栏推送功能**完全失效**
- ❌ 每小时状态重置，永远无法正常推送
- ❌ 用户会重复收到"初始化"日志

**根本原因**：
`subscriptionManager.js` 第288-292行和第299-307行，状态合并逻辑缺少 `lastVideoId` 和 `lastArticleId` 字段。

```javascript
// 当前代码（有bug）
if (oldF) {
    return {
        ...newF,
        lastDynamicId: oldF.lastDynamicId !== undefined ? oldF.lastDynamicId : null,
        lastLiveStatus: oldF.lastLiveStatus !== undefined ? oldF.lastLiveStatus : 0
        // ❌ 缺少 lastVideoId 和 lastArticleId
    };
}
```

### [P2] 名字字段取值错误

**现象**：
- Python服务返回的关注列表使用 `name` 字段（第1400行）
- 但代码中使用 `follower.uname`
- 导致用户名为空，显示 `User_{uid}`

**影响**：
- ⚠️ 推送文案中用户名显示为 `User_1340190821` 而不是 "崩坏星穹铁道"
- ⚠️ 日志中用户名显示不友好

**根本原因**：
Python服务返回字段名为 `name`，但代码假设是 `uname`。

## 修复方案

### 修复1：状态字段保留（P0）

**文件**: `src/services/subscription/subscriptionManager.js`

**修改位置1**: 第288-292行（合并旧状态）

```javascript
// 修复前
if (oldF) {
    return {
        ...newF,
        lastDynamicId: oldF.lastDynamicId !== undefined ? oldF.lastDynamicId : null,
        lastLiveStatus: oldF.lastLiveStatus !== undefined ? oldF.lastLiveStatus : 0
    };
}

// 修复后
if (oldF) {
    return {
        ...newF,
        lastDynamicId: oldF.lastDynamicId !== undefined ? oldF.lastDynamicId : null,
        lastLiveStatus: oldF.lastLiveStatus !== undefined ? oldF.lastLiveStatus : 0,
        lastVideoId: oldF.lastVideoId !== undefined ? oldF.lastVideoId : null,      // 🆕 新增
        lastArticleId: oldF.lastArticleId !== undefined ? oldF.lastArticleId : null // 🆕 新增
    };
}
```

**修改位置2**: 第299-307行（从缓存恢复状态）

```javascript
// 修复前
const stale = this.staleFollowerState.get(id);
if (stale) {
    return {
        ...newF,
        lastDynamicId: stale.lastDynamicId,
        lastLiveStatus: stale.lastLiveStatus
    };
}
return {
    ...newF,
    lastDynamicId: null,
    lastLiveStatus: 0
};

// 修复后
const stale = this.staleFollowerState.get(id);
if (stale) {
    return {
        ...newF,
        lastDynamicId: stale.lastDynamicId,
        lastLiveStatus: stale.lastLiveStatus,
        lastVideoId: stale.lastVideoId,       // 🆕 新增
        lastArticleId: stale.lastArticleId    // 🆕 新增
    };
}
return {
    ...newF,
    lastDynamicId: null,
    lastLiveStatus: 0,
    lastVideoId: null,    // 🆕 新增
    lastArticleId: null   // 🆕 新增
};
```

### 修复2：用户名字段（P2）

**文件**: `src/services/subscription/updateChecker.js`

**修改位置**: `buildUserCheckList()` 方法中

```javascript
// 修复前
userMap.set(fid, {
    uid: fid,
    name: follower.uname || `User_${fid}`,  // ❌ 错误：应该是 name
    // ...
});

// 修复后
userMap.set(fid, {
    uid: fid,
    name: follower.name || `User_${fid}`,  // ✅ 正确：使用 name 字段
    // ...
});
```

## 验证方案

### 验证P0修复

**步骤**：
1. 手动修改 `subfollowers.json`，为某个用户添加 `lastVideoId`
2. 等待1小时后（或手动触发 `refreshCookieFollowings`）
3. 检查 `subfollowers.json`，确认 `lastVideoId` 仍然存在
4. 观察日志，不应该出现重复的"Initialized lastVideoId"

**预期结果**：
- ✅ `lastVideoId` 和 `lastArticleId` 在刷新后保留
- ✅ 不会重复初始化
- ✅ 正常推送新视频和专栏

### 验证P2修复

**步骤**：
1. 重启Bot
2. 观察日志中Cookie用户的名称
3. 检查 `subfollowers.json` 中的 `name` 字段

**预期结果**：
- ✅ 日志显示正确的用户名（如"崩坏星穹铁道"）
- ✅ 推送文案显示正确的用户名
- ✅ 不再显示 `User_{uid}` 占位符

## 影响评估

### P0修复的重要性

这是**关键修复**，没有它：
- Cookie同步视频/专栏推送功能**完全无法工作**
- 每小时状态清空，永远处于"初始化"状态
- 相当于前面的修复工作白做了

### P2修复的重要性

这是**体验优化**：
- 不影响功能，但影响用户体验
- 推送文案更友好
- 日志更易读

## 回归风险

### P0修复风险：极低
- 只是增加字段保留逻辑
- 不改变现有的动态/直播推送功能
- 向后兼容（旧数据没有这些字段，会初始化为null）

### P2修复风险：无
- 只是改变字段名，从 `uname` 到 `name`
- 两者都做了fallback处理（`|| User_{uid}`）
- 即使改错了，也只是显示占位符，不影响功能

## 实施优先级

**必须立即修复P0**，否则前面的工作无效。
**建议同时修复P2**，改动很小，避免后续二次部署。

## 测试计划

### 单元测试（可选）

```javascript
describe('setCookieFollowings state preservation', () => {
    it('should preserve lastVideoId after refresh', async () => {
        // 设置初始状态
        const followers = [{
            uid: 123,
            name: 'Test',
            lastVideoId: 'BV123',
            lastDynamicId: '456'
        }];
        await sm.setCookieFollowings('111', followers);

        // 模拟刷新（新数据不含lastVideoId）
        const newFollowers = [{
            uid: 123,
            name: 'Test'
        }];
        await sm.setCookieFollowings('111', newFollowers);

        // 验证状态保留
        const result = sm.cookieFollowings['111'];
        expect(result[0].lastVideoId).toBe('BV123');
    });
});
```

### 手动测试

1. **P0测试**：
   - 等待1小时观察状态是否保留
   - 或手动调用 `refreshCookieFollowings()`

2. **P2测试**：
   - 重启Bot观察日志中的用户名

## 相关问题

### Q: 为什么之前没有发现这个问题？

A: 因为之前Cookie同步**从不检查视频和专栏**，所以不需要这两个状态字段。这是本次修复引入的新字段，必须同步更新状态保留逻辑。

### Q: staleFollowerState 是什么？

A: 用于恢复取消关注后重新关注的用户状态。也需要包含新字段，否则恢复时会丢失状态。

### Q: 为什么不在 _normalizeFollowerState 中初始化？

A: `_normalizeFollowerState` 只负责确保字段存在，不负责状态合并。状态合并在 `setCookieFollowings` 中处理，这是正确的设计。

## 总结

- **P0修复**：4行代码（两处各增加2个字段）
- **P2修复**：1行代码（改字段名）
- **总改动**：5行代码
- **测试时间**：< 5分钟
- **部署风险**：极低

**建议**：立即修复，避免修复功能失效。
