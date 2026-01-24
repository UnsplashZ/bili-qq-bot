**修改点**
**- `biliApi` 增加可选参数：`bypassCache` 或 `cacheMode`。**
**- `/查询订阅` 与订阅轮询调用 `getUserDynamic` 时默认绕过缓存。**

**效果**
**- 查询动作始终拉最新动态；缓存仅用于链接解析场景。**

### 2) 链接解析保留缓存
**修改点**
**- `linkHandler.getDataWithCache` 继续使用 `cacheManager`。**
**- `DATA_CACHE_TTL` 仍作为链接解析数据缓存 TTL。**

**效果**
**- 解析性能保持；不会影响订阅查询准确性。**

### 3) groupId 类型统一
**修改点**
**- `checkSubscriptionNow` 中统一 `groupId` 为字符串比较。**
**- 可选：加载订阅时统一 `groupIds` 为字符串数组（降低其它匹配风险）。**

**效果**
**- 解决字符串/数字不匹配导致的“找不到订阅”。**

### 4) AI 相关不改
**- 不调整 AI 向量缓存、上下文缓存等任何逻辑。**

## 影响范围
- **`src/services/biliApi.js`**：新增绕过缓存参数或新的无缓存方法。
- **`src/services/subscription/updateChecker.js`**：订阅检查使用无缓存查询。
- **`src/services/subscriptionService.js`**：`/查询订阅` 使用无缓存查询并修复 groupId 比较。
- **`src/handlers/linkHandler.js`**：保留当前缓存逻辑，不修改行为。
- **`src/utils/cacheManager.js`**：不改 TTL 机制，只缩小其使用范围。

## 验证计划
1. `/查询订阅 <uid>` 立即返回最新动态（不受 `DATA_CACHE_TTL` 影响）。
2. 轮询订阅在动态更新后可及时推送（无旧缓存干扰）。
3. 链接解析仍有缓存命中与冷却策略（性能不回退）。
4. `groupId` 字符串/数字混用时订阅查询正常命中。

## 回滚策略
- 若出现异常，可临时恢复 `biliApi.getUserDynamic` 默认缓存行为。
- 删除新增参数调用或恢复旧逻辑即可回滚。

## 不在本次范围
- 不调整 AI 缓存、向量检索逻辑。
- 不调整订阅去重 TTL（已绑定 `/设置 冷却`）。
