# QQ Official Provider P0-P1 接入方案

日期：2026-07-09

状态：已完成并归档（2026-07-12）

> [!IMPORTANT]
> 本文是 QQ Official Provider 接入的历史设计记录。配置、Secret、热重载、部署和回滚合同已经由 [2026-07-10 单一 config.yaml 方案](./2026-07-10-unified-config-hot-reload-and-auto-migration-plan.md) 取代。当前实现只以 `config/config.yaml` 为应用配置真源；不再把 `.env` 或独立 Secret 文件作为运行时配置源，Provider 变更通过 ConfigService 受控重连，只有 host port、volume 和网络变更需要 `setup.sh --apply`。本文后续出现的旧配置示例仅用于解释当时背景，不代表当前行为。

## 背景

当前项目通过 NapCat / OneBot v11 接入 QQ，核心链路集中在：

- `src/bot.js`：连接 NapCat WebSocket、接收 OneBot 事件、维护 `global.bot`、启动订阅。
- `src/services/notificationService.js`：封装 OneBot action、发送群聊/私聊消息、处理 `base64://` 图片到共享文件路径。
- `src/handlers/messageHandler.js`：消费 OneBot 的 `message_type/group_id/user_id/message_id`，分发命令、B 站链接解析和 Agent。
- `src/services/subscription/updateChecker/modules/atAll.js` 与 `notify.js`：订阅推送、@全体、发送结果和回退。
- `src/services/videoDownloadService.js`：依赖 NapCat 可读共享目录发送本地视频文件。
- `src/services/qqGroupAdminService.js`、`src/services/qqAccountService.js`：调用 NapCat 专属群管和账号 action。

QQ 官方 API v2 支持 WebSocket 长连接事件、OpenAPI 发消息、富媒体上传和撤回消息。已验证当前 AppID 可以获取 `access_token`，将出口 IP 加入白名单后可以获取：

- `/gateway`：`wss://api.sgroup.qq.com/websocket`
- `/gateway/bot`：`wss://api.sgroup.qq.com/websocket`，`shards=1`

## 目标

新增 QQ 官方 Provider，并保留现有 NapCat Provider。P0-P1 阶段目标不是 100% 平替 NapCat，而是先让官方链路覆盖核心业务：

- B 站链接解析和预览卡。
- `/菜单`、订阅、设置等指令。
- 群聊/单聊基础收发。
- 订阅主动推送。
- Agent 基础回复。
- 图片、视频等富媒体发送。
- 消息撤回、被动回复、限流队列和状态观测。

## 非目标

P0-P1 不承诺完整替代以下 NapCat 专属能力：

- `set_msg_emoji_like` 表情回应。
- QQ 在线状态、输入状态。
- 完整群管：禁言、踢人、群公告、精华、成员列表等。
- 好友/加群申请审批链路。

这些能力需要通过 Provider capability 标记为 unavailable，并在 Agent 工具、命令和 Dashboard 中降级或隐藏。

## 配置设计（历史记录，已被统一 YAML 合同取代）

当时方案拟在本地 `config/.env` 新增：

```env
QQ_PROVIDER=napcat
QQ_OFFICIAL_APP_ID=...
QQ_OFFICIAL_CLIENT_SECRET=...
```

后续实现时建议继续增加：

```env
QQ_OFFICIAL_API_BASE=https://api.sgroup.qq.com
QQ_OFFICIAL_TOKEN_URL=https://bots.qq.com/app/getAppAccessToken
QQ_OFFICIAL_USE_SHARDED_GATEWAY=true
QQ_OFFICIAL_INTENTS=33554432
QQ_OFFICIAL_MEDIA_UPLOAD_MODE=file_data
QQ_OFFICIAL_TEMP_PUBLIC_BASE_URL=
```

默认仍为 `napcat`，避免现有部署在未完成官方适配时改变行为。

## 模块设计

新增目录：

```text
src/providers/qq/
  index.js
  baseProvider.js
  napcatProvider.js
  officialProvider.js
  official/
    tokenManager.js
    openapiClient.js
    gatewayClient.js
    eventMapper.js
    messageSender.js
    mediaUploader.js
    rateLimiter.js
    idStore.js
```

Provider 接口：

```js
start()
stop()
isReady()
getSelf()
getCapabilities()
sendMessage(target, messageChain, options)
sendGroupMessage(groupId, messageChain, options)
sendPrivateMessage(userId, messageChain, options)
callAction(action, params, options)
recallMessage(target, messageId, options)
uploadMedia(target, media, options)
```

P0 阶段 `callAction` 可作为兼容层存在：

- NapCat Provider：透传 OneBot action。
- Official Provider：只支持白名单 action，如 `send_group_msg`、`send_private_msg`、`delete_msg` 的等价映射；群管类 action 直接返回 capability error。

## 入站事件适配

官方事件先映射为现有 handler 可消费的内部消息对象，减少业务层改动：

```js
{
    provider: 'qq-official',
    post_type: 'message',
    message_type: 'group',
    group_id: groupOpenId,
    user_id: memberOpenId,
    message_id: id,
    raw_message: content,
    message: [{ type: 'text', data: { text: content } }],
    sender: {
        role: memberRole || 'unknown'
    },
    official: {
        eventType,
        eventId,
        group_openid: groupOpenId,
        member_openid: memberOpenId,
        user_openid: userOpenId,
        msg_seq,
        attachments
    }
}
```

对应事件：

