# 大文件盘点与 `updateChecker.js` 完整拆分方案

日期: 2026-03-04  
作者: Codex

## 1. 背景与目标

本文件用于沉淀两件事:

1. 记录当前项目中代码量超过 1000 行的文件，作为后续架构治理基线。
2. 对 `src/services/subscription/updateChecker.js` 给出可落地、可回滚、尽量低风险的完整拆分设计。

本方案默认遵循:

- 先保证行为不变，再做结构优化。
- 先抽“纯函数/工具”，再抽“业务模块”。
- 先保留现有对外 API（兼容调用方），再逐步推进接口收敛。

---

## 2. 大文件盘点（>1000 行）

统计口径:

- 仅统计项目源码文件。
- 排除 `node_modules`、`venv`、`dashboard/dist`、`docs`、`data`、`logs`、`napcat`、lock 文件。

复现命令:

```bash
rg --files -g '!node_modules/**' -g '!venv/**' -g '!dashboard/dist/**' -g '!docs/**' -g '!data/**' -g '!logs/**' -g '!napcat/**' | xargs -r wc -l | sort -nr
```

### 2.1 文件清单

| 文件 | 行数 | 是否建议拆分 | 优先级 | 核心原因 |
|---|---:|---|---|---|
| `src/services/subscription/updateChecker.js` | 2279 | 是 | P0 | 调度、抓取、推送、@all 权限、去重、状态更新混杂，认知负担高 |
| `src/services/bili_server.py` | 2276 | 是 | P0 | 凭证、API 聚合、内容修复、下载、HTTP handler 全在单文件 |
| `dashboard/src/pages/Settings.jsx` | 1906 | 是 | P1 | 页面状态、副作用、MCP CRUD、B站登录、大段 JSX 与弹窗耦合 |
| `dashboard/src/pages/Groups.jsx` | 1840 | 是 | P1 | 多业务域（群配置/订阅/权限/AI/同步/下载）聚合在单组件 |
| `src/dashboard/routes/api.js` | 1757 | 是 | P1 | 路由过多（34 个）且含大量重复验证/序列化逻辑 |
| `src/services/imageGenerator/core/theme.js` | 1399 | 可拆 | P2 | 业务逻辑不重，但 `generateCSS` 内嵌超长样式模板，维护成本高 |

### 2.2 总体建议

- 第一梯队（先拆）: `updateChecker.js`、`bili_server.py`
- 第二梯队（随后拆）: `Settings.jsx`、`Groups.jsx`、`api.js`
- 第三梯队（维护性优化）: `theme.js`

---

## 3. `updateChecker.js` 现状分析

路径: `src/services/subscription/updateChecker.js`

### 3.1 规模与复杂度

- 行数: 2279
- 类方法数: 52
- 超长方法示例:
  - `checkUserDynamic`（约 164 行）
  - `checkUserVideoUnified`（约 144 行）
  - `processDynamicFeed`（约 136 行）
  - `checkUserArticleUnified`（约 135 行）
  - `notifyGroupsWithImage`（约 130 行）

### 3.2 职责混合点

当前文件至少包含 8 类职责:

1. 生命周期与调度（`start/stop/restart/checkAll`）
2. 订阅目标解析（手动订阅 + Cookie 同步融合）
3. Feed 轮询（动态流、直播流）
4. 手动订阅检查（动态、直播、番剧）
5. 统一用户检查（视频、专栏）
6. 消息发送与降级（图文、纯文本、去重）
7. `@all` 能力探测与策略判断
8. 维护任务（Cookie 刷新、关注列表同步、补全昵称）

### 3.3 外部依赖与兼容边界

现有外部调用方（关键）:

- `src/services/subscriptionService.js`
  - `setWs/start/stop/updateCheckInterval/refreshCookieFollowings/checkUserDynamic/checkUserLive`
- `src/bot.js`
  - `notifyAdmin`

结论: 拆分后必须保留这些调用路径与行为，避免上层联动改造放大风险。

---

## 4. 拆分目标（Definition of Done）

### 4.1 架构目标

- 将 `updateChecker.js` 拆为“门面 + 领域模块”结构。
- 每个模块职责单一，代码边界清晰。
- 保留单例导出与现有对外方法签名不变。
- 使主要业务可单独测试（至少到模块级）。

### 4.2 行为目标

- 定时任务触发节奏与顺序不变。
- 动态/视频/专栏/直播/番剧推送结果不变。
- `@all` 规则判断结果不变。
- 去重逻辑、缓存逻辑、失败降级策略不变。

