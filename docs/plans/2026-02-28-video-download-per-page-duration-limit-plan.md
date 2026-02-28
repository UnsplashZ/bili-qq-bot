# 2026-02-28 多P视频按单集时长限流方案（方案2）实施计划

## 1. 背景与问题

当前视频下载限时逻辑在多P场景存在误判：

1. 用户触发下载 `P1`（或 `/下载 Pn`）时，系统使用整稿总时长 `videoInfo.data.duration` 与群配置上限比较。
2. 当“单集时长 <= 限制、整稿总时长 > 限制”时，会被错误拦截。
3. 典型表现：提示 `⚠️ 视频时长 X 分钟，超出当前限制...`，但实际目标分P并未超限。

该问题会直接影响用户可感知行为，属于下载主流程误判。

## 2. 方案2可落地性结论（接口能力核验）

结论：**当前接口满足方案2落地条件**，可按“当前分P时长”做限制判断。

### 2.1 代码链路证据

1. `src/services/bili_server.py` 的 `get_video_info` 直接将 `v.get_info()` 结果透传为 `data` 返回：
   - 返回形态：`{"status": "success", "type": "video", "data": info}`
2. `download_video_file` 已接收 `page_index` 参数，说明下载流程天然具备“分P上下文”。
3. `src/services/videoDownloadService.js` 已在多个位置读取 `videoInfo.data.pages.length`，证明上游结构在本项目中是可用的。

### 2.2 本地探针验证（已执行）

执行了本地接口结构探针（Node 脚本）验证以下断言：

1. Python 层 `get_video_info` 为透传返回。
2. 本地缓存存在多P视频且 `data.pages[].duration` 为数字。
3. 多P样本满足 `sum(pages.duration) === data.duration`。

探针结果（样本）：

1. 缓存文件：`video:BV1ZHiyBkExG:1065812436.json`
2. `pageCount = 4`
3. `p1 = 192s`
4. `total = 768s`
5. `sum(pages.duration) = 768s`

因此，方案2所需字段（`data.pages[pageIndex].duration`）在当前工程链路和本地实证中均可获得。

## 3. 目标与非目标

### 3.1 目标

1. 下载时长限制改为“优先按目标分P时长判断”。
2. 保持单P视频、普通视频、订阅下载的原有功能不回归。
3. 在缺失分P时长数据时提供稳定回退逻辑，避免异常中断。

### 3.2 非目标

1. 不调整下载分辨率、并发、磁盘清理策略。
2. 不改动 `/下载` 命令交互流程。
3. 不改 Python 下载服务接口契约（仅消费既有字段）。

## 4. 方案对比与选型

1. 方案1（保持现状）：
   - 优点：零改动。
   - 缺点：持续误伤多P下载，问题不解决。
2. 方案2（推荐，按目标分P时长判定）：
   - 优点：与用户直觉一致，改动小，风险可控。
   - 缺点：依赖 `pages[pageIndex].duration` 可用性，需要回退保护。
3. 方案3（同时限制分P+总时长）：
   - 优点：限制更保守。
   - 缺点：会继续拒绝“短分P+长总时长”场景，与用户诉求冲突。

结论：采用方案2。

## 5. 详细设计

### 5.1 核心规则

新增统一“有效时长”计算规则（伪代码）：

```text
effectiveDuration =
  videoInfo.data.pages[pageIndex].duration (若存在且为有效数值)
  否则回退 videoInfo.data.duration
  否则回退 0
```

比较逻辑保持不变：

```text
maxDuration > 0 && effectiveDuration > maxDuration => 超限跳过
```

### 5.2 影响点

1. `downloadAndSend(ws, groupId, bvid, videoInfo, pageIndex = 0)`
   - 目前使用 `videoInfo.data.duration`。
   - 改为使用 `effectiveDuration`。
2. `downloadAndSendToGroups(ws, groupIds, bvid, videoInfo, pageIndex = 0)`
   - 当前按总时长过滤群。
   - 改为按 `effectiveDuration` 过滤群，确保与手动下载语义一致。

### 5.3 提示文案策略

为降低行为变更面，文案模板不改，仅替换显示时长来源为 `effectiveDuration`：

1. `⚠️ 视频时长 {durationMin} 分钟，超出当前限制（{limitMin} 分钟），已跳过下载`

说明：不新增 `Pn` 文案，避免额外语义变化。

### 5.4 容错与边界

1. `pageIndex` 越界或 `pages` 缺失：自动回退总时长，行为与旧逻辑一致。
2. `duration` 非数值或负值：按 `0` 处理，避免 NaN 传播。
3. 单P视频：`pages.length = 1` 时新旧逻辑等价。

## 6. 实施步骤（最小改动）

1. 在 `src/services/videoDownloadService.js` 内新增私有辅助方法（如 `_getEffectiveDuration(videoInfo, pageIndex)`）。
2. 将 `downloadAndSend` 的 `duration` 取值切换到辅助方法。
3. 将 `downloadAndSendToGroups` 的 `duration` 取值切换到辅助方法。
4. 保持其余下载参数与消息流程不变。
5. 增加单测覆盖分P时长判定与回退逻辑。

## 7. 测试计划

### 7.1 新增单元测试建议

建议新增：`test/unit/videoDownload-durationLimit.test.js`

覆盖用例：

1. 多P视频，`P1` 未超限、总时长超限：
   - 期望：允许下载（不返回 `duration_exceeded`）。
2. 多P视频，目标 `Pn` 超限：
   - 期望：返回 `duration_exceeded` 并发送超限提示。
3. `pages` 缺失但总时长超限：
   - 期望：回退总时长并拦截。
4. `pageIndex` 越界且总时长未超限：
   - 期望：不因时长逻辑误拦截。
5. 订阅入口 `downloadAndSendToGroups` 在同样输入下与手动入口判定一致。

### 7.2 回归验证

1. `node test/unit/videoDownloadConfig.test.js`
2. `node test/unit/videoDownload-privateRoute.test.js`
3. 新增 `videoDownload-durationLimit` 测试
4. 如有时间，执行后端单测扫全：
   - `for f in test/unit/*.test.js; do node "$f"; done`

## 8. 风险、影响与回滚

### 8.1 影响范围

仅影响“下载前时长限制判定”这一前置分支，不触及下载实现本体。

### 8.2 风险

1. 少量异常数据可能无 `pages[pageIndex].duration`，触发回退。
2. 若测试桩未覆盖订阅入口，可能出现入口语义不一致。

### 8.3 缓解

1. 统一通过同一辅助方法取时长，避免双处逻辑漂移。
2. 单测同时覆盖手动入口与订阅入口。

### 8.4 回滚方案

1. 回滚 `videoDownloadService.js` 中新增辅助方法与两处调用替换即可。
2. 不涉及配置迁移和状态数据迁移，回滚成本低。

## 9. 验收标准（DoD）

1. 多P短分集在限制内可下载，不再被总时长误拦截。
2. 超限提示仅在目标分P确实超限时出现。
3. 订阅下载与手动下载的时长判定规则一致。
4. 相关单测通过，且已有视频下载相关测试无回归。

## 10. 预计改动文件（实施阶段）

1. `src/services/videoDownloadService.js`
2. `test/unit/videoDownload-durationLimit.test.js`（新增）
3. 如需说明变更，可补充文档记录（可选）