- `C2C_MESSAGE_CREATE`：单聊消息。
- `GROUP_AT_MESSAGE_CREATE`：群内 @ 机器人。
- `GROUP_MESSAGE_CREATE`：群聊全量消息，依赖群主允许机器人接收群内全部消息。
- `GROUP_ADD_ROBOT`、`GROUP_DEL_ROBOT`：机器人进/退群，更新 reachability。
- `GROUP_MSG_RECEIVE`、`GROUP_MSG_REJECT`：群主动消息开关，更新订阅推送可达性。

## 出站消息适配

内部仍使用现有 message chain：

```js
[
    { type: 'image', data: { file: 'base64://...' } },
    { type: 'text', data: { text: '...' } }
]
```

Official Provider 转换规则：

- `text`：合并为官方 `content`，使用 `msg_type=0`。
- `image`：上传为富媒体 `file_type=1`，再使用 `msg_type=7` 发送 media。
- `video`：上传为富媒体 `file_type=2`，再使用 `msg_type=7` 发送 media。
- `at all`：P0 先不承诺官方等价。订阅 @全体能力在官方 Provider 下默认降级为普通消息，后续确认官方群聊支持格式后再打开。
- 混合图文：优先拆成两条消息，先发图片再发 URL/文本，避免官方单条消息结构限制导致失败。

富媒体上传策略：

1. 首选 `file_data` 上传 base64，适合预览卡图片。
2. 若官方实际要求 `url` 必填且 `file_data` 不能单独使用，则引入临时公网文件服务或对象存储。
3. 视频文件较大，优先使用对象存储或临时 HTTPS URL，再调用 `/files` 上传。

## 身份与权限模型

官方接口不提供 QQ 数字号，使用 openid：

- 群：`group_openid`
- 群成员：`member_openid`
- 单聊用户：`openid` / `user_openid`

内部 ID 建议：

```text
official:group:<group_openid>
official:member:<group_openid>:<member_openid>
official:user:<openid>
```

P0 为减少改动，可暂时直接把 `group_id` 填为 `group_openid`、`user_id` 填为 `member_openid`。P1 引入 `idStore`，保存 provider、openId、显示名、角色、最近事件时间和能力状态。

管理员配置：

- NapCat 模式继续使用 QQ 号。
- Official 模式使用 `member_openid` / `user_openid`。
- Root Admin 需要新增官方身份绑定流程，不能复用 `ADMIN_QQ` 数字号。

## P0 范围

P0 目标是跑通核心业务闭环：

1. Provider 抽象落地，NapCat 行为保持不变。
2. Official TokenManager 获取并刷新 `access_token`。
3. Official GatewayClient 获取 `/gateway/bot`，连接 WSS，Identify，心跳，断线重连。
4. EventMapper 支持单聊、群 @、群全量消息。
5. 文本消息发送到群和单聊。
6. 图片预览卡发送，优先验证 `file_data` 上传。
7. 命令系统可用：`/菜单`、`/订阅用户`、`/取消订阅用户`、`/查询订阅`、常规 `/设置`。
8. B 站链接自动解析：
   - 群 @ 模式可用。
   - 群全量模式在群主授权后可用。
9. 订阅主动推送：
   - 群主开启“机器人主动在群聊内发言”后可用。
   - 本地按账号和单群 qpm 限速。
10. Agent 基础文本回复可用。

P0 验证清单：

- 能获取 token 和 WSS 地址。
- WSS READY、心跳 ACK、重连恢复正常。
- 群里 @Bot 发 `/菜单` 返回帮助。
- 群里发 B 站链接生成预览卡。
- 私聊 Root 身份可执行基础查询。
- 订阅推送能主动发到允许的群。
- 图片上传失败时降级为文本链接。

## P1 范围

P1 目标是补齐生产可用性：

1. 被动回复字段：
   - 使用 `msg_id`、`event_id`、`msg_seq`。
   - 保持消息去重，避免官方重复投递导致重复回复。
2. 撤回消息：
   - 群聊：`DELETE /v2/groups/{group_openid}/messages/{message_id}`。
   - 单聊：`DELETE /v2/users/{openid}/messages/{message_id}`。
3. 富媒体完善：
   - 视频发送接入对象存储或临时公网 URL。
   - 上传失败、转换失败、资源拉取失败要分类记录。
4. RateLimiter：
   - 账号维度：企业/个人认证 60 qpm，未认证 30 qpm。
   - 单群维度：20 qpm。
   - 主动推送队列支持延迟、重试和丢弃策略。
5. Dashboard：
   - 显示当前 Provider、WSS 状态、token 剩余时间。
   - 显示群主动消息开关、群全量消息可用性、最近发送失败原因。
6. Capability 降级：
   - Agent 工具注册时按 provider capability 过滤群管/账号工具。
   - 命令中遇到不支持能力时返回明确说明。
7. ID Store：
   - 保存群、用户、角色、昵称/群名等最近观测信息。
   - 为 Dashboard 和权限判断提供统一读取接口。

P1 验证清单：

- 主动推送压测不超过 qpm。
- 图片、视频、文本混合发送失败时有可读错误。
- 撤回机器人自己发送的消息成功。
- 官方 Provider 下不可用工具不会进入 Agent 执行。
- Dashboard 能区分 NapCat 与 Official 状态。

## 第 1 轮子代理审计回收

第 1 轮已按只读方式完成架构审计、官方 API 可行性核验和测试策略设计。三方结论一致：P0/P1 主体可落地，但不能把 QQ Official Provider 作为 `src/bot.js` 的简单替换，必须同步收口 Provider 生命周期、出站发送、`callAction` 兼容、身份模型、订阅主动推送、Agent 工具暴露和 Dashboard 状态。

### 架构审计结论

