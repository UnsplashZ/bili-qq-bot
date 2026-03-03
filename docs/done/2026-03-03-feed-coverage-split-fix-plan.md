# 2026-03-03 Feed 覆盖集合拆分修复计划（动态/直播独立）

## 1. 问题定义

当前 `checkFeedUpdate` 只在 `processDynamicFeed` 与 `processLiveFeed` **都成功**后，才将 UID 写入 `feedMonitoredUids`。
这会导致一个明确回归场景：

- 动态 feed 成功并已推送；
- 直播 feed 失败并抛错；
- catch 分支未写入 `feedMonitoredUids`；
- `checkAll` 后续执行 `checkUserDynamic` 时不会跳过该 UID，触发重复动态推送风险。

受影响文件：
- `src/services/subscription/updateChecker.js`

---

## 2. 修复目标与边界

### 2.1 目标

1. 动态与直播的“已由 feed 覆盖”状态拆分存储与消费。
2. 允许部分成功：动态成功时仅跳过 manual 动态；直播失败时 manual 直播仍执行。
3. 保留现有“feed 失败时 manual 兜底”语义，不引入漏推。

### 2.2 非目标

1. 不改动视频/专栏检查链路。
2. 不改变 `processDynamicFeed` / `processLiveFeed` 的业务判定逻辑（仅改调用方提交时机）。
3. 不调整外部 API 协议。

---

## 3. 设计总览

将单集合：

```js
const feedMonitoredUids = new Set()
```

替换为双集合：

```js
const feedCoverage = {
  dynamicUids: new Set(),
  liveUids: new Set(),
}
```

并在 `checkAll` 中按能力维度判断跳过：

- `checkUserDynamic` 仅参考 `feedCoverage.dynamicUids`
- `checkUserLive` 仅参考 `feedCoverage.liveUids`

`checkFeedUpdate` 采用分阶段提交：

- 动态阶段成功 => 提交 `dynamicUids`
- 直播阶段成功 => 提交 `liveUids`
- 任一阶段失败不影响另一阶段已提交结果

---

## 4. 精确代码改造方案

### 4.1 修改 `checkAll` 的覆盖集合模型

文件：`src/services/subscription/updateChecker.js`
函数：`async checkAll()`

#### 4.1.1 当前关键代码（需替换）

```js
const feedMonitoredUids = new Set();
await this.checkFeedUpdate(feedMonitoredUids, activeGroups);

if (feedMonitoredUids.has(String(sub.uid))) {
  continue;
}
```

#### 4.1.2 目标代码

```js
const feedCoverage = {
    dynamicUids: new Set(),
    liveUids: new Set(),
};

await this.checkFeedUpdate(feedCoverage, activeGroups);

// 动态兜底跳过判定
if (feedCoverage.dynamicUids.has(String(sub.uid))) {
    continue;
}

// 直播兜底跳过判定
if (feedCoverage.liveUids.has(String(sub.uid))) {
    continue;
}
```

#### 4.1.3 同步更新注释

将注释从“feed 覆盖用户集合（单一）”改为“按动态/直播拆分的覆盖集合”，避免后续误维护。

---

### 4.2 修改 `checkFeedUpdate` 的签名与提交时机

文件：`src/services/subscription/updateChecker.js`
函数：`async checkFeedUpdate(...)`

#### 4.2.1 签名调整

当前：

```js
async checkFeedUpdate(monitoredUidsSet = null, activeGroups = null)
```

目标：

```js
async checkFeedUpdate(feedCoverage = null, activeGroups = null)
```

并在函数头部规范化：

```js
const dynamicCoverage = feedCoverage?.dynamicUids instanceof Set ? feedCoverage.dynamicUids : null;
const liveCoverage = feedCoverage?.liveUids instanceof Set ? feedCoverage.liveUids : null;
```

> 说明：保持容错，调用方即使未传也不会异常。

#### 4.2.2 账号循环改为“分阶段独立 try/catch”

将当前单个 `try { dynamic; live; commit } catch {}` 拆为如下流程：

```js
for (const [uid, groupId] of accountGroups) {
    const uidsCoveredByFeed = this.collectFeedCoveredUids(uid, activeGroups);

    // A. 动态阶段
    let dynamicSucceeded = false;
    try {
        await this.processDynamicFeed(uid, groupId, activeGroups);
        dynamicSucceeded = true;
        if (dynamicCoverage) {
            for (const fid of uidsCoveredByFeed) dynamicCoverage.add(fid);
        }
    } catch (e) {
        logger.error(`[UpdateChecker] Dynamic feed failed for account ${uid}:`, e);
    }

    // B. 动态与直播之间保留原节流
    await new Promise(r => setTimeout(r, 2000));

    // C. 直播阶段
    let liveSucceeded = false;
    try {
        await this.processLiveFeed(uid, groupId, activeGroups);
        liveSucceeded = true;
        if (liveCoverage) {
            for (const fid of uidsCoveredByFeed) liveCoverage.add(fid);
        }
    } catch (e) {
        logger.error(`[UpdateChecker] Live feed failed for account ${uid}:`, e);
    }

    logger.debug(`[UpdateChecker] Feed coverage commit for ${uid}: dynamic=${dynamicSucceeded}, live=${liveSucceeded}, candidates=${uidsCoveredByFeed.length}`);
}
```

> 关键点：
> - 直播失败不回滚已提交的动态覆盖。
> - 动态失败也不阻断直播阶段执行（直播可独立成功并提交 live 覆盖）。