### 4.3 质量目标

- 单文件控制在可读范围（建议 < 500 行，允许少量例外）。
- 新增文件命名与目录结构可自解释。
- 关键路径增加最小自动化回归用例（或最小可执行脚本）。

---

## 5. 目标结构设计（完整方案）

建议目录:

```text
src/services/subscription/updateChecker/
├── index.js                      # 门面：保持旧对外 API 与单例导出
├── UpdateChecker.js              # 类定义（constructor + 组合装配）
├── constants.js                  # 常量（@all 类别、TTL、默认值）
├── helpers/
│   ├── sourceMap.js              # normalizeSourceList / group-source map 工具
│   ├── ids.js                    # UID/ID 规范化与比较工具
│   └── article.js                # resolveArticleTitle 等文章工具
├── modules/
│   ├── lifecycle.js              # setWs/start/stop/restart/getStatus/updateCheckInterval/checkAll
│   ├── targeting.js              # 构建目标群、来源映射、覆盖集合
│   ├── feed.js                   # checkFeedUpdate/processDynamicFeed/processLiveFeed
│   ├── manualChecks.js           # checkUserDynamic/checkUserLive/checkBangumi
│   ├── unifiedChecks.js          # checkUserVideoUnified/checkUserArticleUnified + 状态更新
│   ├── atAll.js                  # @all 规则、角色查询、能力缓存、消息链拼装
│   ├── notify.js                 # notifyGroups/notifyGroupsWithImage/sendSubscriptionMessage
│   └── maintenance.js            # checkAndRefreshCredential/refreshCookieFollowings/refreshMissingNames
└── adapters/
    └── deps.js                   # 对外部依赖统一封装（config/biliApi/logger 等）
```

说明:

- 推荐采用“原型拼装”方式减少迁移风险:
  - `UpdateChecker` 类保留 `this` 状态。
  - 各 `modules/*.js` 导出方法对象。
  - 通过 `Object.assign(UpdateChecker.prototype, moduleMethods)` 挂载。
- 这样可以几乎原样迁移方法体，先做结构拆分，后续再做深优化。

---

## 6. 方法映射设计（旧 -> 新）

### 6.1 生命周期与调度

- `setWs/start/stop/restart/getStatus/updateCheckInterval/checkAll`
  - -> `modules/lifecycle.js`

### 6.2 目标解析与来源映射

- `createGroupSourceMap/mergeGroupSourceMap/getGroupIdsFromSourceMap/normalizeGroupSourceMap`
- `buildUserCheckList/collectFeedCoveredUids/findTargetGroupSourceMapForUser/findTargetGroupsForUser`
  - -> `modules/targeting.js`

### 6.3 Feed 流处理

- `checkFeedUpdate/processDynamicFeed/processLiveFeed`
- `isLiveDynamic/shouldSkipDynamic`
  - -> `modules/feed.js`

### 6.4 手动订阅检查

- `generateNotificationText/checkUserDynamic/checkUserLive/checkBangumi`
  - -> `modules/manualChecks.js`

### 6.5 统一用户检查

- `checkUserVideoUnified/checkUserArticleUnified/updateVideoState/updateArticleState`
  - -> `modules/unifiedChecks.js`

### 6.6 `@all` 与消息发送

- `isSubscriptionAtAllEnabled/getSubscriptionAtAllRules/resolveContentSubtype/resolveAtAllCategory`
- `buildAtAllMetaForGroup/shouldAtAll/getSubscriptionAtAllWarmupGroups/warmupGroupAtAllCapabilities`
- `markGroupAtAllUnavailable/resolveBotSelfId/queryBotGroupRole/queryGroupAtAllCapability`
- `buildSubscriptionMessageChain/sendGroupMessageByAction/hasAtAllSegment/sendSubscriptionMessage`
  - -> `modules/atAll.js`

- `notifyGroups/notifyGroupsWithImage/notifyGroupsWithImageAndCache`
  - -> `modules/notify.js`

### 6.7 维护任务

- `notifyAdmin/checkAndRefreshCredential/refreshCookieFollowings/refreshMissingNames`
  - -> `modules/maintenance.js`

### 6.8 顶层工具函数

- `normalizeSourceList/toUidString/resolveArticleTitle`
  - -> `helpers/sourceMap.js`、`helpers/ids.js`、`helpers/article.js`

---

## 7. 分阶段迁移计划（可执行）