| 领域 | 现有绑定点 | 修正要求 |
| --- | --- | --- |
| 运行时生命周期 | `src/bot.js` 直接连接 NapCat WebSocket，维护 `global.bot.ws/selfId/groupList` | 新增 Provider 工厂。`global.bot.provider` 成为 provider 真源，`global.bot.ws` 仅保留 NapCat 兼容。 |
| 出站发送 | `notificationService` 直接发送 OneBot action，并把 `base64://` 转 NapCat 共享目录 `file://` | 改为 provider-aware facade。NapCat 保持原行为，Official 走 OpenAPI、媒体上传和统一发送结果。 |
| 入站消息 | `messageHandler` 消费 OneBot-ish 字段 | Official 事件先映射为内部统一消息对象，保留 `message_type/group_id/user_id/message_id/raw_message/message/sender`。 |
| 链接反应 | 链接解析前后调用 `set_msg_emoji_like` | Official 下按 capability 关闭表情回应，不能阻断链接解析。 |
| 订阅主动推送 | `updateChecker` 自持 `ws`，`atAll` 调 `get_group_at_all_remain/get_group_member_info/send_group_msg` | 改为 provider/runtime handle；Official 下 `@全体` 降级普通消息，推送走 qpm 队列。 |
| 视频发送 | `videoDownloadService` 依赖 NapCat 共享目录和 `file://` | Official 下必须走官方媒体上传、HTTPS URL 或明确降级，不能强转数字群号。 |
| 群管/账号 | `qqGroupAdminService`、`qqAccountService` 全部是 OneBot/NapCat action | Official 下默认 capability gate，Agent/命令不能误调用。 |
| Agent 工具 | `agent/tools/registry.js` 静态暴露 `qq.*` 工具，参数多处要求数字 QQ/群号 | 工具列表和执行前都要按 provider capability 过滤或拒绝。 |
| Dashboard | 群 guard 和群设置默认数字群号 | P1 状态接口必须 provider-aware，Official 群 ID 使用 `group_openid`。 |

### 官方 API 核验结论

| 项目 | 结论 | 实现约束 |
| --- | --- | --- |
| 鉴权 | `getAppAccessToken` 可用，OpenAPI 使用 `Authorization: QQBot ACCESS_TOKEN` | token 需缓存、提前刷新、失败脱敏，不输出 secret/token。 |
| WSS | `/gateway` 与 `/gateway/bot` 可用，P0 优先 `/gateway/bot` | Identify token 格式为 `QQBot {access_token}`；保存 `session_id` 和最新 `s`。 |
| 单聊/群 @/群全量 | `C2C_MESSAGE_CREATE`、`GROUP_AT_MESSAGE_CREATE`、`GROUP_MESSAGE_CREATE` 可映射 | 群全量依赖群主开启全量消息，必须作为运行态 capability。 |
| 主动推送 | 群主开启“机器人主动在群聊内发言”后可发 | 维护 `GROUP_MSG_RECEIVE/GROUP_MSG_REJECT` 状态，按账号和单群 qpm 限流。 |
| 富媒体 | `/files` 上传后 `msg_type=7 media` 可用 | 文档将 `url` 标为必填，`file_data` 只能优先试用；失败必须切 HTTPS URL/对象存储/文本降级。 |
| 撤回 | 群聊和单聊 DELETE 接口可用 | 默认只能撤回机器人自己发出的消息，超过 2 分钟或无权限必须明确失败。 |
| 身份 | 官方不提供 QQ 数字号 | `openid/member_openid/group_openid` 不能复用数字 QQ 权限语义。 |

### 测试策略结论

| 范围 | 必测点 |
| --- | --- |
| Provider/NapCat 回归 | provider 选择、NapCat `callAction` 透传、`send_group_msg/send_private_msg/delete_msg` payload 不变。 |
| Official 核心 | TokenManager、OpenAPI Client、GatewayClient、EventMapper、MessageSender、MediaUploader、RateLimiter、ID Store。 |
| 业务轻集成 | `messageHandler`、链接解析、订阅推送、Agent 基础文本回复在 Official provider 下可运行。 |
| Capability | 群管、账号、审批、`@全体`、表情回应等不支持能力被隐藏或明确拒绝。 |
| Dashboard | 状态 payload 包含 provider、WSS、token TTL、群主动消息/全量消息状态、最近错误。 |
| Smoke | token、gateway、WSS READY/心跳、群 @ 入站、文本发送；图片 `file_data` 是否可用是富媒体 hard check。 |

### 第 1 轮修正后的硬约束

- `QQ_OFFICIAL_MEDIA_UPLOAD_MODE=file_data` 不能作为稳定默认，只能作为“优先试用”模式。
- Official 登录态定义为凭据可用、token 获取成功、gateway 可用、WSS READY、机器人身份可获取，而不是 NapCat 扫码登录。
- Official 身份配置需要 provider namespace，P0 至少提供 `QQ_OFFICIAL_ROOT_OPENIDS` 或等价配置，不能复用 `ADMIN_QQ`。
- 订阅主动推送必须经过 provider rate limiter，不能绕过 `notificationService` 或 provider 直接 HTTP 并发。
- 任何 Official 不支持的 OneBot action 必须返回结构化 unsupported capability，不能静默成功。

## 授权前落地进度（历史记录）

以下表格记录授权前的只读审计状态，保留用于追溯方案冻结过程；不代表当前最终状态。当前最终验收以文末“最终验收快照”为准。

