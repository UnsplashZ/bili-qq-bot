# 2026-03-04 `@全体` WebUI 细粒度配置修复方案

## 1. 需求确认（最终口径）

1. 按 **逐个 ID** 控制 `@全体`。
2. 分类需包含全部订阅类型（视频/动态/直播/专栏/番剧及番剧子类）。
3. 判定规则为 **同时满足**：总开关 AND 来源 AND 分类 AND ID。
4. 命令 `/设置 推送AT全体 <开|关>` 保留，仅作为总开关。
5. 细粒度规则仅在 WebUI 配置。
6. 只做群级配置，不做全局配置。
7. 默认行为保持“全开”（兼容现状）。

---

## 2. 目标与非目标

### 2.1 目标

1. 在不破坏现有推送链路和降级策略的前提下，实现群级 `@全体` 细粒度控制。
2. 支持来源维度（手动订阅 / 关注同步）与分类维度、用户 ID 维度联合判定。
3. 兼容旧配置：只开 `subscriptionAtAll` 的群不需要额外迁移。

### 2.2 非目标

1. 不改动命令侧细粒度语法。
2. 不引入全局级 `@全体` 规则模板。
3. 不改动现有 OneBot `@all` 能力探测与失败回退机制。

---

## 3. 配置模型设计

在 `groupConfigs[groupId]` 下新增字段 `subscriptionAtAllRules`：

```json
{
  "subscriptionAtAll": true,
  "subscriptionAtAllRules": {
    "sources": {
      "manual": true,
      "cookieSync": true
    },
    "categories": {
      "video": true,
      "dynamic": true,
      "live": true,
      "article": true,
      "bangumi": true,
      "movie": true,
      "tv": true,
      "guocha": true,
      "doc": true,
      "variety": true
    },
    "manualDisabledIds": [],
    "cookieSyncDisabledIds": []
  }
}
```

### 设计说明

1. `manualDisabledIds` / `cookieSyncDisabledIds` 采用“黑名单”语义，满足“默认全开”。
2. `categories` 覆盖当前订阅推送可能出现的所有内容类型。
3. `actorUid` 不存在的场景（如番剧）仅依据来源+分类判定。

---

## 4. 判定规则（核心）

新增统一判定函数 `shouldAtAll(groupId, meta)`，`meta` 结构建议如下：

```js
{
  sources: ['manual'] | ['cookieSync'] | ['manual', 'cookieSync'],
  category: 'video' | 'dynamic' | 'live' | 'article' | 'bangumi' | 'movie' | 'tv' | 'guocha' | 'doc' | 'variety',
  actorUid: '123456' | null
}
```

### 判定流程

1. `subscriptionAtAll !== true` => `false`。
2. 对应 `category` 开关为 `false` => `false`。
3. 遍历 `sources`，某一来源满足以下全部条件即可 `true`：
   - 来源开关为 `true`
   - `actorUid` 为空，或 `actorUid` 不在该来源的 disabled 列表
4. 若无来源命中 => `false`。

### `source=both` 处理策略

1. 来源内是 AND（来源开关 + ID 开关）。
2. 来源间是 OR（manual 或 cookieSync 任一满足即允许 `@全体`）。

---

## 5. 后端改造方案

## 5.1 `src/config.js`

1. 在 `ensureGroupConfig()` 默认值中加入 `subscriptionAtAllRules`（全开默认）。
2. 新增规则归一化工具（可放 API 层调用）：
   - 仅接受合法 key
   - UID 统一转字符串
   - 数组去重
   - 缺失字段补默认

## 5.2 `src/dashboard/routes/api.js`

1. 扩展 `POST /api/groups/:id/config` 校验逻辑，支持 `subscriptionAtAllRules`。
2. 新增接口 `GET /api/groups/:id/atall-targets`，返回：
   - `manualUsers`: 本群手动订阅用户（uid/name）
   - `cookieUsers`: 本群关注同步候选用户（uid/name/biliGroups/是否命中当前同步分组）
3. 保持现有 `subscriptionAtAll` 布尔校验逻辑。

## 5.3 `src/services/subscription/updateChecker.js`