## Phase 0: 基线冻结

- 新增回归基线文档（本文件）。
- 记录当前关键日志与行为样本（可用本地测试群验证）。

产出:

- 基线 checklist（见第 9 节）。

## Phase 1: 纯工具函数外提（零行为变化）

- 先迁移无 `this` 依赖的顶层函数到 `helpers/`。
- 原文件中仅改为 `require` 调用。

验收:

- 项目可启动，`resolveArticleTitle` 对外测试访问不变。

## Phase 2: 生命周期与维护模块拆分

- 拆 `lifecycle.js` 与 `maintenance.js`。
- `UpdateChecker` 类仅保留 constructor 与最小状态定义。

验收:

- 启停、重启、定时器清理行为一致。
- `notifyAdmin` 外部调用路径不变。

## Phase 3: 目标解析与 Feed 模块拆分

- 拆 `targeting.js`、`feed.js`。
- 保留现有日志文本，减少排障成本。

验收:

- Cookie 同步覆盖范围与原逻辑一致。
- 动态/直播 feed 推送数量无异常波动。

## Phase 4: 手动/统一检查模块拆分

- 拆 `manualChecks.js` 与 `unifiedChecks.js`。
- 保留 “首次锚点不推送” 与 “force 推送” 语义。

验收:

- `subscriptionService.checkSubscriptionNow()` 行为一致。
- 视频/专栏首次检查不误推，强制检查可推。

## Phase 5: `@all` 与通知模块拆分

- 拆 `atAll.js` 与 `notify.js`。
- 保留能力缓存 TTL、角色查询降级逻辑、图片失败文本降级。

验收:

- `@all` 命中规则一致。
- 去重与链接缓存行为一致。

## Phase 6: 清理与收尾

- 删除旧大文件（保留兼容入口 `index.js`）。
- 补充模块级测试或最小可执行 smoke 脚本。
- 更新 `CLAUDE.md` 架构段落（可选）。

---

## 8. 风险清单与缓解策略

### 风险 1: `this` 上下文丢失

- 场景: 方法迁移后直接解构调用，`this.ws`/缓存字段失效。
- 缓解: 统一通过类原型挂载；禁止直接函数式解构调用实例方法。

### 风险 2: 定时器重复启动或未释放

- 场景: `start/stop/restart` 迁移时遗漏某个 timer。
- 缓解: 保留 `stop()` 为单一清理入口；加启动前清理断言日志。

### 风险 3: `@all` 能力缓存行为漂移

- 场景: 缓存 map 拆分后 key/TTL 处理不一致。
- 缓解: 将 TTL 常量集中到 `constants.js`，并保留原 key 结构与日志。

### 风险 4: 推送去重逻辑回归

- 场景: `dedupId` 计算与 `notificationHistory` 记录点错位。
- 缓解: 推送模块拆分时先复制后重构，保留原调用顺序与分支。

### 风险 5: 外部兼容断裂

- 场景: `subscriptionService` 或 `bot.js` 调不到原方法。
- 缓解: `index.js` 继续 `module.exports = updateCheckerInstance`，方法名全部保留。

---

## 9. 验收清单（拆分后必须逐项通过）

1. 机器人启动后，订阅检查、关注同步、Cookie 刷新定时器正常工作。
2. `subscriptionService.start/stop/updateCheckInterval/refreshCookieFollowings` 正常。
3. “立即检查订阅”路径可触发动态与直播强制检查。
4. 视频/专栏首次锚点只记录不推送，后续增量推送正常。
5. 动态中的视频/专栏自动动态仍被正确过滤，避免重复推送。
6. `@all` 总开关、来源开关、分类开关、UID 细粒度规则命中正确。
7. 图片生成失败时仍可回退文本推送，不丢消息。
8. 去重与链接缓存逻辑稳定，无明显重复刷屏。
9. `bot.js` 中 `updateChecker.notifyAdmin()` 调用仍可用。

---

## 10. 实施顺序建议（按 ROI）

1. Phase 1 + Phase 2（最低风险，快速降文件体积）
2. Phase 3（消除 Feed 与目标解析耦合）
3. Phase 4（核心检查逻辑模块化）
4. Phase 5（最复杂，最后拆，降低回归面）
5. Phase 6（收尾和文档同步）

---

## 11. 备注

- 本方案优先“结构解耦”，不主动改变业务策略。
- 若要进一步优化性能（并行化、API 限流策略、缓存层抽象），建议在结构拆分稳定后单独立项。