| 项目 | 状态 | 当前证据 | 下一步 |
| --- | --- | --- | --- |
| 第 1 轮架构/API/测试审计 | 已验证 | 子代理 A/B/C 只读审计结果已回收，并沉淀到本文档 | 作为第 2 轮评审和实现输入 |
| 第 2 轮方案/安全/可靠性评审 | 已验证 | 子代理 D/E/F 只读评审结果已回收，并沉淀到本文档 | 授权后按打回项修正实现 |
| P0 Provider 抽象 | 未开始 | 尚未修改 `src/providers/qq/**`、`src/bot.js`、`notificationService` | 等待代码修改授权 |
| P0 Token/Gateway/WSS | 未开始 | 仅有先前 smoke 观察和官方文档核验，无代码落地 | 等待代码修改授权 |
| P0 EventMapper | 未开始 | 尚无 `official/eventMapper` | 等待代码修改授权 |
| P0 文本/图片发送 | 未开始 | `notificationService` 仍为 OneBot/NapCat 发送路径 | 等待代码修改授权 |
| P0 命令/链接/订阅/Agent 接入 | 未开始 | 业务层仍持有 `ws`/OneBot shape | 等待代码修改授权 |
| P1 被动回复/撤回/富媒体/RateLimiter/ID Store/Dashboard/Capability | 未开始 | 尚无 Official provider 代码或测试 | 等待代码修改授权 |
| NapCat 回归验证 | 未开始 | 尚未产生代码变更，无需回归，但最终必须验证 | 实现后运行目标测试 |
| 代码级能力差异报告 | 未开始 | 需要对照最终 QQ Official 实际代码 | 完成实现后生成 |

## 第 2 轮子代理评审打回项

第 2 轮已完成只读评审：子代理 D 负责实现方案边界，子代理 E 负责安全与凭据，子代理 F 负责运行可靠性。结论是方案方向可继续，但当前仓库还没有 Official Provider 代码，P0/P1 仍处于未实现状态。以下打回项必须在授权后的首批实现中优先修正。

| 子代理 | 发现问题 | 修正措施 | 验证要求 |
| --- | --- | --- | --- |
| D：实现方案评审 | Official Gateway WS 不能伪装成 OneBot action WS；现有 `ws` 参数散落在 bot、订阅、Agent 回复中 | 引入 provider runtime handle。`global.bot.provider` 作为 provider 真源；NapCat 保留 `global.bot.ws`；Official 通过 provider facade 发送，不暴露为 OneBot action WS | NapCat `send_group_msg/send_private_msg/callAction` payload 回归；Official 下 Agent/订阅/命令发送均走 provider facade |
| D：实现方案评审 | P0 命令可用与 Official 身份授权没有闭环 | 新增 provider-aware auth helper，至少支持 `QQ_OFFICIAL_ROOT_OPENIDS`；Official 的 `member_openid/user_openid/group_openid` 与数字 QQ namespace 隔离 | Official 事件 mock 下 `/菜单`、订阅、取消订阅、查询订阅、基础设置权限可判定；NapCat 数字 QQ 权限不变 |
| D：实现方案评审 | RateLimiter 位置不够硬，订阅和命令可能绕过 qpm 队列 | Official 所有主动发送统一进入 provider rate limiter；`notificationService` 和订阅推送不得直接绕过 | fake clock 压测账号桶、单群桶、队列顺序、429 退避 |
| D：实现方案评审 | Capability gate 落点不够具体 | Agent 列举前过滤、normalize/execute 前兜底；命令和服务层对不支持 OneBot action 返回 structured unsupported | Official 下 `qq.*` 群管/账号/审批、`@全体`、emoji reaction、本地 `file://` 均被隐藏或明确拒绝 |
| D：实现方案评审 | `enabledGroups/groupConfigs` 混存 Official openid 有迁移风险 | P0 不自动把 Official openid 写入会影响 NapCat 的白名单字段；新增 provider-scoped 状态或显式 key | 切换 provider 不会误禁用 NapCat 群；Dashboard/状态接口可区分 provider ID |
| E：安全评审 | logger、Dashboard logs/status 可能泄露 secret、token、Authorization、OpenAPI raw body | 新增统一 `redactSensitive`，接入 logger、OpenAPI/Gateway/TokenManager、Dashboard logs/status；错误对象只保留分类/错误码 | token 获取失败、OpenAPI 失败、WSS identify、logs/recent、status payload 测试均断言不含敏感模式 |
| E：安全评审 | Official 配置和 smoke 输出边界不清晰 | Official secret 只从 `.env` 读，不进入 `config.json`、Dashboard 可写配置、测试快照；smoke 默认 dry-run/mock，真实 smoke 显式启用且只输出状态摘要 | `.env.example`/README 说明真实值不可提交；smoke 输出不含 token/clientSecret/header/body |
| E：安全评审 | HTTPS 临时文件/对象存储、URL 白名单和 SSRF 风险 | MediaUploader 禁止 `file://`、localhost、私网、带凭证 URL；公网临时 URL 需 TTL、随机路径、大小和 content-type 白名单、清理、不落完整日志 | MediaUploader 单测覆盖非法 URL、本地路径、私网 URL、过大文件、签名 URL 脱敏 |
| E：安全评审 | Dashboard 状态字段需要分级 | 公开状态只展示低敏健康；认证接口可展示 token TTL、capability、错误码分类，但不得返回 secret/raw headers/raw body/签名 URL | `/api/status` 和认证 provider status 测试字段白名单 |
| F：可靠性评审 | WSS Hello/Identify/Heartbeat ACK/Reconnect/Resume 缺失 | GatewayClient 实现 `/gateway/bot`、Hello、Identify、heartbeat interval、ACK 超时、close code 分类、jitter reconnect、Resume/Identify 回退 | fake WebSocket 覆盖 ACK、超时、Reconnect、Invalid Session、Resume 成功/失败、stop 清 timer |
| F：可靠性评审 | Token 刷新并发和失败策略缺失 | TokenManager 实现单飞刷新、提前刷新、失败保留未过期 token、401 强刷一次、退避、脱敏 | TokenManager 单测覆盖并发、过期、失败、401、日志脱敏 |
| F：可靠性评审 | 主动消息开关和 qpm 状态缺失 | ID Store/Reachability 记录 `GROUP_MSG_RECEIVE/GROUP_MSG_REJECT`；reject 状态跳过订阅主动推送并记录原因 | 事件 mapper + 订阅推送测试覆盖 receive/reject 状态变化 |
| F：可靠性评审 | 入站事件幂等不足 | Official dedup key 优先 `event_id`，其次 `msg_id/msg_seq/openid/group_openid`；被动回复字段传入发送层 | 重放同一官方事件只触发一次命令/链接/Agent/订阅响应 |
| F：可靠性评审 | stop/cleanup/timer 资源清理需要补齐 | Provider stop 清 WSS、heartbeat、reconnect、rate limiter timer；bot shutdown 等待 provider/subscription stop；保留 NapCat 原行为 | GatewayClient stop 单测、bot lifecycle 针对性测试 |