---

### 4.3 抽取候选 UID 收集逻辑，避免重复代码

文件：`src/services/subscription/updateChecker.js`
位置：`checkFeedUpdate` 附近新增私有方法（类方法）

新增：

```js
collectFeedCoveredUids(accountUid, activeGroups = null) {
    const followers = subscriptionManager.cookieFollowings[String(accountUid)] || [];
    const uids = [];

    for (const f of followers) {
        const fid = subscriptionManager.getFollowerId(f);
        if (!fid) continue;

        const targetGroups = this.findTargetGroupsForUser(accountUid, f, activeGroups);
        if (targetGroups.length > 0) {
            uids.push(fid);
        }
    }

    return uids;
}
```

收益：
- 提升可读性与复用性；
- 未来若 targetGroups 规则调整，只需改一处。

---

### 4.4 日志与可观测性补强（建议纳入本次）

在 `checkAll` 的动态/直播两段 manual 循环前，分别记录集合规模：

```js
logger.debug(`[UpdateChecker] Feed coverage: dynamic=${feedCoverage.dynamicUids.size}, live=${feedCoverage.liveUids.size}`);
```

用途：
- 出现重复推送时可以快速判断是“覆盖未提交”还是“manual 跳过条件错误”。

---

## 5. 代码变更清单（文件级）

### 必改

1. `src/services/subscription/updateChecker.js`
- `checkAll`：单集合改双集合；动态/直播跳过条件分离。
- `checkFeedUpdate`：签名与流程重构为分阶段提交。
- 新增 `collectFeedCoveredUids(accountUid, activeGroups)`。
- 新增/调整 debug 日志。

### 可选（推荐）

1. `docs/done/2026-03-03-code-review-full-fix-plan.md`
- 在对应 P1/P2 条目补充“动态/直播覆盖拆分已落地设计”。

---

## 6. 测试计划（精确到测试文件）

当前仓库暂无 `updateChecker` 直接单测，建议新增：

- `test/unit/updateChecker-feedCoverageSplit.test.js`

### 6.1 测试结构建议

采用现有单测风格（`assert` + 直接运行脚本）：

1. 备份并替换以下方法（`finally` 恢复）：
- `updateChecker.checkFeedUpdate`
- `updateChecker.checkUserDynamic`
- `updateChecker.checkUserLive`
- `updateChecker.buildUserCheckList`
- `updateChecker.checkUserVideoUnified`
- `updateChecker.checkUserArticleUnified`
- `subscriptionManager._ensureSubscriptionsLoaded`
- `subscriptionManager.userSubs`
- `config.groupConfigs`

2. 控制数据最小化（1~2 个订阅）以降低等待时间。

### 6.2 必测场景矩阵

1. 场景 A：动态成功 + 直播抛错
- 模拟 `checkFeedUpdate` 仅写入 `dynamicUids`
- 断言 `checkUserDynamic` 未调用、`checkUserLive` 被调用

2. 场景 B：动态抛错 + 直播成功
- 模拟 `checkFeedUpdate` 仅写入 `liveUids`
- 断言 `checkUserDynamic` 被调用、`checkUserLive` 未调用

3. 场景 C：动态成功 + 直播成功
- 同时写入两个集合
- 断言 dynamic/live manual 均跳过

4. 场景 D：动态失败 + 直播失败
- 两集合均不写
- 断言 dynamic/live manual 均执行

5. 场景 E：多 UID 混合
- `uid1` 仅 dynamic 覆盖，`uid2` 仅 live 覆盖
- 断言跳过行为按 UID 与能力维度分别正确

### 6.3 运行命令

```bash
npx mocha "test/unit/updateChecker-feedCoverageSplit.test.js" --exit
```

如需全量回归：

```bash
npx mocha "test/unit/**/*.test.js" --exit
```

---

## 7. 回归风险与防护

### 风险 1：集合命名或键访问错误导致全部不跳过

防护：
- `checkFeedUpdate` 内做 `instanceof Set` 容错。
- 增加 debug 日志输出集合大小。

### 风险 2：分阶段异常处理改变节流行为

防护：
- 维持原有 dynamic→live 之间 `2s` 等待。
- 保持 manual 流程等待逻辑不改，降低行为抖动。

### 风险 3：代码分支增加后可读性下降

防护：
- 抽 `collectFeedCoveredUids` 减少循环内复杂度。
- 统一日志前缀：`Dynamic feed failed` / `Live feed failed`。

---

## 8. 实施顺序（可直接执行）

1. 修改 `checkAll` 覆盖集合结构与跳过条件。
2. 重构 `checkFeedUpdate` 为动态/直播分阶段提交。
3. 抽取 `collectFeedCoveredUids` 并替换原内联逻辑。
4. 增加 debug 日志。
5. 新增 `test/unit/updateChecker-feedCoverageSplit.test.js`。
6. 执行目标单测 + 全量单测。

---

## 9. 完成标准（Definition of Done）

1. 代码层：
- 不再使用单一 `feedMonitoredUids` 控制 dynamic/live 两条 manual 链路。
- `checkFeedUpdate` 任一阶段成功可独立提交对应覆盖集合。

2. 行为层：
- “动态成功 + 直播失败”时，不会重复动态推送，且直播仍有 manual 兜底。
- “动态失败 + 直播成功”时，动态 manual 正常兜底，直播不重复推送。

3. 测试层：
- 新增用例全部通过。
- 现有单测不回归。