1. `sendSubscriptionMessage(groupId, baseMessageChain, meta)` 增加 `meta` 入参。
2. `buildSubscriptionMessageChain()` 改为基于 `shouldAtAll()` 判断是否拼接 `@all`。
3. 所有推送入口补齐 `meta`：
   - 动态、视频、直播、专栏、番剧
4. 修正/增强目标群来源信息传递：
   - 支持“按群识别来源”（manual / cookieSync / both）
   - 避免合并后 source 信息丢失导致误判
5. 保留失败回退：带 `@all` 失败后去掉 `@all` 重发。

## 5.4 `src/commands/settings.js`

1. 保留 `/设置 推送AT全体 <开|关>` 现有行为。
2. 文案可增加一行提示：细粒度控制请在 WebUI 配置。

---

## 6. WebUI 改造方案

文件：`dashboard/src/pages/Groups.jsx`（关注同步 Tab）

新增“`@全体`细粒度配置”区块：

1. 来源开关
   - 手动订阅
   - 关注同步
2. 分类开关
   - video/dynamic/live/article/bangumi/movie/tv/guocha/doc/variety
3. ID 开关（逐个）
   - 手动订阅 ID 列表（开关）
   - 关注同步 ID 列表（开关）
4. 快捷操作
   - 当前列表全开
   - 当前列表全关
5. 交互联动
   - 总开关关闭时，细粒度区块禁用显示
   - 总开关开启时可编辑并保存

数据流：

1. 进入群配置页时并行拉取：
   - `/api/groups`
   - `/api/groups/:id/atall-targets`
2. 保存时将 `subscriptionAtAllRules` 与现有 `formData` 一并提交到 `/api/groups/:id/config`。

---

## 7. 兼容性与迁移

1. 老配置无 `subscriptionAtAllRules` 时，运行时自动视为全开规则。
2. 无需离线迁移脚本。
3. 命令用户与 WebUI 用户可共存：
   - 命令只改总开关
   - WebUI 改细粒度

---

## 8. 测试计划

## 8.1 单元测试（重点）

建议新增：`test/unit/updateChecker-atall-rules.test.js`

覆盖场景：

1. 总开关关闭 => 不 `@all`
2. 来源关闭 => 不 `@all`
3. 分类关闭 => 不 `@all`
4. 手动来源某 UID 关闭 => 不 `@all`
5. 关注同步来源某 UID 关闭 => 不 `@all`
6. `source=both` 且 manual 关、cookie 开 => `@all`
7. `source=both` 且 manual 开、cookie 关 => `@all`
8. `source=both` 两边都关 => 不 `@all`
9. `actorUid` 为空（如番剧）时，仅按来源+分类判定
10. `@all` 发送失败降级回退仍生效

## 8.2 API 测试

1. `subscriptionAtAllRules` 字段格式校验
2. 非法分类键剔除
3. 非法 UID 格式处理（仅保留数字字符串）
4. `/api/groups/:id/atall-targets` 数据完整性

## 8.3 前端联调

1. 列表加载正确
2. 逐个开关与批量开关行为正确
3. 保存后刷新回显一致
4. 总开关联动禁用状态正确

---

## 9. 风险与应对

1. 风险：`source=both` 的来源识别不准确导致误 `@all`
   - 应对：在推送前构建“群->来源集合”映射，并加日志抽样
2. 风险：关注同步候选列表较大，WebUI 渲染卡顿
   - 应对：列表虚拟化或分页（必要时二期）
3. 风险：配置结构扩展后前后端字段不一致
   - 应对：API 层统一 normalize，前端只使用 API 返回结构

---

## 10. 实施顺序

1. 后端规则模型与判定函数落地
2. 推送链路接入 `meta` 与来源判定
3. 新增 `atall-targets` 接口
4. WebUI 细粒度配置区块与保存
5. 单测 + API 测试 + 联调回归
6. README/帮助文案更新

---

## 11. 验收标准

1. 默认情况下（未配置细粒度）行为与当前一致（全开）。
2. 可按来源+分类+ID 对 `@全体` 精确控制。
3. `source=both` 在不同群的判定正确。
4. `@all` 不可用时仍能自动降级推送。
5. 不影响现有订阅去重、关注同步、视频下载扇出链路。