### 第 2 轮修正后的首批实现顺序

1. 配置、安全和身份基座：`QQ_PROVIDER`、Official env 配置、`QQ_OFFICIAL_ROOT_OPENIDS`、脱敏工具、配置快照白名单。
2. Provider 工厂和 NapCatProvider：包住现有 NapCat 行为，保留 `global.bot.ws/selfId/groupList`。
3. `notificationService` provider-aware facade：旧签名兼容，Official 发送返回统一 `{ ok, reason, messageId, raw }`。
4. Official core：TokenManager、OpenAPI Client、GatewayClient、EventMapper、ID Store。
5. Official sender/media/rateLimiter：文本、图片、视频、撤回、被动回复字段、qpm 队列和失败分类。
6. 业务接入：messageHandler 去重/emoji capability、subscription runtime、Agent reply/tool capability、Dashboard provider status。
7. 测试与 smoke：新增 provider 单测、业务轻集成、NapCat 回归、真实凭据 smoke 手工步骤。

## 风险与处理

| 风险 | 影响 | 处理 |
| --- | --- | --- |
| `file_data` 是否可单独上传不确定 | 图片/视频发送实现方式变化 | P0 spike 先验证；失败则启用临时 HTTPS 文件服务 |
| 官方 ID 不是 QQ 号 | 现有管理员、黑名单、群配置不能直接复用 | P0 直接使用 openid；P1 做绑定和迁移工具 |
| 群全量消息依赖群主设置 | 无法像 NapCat 一样默认监听全群 | Dashboard/日志提示群主开启；未开启时支持 @Bot 模式 |
| 主动推送依赖群主设置 | 订阅推送可能失败 | 记录 `GROUP_MSG_RECEIVE/REJECT`，不可达群跳过或降级 |
| 群管能力不等价 | Agent 群管理工具不可用 | capability gate 禁用官方 Provider 下的群管工具 |
| URL 文本需要后台配置 | 含 B 站 URL 文本可能失败 | 启动检查文档提示；发送失败时给出后台配置建议 |

## 实施顺序

1. 抽象 Provider 接口，现有 NapCat 迁入 `napcatProvider`，保持行为不变。
2. 将 `bot.js` 改为加载 provider，并把 provider 传入订阅、命令、handler。
3. 改造 `notificationService` 为 provider-aware facade。
4. 实现 Official TokenManager、OpenAPI client、Gateway client。
5. 实现官方事件到内部消息的 mapper。
6. 实现文本发送和图片上传发送。
7. 接入订阅主动推送队列和 qpm 限速。
8. 接入视频发送、撤回和 Dashboard 状态。
9. 收敛 Agent/命令 capability 降级。
10. 补充单元测试和真实沙箱/群聊验证记录。

## 参考文档

- 接口调用与鉴权：https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/api-use.html
- 事件订阅与通知：https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/event-emit.html
- 获取 WSS 接入点：https://bot.q.qq.com/wiki/develop/api-v2/openapi/wss/url_get.html
- 获取带分片 WSS 接入点：https://bot.q.qq.com/wiki/develop/api-v2/openapi/wss/shard_url_get.html
- 唯一身份机制：https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/unique-id.html
- 发送消息：https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/send-receive/send.html
- 富媒体消息：https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/send-receive/rich-media.html
- 消息事件：https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/send-receive/event.html
- 撤回消息：https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/send-receive/reset.html

## 实施进度更新（2026-07-09）

用户已授权修改源码、配置模板、测试和本地文档；仍禁止任何 git branch/commit/push/pull/merge/rebase/reset/PR 操作。

### 已落地

| 范围 | 状态 | 代码证据 | 验证 |
| --- | --- | --- | --- |
| Provider 基座 | 已实现 | `src/providers/qq/**`，包含 `providerFactory`、`runtime`、`NapcatProvider`、`OfficialQqProvider` | `provider-selection-and-facade.test.js` |
| 安全脱敏 | 已实现 | `src/utils/redactSensitive.js`，`src/utils/logger.js` 接入 fields/error/rendered/json | `logger-redaction.test.js` |
| 配置/后台切换 | 已实现 | `QQ_PROVIDER`、Official env/schema、WebUI 设置页 `QqProviderSection`、后台 `/api/config` 保存 | `dashboard-qq-provider-config.test.js`、Dashboard lint |
| Official Token/OpenAPI | 已实现 | `official/tokenManager.js`、`official/openapiClient.js`，支持缓存、单飞、401 强刷、429 retry-after | `official-token-manager.test.js`、`official-openapi-client.test.js` |
| Official Gateway | 已实现 | `official/gatewayClient.js`，支持 `/gateway/bot`、Hello、Identify、Heartbeat ACK、Reconnect、Invalid Session、Resume、stop 清 timer | `official-gateway-fake-ws.test.js` |
| EventMapper | 已实现 | `official/eventMapper.js` 支持 C2C、GROUP_AT、GROUP_MESSAGE、GROUP_ADD/DEL、GROUP_MSG_RECEIVE/REJECT，并区分 `member_openid/user_openid` | `official-event-mapper.test.js` |
| 出站文本/图片/视频/撤回 | 已实现 | `official/messageSender.js`、`mediaUploader.js`、`messageIdStore.js`；`notificationService` provider-aware facade；本地文件可通过 `/qq-official-temp/` 临时公网 URL 发布 | `official-message-sender.test.js`、`official-media-uploader.test.js`、`videoDownload-official-provider.test.js` |
| qpm 队列 | 已实现 | `official/rateLimiter.js`，账号/单群窗口、队列、429 退避、失败记录、stop 清理 | `official-rate-limiter.test.js` |
| ID/reachability | 已实现 | `official/idStore.js` 保存 group/user/member openid、角色/昵称/状态、群主动消息与全量消息观测状态；订阅 reachability helper 读取 Official `GROUP_MSG_REJECT` 状态 | `official-id-store.test.js`、`subscription-official-reachability.test.js` |
| bot.js 接入 | 已实现 | `QQ_PROVIDER=official` 走 Official provider；NapCat 仍保留原 `global.bot.ws` 真 WebSocket | 语法检查通过，后续跑 bot lifecycle 回归 |
| messageHandler/命令 | 已实现 | Official dedup key 不依赖外层 `message_id`；Official 禁用 NapCat emoji reaction；基础设置和订阅类指令走 notification facade | `messageHandler-official-dedup.test.js`、`messageHandler-official-command-flow.test.js` |
| 链接/视频/Agent | 已实现 | 链接预览发送走 Official facade；视频发送使用 bot 写入路径供公网 URL 映射；Agent 工具按 provider gate，基础文本回复 await Official 发送结果 | `link-sender-official-provider.test.js`、`videoDownload-official-provider.test.js`、`agent-provider-capability-gate.test.js`、`agent-official-reply-executor.test.js` |
| Dashboard 状态 | 已实现 | `/api/status` 带低敏 `qqProvider`；认证接口 `/api/qq-provider/status` | `dashboard-provider-status.test.js` |
| Smoke 工具 | 已实现 | `test/tools/qq-official-smoke.js`，默认 dry-run；`QQ_OFFICIAL_SMOKE_REAL=1` 才使用真实凭据，并只输出状态摘要 | `node test/tools/qq-official-smoke.js` |
| 文档/模板 | 已实现 | `config/.env.example`、`config/config.json.example`、`README.md` | 文档审查待最终收口 |

### 第 1 轮审计回收

第 1 轮使用三个只读子代理并行审计：

- 代码架构审计：指出公开 `/api/status` 状态过细、媒体 URL 子目录映射不完整、Gateway 重连可能双连接、Agent/链接发送未 await、Official 去重依赖外层 `message_id` 等问题。
- 官方 API/协议核对：确认必须覆盖 token、`/gateway/bot`、Identify/Heartbeat/Resume、事件映射、发送/富媒体/撤回；指出 `file_data` 不能作为唯一稳定路径，群全量/主动推送依赖群主开关。
- 测试策略核对：指出缺业务闭环、Gateway reconnect/ACK timeout、私聊/视频/撤回、Dashboard 认证状态、Agent 基础回复、smoke 脚本等测试。

### 第 1 轮修正结果

| 打回项 | 修正 | 验证 |
| --- | --- | --- |
| 公开 `/api/status` 暴露过细 | 新增 public provider summary，详细 openid/token TTL/群状态保留在认证 `/api/qq-provider/status` | `dashboard-provider-status.test.js` |
| 媒体 URL 不稳定 | `hybrid` base64 同步生成临时 URL；本地文件保留 `downloads/` 相对路径；Dashboard 只读发布 `/qq-official-temp/` | `official-media-uploader.test.js`、`videoDownload-official-provider.test.js` |
| Gateway 重连可能双连接 | `RECONNECT/INVALID_SESSION` 先进入单例重连，再关闭当前 socket；close 不覆盖 `reconnecting` 状态 | `official-gateway-fake-ws.test.js` |
| Agent/链接发送未 await | `replyExecutor`、`linkHandler`、`linkSender`、link 默认 sender await Official Promise；`enableFallback=false` 时失败抛出 | `agent-official-reply-executor.test.js`、`link-sender-official-provider.test.js` |
| Official 去重依赖外层 `message_id` | 只要存在 Official metadata 即构造 dedup key | `messageHandler-official-dedup.test.js` |
| P0 业务闭环证据薄 | 增加基础设置/订阅类命令、链接预览发送、Agent 基础回复、视频发送 mock 测试 | 对应新增测试全部通过 |

### 第 2 轮评审状态

第 2 轮子代理 D/E/F 已分发，分别审实现边界、安全凭据和运行可靠性。其打回项将继续记录到本节。

### 当前未完成/需真实环境验证

| 项目 | 状态 | 原因/下一步 |
| --- | --- | --- |
| 真实 QQ WSS READY/ACK/Resume | 未实测 | 单测覆盖 fake WS；需要用真实 AppID/Secret 启动 Official 模式观察 |
| 真实群 `/菜单`、B 站链接预览、订阅主动推送 | 未实测 | 依赖群主开启 @Bot/群全量/主动发言开关 |
| 真实富媒体 `file_data`/URL | 未实测 | 已实现失败文本降级；视频/本地文件可配置临时公网 URL 或对象存储 |
| Official 被动回复窗口 | 已实现，待真实验证 | `AsyncLocalStorage` 将 inbound `msg_id/event_id/msg_seq` 透传至 notification facade；sender 支持被动回复字段 |
| 完整群管/审批/账号状态 | 不在 P0-P1 等价范围 | Official 下通过 capability gate 隐藏或拒绝；NapCat 保持完整能力 |

## 最终验收快照（2026-07-09，历史行为）

> 下述快照只记录 2026-07-09 当时的实现。`restartRequired=true`、`.env`、独立 Secret store 和 `config.json` 均已被 2026-07-10 统一 YAML、受控热重载与自动迁移合同取代，不得作为当前部署或开发指引。

2026-07-09 当时的结论是：QQ Official Provider P0-P1 已完成本地代码落地和自动化验证；当时后台切换 Provider 后返回 `restartRequired=true`，重启后再生效。该行为现已废止，当前 Provider 配置通过统一 YAML 与受控重连生效。

当时的本地验证使用 `config/.env` 与独立 Secret store；本文档和测试输出没有记录真实值。该存储模型现已废止，当前 Secret 只由 `config/config.yaml` 持有，公开接口只返回 configured marker。

### P0 完成矩阵

| P0 项 | 最终状态 | 代码/测试证据 |
| --- | --- | --- |
| Provider 抽象与 NapCat 默认兼容 | 已完成 | `src/providers/qq/providerFactory.js`、`napcatProvider.js`；`provider-selection-and-facade.test.js` |
| 后台连接模式切换 | 已完成 | `dashboard/src/pages/settings/components/QqProviderSection.jsx`、`src/dashboard/routes/api/modules/config.js`；`dashboard-qq-provider-config.test.js`、Dashboard lint/build |
| TokenManager 获取/缓存/刷新 token | 已完成 | `official/tokenManager.js`；`official-token-manager.test.js` |
| WSS Gateway `/gateway/bot`、Identify、Heartbeat、Resume | 已完成本地 fake WSS 验证 | `official/gatewayClient.js`；`official-gateway-fake-ws.test.js` |
| C2C、GROUP_AT、GROUP_MESSAGE、GROUP_ADD/DEL、GROUP_MSG_RECEIVE/REJECT 映射 | 已完成 | `official/eventMapper.js`；`official-event-mapper.test.js` |
| 文本群聊/私聊发送 | 已完成 | `official/messageSender.js`、`openapiClient.js`；`official-message-sender.test.js` |
| 图片预览卡发送 | 已完成本地 mock 验证 | `official/mediaUploader.js`、`notificationService.js`；`official-media-uploader.test.js`、`link-sender-official-provider.test.js` |
| `/菜单`、订阅、取消订阅、查询订阅、基础设置 | 已完成 | `messageHandler-official-command-flow.test.js` 覆盖菜单、设置和订阅类指令 |
| B 站链接入站到链接 pipeline | 已完成 | `messageHandler-official-command-flow.test.js` 覆盖 Official 入站 B 站 URL 进入 link pipeline |
| 订阅主动推送走 qpm 队列 | 已完成 | `updateChecker-notify-result.test.js` 覆盖 Official sender + media uploader + qpm 调度 |
| Agent 基础文本回复 | 已完成 | `agent-official-reply-executor.test.js` |

### P1 完成矩阵

| P1 项 | 最终状态 | 代码/测试证据 |
| --- | --- | --- |
| 被动回复 `msg_id/event_id/msg_seq` | 已完成 | `messageHandler.js`、`notificationService.js`、`messageSender.js`；`official-message-sender.test.js` |
| Official 事件去重 | 已完成 | `messageHandler.js`；`messageHandler-official-dedup.test.js` |
| 群聊/单聊撤回 | 已完成 | `officialProvider.js`、`openapiClient.js`、`messageIdStore.js`；`official-message-sender.test.js` |
| 图片/视频富媒体失败分类与 fallback | 已完成 | `messageSender.js`、`videoDownloadService.js`；`official-message-sender.test.js`、`videoDownload-official-provider.test.js` |
| RateLimiter 账号/单群 qpm、队列、429 退避、失败脱敏 | 已完成 | `official/rateLimiter.js`；`official-rate-limiter.test.js` |
| Dashboard 状态 | 已完成 | 设置页展示当前 provider/连接态/token TTL，后端公开低敏 `/api/status` 与认证 `/api/qq-provider/status`；`dashboard-provider-status.test.js` |
| Capability 降级 | 已完成 | `capabilities.js`、`agent/tools/registry.js`、`messageHandler.js`、`requestApprovalService.js`；`agent-provider-capability-gate.test.js`、`requestApprovalService.test.js` |
| ID Store/reachability | 已完成 | `official/idStore.js`、`groupReachability.js`；`official-id-store.test.js`、`subscription-official-reachability.test.js` |
| NapCat 回归 | 已完成本地自动化回归 | `npm test` 全量通过，包含 NapCat send payload 兼容测试 |

### 三轮子代理评审回收

| 轮次 | 子代理关注点 | 打回项 | 修正状态 |
| --- | --- | --- | --- |
| 第 1 轮 | 架构、官方 API、测试策略 | 状态接口过细、媒体 URL 不稳定、Gateway 重连、Agent/链接 await、Official 去重、业务闭环测试不足 | 已修正并新增对应测试 |
| 第 2 轮 | 实现边界、安全凭据、运行可靠性 | Provider runtime、openid 权限、qpm 位置、capability gate、secret/token 脱敏、SSRF/本地路径限制、WSS/Token 可靠性 | 已修正并新增 Token/Gateway/Media/RateLimiter/ID Store 测试 |
| 第 3 轮 | P0/P1 严格验收、NapCat 差异 | EventMapper 直接覆盖不足、`/菜单` 和 Official 链接端到端证据薄、订阅 + qpm 集成证据薄、RateLimiter failure 未统一脱敏、Official 下审批 action 边界 | 已补齐测试与小补丁；Avicenna 输出的 NapCat 差异纳入下表 |

### 最终验证记录

| 命令 | 结果 |
| --- | --- |
| `node --check` 针对修改的 Node 源码和 JS 测试 | 通过 |
| `npx mocha --exit test/unit/providers/qq/official-rate-limiter.test.js test/unit/providers/qq/official-event-mapper.test.js test/unit/providers/qq/official-message-sender.test.js test/unit/messages/messageHandler-official-command-flow.test.js test/unit/subscriptions/updateChecker-notify-result.test.js` | `30 passing` |
| `node test/unit/services/requestApprovalService.test.js` | 通过 |
| `npx mocha --exit test/unit/dashboard/dashboard-provider-status.test.js test/unit/dashboard/dashboard-qq-provider-config.test.js` | `4 passing` |
| `npm --prefix dashboard run lint -- --quiet` | 通过 |
| `npm --prefix dashboard run build` | 通过；仅有 chunk size 与 browserslist 常规 warning |
| `node test/tools/qq-official-smoke.js` | dry-run 通过，输出 token/gateway 摘要且不含 secret/token |
| `npm test` | `190 unit test files passed` |

### 尚未真实环境验证

| 项目 | 状态 | 原因 |
| --- | --- | --- |
| 真实 QQ WSS READY/ACK/Resume | 未实测 | 本地 fake WSS 覆盖协议行为；真实环境需用 Official 模式启动进程观察 |
| 真实群 `/菜单`、B 站链接预览、订阅主动推送 | 未实测 | 依赖机器人被加入群、群主开启 @Bot/全量消息/主动发言 |
| 真实富媒体 `file_data` 与公网 URL | 未实测 | 本地 mock 覆盖 body 和 fallback；官方侧拉取 URL 需要公网可访问地址 |
| 真实撤回窗口 | 未实测 | 本地覆盖 DELETE endpoint 和 messageIdStore；官方权限/时间窗口需实群确认 |

### QQ Official 对比 NapCat / OneBot 缺少的能力

| 能力 | NapCat / OneBot | QQ Official 当前实现 | 差异与影响 |
| --- | --- | --- | --- |
| 文本群聊/私聊 | 支持 | 支持 | Official 使用 `group_openid/user_openid`，不是数字 QQ/群号 |
| 图片 | 支持 base64/共享文件 | 支持 `/files` + `msg_type=7`，失败文本降级 | 真实稳定性取决于官方 `file_data` 和公网 URL |
| 视频 | 支持共享目录 `file://` | 支持受限本地文件读取、file_data/公网 URL、失败分类 | 大文件和公网拉取需真实验证 |
| mixed chain | OneBot chain 可原样发送 | 拆成多条文本/媒体顺序发送 | 群内展示可能从单条变多条 |
| 主动群发 | NapCat 直接发 | 支持，但受群主主动发言开关和 qpm 限制 | 不可达群会被跳过并记录原因 |
| 被动回复 | 支持 | 支持 `msg_id/event_id/msg_seq` | 真实窗口规则需实测 |
| 撤回 | `delete_msg` | 支持群/私聊 DELETE | 主要撤回机器人自己发送的消息 |
| 群全量消息 | 默认可收 NapCat 侧消息 | 支持 `GROUP_MESSAGE_CREATE` | 依赖群主开启全量消息 |
| 群 @ | 支持 at segment | 支持 `GROUP_AT_MESSAGE_CREATE` | Official 默认入口更适合 @Bot |
| 私聊 | 支持数字 QQ | 支持 C2C openid | Root 管理员需配置 `QQ_OFFICIAL_ROOT_OPENIDS` |
| B 站链接文本解析 | 支持 | 支持普通文本 URL | QQ 卡片/JSON segment 的结构化 URL 仍主要是 NapCat 能力 |
| emoji reaction | 支持 `set_msg_emoji_like` | 不支持，已跳过 | 链接处理中没有表情反馈，但主流程不受阻 |
| @全体 | 支持 NapCat action/segment | 不支持，降级普通推送 | 订阅 @全体在 Official 下不会生效 |
| 群列表/成员信息 | 支持完整查询 | 仅观测缓存和有限 `get_group_list` 兼容 | Dashboard 群名/成员数不等价 |
| 群管：禁言/踢人/名片/全员禁言 | 支持 | 不支持，Agent/服务层 gate | Official 模式无法群管 |
| 群公告/精华 | 支持 | 不支持 | 后台/Agent 应隐藏或提示不支持 |
| 好友/加群审批 | 支持 request + set request action | 不支持，Official 下明确 `unsupported_official_action:request_approval` | 审批快捷回复不会误调 Official |
| 在线状态/输入状态 | 支持 | 不支持 | 账号状态类功能隐藏 |
| 任意本地 `file://` | NapCat 可读共享目录 | 只允许配置目录内文件，并转 file_data/公网 URL | 避免任意本地文件读取风险 |
| Agent QQ 工具 | 暴露完整 `qq.*` | 仅允许 Official 支持的安全子集，如删除消息 | 避免 LLM 误用群管/审批/账号工具 |
