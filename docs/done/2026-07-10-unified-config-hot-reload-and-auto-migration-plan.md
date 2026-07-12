# 单一 config.yaml、全量热重载与历史数据自动迁移方案

**日期：** 2026-07-10  
**状态：** `ARCHIVED — COMPLETE WITH ACCEPTED RESIDUAL RISKS`；2026-07-12 已归档至 `docs/done/`。用户已接受 legacy-v0 首次升级在不可判定 in-flight 窗口内采用 best-effort、允许极小概率重复或漏推，并接受 18.45 所列 setup crash-only 残余边界。最新三路独立 review、Config CAS 聚焦复核与三路第 14 节 auditor 均 PASS；最终验证和证据矩阵见 18.47  
**目标：** 将当前分散在 `config/.env`、`config/config.json`、`config/.jwtSecret`、`config/.qqOfficialClientSecret` 的应用配置统一到唯一的 `config/config.yaml`，让用户只维护一个配置文件；新版本部署时自动迁移旧配置和需要升级的历史持久化数据；除宿主机端口、Docker volume 等基础设施级变更外，应用配置均通过直接刷新或受控重建子系统生效。

> **后续合同变更（2026-07-12）：** 本文记录的是当时已完成的完整设计与验证历史。当前 `setup.sh` 已移除 install/upgrade/apply、部署事务、Compose ownership、fencing、health gate 和回滚，恢复为 v3.24.6 范围的 NapCat 交互式快捷部署；本文后续相关命令和状态机描述不再代表当前行为。

---

## 1. 最终结论

本轮配置治理采用以下硬决策：

1. **应用持久化配置最终只保留 `config/config.yaml`。**
2. 不再把 `.env`、`config.json`、JWT Secret 文件、QQ Official Secret 文件作为长期运行时配置源。
3. Secret 与普通配置统一进入 `config.yaml`，依靠文件权限、脱敏、备份权限和 API 白名单保护。
4. 新版本部署必须自动识别旧安装，并将旧配置按照旧版本真实优先级合并到 YAML，不能要求用户手工复制。
5. `data/`、`napcat/`、自定义字体和其他持久化目录在升级时必须保留；需要结构升级的数据由版本化 migration 自动处理。
6. 所有配置改动都必须被 watcher 检测并给出明确结果：
   - 已直接生效；
   - 已重建对应子系统并生效；
   - 属于宿主机/Docker 级变更，需要执行部署应用流程。
7. 无效 YAML、非法字段或重载失败不得让正在运行的 Bot 使用半份配置，也不得覆盖最后一份有效配置。
8. 升级和迁移必须可重复执行、可审计、可回滚。

本方案会替代当前文档中“Official Secret 只存 `.env`”“Provider 切换必须手工重启”等旧配置约定。实施时需要同步更新 README、CLAUDE.md 和 QQ Official Provider 相关计划中的配置章节。

---

## 2. 当前真实状态

当前应用配置至少来自以下四处：

| 当前文件 | 主要内容 | 当前问题 |
|---|---|---|
| `config/.env` | WS、Provider、管理员、路径、Agent LLM、Dashboard、日志 | 启动时加载，人工修改后不会可靠刷新；键名扁平且数量持续增长 |
| `config/config.json` | 群配置、订阅、预览、视频下载、Agent、Official 非敏感配置 | WebUI 写入能更新内存，但人工修改文件不会自动刷新 |
| `config/.jwtSecret` | Dashboard JWT Secret | 独立生命周期，迁移和备份容易遗漏 |
| `config/.qqOfficialClientSecret` | QQ Official Client Secret | 与 `.env`、`config.json` 存在特殊优先级 |

当前配置加载还有以下不一致：

- 普通 schema 字段通常是 `config.json > .env > default`。
- Agent LLM 和预算字段通常是 `.env > config.json.agent > default`。
- QQ Official Secret 是 `.env > .qqOfficialClientSecret > config.json`。
- JWT Secret 是 `config.json.jwtSecret > .env > .jwtSecret > 自动生成`。
- `ADMIN_QQ` 仍由业务代码直接读取 `process.env`。
- 日志、浏览器路径、消息去重等模块仍绕过统一 config facade。
- Python 服务端口、脚本路径、视频下载目录等在实例构造或模块加载阶段固化。

因此，不能通过“把 JSON 改成 YAML，再加 `fs.watch`”完成本任务。必须同时治理配置真源、调用方式、持久化、差异应用、子系统生命周期和部署迁移。

---

## 3. 最终目录与用户操作面

升级完成后，安装目录中的应用配置只要求用户维护：

```text
config/
└── config.yaml
```

其他目录仍按职责保留：

```text
data/                    # 订阅、Cookie、Agent 状态、缓存等持久化业务数据
napcat/                  # NapCat 配置和 QQ 数据
fonts/custom/            # 自定义字体
logs/                    # 日志
docker-compose.yml       # setup.sh 管理的部署文件，不作为应用配置真源
```

约束：

- `config/config.yaml` 加入 `.gitignore` 和 `.dockerignore` 的敏感配置规则。
- 配置目录权限建议为 `0700`，配置文件和含 Secret 的备份为 `0600`。
- 不在 `config/` 下保留 `.env.example`、`config.json.example` 等第二配置模板。
- 默认值和配置生成模板由代码内 schema 提供；README 只展示示例片段。
- `docker-compose.yml` 可以由 `setup.sh` 生成或更新，但用户不需要同时维护它和 YAML 中的相同字段。

---

## 4. config.yaml v1 结构

配置采用嵌套结构，避免继续扩张扁平环境变量命名空间。下方是用户可读示例；**可执行完整合同以 18.1 的 exhaustive schema inventory 为准**，init、validator、migration、flat facade、Secret 分类、diff 和 reload policy 必须全部由同一 schema 生成，示例不能成为遗漏字段的理由：

```yaml
version: 1

qq:
  provider: napcat
  napcat:
    wsUrl: ws://napcat:3001
    wsToken: ""
  official:
    appId: ""
    clientSecret: ""
    apiBase: https://api.sgroup.qq.com
    tokenUrl: https://bots.qq.com/app/getAppAccessToken
    useShardedGateway: true
    intents: 33554432
    gatewayAckTimeoutMs: 90000
    mediaUploadMode: hybrid
    tempPublicBaseUrl: ""
    rootOpenids: []
    rateLimit:
      accountQpm: 30
      groupQpm: 20
      queueMaxSize: 300

admin:
  rootQQ: "123456789"

dashboard:
  listenPort: 3000
  password: admin
  jwtSecret: ""
  allowedOrigins: []

deployment:
  ports:
    dashboardHost: 3000
    napcatWebuiHost: 6099
    napcatWsHost: 3001
  mounts:
    config: ./config
    data: ./data
    logs: ./logs
    fonts: ./fonts/custom
    napcatConfig: ./napcat/config
    napcatQq: ./napcat/qq
  network:
    name: bot_network
    external: false

paths:
  napcatTemp: /app/.config/QQ/tmp/
  napcatRead: /app/.config/QQ/tmp/
  python: python3
  biliScript: ./src/services/bili_server.py
  chromium: ""
  puppeteerExecutable: ""

pythonService:
  port: 10001

cache:
  dataTtlSeconds: 3600
  linkTtlSeconds: 600

messageDedup:
  ttlMs: 120000
  maxEntries: 50000

subscription:
  checkIntervalSeconds: 60

rendering:
  useBase64Send: false
  showId: true
  previewGradient:
    color1: "#D8C7F1"
    color2: "#BFE6E2"
  labels: {}
  nightMode:
    mode: off
    startTime: "21:00"
    endTime: "06:00"
  previewLayout: {}

videoDownload:
  enabled: false
  resolution: 1080p
  maxDurationSeconds: 600
  autoClean: true
  cleanTimeoutHours: 6

logging:
  level: info
  channels: []
  excludeChannels: []
  color: true
  timestamp: true
  pretty: true
  stacks: error
  bufferSize: 2000

agent:
  enabled: false
  observeOnly: true
  logTrajectory: true
  defaultGroupEnabled: false
  decisionMode: rule_only
  sendEnabled: false
  aliases: []
  persona: {}
  shortTerm: {}
  longTerm: {}
  replyPolicy: {}
  participation: {}
  replyer: {}
  expression: {}
  timing: {}
  social: {}
  tools: {}
  llm:
    enabled: false
    provider: openai-compatible
    baseUrl: ""
    model: ""
    apiKey: ""
    timeoutMs: 12000
    temperature: 0.2
    maxTokens: 500
  budget:
    enabled: true
    windowMs: 60000
    maxLlmCallsPerGroupPerMinute: 60
    maxLlmCallsPerUserPerMinute: 20
  groups: {}

enabledGroups: []
providerScopedEnabledGroups: {}
blacklistedQQs: []
groupConfigs: {}
```

说明：

- `agent.llm.apiKey` 替代当前 `apiKeyEnv + AGENT_API_KEY` 的双层间接配置。
- `dashboard.jwtSecret` 为空时，在首次生成 YAML 时写入随机值，而不是再创建 `.jwtSecret`。
- QQ Official Secret 直接进入 `qq.official.clientSecret`，WebUI 只返回 `configured: true/false`，永不回显明文。
- 旧 flat `dashboard.hostPort` 仅作为 migration/facade alias 映射到 `deployment.ports.dashboardHost`；应用进程只使用 `dashboard.listenPort`。
- 未来配置变更通过顶层 `version` 执行 schema migration。
- QQ、OpenID、群 ID、用户 ID、Token 和其他标识符均按字符串处理，禁止 YAML 数值隐式转换；只有端口、超时、容量等明确声明的字段可为数值。
- `groupConfigs.<id>`、`agent.groups.<id>`、`providerScopedEnabledGroups.<provider>`、`rendering.previewLayout` 使用专用 map schema：map key 可动态，map value 仍必须按已知结构严格校验。

---

## 5. 单一配置中心设计

### 5.1 模块结构

建议将 `src/config/` 调整为：

```text
src/config/
├── index.js                 # 兼容现有 require('../config')
├── configService.js         # 加载、patch、快照、generation、事件
├── schema.js                # YAML path、类型、默认值、Secret、重载策略
├── loader.js                # 只加载 config.yaml；兼容期调用 legacy loader
├── legacyLoader.js          # 仅用于旧安装迁移
├── validator.js             # 完整校验和归一化
├── writer.js                # 原子写入、权限、备份
├── watcher.js               # chokidar、hash、防抖
├── diff.js                  # old/new 差异和字段分类
└── reloadRegistry.js        # 各子系统重载处理器
```

版本化迁移统一放在 `src/migrations/config/**` 与 `src/migrations/data/**`，不再同时维护 `src/config/migrations/**` 第二入口。

### 5.2 Schema 元数据

每个字段至少声明：

```javascript
{
    yamlPath: 'subscription.checkIntervalSeconds',
    legacyKeys: ['subscriptionCheckInterval'],
    legacyEnv: ['SUBSCRIPTION_CHECK_INTERVAL'],
    type: 'int',
    default: 60,
    secret: false,
    reload: 'reschedule-subscription',
    validate: value => value > 0
}
```

`reload` 至少支持：

- `live`
- `resize-log-buffer`
- `reschedule-subscription`
- `restart-python-service`
- `restart-browser`
- `reconfigure-download-paths`
- `reconnect-qq-provider`
- `restart-dashboard`
- `deployment-apply-required`

### 5.3 兼容 facade

第一阶段保留现有平面调用：

```javascript
config.wsUrl
config.qqProvider
config.groupConfigs
config.subscriptionCheckInterval
```

这些 getter 映射到 YAML 嵌套路径。这样可以先替换配置底座，再分批修改调用方。

YAML watcher 启用前必须将全部生产隐式修改迁走：

```javascript
config.groupConfigs[groupId].showId = false
config.save()
```

替换为事务式接口：

```javascript
await config.update(['groupConfigs', String(groupId)], draft => {
    draft.showId = false
})
```

动态 ID 路径只能使用 segment array 或 RFC 6901 JSON Pointer，禁止点字符串拼接。最终 flat facade 只兼容读取；对象 getter 返回冻结快照，生产属性 setter、`_overrides`、嵌套 mutation + save 全部移除并由静态扫描门禁确认。

### 5.4 原子写入

唯一 writer 状态机以 18.4 为准：使用唯一 `0600` 临时文件、完整复读校验、file fsync、原子 rename、directory fsync；权限从创建时即正确，last-good/rollback/journal 不得留在 `config/`。本节不再保留第二套简化算法。

推荐直接依赖：

- `yaml`：保留 YAML Document、注释和节点信息。
- `chokidar`：处理原子 rename、Docker bind mount 和编辑器临时文件行为。

不能依赖当前 package-lock 中的间接依赖。

---

## 6. 热重载完整设计

### 6.1 Reload 流程

```text
文件变化
  -> 300~500ms 防抖
  -> 读取完整 YAML
  -> parse + normalize + validate
  -> 生成 candidate snapshot
  -> 与 active snapshot 做 diff
  -> 为 diff 构造 apply plan
  -> prepare parallel 资源 / preflight exclusive 资源
  -> pause/drain 受影响 ingress
  -> 提交前再次 CAS 确认磁盘 revision 未变化
  -> stage/fync YAML（人工 watcher 已在磁盘则只核对 hash）
  -> prepare exclusive 资源并执行可补偿切换
  -> 原子持久化 YAML + 切换 handles + 恢复 ingress
  -> 发布 snapshot/document generation/effective generation
  -> drain/dispose 旧资源
  -> 记录 generation 和结果
```

失败原则：

- YAML 解析失败：继续使用上一份有效配置。
- 字段校验失败：整份 candidate 拒绝，不部分应用。
- 子系统 prepare 失败：不切换 active snapshot，销毁 candidate。
- commit barrier 前发生任何失败：按依赖图逆序 rollback；旧 snapshot 和旧子系统始终保持 active。
- parallel commit 只允许不可失败的 handle swap；Official、same-port Python 等 exclusive cutover 允许在 snapshot 发布前执行可失败步骤，但必须有 journal 和逆序补偿恢复。
- 同一错误 hash 不循环刷屏；文件内容再次变化后重新尝试。

### 6.2 配置分类

| 配置 | 生效方式 | 预期行为 |
|---|---|---|
| 群配置、黑名单、显示、预览、Agent 行为 | `live` | 下一次请求直接使用新 snapshot |
| 缓存 TTL | `live` | 新判断立即使用新 TTL；必要时触发一次清理 |
| 日志等级、Channel、格式 | `live` | 下一条日志开始生效 |
| 日志 bufferSize | `resize-log-buffer` | 保留最新 N 条并调整容量 |
| 订阅间隔 | `reschedule-subscription` | 重建 timer，不中断正在执行的检查 |
| Dashboard 密码、Origins | `live` | 新登录、新请求立即生效 |
| JWT Secret | `live-with-warning` | 立即生效并明确提示现有 Token 失效 |
| QQ WS URL/Token/Provider/Official 参数 | `reconnect-qq-provider` | 暂停订阅、受控切换连接、失败回滚 |
| Python 路径、端口、脚本、Python 所需路径 | `restart-python-service` | 停旧进程、启新进程、health 成功后切换 |
| Chromium 路径 | `restart-browser` | 等活跃任务结束后关闭浏览器，下次懒启动 |
| NapCat 读写目录 | `reconfigure-download-paths` | 阻止新下载，等待活跃下载结束，切换路径并重启 Python/浏览器相关资源 |
| Dashboard listenPort | `restart-dashboard` | 关闭旧 listener，再监听新端口 |
| Dashboard hostPort、volume、Docker 网络 | `deployment-apply-required` | 配置状态中提示运行 `setup.sh --apply` |

### 6.3 QQ Provider 重载

`bot.js` 当前以模块级变量管理 WS、Official Provider 和定时器。应抽成可串行重配置的 `BotRuntime`：

```text
BotRuntime
├── start()
├── stop()
├── reconnectNapcat(nextConfig)
├── reconnectOfficial(nextConfig)
└── switchProvider(nextProviderConfig)
```

切换流程：

1. 获取全局 provider-reload mutex。
2. 先执行 provider-specific preflight；NapCat 可创建 shadow socket，Official 默认只预取 token/gateway 元数据，除非明确证明平台允许同 App 双 Gateway session。
3. pause/drain 新订阅与 outbound lease，并让所有回调绑定 slot generation。
4. NapCat 等 shadow READY 后进入 commit；Official 在保留旧 slot 完整重建参数的前提下停止旧 Gateway，再启动 candidate 并等待真实 READY。
5. 在 commit barrier 原子更新 `qqProviderRuntime`、`global.bot` 和订阅 transport。
6. 恢复新调度；NapCat 旧 Provider 等旧 generation lease 清空后停止，Official 的旧 slot 保留到 candidate READY/commit 完成。
7. candidate 失败时：NapCat 只销毁 shadow；Official 立即按旧 slot 参数重建并验证 READY，然后恢复旧调度。允许短暂受控停机，但不允许要求用户重启整个 Bot。

Provider 切换不再简单返回 `restartRequired=true`。

### 6.4 Python 服务重载

`ServiceManager` 不能继续只在 constructor 中读取端口和脚本路径。增加：

```javascript
await ServiceManager.reconfigure({
    pythonPath,
    port,
    scriptPath,
    managedEnv
})
```

新进程必须通过带 instance/generation 身份的 health 后再切换 `baseUrl`。端口不变时先用临时 probe port 验证，再 drain/停止旧 target-port 服务并启动 candidate；失败时按保留的旧 args/env 恢复。不能把旧端口上的孤儿进程当成新服务。

Python 子进程环境由 `configService.buildChildEnv()` 构造，不再依赖修改全局 `process.env`。

---

## 7. 历史旧配置自动迁移

### 7.1 迁移范围

新版本第一次部署或升级时，自动检测：

- `config/.env`
- `config/config.json`
- `config/.jwtSecret`
- `config/.qqOfficialClientSecret`
- 已存在的 `config/config.yaml`
- Docker Compose 中与应用配置重复的端口、Provider 信息

迁移完成后：

- 当前运行配置全部进入 `config/config.yaml`。
- 旧配置文件移动到受保护的 migration backup，而不是继续留在 `config/`。
- `config/` 最终只有 `config.yaml`。

### 7.2 必须保持旧版本真实有效值

迁移器不能简单按固定文件顺序覆盖，必须复刻旧代码的字段级优先级：

| 字段类别 | 旧版本有效值解析顺序 |
|---|---|
| 普通 schema 字段 | `config.json > .env > default` |
| Agent LLM/预算 | `.env > config.json.agent > default` |
| QQ Provider | `config.json.qqProvider > .env.QQ_PROVIDER > default` |
| QQ Official Secret | `.env.QQ_OFFICIAL_CLIENT_SECRET > .qqOfficialClientSecret > config.json` |
| JWT Secret | `config.json.jwtSecret > .env.JWT_SECRET > .jwtSecret > 自动生成` |
| Root Admin QQ | `.env.ADMIN_QQ > default/empty` |
| Official Root OpenIDs | `config.json > .env > default` |
| 群配置、预览、订阅配置 | `config.json > default` |

迁移测试需要使用旧版 loader 与新版 migration resolver 对同一组 fixture 计算结果，确保迁移前后的有效配置一致。

### 7.3 迁移步骤

```text
preflight
  -> 发现旧文件和现有安装版本
  -> 校验旧 JSON/.env/secret 文件可读
  -> 计算旧版本 effective config
  -> fsync cutover_intent，冻结/停止全部 mount writer
  -> 建立一致恢复点和 manifest
  -> 生成 config.yaml candidate
  -> 完整校验 candidate
  -> 原子写入 config.yaml
  -> 使用新镜像做 config validate
  -> 启动无业务 Provider session 的 upgrade-probe
  -> fsync runtime_release_armed/runtime_released releaseEpoch
  -> marker 后建立正式 Provider session 并执行 normal health gate
  -> 写 runtime_ready，归档旧配置文件
  -> 写 upgrade_complete
```

备份目录建议：

```text
data/migrations/
└── 2026-07-10T12-30-00-config-v0-to-v1/
    ├── manifest.json
    ├── config.env.backup
    ├── config.json.backup
    ├── jwtSecret.backup
    └── qqOfficialClientSecret.backup
```

安全要求：

- migration 目录为 `0700`。
- 备份文件为 `0600`。
- manifest 只记录路径、大小、权限、hash、版本和状态，不记录 Secret 明文。
- 日志中只输出字段名和 `configured=true/false`。

### 7.4 幂等性

`manifest.json` 至少记录：

```json
{
  "migrationId": "config-v0-to-v1",
  "sourceHashes": {},
  "targetHash": "...",
  "fromVersion": 0,
  "toVersion": 1,
  "status": "complete",
  "cutover": {
    "sourceRuntimeClass": "legacy-v0",
    "cutoverKind": "first-managed-adoption",
    "cutoverAttemptId": "opaque-random-id",
    "deliveryGuarantee": "best-effort",
    "ambiguousDeliveryWindow": true,
    "forcedStop": false,
    "appliesToCommittedRuntime": true,
    "warningCodes": ["LEGACY_INFLIGHT_DELIVERY_AMBIGUOUS"]
  }
}
```

`cutover` 是 migration manifest 的 typed metadata，不属于 `config.yaml` schema，不参与 source/public config hash、`documentGeneration`、`effectiveGeneration`、diff、reload effect、config transaction `warnings` 或 Dashboard config patch。`warningCodes` 只允许代码内枚举，不接收旧配置、环境变量、Provider 响应、异常文本或用户输入；详细异常仅进入脱敏后的私有诊断日志。公开 migration status 必须唯一通过 `toPublicMigrationStatus()` 投影为枚举、布尔值和时间戳，不返回路径、hash、payload、Secret、环境快照、stack 或自由文本。manifest checkpoint 写入不得触发 config watcher/reload DAG。

重复运行规则：

- YAML 不存在：执行旧配置迁移。
- YAML 已存在且有效：以 YAML 为真源，只补 schema migration，不重新导入残留旧文件。
- 上次迁移为 `prepared` 或 `failed`：读取 manifest，继续或回滚。
- source hash 与已完成记录一致：直接跳过。
- 只有显式 `--force-migrate-legacy` 才允许重新导入旧文件。

这可以避免每次升级都被历史 `.env` 把新配置覆盖回去。

### 7.5 回滚

迁移过程中旧文件在新版本健康前不得删除或移动。

如果发生以下任一情况：

- YAML 生成失败；
- 配置校验失败；
- 新容器无法启动；
- `/api/ready` 未达到目标 generation、超时或关键组件 degraded；
- QQ Provider 无法恢复 ready；

则：

1. 停止新版本容器。
2. 恢复升级前镜像引用或容器配置。
3. 保留原 `.env/config.json/secret` 文件。
4. 将失败 manifest 标为 `failed`。
5. 不把 candidate YAML 标为 active；必要时移动到 migration 目录供排查。
6. 重启旧版本并执行旧版 health check。

---

## 8. 历史业务数据自动迁移

“旧数据迁移”不能只覆盖配置。新版本升级还必须保证现有持久化业务数据继续可用。

### 8.1 默认原样保留的目录

- `data/cookies.json`
- `data/subscriptions.json`
- `data/subfollowers.json`
- `data/agent/`
- `data/contexts/`
- `data/profiles/`
- `data/vectors/`
- `data/qq-official-id-store.json`
- `napcat/config/`
- `napcat/qq/`
- `fonts/custom/`
- `logs/`

`setup.sh` 更新 Compose 或容器时不得删除、覆盖或重新初始化这些挂载目录。

### 8.2 数据 migration registry

新增版本化业务数据迁移入口：

```text
src/migrations/data/
├── index.js
├── v1-subscription-state.js
├── v2-agent-profile.js
└── ...
```

状态记录放在：

```text
data/migrations/data-schema-state.json
```

每个 migrator 必须声明：

- `id`
- `fromVersion`
- `toVersion`
- `detect()`
- `backup()`
- `migrate()`
- `validate()`
- `rollback()`

没有结构变化的数据只做存在性和可解析性检查，不进行无意义重写。

### 8.3 大文件和缓存策略

- 对即将修改的小型 JSON 数据先复制备份，再原子替换。
- `data/cache/`、下载文件、日志等可再生成或体积较大的目录不做全量备份。
- migration 不主动清空缓存，除非新版数据格式确实不兼容，并在 manifest 中记录原因。
- 迁移订阅数据时必须保留 `lastDynamicId`、`lastLiveStatus`、`lastVideoId`、`lastArticleId` 等推进锚点，防止升级后重复推送历史内容。

### 8.4 启动顺序

新容器入口应按以下顺序执行：

```text
validate config.yaml
  -> migrate config schema
  -> detect/migrate business data schema
  -> validate migrated data
  -> start Node runtime
  -> start Python service
  -> start Dashboard
  -> start QQ Provider
  -> start subscription runtime
```

数据迁移失败时应用不应带着半迁移状态继续启动。

---

## 9. setup.sh 一键部署与升级

### 9.1 支持模式

```bash
./setup.sh                       # 交互式首次安装或自动识别升级
./setup.sh --provider napcat
./setup.sh --provider official
./setup.sh --upgrade
./setup.sh --apply               # 应用 hostPort/volume 等部署级变化
./setup.sh --non-interactive --config config/config.yaml
./setup.sh --dry-run
```

### 9.2 首次安装

1. 检测 Docker 和 Compose。
2. 选择 Provider。
3. 根据代码 schema 生成唯一 `config/config.yaml`。
4. 生成 JWT Secret。
5. NapCat 模式写入 WS 和管理员配置；Official 模式写入 AppID、Secret、Root OpenIDs。
6. 设置目录和文件权限。
7. 根据 YAML 生成/更新 Compose。
8. `docker compose config -q`。
9. 拉取镜像并启动。
10. 轮询 `/api/ready`，要求配置、迁移、Dashboard、Python、Provider、订阅 generation 一致并连续成功。

### 9.3 旧版本升级

1. 识别现有容器、镜像、安装目录和持久化挂载。
2. 记录当前镜像 digest 和 Compose 状态。
3. 备份旧配置并生成 migration manifest。
4. 使用新镜像的配置 CLI 执行 `migrate --from-legacy`。
5. 使用新镜像执行 `config validate` 和 `data migrate --check`。
6. 保留全部数据 volume，启动新版本。
7. 先以无出站副作用的 `upgrade-probe` 验证 Dashboard、Python、只读数据加载和 paused 订阅运行时；QQ Provider 只做不消费业务事件的 token/HTTP 能力 preflight，不支持时明确 `deferred`，正式业务连接在持久 release marker 后建立。
8. 健康后才归档旧配置。
9. 失败则恢复旧镜像和旧配置。

### 9.4 Compose 处理

- 不再使用 `sed -i` 直接替换端口。
- `setup.sh` 通过配置 CLI 读取 `deployment.ports.dashboardHost`，渲染 Compose。
- Official 模式不强制启动 NapCat，也不等待扫码。
- NapCat 模式保留二维码登录流程。
- Compose 文件属于 setup 管理产物；重复执行必须保持自定义 volume 和网络配置，或在覆盖前给出 diff。

### 9.5 配置 CLI

建议增加：

```bash
node src/cli/config.js init
node src/cli/config.js validate
node src/cli/config.js get deployment.ports.dashboardHost
node src/cli/config.js set deployment.ports.dashboardHost 3000
node src/cli/config.js migrate-legacy
node src/cli/data-migrate.js check
node src/cli/data-migrate.js apply
node src/cli/data-migrate.js rollback
```

`setup.sh` 通过 CLI 读写 YAML，不再自己用 `awk/sed` 理解 YAML。

---

## 10. Dashboard 和命令侧调整

### 10.1 Dashboard API

所有配置写入统一进入：

```javascript
configService.patch(patch, {
    actor: 'dashboard',
    expectedGeneration
})
```

返回：

```json
{
  "generation": 12,
  "applied": ["logging.level"],
  "reloaded": ["subscription"],
  "deploymentApplyRequired": ["deployment.ports.dashboardHost"],
  "warnings": []
}
```

新增：

- `GET /api/config/status`
- `POST /api/config/reload`
- `GET /api/config/migrations`

状态至少展示：

- 当前 schema version；
- active generation；
- 最后成功 reload 时间；
- 最后失败原因；
- active 配置 hash；
- 等待执行的部署级变更；
- 最近 migration 状态。

### 10.2 Secret 处理

- API 永不返回 Secret 明文。
- Secret 未修改时前端不发送字段。
- Secret 更新后只返回 `configured: true`。
- config diff、日志、migration report、错误对象全部经过敏感字段脱敏。

### 10.3 QQ 命令和 Agent 工具

群命令、管理员命令、Agent 管理工具不能再直接修改 `config._overrides`。全部调用 config patch/update API，并获得同样的 reload result。

---

## 11. 代码调用点改造清单

### 11.1 必须移除的直接环境变量读取

- `src/agent/config/agentConfig.js`
- `src/config/authConfig.js`
- `src/config/jwtSecretOwner.js`
- `src/handlers/messageHandler.js`
- `src/services/agentBrowserService.js`
- `src/services/agentScreenshotService.js`
- `src/services/imageGenerator/core/browser.js`
- `src/utils/logger.js`
- Dashboard Agent 配置状态接口

测试工具可以显式注入测试配置，但生产代码不应再依赖 `.env`。

### 11.2 必须消除的构造期固化

- `ServiceManager.port/scriptPath/baseUrl`
- `videoDownloadService` 的下载和路径常量
- `UpdateChecker.checkInterval`
- `OfficialQqProvider` 内部 token manager、gateway、限流器和 uploader
- Dashboard listener 和 Official 临时静态目录
- 浏览器 executable path 和已启动实例
- Dashboard log buffer capacity

### 11.3 必须收口的配置写入

- Dashboard 全局配置路由
- Dashboard 群配置路由
- Agent 配置路由
- Preview Layout 保存/重置
- QQ `/设置`、管理员配置命令
- Agent 配置工具
- Provider Secret 更新

---

## 12. 分阶段实施计划

### Phase 0：冻结当前行为

- 为现有四种配置源补 fixture。
- 为每类字段记录旧版 effective value。
- 补 Secret 脱敏、权限和快照测试。
- 补 setup 升级场景的只读 fixture。

### Phase 1：建立 YAML ConfigService

- 引入 `yaml`、`chokidar` 直接依赖。
- 实现 schema、loader、validator、writer、diff。
- 保留 `src/config.js` 和平面 getter 兼容。
- 新安装只生成 YAML。

### Phase 2：旧配置自动迁移

- 实现 legacy loader 和字段级优先级 resolver。
- 实现 config v0-to-v1 migration。
- 实现 manifest、权限、幂等和 rollback。
- 确认迁移后 `config/` 只剩 `config.yaml`。

### Phase 3：调用方统一

- 替换生产代码中的直接 `process.env`。
- 替换 `_overrides` 和“修改后 save”模式。
- Dashboard、QQ 命令、Agent 工具统一调用 patch API。

### Phase 4：热重载

- 实现 watcher 和 last-good snapshot。
- 接入日志、缓存、订阅 timer。
- 接入 Python、浏览器、视频路径重建。
- 抽取 BotRuntime，接入 QQ Provider 重连和切换。
- 增加配置状态接口和 Dashboard 展示。

### Phase 5：业务数据 migration framework

- 建立 data schema state 和 migration registry。
- 为现有订阅、Agent、Official ID 数据建立检测和验证基线。
- 确认推进锚点和订阅状态不会在升级中丢失。

### Phase 6：setup.sh 与 Docker 升级链

- 用配置 CLI 替代 `.env` 的 `awk/sed` 修改。
- 支持 NapCat/Official 分支。
- 支持首次安装、升级、apply、dry-run、非交互模式。
- 加入新版本 health gate 和旧版本 rollback。

### Phase 7：移除旧配置实现

- 删除 dotenv 运行时加载。
- 删除 config.json store。
- 删除 JWT/Official 独立 Secret store。
- 删除旧 example 配置文件。
- 更新 README、CLAUDE.md 和相关计划真源。

---

## 13. 测试与验证计划

### 13.1 配置核心

- YAML 解析、类型、默认值和未知字段拒绝。
- Secret 脱敏。
- 原子写入和权限。
- watcher 防抖、自写入不循环。
- YAML 无效时保留 last-good。
- generation 冲突检测。
- Dashboard 与人工编辑并发时不丢更新。

### 13.2 迁移

- 只有 `.env`。
- 只有 `config.json`。
- 四个旧文件全部存在。
- 不同来源存在冲突值。
- 旧 Secret 文件损坏或权限异常。
- 已有 YAML 时不会再次导入旧文件。
- migration 中断后可继续。
- migration 失败后可回滚。
- 迁移前后 effective config 完全一致。

### 13.3 热重载

- 订阅间隔变化后旧 timer 被清理且只存在一个新 timer。
- 日志等级下一条日志生效。
- Dashboard 密码变化后旧密码失效。
- JWT Secret 变化后旧 Token 失效并记录 warning。
- NapCat WS 变更触发重连。
- NapCat/Official 切换成功且订阅 transport 更新。
- Official Secret/限流/Gateway 参数变化后新 Provider 使用新值。
- Python 配置变化后旧进程退出、新进程 health 通过。
- Chromium 变化时不杀死活跃渲染，空闲后重建。
- 下载路径变化时不会把文件写到旧目录。

### 13.4 业务数据

- `subscriptions.json` 和 `subfollowers.json` 迁移后订阅数量不变。
- 所有 last* 推进锚点不丢失。
- Cookie、Agent profile、长期记忆和 Official ID store 可正常读取。
- migration 不清空用户数据目录。

### 13.5 setup.sh

- `bash -n setup.sh`。
- `shellcheck setup.sh`（环境可用时）。
- 临时目录首次安装 dry-run。
- 旧版 fixture 升级 dry-run。
- NapCat 和 Official 两种安装路径。
- `docker compose config -q`。
- 新容器 `/api/ready` generation-aware health gate；probe 阶段订阅必须 paused 且无正式业务 Provider session，`runtime_released` marker 后同 epoch runtime 必须 running/ready。
- 故意提供错误 YAML，确认不会覆盖旧配置或启动半成品。

---

## 14. 完成验收标准

以下条件全部满足才算完成：

1. 新安装的 `config/` 目录只有 `config.yaml`。
2. 应用不再加载 `.env`、`config.json`、`.jwtSecret`、`.qqOfficialClientSecret`。
3. 旧安装升级无需用户手工复制配置。
4. 迁移后所有有效配置值与升级前一致。
5. 迁移后 Secret 不出现在日志、API、manifest 明文字段中。
6. `data/`、`napcat/`、字体等历史数据完整保留。
7. 订阅推进锚点与已落 delivery ledger 的投递状态不丢失，升级后不得重放已经确认提交的历史内容。唯一例外是 arbitrary legacy-v0 首次升级 cutover 窗口内、缺少 durable child/target delivery record 的 in-flight outbound operation：按用户决策采用 best-effort；可判定为未提交的 parent/target 正常重试，可能重复，旧版本 detached descendant 可能漏推。不得因迁移丢失已提交 anchor/ledger，例外不得扩散到窗口外历史内容。
8. 手工编辑合法 YAML 后，所有应用级配置能直接生效或自动重建对应子系统。
9. 非法 YAML 不影响当前运行实例。
10. Provider 切换、Python 配置、Chromium 路径不再要求用户手工重启整个 Bot。
11. 宿主机端口和 volume 变化能被明确识别，并可通过 `setup.sh --apply` 一键应用。
12. setup 在 `runtime_released` 持久 commit marker 前失败时能够恢复旧镜像、旧配置、原有数据、Compose、网络和所有 managed writer 状态；marker 后异常进入 `RECOVER_SAME_RELEASE_EPOCH`，不得伪称可安全回滚，也不得创建第二个 runtime epoch。
13. migration 和 setup 可重复执行，不会反复导入旧配置或覆盖新配置。
14. README、CLAUDE.md、Dashboard 提示和代码行为对配置真源的描述一致。

---

## 15. 实施风险与控制

### 风险一：大范围调用方依赖可变对象

现有代码和测试大量直接修改 `groupConfigs`、`agent` 和 `_overrides`。必须先提供兼容 facade，再逐步切换到事务 update，不能直接换成冻结对象。

### 风险二：Secret 与动态配置写入同一文件

通过 `0600`、原子写入、脱敏、受保护备份、WebUI 不回显和 Git ignore 控制。配置写入失败时不能把 Secret 写进错误日志。

### 风险三：QQ Provider 重连产生重复事件

Provider 切换必须串行，并避免新旧连接长时间同时消费事件。订阅和消息去重状态不能随 Provider 重建清空。

### 风险四：升级后历史订阅重复推送

迁移必须保留所有内容推进锚点和 delivery ledger。数据 migration 验证中应将这些字段列为强校验字段。legacy-v0 首次 cutover 的不可判定 in-flight outbound 使用 best-effort：可识别的未提交 parent/target 由新版本正常重试；旧版本没有 durable child record 的 detached download/fallback descendant 无法事后恢复，可能重复或漏推。manifest、setup 输出与 Dashboard migration status 必须明确记录 typed `cutover.deliveryGuarantee=best-effort`、受影响 feature inventory 和 warning，不能伪装成 exactly-once/at-least-once。

### 风险五：setup 自动覆盖用户部署定制

setup 更新 Compose 前先保存 diff 和备份；对于无法安全合并的自定义 Compose，停止并提示，而不是静默覆盖。

---

## 16. 本方案边界

本方案负责：

- 单一 YAML 配置真源；
- 配置自动迁移；
- 业务历史数据的版本化迁移框架；
- 应用级热重载和子系统重建；
- setup 一键安装、升级、验证和回滚。

本方案不承诺：

- 修改宿主机端口、Docker volume、Docker 网络后完全不重建容器；
- 在 YAML 严重损坏时自动猜测用户本意；
- 对未知的用户自定义 Compose 内容进行无条件自动合并。

这些场景必须明确报告并通过部署 apply 或人工确认处理，不能用不可靠的“伪热重载”掩盖。

---

## 17. 执行边界、所有权与评审编排

### 17.1 当前执行状态

- Workflow Map Stage：`automated-development-chain`，方案评审与并行实现已完成；阶段三第 1 轮 `code-review` 判定 blocked，当前按 reviewer 证据回到阶段二修复，修复和定向验证后重新进入代码 Review。
- Flow Lane：`standard`。原因是任务跨 Node/Python/Dashboard/Docker/setup，包含配置与业务数据迁移、Secret、安全权限、进程生命周期和失败回滚。
- Goal Mode：`enabled`。在本方案范围内连续推进评审、实现、验证和文档同步；遇到真实数据、生产、破坏性操作或 git workflow action 时停止。
- 当前唯一产品/工程真源：本文件。评审结论必须直接修订本文件，不能只留在聊天或 reviewer 输出中。
- 当前仓库没有 `.gstack/` active boundary；本节承担本任务的 active boundary、Subagent Plan 与 Spec Sync Plan 职责。

### 17.2 开工前已核对的实现基线（历史证据）

以下条目记录 2026-07-10 开工前的真实调用链，用于证明方案没有把假设当成已实现事实；它们不是当前工作区行为。当前实现与 Review 状态见 17.2.1。

- `src/config/schema.js` 仍在模块加载时调用 `dotenv.config(config/.env)`；`src/config/store.js` 仍把 `config/config.json` 作为可写真源。
- JWT Secret 与 QQ Official Secret 仍分别由 `src/config/jwtSecretOwner.js`、`src/config/secretStore.js` 管理。
- `src/bot.js` 以模块级 `ws`、`officialProvider`、reconnect/group timer 管理 Provider 生命周期；尚无可串行重配置的 `BotRuntime`。
- `src/services/ServiceManager.js` 在单例 constructor 固化 Python port/script/baseUrl，并把全量 `process.env` 传入子进程。
- `src/services/subscription/updateChecker/UpdateChecker.js` 在构造期固化检查间隔；Dashboard 当前通过命令式 `updateCheckInterval()` 单点补偿。
- `src/dashboard/server.js` 固化 listener、Official 临时静态目录和 log WebSocket；`src/dashboard/logBuffer.js` 在模块加载时固化容量。
- `src/services/imageGenerator/core/browser.js`、Agent 浏览器/截图服务仍直接读取 Chromium 环境变量；Python 下载根目录在模块 import 时由 `NAPCAT_TEMP_PATH` 固化。
- `setup.sh` 当前只覆盖 NapCat 交互安装，生成 `config/.env`，并使用 `sed` 修改 Compose 端口；没有升级 health gate、镜像/配置回滚、Official 分支或 dry-run。
- 当前真实 `config/` 含 `.env`、`.env.example`、`.jwtSecret`、`config.json`、`config.json.example`；迁移演练不得直接操作该目录。
- 根 `npm test` 会遍历 Node 与 Python 单测；本机已有 root/dashboard `node_modules` 与 `venv`，Docker Compose 可用，`shellcheck` 当前未检测到。

#### 17.2.1 当前工作区实现、验证与 Review 状态

- ConfigService 已落地唯一 `config/config.yaml`、v1 schema、严格 YAML、owner lock、generation/CAS、原子写与 fsync、`0700/0600` 权限、last-good、父目录 watcher/hash/debounce、diff/effect registry 和兼容 getter。
- 迁移层已覆盖四类 legacy 配置的字段优先级、typed manifest、受保护备份、幂等/续跑/rollback，以及订阅 anchor、delivery ledger、Agent、Cookie、Official ID 等业务数据 inventory/migration registry。
- Runtime 已覆盖日志/缓存/订阅 timer、Python、Dashboard listener、browser/Agent browser、下载路径和 NapCat/Official Provider 的受控热重载；Dashboard/API 已统一 generation-checked transaction 和 Secret configured marker。
- `setup.sh` 已实现首装、升级、apply、dry-run、non-interactive、NapCat/Official 分支、Compose ownership/render、health gate、releaseEpoch 和 marker 前恢复/marker 后 same-epoch recovery。
- 首轮实现验证已通过根 `npm test`（218/218 unit test files）、Dashboard lint/build、部署状态机 37 项、CLI 8 项、Python venv 定向测试、`bash -n setup.sh`、`docker compose config -q` 与 `git diff --check`；`shellcheck` 在当前环境不可用。
- 阶段三第 1 轮三个独立 reviewer 均判定 `BLOCKER=YES`：迁移/配置发现 8 个 P1、1 个 P2；生命周期发现 9 个 P1、1 个 P2；部署/API 发现 1 个 P0、11 个 P1、1 个 P2。问题集中于真实数据 identity/inventory、crash journal、最终 CAS/rollback degraded、Provider/Python 最终 readiness、operation lease、Official pre-marker preflight、setup 锁/marker/fsync、Compose ownership/network、Secret snapshot 清理和 Official opaque ID。全部问题已按文件所有权打回 implementer，修复与重验未完成前本方案状态保持 blocked-under-repair。

### 17.3 已有脏文件保护

以下路径在任务开始前已有用户未提交改动，必须保留并做增量合并，禁止回退或覆盖：

- `src/providers/qq/official/messageSender.js`
- `test/unit/providers/qq/official-message-sender.test.js`
- `test/unit/subscriptions/updateChecker-notify-result.test.js`
- 本方案文档本身为未跟踪文件，继续作为本任务唯一真源维护。

### 17.4 Allowed / Forbidden / Non-goals

Allowed Files：方案范围内的 `src/config/**`、`src/migrations/**`、`src/cli/**`、相关 runtime/provider/service/dashboard 源码、`dashboard/src/**`、`setup.sh`、Docker/ignore 配置、测试、README、CLAUDE.md 和冲突计划文档。

Forbidden Operations：

- 不创建或切换分支，不 commit/push/pull/merge/rebase/reset/cherry-pick，不创建 PR。
- 不修改或迁移当前真实 `config/`、`data/`、`napcat/`、`fonts/custom/` 内容；所有演练使用临时隔离副本。
- 不删除或覆盖与本任务无关的工作区改动。
- 不把测试替身、文档声明或未执行命令当作验收通过证据。

Functional Non-goals：

- 不改变订阅业务语义、消息发送语义、Preview Template/Layout 产品模型或 Agent 产品行为，仅调整其配置来源与重载生命周期。
- 不承诺对任意未知自定义 Compose 自动无损合并；无法证明安全时必须停止并报告 diff。
- 不执行真实生产升级、真实 QQ 重连或真实用户数据迁移；以隔离 fixture、dry-run、容器 smoke 和可复现本地 health 为验收证据。

### 17.5 Required Gates

- `plan-eng-review`：`done`。第 1—3 轮、provider reconciliation audit 与产品例外聚焦复核均完成；用户接受 legacy-v0 首次 cutover best-effort，三个聚焦 reviewer 均确认无剩余 BLOCKER，证据见 18.12.4。
- `data-access`：`not-required`。本任务不接真实业务数据源；仅迁移本地文件，且必须使用隔离副本。
- `prototype-logic-extraction`：`not-required`。本任务不以 UI mock/原型反推新后端业务逻辑；Dashboard 仅承接统一配置合同。
- `ui-design-quality`：`not-required`。Dashboard 只增加配置状态/结果展示并保持现有设计系统，不进行视觉重构；功能交互仍需 lint/build/API/浏览器 smoke。
- `data-knowledge-sync`：`planned`。Config API、migration manifest/data schema state 的最终合同必须同步 README、CLAUDE.md、本方案和相关冲突计划。
- `code-review`：实现后至少两轮、每轮三名未参与对应实现的独立 reviewer；仍有问题则第三轮。
- `qa`：定向测试、完整 `npm test`、Dashboard lint/build、Python venv 测试、setup/Docker/dry-run/smoke 全部形成可复现证据。
- `acceptance-audit`：多名独立 auditor 对第 14 节 14 项逐条建立“要求—实现—测试—结果—证据”矩阵。

### 17.6 文件所有权边界

主代理独占共享核心与最终集成：

- 本方案文档、`package.json`/lockfile、`src/config/index.js` 兼容 facade、`src/bot.js`/BotRuntime 集成点、`src/dashboard/routes/api/index.js`、`docker-compose.yml`、最终 README/CLAUDE.md 合并。
- 任何跨 implementer 的公共接口变更、冲突处理、完整 diff 检查和最终验证。

计划中的互斥 worker 写范围：

| Worker | 允许写入 | 禁止写入 |
|---|---|---|
| ConfigService | `src/config/**` 中的新底座模块、`test/unit/config/**` | runtime/provider/dashboard/setup；共享 facade 由主代理整合 |
| Migration | `src/migrations/**`、config legacy migration 专用模块、`src/cli/data-migrate.js`、迁移 fixtures/tests | runtime/provider/dashboard/setup |
| Runtime | `src/services/**`、`src/providers/qq/**`、必要的 runtime tests | `src/config/**`、Dashboard、setup；已有脏文件只允许增量合并 |
| Dashboard/API | `src/dashboard/**`、`dashboard/src/**`、dashboard tests | config core、runtime/provider、setup |
| Deployment/docs | `setup.sh`、部署模板/脚本、setup tests、README 和冲突计划草案 | config/runtime/dashboard 源码；CLAUDE.md 与 Compose 最终合并由主代理完成 |

共享核心文件不得由多个 worker 同时编辑；若 reviewer 要求改变公共合同，先由主代理更新本节再重新分配。

### 17.7 Subagent Plan

- Mode：`mixed`。
- Main Agent Owns：流程控制、真源修订、文件范围分配、公共接口、集成、验证、Review/QA 结论和最终答复。
- 方案评审 Round 1/2（必要时 Round 3）每轮固定三名只读 reviewer：
  - `config-architecture-reviewer`：schema、YAML、兼容 facade、并发、generation、Document、原子性。
  - `runtime-lifecycle-reviewer`：Provider、Python、Dashboard、browser/download、subscription timer、回滚与清理。
  - `migration-deployment-reviewer`：旧值优先级、业务数据、Secret/权限、setup/Docker、失败恢复与验证。
- reviewer 输入：本文件、当前代码、当前脏文件和上一轮修订；输出必须含文件/行号、严重级别、遗漏场景、可执行修订和阻断结论，且只读。
- implementer 仅在方案评审通过后启动，写范围严格按 17.6 互斥分配；必须列出 changed files 和最小验证结果，不得回滚他人改动。
- code reviewer 与最终 auditor 不得评审自己参与实现的对应范围。
- 重要结论全部回收到本文件、测试或最终验收矩阵，不只保留在 subagent 消息中。
- Blocker evidence follow-up（goal continuation，read-only）：
  - `napcat-reconciliation-explorer`（done）：核对 NapCat send/history/get-message 是否提供 client idempotency key、可稳定匹配的 bot message identity 或 fence 后对账能力；结论为不提供确定性 reconciliation。
  - `official-reconciliation-explorer`（done）：核对 QQ Official msg_id/msg_seq/event_id 的幂等/重试合同，以及是否支持发送后查询对账；结论为主动推送无可复用幂等键及发送后结果查询。
  - `legacy-window-code-reviewer`（done）：基于当前 send → ledger/anchor 链、日志字段和持久文件验证状态不可区分性；结论为 network fence、稳定期、cycle 终态和本地日志均不能消除 ACK-loss 窗口。
  - 三者均为只读独立复核，详细证据已回收到 18.12.3；未形成跨 Provider 的 exactly-once 证据。用户随后接受 legacy 首次 cutover best-effort 产品例外，因此不再以 `LEGACY_DELIVERY_STATE_UNPROVABLE` 阻断首次升级，但必须保留 warning 和窄化验收边界。
- Product-exception focused review（read-only，done）：
  - `config-exception-reviewer`（done/pass）：typed manifest/public status 与 config generation、reload warning、Secret projection 隔离成立。
  - `lifecycle-exception-reviewer`（done/pass）：正式 Provider session 延后到 release marker 后，releaseEpoch 与 deliveryPart 合同关闭新 runtime 例外外溢。
  - `deployment-exception-reviewer`（done/pass）：mountWriterSet、forced recovery、dry-run、rollback/recover-same-epoch 与 fixture 合同可实施。
  - 三者结论已回收到 18.12.4；阶段二 implementer 按 17.6/18.13 互斥写范围启动。

### 17.8 Spec Sync Plan

实现变化必须同步：

- 本文件：方案修订、review 结论、实现偏差、验证与 14 项验收矩阵。
- `README.md`、`CLAUDE.md`：唯一 YAML 真源、配置 CLI、安装/升级/apply/rollback、开发与测试入口。
- QQ Official Provider 相关计划：删除独立 Secret/.env 和手工重启约定，改为 YAML + 受控重连。
- Dashboard 文案/API 契约：generation、reload 状态、deployment apply、Secret configured 状态。
- 不把本文件移动到 `docs/done/`，除非用户另行明确要求。

---

## 18. 第 1 轮评审后的强制实施合同

本节是第 1 轮三名独立 reviewer 基于当前代码提出阻断项后的直接修订。若本节与第 4—13 节的早期描述存在冲突，**以本节为准**。第 2 轮 reviewer 必须按本节重新判断是否允许实现。

### 18.1 Exhaustive schema inventory 与 legacy effective matrix

#### 18.1.1 唯一 schema 真源

实现前先建立机器可读的 exhaustive inventory。每个条目至少包含：

```javascript
{
    yamlPath,
    flatKey,
    legacyEnvKeys,
    type,
    default,
    secret,
    allowEmpty,
    validator,
    normalizer,
    effects: [],
    publicShape,
    legacyResolver
}
```

inventory 必须覆盖且只覆盖一次：

- 当前 `src/config/schema.js` 的全部 flat key；
- `jwtSecret`、`ADMIN_QQ`、QQ Official Root OpenIDs 的特殊 owner/getter；
- 完整 `DEFAULT_AGENT_CONFIG` 树及其 normalizer；
- Agent LLM 与预算的所有旧环境变量，以及 `apiKeyEnv` 指向的动态 Secret；
- `MESSAGE_DEDUP_*`、`LOG_*`、`CHROMIUM_PATH`、`PUPPETEER_EXECUTABLE_PATH`、Python/NapCat 下载路径等生产 `process.env` 读取；
- Dashboard 全局/群级/Agent/Preview Layout 可写字段；
- `groupConfigs`、`agent.groups`、`providerScopedEnabledGroups`、Preview Layout 等动态 map 的 value schema。

至少明确以下路径：

- `qq.napcat.wsUrl/wsToken`
- `qq.provider`
- `qq.official.*`（含 rateLimit、rootOpenids、gatewayAckTimeoutMs）
- `admin.rootQQ`
- `dashboard.listenPort/hostPort/password/jwtSecret/allowedOrigins`
- `deployment.ports.*`、`deployment.mounts.*`、`deployment.network.*`；全部 effect 为 `deployment-apply-required`，应用进程不直接消费宿主路径/网络
- `paths.napcatTemp/napcatRead/chromium/puppeteerExecutable/python/biliScript`
- `pythonService.port`；Python child env 由代码内安全 allowlist 构造，不开放任意用户 map
- `cache.*`、`messageDedup.*`、`subscription.*`
- `rendering.*`（含 previewLayout、labels、nightMode、gradient）
- `videoDownload.*`、`logging.*`
- 完整 `agent.*`
- `enabledGroups/providerScopedEnabledGroups/blacklistedQQs/groupConfigs`

schema coverage 测试必须静态扫描生产代码使用的 flat key、环境变量和 Dashboard allowlist；未映射、重复映射或没有 reload policy 时直接失败。

`GROUP_CONFIG_SCHEMA` 必须成为 Dashboard、QQ 命令、Agent 工具和 YAML validator 的共同 allowlist，禁止继续任意 `Object.assign`。legacy 发现未映射群字段时不得丢弃：迁移到显式 `compat.unmappedLegacy.groupConfigs.<id>`，整个 subtree secret-by-default、不参与 runtime、不允许 Dashboard 修改、公开输出只显示 path，并产生待清理 warning。

#### 18.1.2 严格类型

- 人工 YAML 不做宽松 coercion；错误字符串不能静默变为 `0/false/[]/{}`。
- legacy migration 可单独执行旧兼容 coercion，但必须记录不含值的 warning。
- QQ、OpenID、群/用户/消息/内容 ID、Token 均为字符串；端口、超时、容量等才允许数值。
- `version` 必须是受支持整数；future version fail closed。

#### 18.1.3 冻结旧 resolver

旧值解析不能再用类别级近似表。新增只用于 fixture/migration 的 frozen legacy resolver，复刻当前逐字段行为：

1. 先取得旧进程真实 runtime environment（宿主机/Compose/container 注入）。
2. 再按 dotenv 当前“不覆盖已有 process.env”的语义填充 `config/.env`。
3. 普通字段按当前 getter 的 own-property、env、default 顺序。
4. Provider、Official Secret、JWT、Root OpenIDs、Python venv 自动探测、Agent 空值 fallback 和动态 API Key 分别走当前真实 resolver。
5. `apiKeyEnv` 必须先确定变量名，再解析该变量实际 Secret，迁移到 `agent.llm.apiKey`。

升级时 setup 从旧容器 inspect 结果生成 `0600` 的短生命周期 runtime-env snapshot，直接交给迁移 CLI，绝不打印内容。若发现旧安装依赖外部 runtime env、但无法取得真实值，迁移必须停止，不能猜测。

迁移 fixture 必须同时运行 frozen legacy resolver 与新 YAML resolver，逐 path 比较 effective config；数组顺序、空值、重复 OpenID 等只有在当前 normalizer 明确规定时才允许归一化。

### 18.2 YAML 安全、Document 与公开序列化

- 使用 YAML 1.2 safe schema；拒绝 duplicate key、未知/custom tag、循环引用、不允许的 merge key。
- 限制配置文件最大字节数、最大深度、节点数和 alias 数。
- API patch 基于最近已接受的 YAML Document 做最小 `setIn/deleteIn`；除 init/schema migration 外，不 materialize 默认值、不整体重排。
- 未修改节点的注释、顺序、quoted scalar style 必须通过测试保持。
- 对外只允许 schema 驱动的 `toPublicConfig()`、`toPublicDiff()`、`toPublicError()`：Secret 只输出 `{ configured: boolean }`。
- parser/validator error 只返回 code、path、line/column；不返回 source line、candidate value、Document 或 stack。
- 公共 fingerprint 对 Secret 先替换 configured marker 后再 canonicalize；不得暴露原始 source/effective hash，避免低熵 Secret 猜测。

### 18.3 配置事务、跨进程锁与 generation

watcher、Dashboard/API patch、QQ 命令和 Agent 工具由运行中 ConfigService 统一事务化。CLI 明确分为两种模式：

- `online`：通过 `data/runtime/config-control.sock`（目录 `0700`、socket/认证材料 `0600`）把 patch、actor、expectedDocumentGeneration 委托给运行中 ConfigService；CLI 不直接写 YAML、不持 write lock，返回运行进程的 reload result。
- `offline`：仅在确认不存在 runtime owner lease，或 setup 已完成 quiesce/stop 后允许；只做 validate + crash-safe persist，不声称已热重载，配置在下次启动应用。运行中 online 连接失败时不得自动降级为 offline 写盘。

事务基础合同：

1. 进程内 `configTransactionMutex` 串行化。
2. runtime owner 与 offline writer 使用原子目录锁 + nonce + heartbeat，或直接 runtime lock 依赖；不得仅凭 PID/TTL 删除可能仍有效的锁。`data/runtime/` 为 `0700`。
3. 持锁后重新读取磁盘原始字节并计算 `sourceHash`。
4. 若磁盘 hash 不是服务已接收 revision，先载入该 revision；无法合并则返回冲突，禁止覆盖。
5. Dashboard mutation 必须携带 `expectedGeneration`；不匹配返回 HTTP 409，只带当前 generation、公开 fingerprint 和冲突 paths。
6. 内部 update 在最新 snapshot 的隔离 draft 上同步执行；mutator 持锁期间不得 await 外部工作。

generation/effect 合同：

- `documentGeneration`：每个被接受的 YAML Document revision 都递增，包括 comment-only revision；Dashboard expectedGeneration 使用它。
- `effectiveGeneration`：仅当 normalized effectiveHash 改变时递增；业务 operation 捕获它。
- 每个组件维护 `observedDocumentGeneration`、`resourceGeneration`、`appliedEffectHash` 和 `desiredEffectHash`。
- 未受影响组件只推进 `observedDocumentGeneration`，不伪造 resourceGeneration，也不重建资源。
- readiness 要求 observedDocumentGeneration 已追上、appliedEffectHash 等于 desiredEffectHash、无 pending/failed effect 且资源 ready；不要求所有 resourceGeneration 等于全局 revision。
- 同时维护私有 `sourceHash`、私有 `effectiveHash`、公开 fingerprint、`desiredSourceHash`、`rejectedSourceHash`。
- generation 只在完整事务提交成功后递增；失败和 rollback 不递增。
- active snapshot 是 deep-frozen immutable value；对象 getter 返回冻结快照或只读 proxy。

Patch 合同：

- 路径用 segment array 或严格 RFC 6901 JSON Pointer，禁止点字符串拼接动态 ID。
- 拒绝 `__proto__`、`prototype`、`constructor` 等危险 segment。
- 明确 `set`、array replace、explicit `remove`；`undefined` 不属于合同。
- Secret omission 表示不变；清除必须走显式 secret action，JWT Secret、Dashboard password 等不可清为空。

生产兼容 gate：

- flat 读取 getter 可以保留；隐式嵌套写不保留为最终能力。
- 启用 YAML watcher 前，生产代码中不得再存在 `config._overrides`、属性 setter 持久化、嵌套 `push/splice/delete + save()` 或 `config.<object>.<field> =`。
- 所有生产写入必须 `await configService.patch/update()`；静态扫描和定向测试作为硬门禁。

### 18.4 崩溃安全 writer 与 last-good

writer 使用同目录唯一临时文件 `config.yaml.tmp.<pid>.<random>`：

1. `lstat` 拒绝 symlink、非普通目标和异常 hardlink。
2. 以 `O_CREAT|O_EXCL`、`0600` 创建临时文件。
3. 写入并完整重新 parse/validate。
4. `fsync(temp fd)`，关闭并确认 mode。
5. 原子 rename 到 `config.yaml`。
6. `fsync(config directory fd)`。

配置目录创建/修复为 `0700`，目标 YAML 为 `0600`。rollback Document、last-good、write journal 放入 `data/config-state/`，不能留在 `config/`。启动时只清理能证明属于本应用且过期的临时文件。

online API/CLI 发起的 write 若 runtime apply 失败，必须由运行中 ConfigService 在仍持事务锁时原子恢复写前 Document；offline CLI 不执行 runtime apply。人工编辑失败时不得覆盖用户文件，只保持 active last-good 并记录 rejected 状态。

### 18.5 两阶段 reload 事务与 effect DAG

原先单一 `prepare/commit` 合同废止，必须同时表达 parallel 与 exclusive 资源。统一顺序为：

```text
stable read + initial CAS
  -> parse + strict validate
  -> diff + effect DAG
  -> preflight + prepareParallel
  -> pauseIngress + preCommitDrain
  -> post-parallel CAS / watcher candidate hash recheck
  -> stage YAML tmp + file fsync（online mutation only）
  -> prepareExclusive
  -> commit CAS（紧邻 rename/handle commit）
  -> rename YAML + directory fsync（online mutation only）
  -> commitHandles + enable prebuilt ingress
  -> publish immutable snapshot/generations
  -> drain/dispose old resources
```

handler 合同：

```javascript
{
    id,
    ownedPaths,
    dependsOn,
    preflight(candidate, previous),
    prepareParallel(candidate, previous),
    pauseIngress(),
    preCommitDrain(),
    prepareExclusive(candidate, previous),
    commitHandles(),
    enableIngress(),
    rollbackExclusive(),
    rollbackPrepared(),
    restorePrevious(),
    postCommitDrain(),
    disposeOld(oldHandle)
}
```

- schema path 可声明多个 effects；registry 按 DAG 去重。
- parallel 资源的 connect/bind/spawn/health 在 `prepareParallel` 完成；Official Gateway、same-port Python 等独占资源在 pause/drain 后进入 `prepareExclusive`。
- `prepareExclusive` 可失败，但 active snapshot 尚未发布；journal 记录 phase、已停旧资源、已启 candidate、rollback deadline，失败按 DAG 逆序恢复旧独占资源并重新验证 READY。
- `commitHandles + enableIngress` 必须只启用预创建 handle，纳入同一 commit barrier；对外发布 generation 前必须成功。意外异常执行 reverse-swap 并恢复写前 YAML。
- publish 后 `disposeOld` 失败不回滚配置，标记 `cleanupPending/degraded` 并重试。
- runtime handle、operation lease 和组件状态按 document/effective/effect hash 合同报告，不要求无关组件 resourceGeneration 跟随。
- `paths.napcatTemp/napcatRead` 的 DAG 至少包含 download、Python、Agent screenshot、Official uploader、Dashboard temp static route；不能只挂单一 reload tag。

来源专用线性化规则：

- 人工 watcher：stable read candidate → parallel prepare → pause/drain → post-parallel hash recheck → exclusive prepare → **紧邻 publish barrier 再做 commit hash recheck**；任一 recheck 发现变化都逆序 rollback exclusive/prepared、恢复旧 ingress并处理最新 revision。磁盘由用户写入，不执行 rename。
- online mutation：initial base hash → patch/validate/parallel prepare → post-parallel CAS 仍为 base → stage/fsync tmp → pause/exclusive → **紧邻 rename 再做 commit CAS** → rename/dir-fsync → commit/publish；exclusive 期间人工改盘导致 commit CAS 不匹配时必须 rollbackExclusive、删除 tmp、恢复旧 ingress并返回 409，禁止覆盖。任一步失败按 journal 逆序恢复 runtime 与旧 Document。
- offline CLI：stable read/CAS → patch/validate → tmp/fsync/rename/dir-fsync → journal commit；不执行 runtime handler。
- journal 至少记录 base/candidate hash、tmp prepared、file committed、exclusive phase、runtime committed、snapshot published。

### 18.6 Watcher 状态机

- watcher 监控 `config/` 父目录，覆盖 add/change/unlink/atomic rename/Docker bind mount。
- unlink 使用 grace period 等待替换；期间继续 last-good，绝不回默认值。
- self-write suppression 只匹配“当前待观察的已提交 hash”，不维护永久 seen set。
- effective diff 为空但 source revision 改变时，仍更新 Document/sourceHash/generation，保留注释。
- parse/validation 属确定性错误，按 rejected hash 去重；prepare/apply 属瞬态错误，允许 `POST /api/config/reload` 对相同内容重试。
- 运行期无效编辑继续使用内存 last-good。普通冷启动、setup probe 和 upgrade 遇到 YAML 缺失、invalid 或 future-version 一律 fail closed；persistent last-good 只用于 rollback/诊断和显式 `config recover-last-good`，不得静默成为第二真源。

### 18.7 Runtime slot、lease、drain 与 rollback

#### 18.7.1 QQ ProviderSlot

`BotRuntime` 管理 `ProviderSlot { generation, provider, state, leases, abortController, reconnectTimers }`：

- provider preflight/candidate 期间不得发布到 `qqProviderRuntime/global.bot`，也不得向业务 handler 分发非 active generation 事件。
- NapCat ready：WebSocket open、`get_login_info` 返回有效 selfId、基础 action round-trip 成功。
- Official ready：token 成功、Gateway 收到 `READY`、heartbeat 已启动。
- 事件 callback 绑定 provider instance + generation；非 active generation 的迟到 event/close/reconnect 全部丢弃。
- ProviderSlot 声明 `supportsParallelSession`。NapCat 使用 shadow READY 后原子切 slot；Official 默认执行 token/gateway preflight 后，在 pause/drain 状态中关闭旧 Gateway、启动 candidate 并等待 READY。
- Official 切换前必须保留旧 slot 的 config、session-independent state、重建函数和 rollback deadline；candidate 失败时自动重建旧 Gateway 并验证 READY。该路径允许短暂受控停机，但禁止退化为用户手工重启。
- `OfficialIdStore`、`OfficialMessageIdStore`、近期 reply/recall 映射和 per-target `msgSeq` 提升为 ProviderSlot-owned shared state；candidate 与 rollback Provider 显式注入同一 state handle，连接重建不得清空。
- upgrade probe/candidate 在 active commit 前对共享 Official state 使用只读或 copy-on-write view，不得因被隔离的 candidate 事件提前污染 active store。
- NapCat commit 后旧 Provider quiesce，拒绝新 lease，等待 running send/queue 清空并 await close；超时才强制终止。

#### 18.7.2 全局 BotOperationRegistry

所有 Provider-originated work 都必须注册，不只订阅：普通 message、request、异步 notice、command、Agent、link/preview/render、QQ admin action、非订阅 download/send 和关联 state write。

dispatch 时捕获：

```javascript
{
    effectiveConfigSnapshot,
    providerSlotLease,
    providerGeneration,
    abortSignal
}
```

- `dispatchMessageToHandler()`、request/notice handler 必须返回并注册完整 Promise，直到全部异步后代、发送和状态写入完成才释放 lease，禁止 fire-and-forget 脱离 registry。
- Provider `pauseIngress()` 阻止新业务事件；`preCommitDrain()` 同时等待 BotOperationRegistry 和 Subscription registry 归零。
- 所有 outbound API 优先使用 operation context 的 provider lease；operation 内禁止回退到 `qqProviderRuntime.getCurrentProvider()` 或其他新 active Provider。
- 无 operation context 的主动任务在开始时显式获取当前 ProviderSlot lease。
- drain timeout 按事务合同 rollback，恢复旧 ingress，旧 Provider 保持到最后一个 lease 释放。

#### 18.7.3 Subscription operation registry

统一 registry 覆盖 scheduled/manual `checkAll`、cookie followings refresh、credential refresh、capability warmup、手工立即检查及其下载/发送：

- operation 开始时捕获不可变 `{configSnapshot, providerLease, generation}`，整轮禁止重新读 active transport。
- `pause()` 阻止新 scheduled/manual operation；`drain()` 等待发送、state advance、delivery ledger、followers flush 全部完成。
- drain timeout 判定 reload 失败并恢复旧调度，不能强杀可能已经发消息的 cycle。
- interval reload 只替换主 poll timer，不重启 sync/credential/warmup；在途 cycle 自然完成。
- state advance、delivery ledger 与 send result 必须属于同一 operation generation，锚点只推进一次。

#### 18.7.4 PythonRuntimeSlot

每个 slot 保存 child、args、受限 env hash、baseUrl、instanceId、resourceGeneration/effectHash、restart/idle timers、request leases。用户 schema 不开放任意 `childEnv`；`buildChildEnv()` 只组合固定安全变量和已声明配置，不继承全量 `process.env`：

- `/health` 返回并验证 `instanceId/resourceGeneration/effectHash/buildVersion/pid`，不能只看 HTTP 200。
- 端口变化时并行启动 candidate，验证身份后路由新请求，再 drain/stop 旧 slot。
- 端口不变而 executable/script/env 变化时，先用临时 probe port 验证 candidate；随后 drain/stop 旧 target-port，启动 candidate 到目标端口。失败使用保留的旧 args/env 恢复。
- 发现目标端口由非本 manager 的实例响应时标记 unmanaged/conflict，拒绝冒充成功。
- exit/restart callback 核对 slot identity/generation；所有 timer 可取消。
- request 持有 slot lease；旧请求完成前旧 child 不停止。

#### 18.7.5 DashboardInstance 与 health

- 分离公开 `/api/live` 与 `/api/ready`；setup 只使用 readiness。
- Dashboard 拆成稳定 `DashboardListener`（HTTP server + WS upgrade dispatcher）与可替换 `activeAppHandle`。同 listenPort 时用 candidate snapshot 构建独立 Express app，做内部 request-injection/contract health 后原子交换 app/upgrade handle；不同端口才 bind 双 listener。
- candidate app 显式接收 candidate snapshot，不读取全局 active config。`napcatTempPath` 变化通过 app/static middleware handle swap 生效，无需同端口重绑。
- `stop/drain()` 返回 Promise，等待 HTTP keep-alive sockets、WebSocket clients、listener 真正关闭；超时后才 destroy/terminate。
- 日志广播使用中央 broadcaster 或实例级订阅，支持 candidate/old listener 短暂并存。
- `napcatTempPath` 变化必须重建 Official 临时静态路由。

#### 18.7.6 Browser、Agent browser/screenshot 与下载

- pooled BrowserManager 的所有 createPage/render 入口取得 browser generation lease；增加 launch/reconfigure mutex 与 `initPromise`。
- executable 变化时停止新 lease，等 pagePool/lease 为 0 后关闭旧实例；超时拒绝 reload，不杀活跃页面。
- Agent browser/screenshot 为 per-request browser，任务开始捕获 executable/temp path snapshot，旧任务自然结束。
- 每个下载任务捕获 `DownloadTaskContext { generation, writeBase, readBase, pythonLease, providerLease, cleanupOwnership }`。
- path reload 先 block new downloads，再等待真实 task registry；外层 Promise timeout 不等于底层任务结束。
- AbortSignal 贯穿 Node HTTP、Python handler、stream 和 ffmpeg；若不能证明终止，reload 失败并保留旧路径/slot。
- 每个下载 RPC 带 `taskId`，Python 维护 task registry。Node 只有在收到 terminal result，或确认 child 已退出、ffmpeg 已 wait、文件句柄已关闭且 partial/tmp 已清理后才释放 lease。
- cancellation 使用独立 cancel/status control API；原 HTTP request abort 后不能依赖原请求返回 terminal result。
- cleanup timer 可追踪，绑定绝对路径和 generation；旧任务不重新读取新 config/provider。

#### 18.7.7 Logger、buffer 与 shutdown

- logger 持有原子 config snapshot；每次 event 只读一次，生产路径不再解析 `process.env`。
- `logger.reconfigure(next)` 下一事件生效；`logBuffer.resize(n)` 原地调整并立即保留最后 N 条。
- 所有 subsystem 提供幂等 async `stop()` 与 `getResourceCounts()`。
- 分别定义 reload deadline、upgrade quiesce deadline、process shutdown deadline。reload 超时 rollback 并继续旧实例；upgrade quiesce 超时中止升级；process shutdown 先 graceful，超时后 abort/terminate/kill 并以非零结果记录残余资源。
- `BotRuntime.stop()` 顺序：停 watcher/拒绝 reload → abort 未提交 candidate/等当前 reload → pause/drain subscription/download → quiesce Provider → Dashboard/WS drain → browser/Agent resource cleanup → Python stop → 清 timer/listener。

### 18.8 Config 与业务数据迁移状态机

#### 18.8.1 YAML/manifest 状态决策

明确处理：`missing`、`valid-supported`、`valid-needs-schema-migration`、`invalid`、`future-version`、`prepared-hash-match`、`prepared-hash-conflict`。

- 已有有效 YAML 永远是第一真源；残留 legacy 只在同 releaseEpoch `runtime_ready` health 连续通过后归档，不重新导入。
- invalid/future-version 一律停止并保留原文件，不用旧文件静默替代。
- `--force-migrate-legacy` 只能生成独立 candidate + redacted diff；默认不覆盖现有 YAML，必须额外显式确认和备份。
- manifest/YAML/tmp hash 冲突时禁止自动选择。

#### 18.8.2 持久化 inventory 与不变量

强一致小型数据至少包含：

- `data/subscriptions.json` 及 `.bak`
- `data/subfollowers.json` 及 `.bak`
- `data/subscription_state.json` 及 `.bak`
- `data/subscription_delivery.json` 及 `.bak`
- `data/qq-official-id-store.json`

强校验不变量至少包含：

- `lastDynamicId`、`lastLiveStatus`、`lastVideoId`、`lastVideoCreated`
- `lastArticleId`、`lastArticlePublishTime`、`roomId`、番剧 `lastEpId`
- unified state 的 per-target baselines/time anchors
- delivery key、目标群集合、deliveredAt 与未完成投递状态
- 订阅/关注数量、group mapping、Official group/user/member ID mapping

逐项分类：

- `preserve-required`：Cookie、Agent memory/profile/audit/runs、contexts、profiles、vectors、NapCat 身份/配置、Official ID、字体、自定义数据。
- `regenerable-but-preserve-by-default`：cache、subscription user meta cache、日志、下载产物。
- 任一 migrator 实际修改 preserve-required 路径时，该路径自动提升为本次强一致 snapshot/rollback 项；manifest 记录实际 touched paths。

迁移前后输出只含 count/hash/invariant 的报告，不含明文数据；强一致项减少、损坏或无法确定主文件与 backup 新旧关系时失败。

subscription 恢复必须按 `(contentType, contentId, groupId, deliveryPart)` 判定，`deliveryPart` 至少区分主卡片、fallback 文本、自动下载视频/文件；新 managed runtime 禁止无 registry/outbox 的 detached outbound Promise。legacy-v0 没有 durable child record 时只记录 best-effort 例外，不得把父 anchor/ledger 猜成 child 已投递。恢复 truth table：

| snapshot 状态 | 恢复动作 |
|---|---|
| target/part ledger 已有、anchor 未推进 | 不重发该 target/part；幂等补推进 anchor |
| partial target/part ledger、anchor 未推进 | 只重试缺 ledger 的 target/part |
| legacy anchor 已推进、ledger 全无 | 只推定 parent/main part 已提交并不回放；不得据此推定 detached child 已发送 |
| anchor/ledger 都无，属于首次 cutover 当前候选 parent/target | best-effort 正常重试，允许重复 |
| legacy detached descendant 无 durable part record | 不猜测远端状态；记录 feature/warning，允许该窄窗口重复或漏推 |
| managed-v1+ 任意缺口 | 只由 managed operation registry/outbox 恢复，禁止套用 legacy best-effort warning |

#### 18.8.3 升级事务 cutover

1. 获取安装级排他锁。
2. 在任何 quiesce、断网、pause、stop、kill、target pull 或安装目录可见候选写入之前，先以只读 probe/内存变量收集 writer、network 和旧容器环境；Secret 环境不得在 intent 前落盘。`cutover_intent` 先在同文件系统私有 staging 中完成并 fsync，再以目录 rename + 父目录 fsync 原子发布 attempt，随后原子写 active marker；rename 前 SIGKILL 的私有 orphan staging 在下次启动删除，rename 后 active marker 前 SIGKILL 的单一无 checkpoint attempt 自动恢复为 active 并走 typed manifest rollback。它按每个受保护 mount source 记录 `mountWriterSet`：枚举 Bot、NapCat 和同主机其他 Docker writer 的 container/image ID、原始 running/paused 状态、Compose project/files/profiles、全部 network attachment（network ID/name、aliases、IPv4/IPv6、link-local、driver opts）、恢复动作和不可变 `cutoverAttemptId/sourceRuntimeClass/cutoverKind`。通过 container inspect/mount namespace 和宿主机打开写句柄探测发现未知外部 writer、无法 pause/stop 的 writer 时，该路径 snapshot/relocation/forced-stop blocked。明确原地保留且 setup 永不写的路径可标记 `preserved-in-place`，但不得声称进入冻结 snapshot。`cutover_intent` 后任何失败都必须逐个恢复 writer 与网络并 inspect 校验。
3. `managed-v1+`：调用 quiesce API，等待 operation registry、Provider flush、订阅 debounce、Official ID 和文件写链完成。
4. `legacy-v0`：不得假设 quiesce API。非 host-network 容器可先做 best-effort network fence 并写 `legacy_fenced`；随后等待 bounded drain window，采集 active cycle、自动下载、fallback、Python/ffmpeg 等 feature/task inventory。无论 detached task 是否有终态，均尝试 graceful stop。typed `cutover` 固定 `sourceRuntimeClass=legacy-v0`、`deliveryGuarantee=best-effort`、`exceptionScope=legacy-v0-first-cutover-inflight-outbound`、`affectedState=operations-without-durable-part-record`、`retryPolicy=retry-determinable-uncommitted-parent-or-target`、fence/stop/drain/feature inventory 与枚举 warning。host-network 或无法 fence 不因 exactly-once 单独阻断，但仍必须成功停止旧容器并取得一致恢复点。
5. `managed-v1+` quiesce/drain 或 `legacy-v0` bounded drain 后，按固定顺序 graceful stop 全部 managed writer并等待退出，随后逐容器 inspect `Running=false`、`ExitCode=0`、`OOMKilled=false` 且无 shutdown residual/error，全部满足才写 `runtime_stopped`。managed-v1+ quiesce/flush/stop/inspect 任一失败立即进入 marker 前 rollback，禁止把 exit 1、OOM 或残余 operation 记为 clean；managed-v1+ 禁止 forced stop。只有 legacy-v0 可考虑 forced stop：kill 前先 pause `mountWriterSet` 中全部 writer，对全部可写强一致及 preserve-required 路径建立 `0700/0600` 冻结恢复点，校验格式/count/hash/invariant，fsync snapshot + manifest 并写 `forced_recovery_ready`；无法冻结任一 writer或建立完整恢复点（包括大型目录）则 forced stop blocked。只有 `forced_recovery_ready` 已 fsync 才可 kill；rollback 以该恢复点为基线并逐个恢复 writer 原始状态。
6. graceful stop 后，或 forced-stop 冻结恢复点已建立后，对旧配置和全部强一致数据建立/确认同一时点 snapshot，写 `snapshot_ready`；稳定 hash 不能替代格式、count 和业务不变量校验。
7. 执行带 checkpoint journal 的 config/data migration。
8. 新版本以 `upgrade-probe` 启动：禁止业务消息 handler、订阅检查、Cookie refresh、任何出站消息和业务数据 cleanup。probe 不建立会消费真实业务事件的 Provider session：Official 仅做 token/OpenAPI/gateway endpoint preflight，不连接业务 Gateway；NapCat 只有存在明确只读 HTTP/admin action 时才验证登录/能力，否则 Provider preflight 标记 `deferred`。禁止“接收后丢弃”真实事件，也禁止用内存 buffer 冒充持久隔离。
9. probe 全部通过后，准备除正式业务 Provider session/timer admission 以外的 normal resources，写 `release_prepared`；legacy 文件此时仍原位保留。runtime 与 setup 协商唯一 `releaseEpoch`，写并 file/directory-fsync `runtime_release_armed`，再次确认尚无正式 Provider session、timer、handler admission。
10. 所有 rollback-safe preflight 通过后，先原子写并 fsync `runtime_released {releaseEpoch}`；这是持久 commit marker 和不可回滚边界。marker 完成后才建立 NapCat event WS、Official Gateway 或任何会消费业务事件的 session，并从连接创建时就绑定 active handler/BotOperationRegistry；不得存在“已读事件但 admission closed”的阶段。随后启动 timer/refresh/outbound admission，同 epoch 重入只补建缺失资源且每类最多一份。
11. setup 在 marker 后使用 normal pre-ready predicate：manifest checkpoint=`runtime_released`、releaseEpoch 一致、正式 Provider READY、subscription running、全部 effect applied；连续 N 次成功后由 setup CAS 写 `runtime_ready`，再执行一次 final readiness（checkpoint=`runtime_ready`）。只有此后才按 manifest 文件列表幂等归档四类 legacy 配置；归档成功并 fsync 后写 `upgrade_complete`，setup 才宣布成功。Provider 连接、归档或进程异常进入 `RECOVER_SAME_RELEASE_EPOCH`，持续恢复同一 epoch，不 rollback、不创建第二 session set；错误必须明确区分 committed-recovering 与 pre-marker upgrade failure。
12. `runtime_released` 前任何失败按逆序恢复旧镜像、旧配置、原数据、Compose、网络和所有 writer 状态；rollback 聚合 Compose down/up、snapshot restore、network/writer restore 和 writer 错误，不得吞掉任一失败。恢复后必须重新生成并逐项比对 config/data/Compose/setup-control 的 hash、mode、size/owner inventory，inspect writer image/running/paused 原态；任何 restore 或 verify 失败写 `failed/recovery-required`、保留 active attempt，禁止清理为 `rolled_back`。marker 后只恢复同一 release epoch，不回滚到可能与新业务事件/副作用并发的旧版本。

同 releaseEpoch `runtime_ready` health 前旧文件不得移动；新版本 probe 不得对真实业务数据产生不可逆副作用。

#### 18.8.4 Manifest checkpoint 转移表

manifest 使用独立 versioned schema，至少包含：

```text
manifestVersion: integer
migrationId/status/fromVersion/toVersion: typed enum/integer
sourceHashes/targetHashes/snapshotHashes: private fixed-shape maps
cutover:
  sourceRuntimeClass: fresh-install | managed-v1+ | legacy-v0
  cutoverKind: fresh-install | first-managed-adoption | resume-same-attempt | managed-upgrade
  cutoverAttemptId: opaque random ID
  deliveryGuarantee: exactly-once | best-effort
  exceptionScope: none | legacy-v0-first-cutover-inflight-outbound
  affectedState: none | operations-without-durable-part-record
  retryPolicy: none | retry-determinable-uncommitted-parent-or-target
  ambiguousDeliveryWindow: boolean
  ambiguousDeliveryWindowStartedAt/EndedAt: ISO timestamp | null
  fenceCapability: established | best-effort | unavailable | not-required
  stopMode: graceful | forced | not-required
  fenceAttempted/fenceEstablished/forcedStop: boolean
  drainOutcome: not-required | clean | timed-out | interrupted
  legacyFeatureInventory: enum[]
  warningCodes: enum[]
  appliesToCommittedRuntime: boolean
```

不变量：`deliveryGuarantee=best-effort` 仅允许 `sourceRuntimeClass=legacy-v0` 且 `cutoverKind=first-managed-adoption|resume-same-attempt`，并必须使用上述固定 exception scope/affected state/retry policy；fresh install 和 managed-v1+ 必须为 `exactly-once`，出现 legacy warning、legacy feature inventory 或 forced-stop continuation 组合即 schema 校验失败。runtime class 依据旧进程 capability/provenance marker 与 manifest lineage 判定，禁止只凭 YAML schema version 猜测。同一 attempt resume 保留不可变 `sourceRuntimeClass/cutoverAttemptId`；rollback 将 `appliesToCommittedRuntime=false`；只有 `runtime_released` 后才设为 true。后续 managed upgrade 创建新 attempt/manifest，历史 legacy warning 只进入 audit history，不得作为当前运行保证。任何未知字段、未知 warning code、非法组合或 manifest schema 版本不支持都停止，不做宽松 coercion。

公开 `/api/config/migrations`、`/api/config/status` 和 `/api/ready.migration` 只使用同一 `PublicMigrationStatusV1 = toPublicMigrationStatus(manifest)`：投影 `migrationId`、原始 `checkpoint`、固定映射 `phase`、`sourceRuntimeClass`、`cutoverKind`、`deliveryGuarantee`、`exceptionScope`、`affectedState`、`retryPolicy`、enum-only `legacyFeatureInventory`、`ambiguousDeliveryWindow`、`forcedStop`、`drainOutcome`、`warningCodes`、`appliesToCommittedRuntime` 与公开时间戳。它不进入 ConfigService snapshot，也不改变 config generation。所有公开错误经过统一 `toPublicError()`，warning code 到固定用户文案的映射由应用代码维护，禁止直接透传 manifest 自由文本。config patch/reload response 的 `warnings` 只表达当前 config transaction，不携带历史 migration warning。

| 状态 | 已发生副作用 | 重入动作 | 失败动作 |
|---|---|---|---|
| `discovered` | 只读探测 | 重做 preflight | 无需 rollback |
| `cutover_intent` | 已持久化恢复意图，尚未操作旧容器 | 按不可变 attempt 继续 | 恢复/确认旧容器原状态后 `rolled_back` |
| `legacy_fenced` | legacy 网络可能已断开 | 按记录继续 drain/stop | 恢复全部 network attachment 与原 running 状态并 inspect |
| `forced_recovery_ready` | 全部 writer 已冻结，强杀前恢复点已 fsync/invariant 通过 | 才允许执行/重试 forced stop | 恢复全部 writer、数据和网络 |
| `runtime_stopped` | 旧容器已停止；legacy 可能存在 ambiguous in-flight | 建立/确认 snapshot | snapshot 前失败先恢复旧容器/网络 |
| `snapshot_ready` | 配置/数据恢复点完成且 fsync/invariant 通过 | 校验全部 snapshot hash 后继续 | hash/invariant 不符则停止并恢复旧状态 |
| `candidate_written` | candidate YAML/journal 已持久化 | hash 全匹配才继续 | 删除 candidate 或 rollback |
| `data_applied` | 数据 migrator 已修改工作副本/目标 | 默认 rollback；仅全部 source/target/snapshot hash 精确匹配才允许 resume probe | `rollback_started` |
| `probe_started` | 新容器 no-business-session/no-outbound | 重建或继续无消费 preflight | 停 probe 后 rollback |
| `probe_ready` | preflight 连续满足，business admission 仍关闭 | 幂等准备 normal resources | rollback 仍允许 |
| `release_prepared` | normal resources/candidate handle 已准备，admission 关闭；归档仍可逆 | 恢复同一 candidate/releaseEpoch | rollback 仍允许 |
| `runtime_release_armed` | 唯一 releaseEpoch 已 fsync；正式 Provider session/admission 尚不存在 | marker 前仍可 rollback | 禁止新建第二 epoch |
| `runtime_released` | commit marker 已 fsync；随后才允许创建正式 Provider session/admission | 只恢复/完成同一 epoch，不重跑 migration/probe | 不再回滚到旧 runtime；失败为 `RECOVER_SAME_RELEASE_EPOCH` |
| `runtime_ready` | 同 epoch Provider/subscription/readiness 连续成功；legacy 文件仍可未归档 | 幂等完成 legacy 归档 | 失败为 `RECOVER_SAME_RELEASE_EPOCH` |
| `upgrade_complete` | health 已通过且 legacy 归档 fsync 完成 | 正常启动/升级完成 | 以后升级处理 |
| `rollback_started` | 正在恢复 snapshot/旧镜像/网络 | 只能继续 rollback | 失败保持 blocked |
| `rolled_back` | 旧状态 hash、镜像、Compose 与网络已恢复 | 可创建新 attempt 重新 preflight | 无 |
| `failed` | 原因已记录 | 依据最后安全 checkpoint 转入 rollback 或人工处理 | 不自动猜测 |

每个状态记录允许的 config/data/image/Compose hash、归档文件列表、mountWriterSet/network fence 信息、releaseEpoch 和 `businessAdmissionOpened`。`runtime_released` marker 必须在创建任何正式业务 Provider session/admission 前 file+directory fsync；marker 后 crash 只恢复同一 epoch。manifest tmp rename 后目录 fsync 前 crash 必须通过 hash+journal 判定，不得只看状态字符串。

### 18.9 setup.sh 可执行状态机

#### 18.9.1 参数与副作用

- 参数解析必须在任何安装依赖、mkdir、download、pull、写文件或容器操作之前。
- `--dry-run` 不写安装目录、不停止/启动受管业务服务、不创建备份、不迁移；默认也不 pull。允许使用已经存在的 target image 启动受限临时 CLI sandbox：`--network none --read-only --tmpfs /tmp`，安装目录只读挂载，不挂 Docker socket，不运行应用 entrypoint。镜像不存在时只有显式 `--allow-pull` 可 pull；否则输出 `INCOMPLETE_TARGET_IMAGE_UNAVAILABLE` 并非零退出，不宣称可升级。
- dry-run 不创建 manifest，只向 stdout 输出脱敏 machine-readable planned report：`plannedDeliveryGuarantee`、`plannedExceptionScope`、`plannedAffectedState`、`plannedRetryPolicy`、`plannedFeatureInventory`、`fenceCapability`、`wouldForceStop`、`wouldModifyLogicalPaths`、`checks.evaluated/skipped`、`rollbackAvailable`；`wouldModifyLogicalPaths` 只能是 schema JSON Pointer 或逻辑类别，禁止真实宿主路径，其他字段也不得包含 Secret、私有 hash、task payload 或异常自由文本。
- `--non-interactive` 禁止任何 `read`；缺参立即失败。
- Secret 只从 `0600` 输入文件、stdin/FD 或内存临时变量传给 CLI，不出现在命令行、日志、diff、进程列表；旧容器 runtime env 仅在 `cutover_intent` 原子发布后才可写入 active attempt，启动时立即清除非 active attempt 的 runtime-env 与 Official 输入 orphan。
- `--apply` 只应用已记录的 `deploymentApplyRequired` diff，并再次核对 generation/hash。
- legacy 成功归档使用固定 allowlist：四类旧文件及其官方 `.example` 变体；preflight 遇到任何未知 config entry（包括非 YAML 私有备注、目录、symlink）必须 fail-closed，要求用户显式移走。`upgrade_complete` 前再次校验 `config/` 精确只含普通 `0600 config.yaml`，同 attempt resume 幂等继续未完成归档，不静默覆盖未知文件。

#### 18.9.2 CLI 与镜像 pin

- setup 不要求宿主机安装 Node；先解析目标 bot image digest，再用受限 CLI sandbox `docker run --rm --network none --read-only --tmpfs /tmp ... <target-digest> node src/cli/...` 运行 init/validate/migrate/render。需要写 candidate/manifest 的非 dry-run 子命令只挂载明确的 staging 目录，禁止挂 Docker socket或启动应用 entrypoint。
- 在任何 target pull 前必须先原子发布 `cutover_intent`、记录旧容器 image content ID 并创建唯一 rollback tag；manifest/attempt metadata 同时记录 tag 与期望 image ID。即使 target image 尚不存在，也先用内嵌固定 shape 的 private intent writer 生成 manifest，pull 后第一步由目标镜像 typed CLI 重新读取校验。rollback override 设置 `pull_policy: never`；执行前验证 `docker image inspect(tag).Id` 与记录一致，不匹配或镜像缺失即停止。
- 默认只 pull bot service；NapCat 只有显式 `--upgrade-napcat` 才升级，并建立独立 rollback 引用。
- 不能使用移动后的 `latest` 作为 rollback 依据。
- commit 前禁止 prune/删除旧镜像。

#### 18.9.3 Compose 所有权与自定义保护

- 保存 setup last-rendered hash 和模板版本。
- 已知官方 legacy fingerprint 可自动升级。
- 未知或用户改动 Compose 不自动覆盖：生成候选和 unified diff；交互模式需显式确认，非交互退出。
- `--apply` 通过 Node YAML/Compose model 只改 setup 拥有字段；无法证明安全合并时停止。
- Official 渲染移除 NapCat service/depends_on；NapCat 渲染保留扫码流程。

Compose ownership：

| 范围 | setup 自动拥有 | 仅 known-template fingerprint 可改 | 永远用户所有 |
|---|---|---|---|
| `bili-qq-bot` | image digest、由 deployment schema 声明的 ports/mounts/network attachment、healthcheck、必要 TZ | container_name、restart、depends_on | labels、resource limits、logging driver、额外 environment、额外 networks、reverse-proxy 配置 |
| `napcat` | 仅 NapCat provider 模式下的官方 image/标准 ports/标准 mounts | container_name、restart、标准 environment | 用户额外插件、labels、资源限制、额外 networks/volumes |
| top-level networks | `deployment.network` 明确声明的 managed network | known legacy `bot_network` | 其他网络定义 |

last-rendered manifest 记录每个 owned JSON Pointer 和 value hash，而非只有整文件 hash。未知 Compose 不能通过一次笼统确认后整体覆盖，只能应用用户明确选择的 owned pointers，否则停止。

#### 18.9.4 安全与 crash recovery

- setup 开始即 `umask 077`；安装根及每级父目录执行 realpath containment/no-symlink 检查。关键创建/打开通过 directory fd + `openat/O_NOFOLLOW/O_EXCL` 或等价安全 helper，检查到使用期间保持目录 fd；目标必须 `st_nlink===1`。
- migration 目录使用不可预测名称原子创建；backup/candidate/manifest 从创建时即正确权限。
- manifest 每个 checkpoint 通过 tmp + file fsync + rename + directory fsync 更新，并持有安装级 flock。
- `.gitignore/.dockerignore` 覆盖 `config/config.yaml` 和全部四类 legacy Secret/config；Docker build context 测试不得包含它们。
- runtime-env snapshot 在 success/error/signal trap 中删除，不进入普通 migration backup。

#### 18.9.5 Mount relocation / adoption 事务

`deployment.mounts.*` 变化不能只改 Compose：

1. quiesce managed runtime；legacy-v0 按 18.8.3 的 best-effort admission rule 停止并取得一致恢复点后才允许。
2. canonicalize 并锁定旧/新路径；拒绝 symlink、父子重叠、安装根外危险路径和不受支持的跨文件系统原子切换。
3. 新目标为空时，复制 preserve-required config/data/Cookie/Agent/NapCat/font 到同文件系统临时目录，保持 mode/owner，并逐文件 fsync + directory fsync。
4. 新目标非空默认拒绝；只有显式 `--adopt-existing` 且 inventory、schema version、身份和全部强一致 invariant 匹配才允许。
5. paused probe readiness 必须包含预期 data inventory fingerprint；缺失文件不得按空默认值通过。
6. probe 成功后提交 Compose + mount manifest，再 runtime release。
7. 失败恢复旧 Compose/旧挂载；新目标保留供排查但不得继续使用。

大型 NapCat/下载目录无法安全复制时允许明确 blocked，禁止静默初始化。测试覆盖空 target、非空不匹配、copy/fsync/Compose/probe crash、路径重叠、父目录 symlink、跨文件系统失败和 adopt 前后 invariant 一致。

### 18.10 Machine-readable readiness 合同

`/api/ready` 至少返回：

```json
{
  "ready": false,
  "mode": "normal|upgrade-probe",
  "config": { "valid": true, "documentGeneration": 1, "effectiveGeneration": 1, "fingerprint": "public" },
  "migration": {
    "migrationId": "config-v0-to-v1",
    "checkpoint": "probe_ready",
    "phase": "probe",
    "sourceRuntimeClass": "legacy-v0",
    "cutoverKind": "first-managed-adoption",
    "deliveryGuarantee": "best-effort",
    "exceptionScope": "legacy-v0-first-cutover-inflight-outbound",
    "affectedState": "operations-without-durable-part-record",
    "retryPolicy": "retry-determinable-uncommitted-parent-or-target",
    "legacyFeatureInventory": ["subscription-auto-download"],
    "ambiguousDeliveryWindow": true,
    "forcedStop": false,
    "drainOutcome": "clean",
    "warningCodes": ["LEGACY_INFLIGHT_DELIVERY_AMBIGUOUS"],
    "appliesToCommittedRuntime": false
  },
  "dashboard": { "state": "ready", "observedDocumentGeneration": 1, "effectApplied": true },
  "python": { "state": "ready", "resourceGeneration": 1, "effectApplied": true, "instanceId": "..." },
  "qqProvider": { "id": "napcat", "state": "preflight-ready|deferred|ready", "resourceGeneration": 1, "effectApplied": true, "releaseEpoch": "..." },
  "subscription": { "state": "ready", "paused": true, "observedDocumentGeneration": 1, "effectApplied": true }
}
```

- setup 按 Provider/normal/probe 模式执行明确 predicate，并要求连续 N 次成功，而非单次短暂 `ok`。
- public `checkpoint` 原样使用 manifest checkpoint enum；`phase` 只允许固定映射：discovery/cutover/snapshot/migrate/probe/release/complete/rollback/failed。probe 接受 `data_applied|probe_started|probe_ready|release_prepared`，要求 subscription=`ready+paused`，Provider 只能为 no-consume `preflight-ready|deferred`。normal pre-ready 接受同一 `releaseEpoch` 的 `runtime_released`，但只有 Provider=`ready`、subscription=`ready+running`、全部 effect applied 时返回 `ready=true, phase=release`；setup 连续 N 次后 CAS 写 `runtime_ready`，final readiness 只接受 `runtime_ready|upgrade_complete`。单独存在 `runtime_released` 且组件未 ready 不能通过。不再存在模糊 `applied` 或 `committed` readiness 状态。
- 组件 readiness 依据 `observedDocumentGeneration` 与 owned `appliedEffectHash/desiredEffectHash`，不要求所有 resourceGeneration 等于全局 revision。comment-only/logging-only/group-only 更新不得无意义重启 Python/Provider/Dashboard。
- NapCat 交互升级必须等登录 ready；非交互且没有现有登录态时返回明确 pending/failed exit code，不能宣布完成。
- endpoint 公开但不输出 Secret、私有 hash、路径、备份或 migration 明文。

### 18.11 强制 fault-injection 与竞争测试矩阵

除第 13 节原有测试外，必须增加：

- 两个同 generation API 写、watcher 防抖窗口人工写+API、CLI+API、comment-only、unlink/add、旧 hash 恢复。
- online CLI control socket、runtime owner 缺失、offline CLI 拒绝活跃 runtime、post-parallel CAS 后在 exclusive 期间出现新 revision、commit CAS 拒绝覆盖。
- duplicate key、future version、alias/depth/size limit、动态 map、ID 精度、prototype pollution。
- write/fsync/rename/directory-fsync 每一步失败与 rename 前后 crash recovery。
- parallel/exclusive 每个 phase 第 N 个失败/kill、逆序 restore、旧资源仍可用、journal phase 可重入。
- NapCat/Official 未 READY、超时、迟到 READY/event/close/reconnect timer。
- Official 热重连前后 IdStore、MessageIdStore、reply/recall mapping 与 msgSeq 连续。
- in-flight subscription cycle + Provider reload，同一 cycle 只使用一个 generation，anchor/ledger 只推进一次。
- 长时间普通消息、Agent、link preview、request/notice 与 Provider reload 并发；整个 operation 只能使用一个 Provider generation，旧 Provider 在最后一个 lease 释放前不得关闭，禁止 Agent/NotificationService 全局 fallback。
- interval reload 不重启 sync/credential/warmup。
- Python unmanaged port、stale exit、same-port probe、RPC drain、旧 args/env rollback。
- Dashboard candidate bind/app build 失败、同端口 app handle swap、旧 listener/WS 保持；comment/logging/group-only revision 后 effect readiness 仍成功且无无意义重启。
- 下载外层 timeout 但底层仍运行、path reload 拒绝；Chromium 活跃 render 不被关闭。
- Python download taskId 在 stream/merge/remux/response 前取消，必须 terminal ack、ffmpeg 已 wait、无句柄/tmp/partial。
- logger 单 event 单 snapshot、buffer 原地 resize。
- setup fake-docker harness 在 preflight/backup/candidate/data-migrate/start/health/archive/commit 各 checkpoint 注入 failure/kill，重跑后 resume 或 rollback。
- legacy-v0 network fence/drain window、host-network/无法 fence/forced-stop/detached descendant 的 best-effort warning、一致恢复点强门禁；managed-v1+ forced stop 拒绝；manifest typed schema/非法组合/全状态转移、releaseEpoch 重入；rollback tag ID/pull_policy 校验。
- `cutover_intent` rename/fsync 前后、fence 后、runtime stop 后、`forced_recovery_ready` 前后 crash；Bot/NapCat/未知外部 writer fixture 验证全 writer 冻结、未知 writer 拒绝、preserved-in-place 分类，重跑后 network aliases/IP/driver opts 与每个 writer 原 running/paused 状态逐项一致。
- no-consume probe 期间注入 message/request/notice 与 probe crash/rollback，断言正式业务 session 根本不存在；`runtime_release_armed` rename 前、directory-fsync 后、`runtime_released` marker 前后、正式 Provider connect/READY 前后、admission enable 前后 kill，只恢复同一 releaseEpoch 且 timer/session 各一份，并断言 runtime owner lease/nonce 全局唯一。Official seq/heartbeat 与 NapCat event WS 必须证明 marker 前不会消费事件。
- delivery truth table 覆盖 ledger 后/anchor 前 kill、partial target/part ledger、legacy anchor 无 ledger、ledger retention 后旧 anchor，以及主卡片/fallback/自动下载 descendant 独立 part；legacy U/S 使用相同本地 fixture并验证 best-effort warning，managed-v1+ 不得出现该 warning。
- manifest checkpoint 更新不改变 config document/effective generation、fingerprint、reload state；config patch/reload response 不携带历史 migration warning。
- legacy first adoption、同 attempt resume、rollback、runtime release、后续 managed upgrade 分别验证 `cutoverAttemptId`、`appliesToCommittedRuntime` 和 warning 生命周期；managed-v1+ manifest 出现 legacy guarantee/warning/forced-stop continuation 必须校验失败。
- `/api/config/migrations`、`/api/config/status`、`/api/ready.migration` 三个出口只使用同一 public projection；Secret、低熵 Secret hash、路径、runtime env、Provider payload、原始异常和 stack 均不可出现。
- public projection 对 `exceptionScope/affectedState/retryPolicy/legacyFeatureInventory` 使用严格 enum allowlist；任意未知 feature/value fail closed，Dashboard/readiness 必须可机器判定例外只覆盖 legacy 首次 cutover in-flight outbound。
- runtime env 覆盖 dotenv、损坏/future YAML、symlink/权限、未知 Compose、移动 latest tag、NapCat/Official、probe 无出站副作用。
- 每轮结束断言 timer/socket/page/child/listener/pending promise 为 0。

### 18.12 第 1 轮 reviewer 结论与处置

| 视角 | 第 1 轮结论 | 已写回的主要修订 |
|---|---|---|
| 配置架构 | 不通过：schema、事务/CAS、可变 facade、reload 原子性阻断 | 18.1—18.6、18.11 |
| 生命周期 | 不通过：Provider/订阅/Python/Dashboard/download 缺 ready/drain/lease/rollback | 18.5、18.7、18.10、18.11 |
| 迁移部署 | 不通过：旧值 resolver、数据 inventory、quiesce/probe、镜像回滚与 health gate 阻断 | 18.1、18.8—18.11 |

第 1 轮所有 BLOCKER 已转为强制实施合同，但尚未获得第 2 轮独立确认，因此当前仍不得进入实现。

#### 18.12.1 第 2 轮结论与再次修订

| 视角 | 第 2 轮剩余阻断 | 本次修订 |
|---|---|---|
| 配置架构 | online/offline CLI 进程边界；prepare 后二次 CAS 与 YAML 线性化点 | 18.3—18.5，原位修订 5.3—6.1 |
| 生命周期 | parallel/exclusive 阶段冲突；generation/readiness；Dashboard 同端口 app 重建 | 18.5、18.7、18.10、18.11 |
| 迁移部署 | legacy-v0 首次 cutover；migration 状态循环；deployment schema；manifest 重入 | 18.8—18.11 与 deployment schema |

第 2 轮存在阻断项，因此按任务规则必须执行第 3 轮。只有第 3 轮确认架构、数据安全、兼容、部署和可验证性均无 BLOCKER，才能进入实现。

#### 18.12.2 第 3 轮最终结论

- 配置架构：最终复核通过，无剩余 BLOCKER。
- 生命周期：发现普通 message/request/notice/Agent/link 等未纳入 Provider lease；已通过 18.7.2 `BotOperationRegistry` 修订关闭。
- 迁移部署：mount relocation 已通过 18.9.5 修订；但 legacy-v0 存在无法由新版本事后判定的 delivery window：Provider 可能已完成远端发送，而 ACK 在断网/停机时丢失，旧进程尚未写 delivery ledger/anchor。network fence、日志终态和文件稳定 hash 都不能证明远端未发送。

因此，对任意正在运行的 legacy-v0 安装同时承诺“全自动首次升级”与“历史推送 exactly-once、绝不重复”在当前协议下不可证明。原安全 admission rule 是：

- 若旧版本具备 pre-send persistent outbox/idempotency/reconciliation capability，允许自动 cutover；
- 若 Provider 能以业务 idempotency key 查询/对账 fence 前请求，允许 reconcile 后 cutover；
- 其他活跃 legacy-v0 安装返回 `LEGACY_DELIVERY_STATE_UNPROVABLE` 并 blocked，禁止把 timeout/failure 当成未发送证明。

解除 blocker 需要用户明确选择其一：

1. 放宽首次 legacy cutover 的 exactly-once 保证，接受极小概率重复或跳过；
2. 把目标缩为“仅支持具备 managed quiesce/outbox 的版本升级”，legacy-v0 明确 blocked；
3. 先另行发布并运行能在外部副作用前持久化 outbox/idempotency intent 的兼容版本，再执行本迁移。

**用户决策（2026-07-10）：接受 legacy-v0 首次 cutover 的极小概率重复或漏推。实现层采用机器可见的 best-effort 策略：可判定为未提交的 parent/target 一律重试，不使用历史启发式自动跳过；旧版本缺少 durable child record 的 detached descendant 无法保证重试或去重。该例外只覆盖 arbitrary legacy-v0 首次升级 cutover 窗口内的 in-flight outbound，不放宽已提交历史数据、managed-v1+、后续升级或正常运行期的一致性要求。**

#### 18.12.3 Provider reconciliation 独立复核

Round 3 阻断后，额外派发三个相互独立、只读的 explorer，分别核对 NapCat 官方接口、QQ Official 官方接口和当前 legacy send → ledger/anchor 调用链。三方结论一致：**不存在能够覆盖 arbitrary legacy-v0 且同时保证不重复、不漏推的确定性 reconciliation 算法。**

NapCat 证据：

- 官方 `/send_group_msg` 与 `/send_msg` 请求没有 `idempotency_key`、`request_id` 或 delivery key；`message_id` 仅在成功响应中返回。参考：<https://napcat.apifox.cn/226656598e0.md>、<https://napcat.apifox.cn/226656652e0.md>。
- OneBot `echo` 仅用于把响应关联回当前连接中的 pending Promise。当前实现每次生成随机 `echo`，timeout 后只 reject，见 `src/services/notificationService.js:90-110`；它不是进入 QQ 侧的幂等键，以同一 `echo` 重发仍会再次执行发送。
- `/get_msg` 要求调用方已经持有 `message_id`，无法解决成功 ACK 丢失后没有 ID 的情况。参考：<https://napcat.apifox.cn/226656707e0.md>。
- `/get_group_msg_history` 仅按 `group_id`、`message_seq`、`count` 等读取历史，没有按 `echo`、业务 operation ID 或内容 hash 查询的合同。参考：<https://napcat.apifox.cn/226657401e0.md>。同一 bot 可因定时订阅、立即检查和链接预览在同群发送相同内容，文本/时间/发送者匹配只能启发式判断；图片、合并消息、撤回、分页和历史裁剪进一步使“未找到”不能证明“未发送”。

QQ Official 证据：

- 官方发送文档明确 `msg_id` 是前置收到的用户消息 ID，`msg_seq` 仅与 `msg_id` 联合用于被动回复去重；相同 `msg_id + msg_seq` 重发会失败。主动订阅推送没有可复用的 `msg_id`。参考：<https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/send-receive/send.html>。
- 同一官方文档明确警告 timeout 可能出现“实际消息已发送成功，但没接收到同步的结果返回”，直接构成 ACK-loss 反例。
- 当前主动发送没有 inbound `msgId/eventId` 时只使用进程内 `nextSeq()`，见 `src/providers/qq/official/messageSender.js:62-79`；`records` 和 `seqByTarget` 都是内存 `Map`，见 `src/providers/qq/official/messageIdStore.js:1-54`。
- 只有 HTTP 成功响应后才记录返回的 message ID，见 `src/providers/qq/official/messageSender.js:83-109,123-136`。当前 OpenAPI client 只有发送、上传与按已知 ID 撤回，没有 QQ 群主动消息历史或按请求身份查询，见 `src/providers/qq/official/openapiClient.js:80-111`。

当前代码的不可区分窗口：

1. NapCat 发送前只在内存登记 `echo`，`action-sent` 日志没有 group、contentId、payload fingerprint 或 response `message_id`，见 `src/services/notificationService.js:90-118,152-197`。
2. 实际发送成功返回后才写进程内 notification history，见 `src/services/subscription/updateChecker/modules/notify.js:294-313`。
3. 调用方随后才持久化 delivery ledger，再推进 anchor，见 `src/services/subscription/updateChecker/modules/feed.js:262-275` 与 `src/services/subscription/updateChecker/modules/targeting.js:370-393`。
4. 因此可以构造两次本地观测完全相同的执行：U 为 frame/request 未到 Provider，S 为 Provider/QQ 已接受但 ACK 在返回前丢失。二者都可能留下相同 timeout/failure、相同日志、无 message ID、无 ledger、anchor 未推进和相同文件 hash。
5. network fence 可能正好切断 ACK；延长稳定期只证明没有新的本地写入；cycle `done` 也不能证明远端未发送。重发在 S 中重复，不重发在 U 中漏推，任何一侧都违反本目标硬约束。

最终门禁结论：

- NapCat history 只可作为风险观测手段，不作为自动跳过依据；best-effort 模式下可判定为未提交的 parent/target 仍由新版本重试。
- QQ Official 没有能够覆盖主动推送的等价历史或发送结果查询能力。
- arbitrary legacy-v0 只有预先具备 send 前持久 outbox/operation ID、Provider 级幂等键和查询合同，或 managed quiesce/drain 才可自动 cutover；当前实现均不具备。
- 该问题属于协议和已有运行状态的信息缺失，不能通过本次新版本事后恢复 exactly-once；用户已明确接受首次 cutover best-effort，因此它不再是实施 blocker，但必须以 manifest/status warning、feature inventory 和定向测试保持例外边界可见。

#### 18.12.4 产品例外后的聚焦方案复核门禁

进入实现前，三个独立 reviewer 只需复核本次边界变化，不重开已通过的完整架构评审：

1. 配置架构 reviewer：确认 typed `cutover.deliveryGuarantee`、warning/status 字段不会污染正常 config generation、reload transaction 或 Secret 脱敏合同。
2. 生命周期 reviewer：确认 bounded drain、stop、snapshot、no-consume probe/releaseEpoch 顺序不会把 best-effort 例外扩大到新 runtime/managed upgrade，并覆盖 legacy detached descendant 风险。
3. 迁移部署 reviewer：确认 setup/manifest/rollback/dry-run 明确记录例外，host-network/forced stop 仍受一致 snapshot 和失败恢复约束，验收标准第 7 项的新表述可被 fixture 验证。

三名 reviewer 均确认无新 BLOCKER 后，`plan-eng-review` 变为 `done` 并立即进入阶段二。任何 reviewer 发现 best-effort 例外扩散到 managed-v1+、已落 ledger/anchor 的历史内容、正常运行时 retry、probe inbound 或 rollback 数据一致性，必须先修订本方案，不得进入实现。

聚焦复核最终结果：

| Reviewer | 最终结论 | 关闭的关键缺口 |
|---|---|---|
| config exception | PASS / no blocker | typed manifest + PublicMigrationStatusV1；best-effort scope/feature enum；generation/reload/Secret 隔离 |
| lifecycle exception | PASS / no blocker | deliveryPart truth table；no-consume probe；Provider session marker 后建立；releaseEpoch 单 owner 重入 |
| deployment exception | PASS / no blocker | cutover_intent/mountWriterSet；forced_recovery_ready；marker 前 rollback/后 same-epoch recovery；dry-run/fault fixture |

因此 `plan-eng-review=done`，允许进入实现。实现不得弱化上述门禁；任何偏差都必须重新触发对应 reviewer。

### 18.13 修订后的 worker 所有权

- ConfigService worker：`src/config/configService.js`、schema/validator/loader/writer/watcher/diff/reload registry 与 `test/unit/config/**`；不改 `src/config/index.js`。
- Migration worker：独占 `src/migrations/config/**`、`src/migrations/data/**`、迁移 fixtures/tests、`src/cli/data-migrate.js`；不改 `src/config/**`。
- Runtime worker：runtime slot/lease/service/provider 及对应测试；不改 config core、Dashboard、setup。已有脏文件只增量合并。
- Dashboard worker：`src/dashboard/**`、`dashboard/src/**`、Dashboard tests；不改 config/runtime/setup。
- Deployment worker：`setup.sh`、Compose render/fixture/harness、部署文档草案；不改 config/runtime/dashboard 源码。
- 主代理独占 `src/config/index.js` facade、`src/bot.js` 集成、package/lock、API composition root、Compose 最终文件、README/CLAUDE/本方案和跨 worker 公共合同。

### 18.14 阶段三代码 Review 第 1 轮与打回修复

第 1 轮三名独立 reviewer 均读取完整 diff、本方案和 `218/218` 首轮测试日志，并明确判定 `BLOCKER=YES`。该轮不计为通过；全部可执行问题已直接打回互斥文件范围的 implementer。

| Reviewer | 阻断摘要 | 直接修订/实现 | 定向证据 |
|---|---|---|---|
| 迁移/Config/Secret | Official inventory shape 错；preserve 只比 count；data migrator crash 后覆盖原 backup；legacy Agent/JWT effective 复刻不完整；兼容 facade 延迟写；ConfigService 缺最终 CAS/rollback degraded；manifest provenance/warning 可漂移；父级 symlink/TOCTOU | Official array identity/canonical hash；untouched strong/preserve hash；per-migrator crash journal；frozen Agent normalizer/JWT fail-closed；生产 facade 只读 + awaited transaction；多阶段 disk CAS 与 recovery-required；provenance 冻结和统一 public warning；path chain/inode/O_NOFOLLOW 检查 | migration/CLI 48 passing；ConfigService 新增 partial-phase、final-CAS、restore-failure、symlink fault 后 19 passing |
| 生命周期/并发 | migration status 读取 fail-open；phase 部分副作用不回滚；Provider/Python READY 后失活仍提交；Official stop/迟到事件/缓冲溢出；request/notice/download 后代未持 lease；停止态订阅误建 timer；readiness 漏 Provider；browser lease 泄漏；Python stop 无 hard deadline；module timer 未收口 | marker 读取 fail-closed；phase 前登记并聚合 rollback error；commit 前 final identity health；Official async close/terminate/stop 后禁 dispatch；缓冲溢出使 candidate 失败；message/request/notice/下载全 Promise 纳入 operation lease；timer 仅 running 重排；strict Provider readiness；全失败路径释放 lease；hard deadline/residual PID；显式 scheduler start/stop | runtime 合并定向 54 passing；配置/迁移/runtime/readiness 合并门禁 116 passing |
| 部署/API/文档 | Official probe 未验凭据即跨 marker；setup 无安装锁；marker 顺序、forced snapshot fsync、ownership value CAS、shared mount、network rename、listenPort health、runtime-env Secret 清理、legacy feature inventory、Official opaque Agent ID、clean clone 判定、旧 example/docs | no-consume Official token/gateway preflight；全程 flock；manifest 为 commit 真源；逐文件/目录 fsync；ownership last-value hash 三方 CAS；service binding/sharedIdentity relocation；managed network CAS；listenPort 归类 network deployment apply 并动态 health；Secret snapshot finally cleanup；保守 feature inventory；provider-aware opaque ID；provenance-based install detection；删除 tracked legacy example；README/CLAUDE/旧计划同步 | setup state machine 修复后 39 passing；CLI + Agent API 12 passing；Dashboard lint/build、`bash -n`、`git diff --check` 通过 |

部署 reviewer 正式复核追加打回项已落实到当前实现：`cutover_intent` 在 rollback tag、断网和 stop 前持久化；managed rollback 独立冻结 attempt 外 `setup-state`，以逐项 inventory/hash/mode 恢复并验证 `managed-v1` 与 Compose ownership lineage；ownership v1 因不存在 last-rendered value 默认 fail-closed，仅显式 adoption 可升级；NapCat → Official 会移除 ownership 证明属于 setup 的 `/app/.config/QQ` mount；dry-run 从旧容器环境、legacy 配置和数据只读生成 enum-only 脱敏 feature inventory；legacy archive 对文件、archive 目录及全部父目录 fsync；无 `flock` 环境使用 PID + process-start identity 的 portable lock，owner 尚未写入即 crash 时仅在目录过期后回收，live identity 永不删除。对应 fault fixture 覆盖 marker/ownership byte hash 与权限不变、cutover-before-pin、archive-parent-fsync same-epoch recovery、stale/live portable lock 和 v1/QQ mount ownership。

部署 reviewer 第二次打回的 6 个 P1 也已进入当前冻结实现：managed-v1+ stop 后逐容器 inspect exit code/OOM/shutdown residual，任一异常在 `runtime_stopped` 前立即 rollback；rollback 聚合 Compose/snapshot/network/writer restore error，并用 config/data/Compose/setup-control inventory 与 writer image/running/paused 原态做只读复核，任一失败保留 active attempt 为 `failed/recovery-required`；bot 与可选 NapCat rollback pin、原子 intent 均先于 target pull，pull 后由目标 typed CLI 重验 manifest；intent 采用私有同文件系统 staging + rename/fsync 发布，旧 runtime env 仅驻留内存至 intent 后，rename 前后 SIGKILL 均有 orphan cleanup/active recovery；`on_error` 不再 grep JSON，而通过同一 private typed manifest reader fail-closed，corrupt/symlink/0644/hardlink 均保留 active；legacy archive 固定 allowlist 包含四类旧配置及官方 example，未知 config entry preflight fail-closed，成功及 same-attempt resume 后 `config/` 精确只含普通、单 hardlink、`0600 config.yaml`。新增 fault fixture 覆盖 missing target 的 intent/pin/pull 顺序、exit 1/OOM/drain residual、rollback 多错误与 writer restore failure、intent rename 前后 SIGKILL、四类 unsafe manifest、known example 归档和 unknown entry。该批修复后的完整 setup state-machine 为 `62 passing (5m)`，日志 `/tmp/bili-setup-r1-deploy-2.log`；`bash -n setup.sh` 与 scoped `git diff --check` 通过，仍须交回独立 deployment reviewer 复核后才能把 R1 判为通过。

迁移/Config reviewer 正式复核追加打回项也已落实：`DataMigrationRegistry.rollback()` 使用 `rollback_started -> data_restored -> state_reverted -> rollback_complete` crash-safe journal，任一步失败进入 typed recovery-required；正式 legacy CLI 禁止生成无法由旧 effective state 证明的 JWT Secret，fresh install 才可生成；同 attempt resume 保留首次 `cutoverKind/sourceRuntimeClass/cutoverAttemptId`，checkpoint 持久化失败不得删除 active attempt；warning code 只做单调 union；manifest、data state、journal、backup 读取统一要求普通文件、非 symlink、单 hardlink、`0600`。原子 writer 通过已校验 directory fd 调用永久 Python helper，使用 `dir_fd + O_NOFOLLOW + O_EXCL + os.replace(src_dir_fd,dst_dir_fd)`、文件及父目录 fsync，并在调用前后复核父目录 dev/inode，覆盖父目录 rename/symlink 竞态。定向证据为 migration/CLI `62 passing`，其中含 rollback crash resume、JWT missing/exit 63/65、warning 真实 setup 链和 directory-fd fault fixture。

生命周期 reviewer 正式复核追加打回项已落实：Provider、Python candidate 的 stop/rollback/cleanup 错误不再吞掉，残余 handle/PID 保留并阻止新实例；Provider observer 与 Python identity health 延续到 `validateAdmission`，commit 后 close/overflow/exit 会 reverse swap；Dashboard 同端口 app swap 与异端口 listener swap 在 `commitHandles` 完成，所有可失败 contract/health 检查在 prepare/`validateAdmission`，`disposeOld` 只关闭旧 handle；RequestApproval timer 仅 normal runtime 显式 start，stop/restart 可等待；subscription/download/Python 暴露 abort + bounded cleanup；shutdown drain timeout 后先 abort、短 drain，再 terminate/kill，任何错误或 residual PID 强制非零退出。ConfigService 增加全应用 admission barrier：所有 handler 完成 fallible validation、最终 disk CAS、handle swap 和 snapshot publication后，各局部 ingress 在全局 gate 关闭状态恢复，最后用 token-fenced gate 一次放行；Dashboard（`/api/live` 除外）、Provider、Browser 与所有 `OperationRegistry` 共用该 gate，Provider 缓冲事件只在 gate 打开后释放。主代理复跑 runtime/Config/readiness 定向 `93 passing`，implementer 扩展集合 `96 passing`；另有 shutdown deadline、buffer/admission、同/异端口 rollback fault tests。

生命周期 reviewer 第二次打回的 6 个 P1 已进入当前冻结实现：ReloadRegistry 在异步 `validateAdmission`、snapshot/handle swap 和局部 ingress arm 后，先执行同步纯检查 `finalizeAdmission`，再执行可补偿的 `commitAdmission`，随后在同一 JS turn 再次同步检查并立即打开唯一 gate；任何失败逆序调用 `rollbackAdmission`，Provider/Python/Dashboard liveness observer 直到 `afterAdmissionOpen` 才移除。Python prepare 阶段通过 spawn callback 保留半创建 child，cleanup/residual 失败进入 rollback error、全局 gate 保持关闭并使 ConfigService `recovery-required`。Axios Python RPC 合并 caller signal 与 OperationRegistry abort signal。Provider 切换、socket close/reconnect 与 subscription `start/restart` 均等待旧 stop 和新 READY，初始化错误向上触发 rollback。Official COW canonical memory/disk commit 移至 `commitAdmission`，gate 前任一后置失败均按 checkpoint 恢复字节。process shutdown 使用绝对 deadline 和剩余预算 stage wrapper；deadline 同步 abort registries、terminate Dashboard/WS、Browser process/pages 与 Python children，最终强制非零退出。主代理复跑 Config/runtime/provider/dashboard/subscription 集合 `92 passing`，ConfigService core `22 passing`，shutdown/scheduler fault tests通过。

本轮修复后的最新冻结验证基线：完整 `npm test` 为 `224 unit test files passed`，日志 `/tmp/bili-qq-bot-npm-test-r1-fourth-final.log`；setup state-machine `62 passing (5m)`，独立日志 `/tmp/bili-setup-r1-deploy-2.log`；Compose ownership + Config CLI `11 passing`；migration/CLI `62 passing`；runtime/Config/provider/dashboard/subscription 主集合 `92 passing`，ConfigService core `22 passing`；Dashboard lint/build 通过，仅有既有 Browserslist、第三方 PURE 注释和 chunk-size warning；本地 `venv` Python runtime `3 tests OK`；真实本地 Secret 候选扫描 `4` 个、源码/测试/文档命中 `0`；`bash -n setup.sh`、scoped Node syntax、`docker compose config -q`、`git diff --check` 通过。根 runner 为 setup 专设 `480s` 单文件上限；`rollback_started` checkpoint fault 改为 `BILI_SETUP_TEST_MODE=1` 下确定性 failpoint，连续 3 次和完整 suite 均通过。`shellcheck` 与 Docker daemon 当前环境不可用，因此 shellcheck 和真实临时容器 smoke 尚无运行证据；隔离 fake-Docker setup fault suite 与 API health/readiness unit smoke 已通过。该基线现交回三名 R1 reviewer；本段记录修复和验证事实，不代表 R1 已通过。

部署/API reviewer 第三次打回的 4 项已继续修订：新增 `data/config-state/deployment-applied.json` 私有基线，持久化最后一次通过 setup health gate 的 deployment projection、fingerprint、单调 generation 与 releaseEpoch；ConfigService 每次 status/result 都相对该基线重算 pending paths，因此 no-op reload、非 deployment patch 和进程重启不会清空待 apply，marker 前 rollback 保留旧基线并继续显示 pending，只有 `runtime_ready` 后再次通过连续 health gate 的 setup 才原子发布新基线。`setup --config` 在 canonicalize/CLI 读取前统一要求普通、非 symlink、单 hardlink、`0600`，dry-run 同门禁并覆盖 `0644/symlink/hardlink/FIFO`；`assert_private_control_file` 先以 `-L` 拒绝 dangling symlink，四类 legacy 文件和 `config.yaml` 均在 cutover marker/image pin/runtime mutation 前失败。Dashboard README 与 CSRF 错误提示只引用 `config/config.yaml` 的 `dashboard.password/dashboard.allowedOrigins`，并有 stale-source 扫描阻止旧环境变量提示回归。新增定向证据：ConfigService/Config CLI/Dashboard source `34 passing`；unsafe input/dangling/unknown-entry `11 passing`；deployment rollback→pending→successful health→generation 递增并清 pending 链 `1 passing`；Dashboard API 相关集 `32 passing`；Dashboard lint、`bash -n setup.sh`、`git diff --check` 通过。该批仍须完整 suite 重跑并交回独立 deployment reviewer，不能据此将 R1 标为通过。

第 1 轮修复完成后必须由原 reviewer 或同等独立 reviewer 对当前完整 diff 复核确认。只有三类 reviewer 均明确 `PASS / no known bug / no omitted acceptance item`，才将本轮闭环标为通过并进入第 2 轮代码 Review。

### 18.15 fresh R1 独立复核、第二次打回与冻结修复

在上一批 `226 unit test files passed` 的冻结实现上重新派发三名全新、未参与实现的 reviewer。三类 reviewer 均判定 `FAIL`，阻断不以测试已绿为由降级：

- 生命周期/正确性：rollback phase 首次产生 residual 时 admission gate 未保持关闭；非 Provider reload 的 QQ 缓冲事件不自动 flush；NapCat shadow candidate 在 commit 前存在入站无 listener 窗口；managed Bangumi fallback 为 detached outbound；Python idle restart 未与 reload 共用生命周期互斥。
- 配置/迁移/安全：ConfigService 读取仍为路径式 TOCTOU 且读取前未校验 `0600`；owner lease 仅事务入口 fencing；DataRegistry 会补偿历史已提交 migrator；data-migrate CLI 无 runtime owner；private copy/inventory 与 rollback resume 复核不完整；legacy logger、全 Secret snapshot、动态 Cookie、Official roots 重复语义与 existing-YAML staging/resume 合同不完整。
- Dashboard/部署/文档：`allowedOrigins` 数组被当字符串；Official 首装 DTO 字段名不匹配；NapCat 自生成配置错误使用 `localhost`；migration fallback 会选到更新的失败 attempt；前端表单值与 generation 非同一快照；Dashboard patch、no-op pending、Compose ownership fd read 和 README 密码声明不一致。

三批互斥 implementer 已关闭全部上述问题：

1. ReloadRegistry 的任意 rollback error 都保持全局 gate 关闭；QQ gate-open flush 采用 provider instance/sequence token；NapCat candidate 从 socket 建立时即具备 bounded precommit buffer；Bangumi fallback 纳入 OperationRegistry 和 main/fallback ledger；Python start/stop/restart/reconfigure/idle 共享 FIFO 生命周期 mutex。
2. ConfigService 使用继承 directory fd 的 `O_NOFOLLOW + fstat/read/re-fstat` 读取且在读取前要求普通、单 hardlink、精确 `0600`；owner identity 为 typed alive/dead/unknown，unknown fail-closed，lease token 贯穿 prepare、writer CAS、handler commit、snapshot 与 ingress；data apply 仅补偿本次副作用；异步 CLI owner 覆盖 Promise 全生命周期；private reader/inventory/copy 与 rollback resume 均复核；legacy logger、Secret snapshot、Cookie 集合、Official roots 与 existing-YAML 状态机按旧真实调用链补齐。
3. Dashboard Origin 使用 canonical `http(s)` 数组；Official/NapCat 交互首装通过 `0600` DTO 生成正确 YAML，NapCat 固定 Compose service URL `ws://napcat:3001`，用户 `--config` 保持字节不变；migration status 只回退到与 managed marker epoch 匹配的 committed ready/complete；前端值与 generation 从同一 `/api/config` hydrate；patch path、no-op pending、Compose ownership secure fd read 和 README 已同步。

冻结验证：

- 完整 `npm test`：`228 unit test files passed`，日志 `/tmp/bili-qq-bot-npm-test-r1-final-isolated-20260711.log`。
- setup state machine：`75 passing (7m)`，包含真实 Config CLI 的 Official/NapCat 交互 DTO、Secret 不进输出、relocation/adopt、失败回滚、same-epoch recovery 与 legacy resolver/JWT 链。
- Dashboard lint/build 通过，仅保留既有 Browserslist、第三方 PURE 与 chunk-size warning；本地 `venv` Python runtime `3 tests OK`。
- `bash -n setup.sh`、`docker compose config -q`、Node syntax、`git diff --check` 通过；真实 Secret 候选 `4` 个，源码/测试/文档命中 `0`；无 pycache/tmp 生成物残留。
- `shellcheck` 与 Docker daemon 仍不可用，因此 shellcheck 和真实临时容器/API health smoke 没有运行证据；在最终目标审核中必须保持为外部验证 blocker，不能伪装为已通过。

测试隔离与边界事故：

- 根测试 runner 现预加载 `test/tools/isolate-runtime-data.js`，每个 Node 测试进程把 singleton delivery store 指向独立临时目录并在退出时清理；冻结全测前后真实 delivery current/.bak hash 完全不变。
- 早期旧测试曾误写真实 `config/config.json`，原始字节不可恢复；冻结 SHA-256 为 `839e30445700c6723ec575b690313d75d7d8fdf5fbc73c259c43853e89cc8b5a`。
- 本批 Bangumi 测试首次执行时曾漏注入隔离 store，写入后删除了一条测试 delivery record并轮换 `.bak`；测试 record 已不存在，但原历史 `.bak` 已覆盖且不可恢复，current 也经历 deliveredAt 变更。当前冻结 hash：current `4a05b6f42fad51fdd55c3c6e76d6b3a18872f3f8bee486f103ebab68201ce9b6`，bak `485f94d42f580772e7272c0a39c761f77a74191a17cb28d6d5cae92956b93f81`。后续不得再写真实 data，最终报告必须披露。

本节仅记录修复和冻结验证事实，不代表 fresh R1 已通过。下一门禁是三名全新 reviewer 对当前完整 diff、本方案和上述冻结日志全部明确 `PASS / no known bug / no omitted acceptance item`。

### 18.16 fresh R1 后续复核、第三次打回与冻结修复

fresh correctness reviewer 基于当前完整 diff 与 `229 unit test files passed` 冻结日志仍判定 `FAIL`：`src/bot.js` 在 subscription/Provider stop 完成前设置 `previousStopped`，subscription stop 拒绝或 Provider partial-stop 时会在 rollback 重建第二个旧 Provider，遗留不可见的 socket/session/timer。现改为 `untouched/stopping/stopped/residual` 明确状态；subscription stop 失败复用原 handle，Provider stop 失败把原 slot 登记为 residual，`restorePrevious` 返回 typed `PROVIDER_RESIDUAL_CLEANUP_REQUIRED`，ReloadRegistry 因 compensating failure 保持全局 admission gate 关闭，禁止重建第二实例。新增 Bot wrapper 故障测试覆盖两条路径，并与 slot runtime 合并验证 `29 passing`。

fresh migration/security reviewer 同轮发现并打回两项 P1：历史 setup 和旧 JSON writer 常留下 `0644` 的 `.env/config.json`，原 setup 私有门禁会让真实首次升级在 cutover 前失败；legacy resolver 对解析、hash、backup 三次独立读取，可能产生 A/B/C 三个字节版本。现 setup 对 legacy-v0 四类源仅接受普通、非 symlink、单 hardlink、`0600|0644`，managed-v1+ 仍拒绝 legacy artifact，迁移归档和新 YAML 一律 `0600`；resolver 对每个源只执行一次 directory-fd anchored capture，同一 Buffer 同时用于解析、source hash 与 backup，并在 backup 前核对 expected hash。新增历史 `0644` 首升和 dry-run、捕获后源变更仍备份同一原始字节的 fixture。迁移/CLI/Provider 合并定向 `56 passing`，setup `2 passing`；该 reviewer 修复后独立复跑迁移/CLI `73 passing`、历史 0644 setup `1 passing`，明确 `PASS / no known bug / no omitted acceptance item`。

修复后冻结验证：完整 `npm test` 再次为 `229 unit test files passed`，日志 `/tmp/bili-qq-bot-npm-test-r1-repair-final-20260711.log`，其中 setup state machine `76 passing (6m)`；Dashboard `npm run lint && npm run build` 通过，仅保留 Browserslist、第三方 PURE 注释与 chunk-size warning；本地 `venv` 以 `PYTHONPATH=.` 执行 Python runtime `3 tests OK`；`bash -n setup.sh`、`git diff --check` 通过。真实文件冻结哈希未变化：`config/config.json=839e30445700c6723ec575b690313d75d7d8fdf5fbc73c259c43853e89cc8b5a`、delivery current=`4a05b6f42fad51fdd55c3c6e76d6b3a18872f3f8bee486f103ebab68201ce9b6`、delivery bak=`485f94d42f580772e7272c0a39c761f77a74191a17cb28d6d5cae92956b93f81`。`shellcheck` 仍未安装；Docker CLI 存在但 daemon socket 不存在，因此真实临时容器/API health smoke 尚无证据，最终 100% 门禁仍未满足。

Compose 语法补验使用隔离临时目录生成 `0600 config.yaml`，调用真实 `render-compose` CLI 生成 candidate，再执行 `docker compose -f <candidate> config -q`，退出码 `0`；该命令只依赖 Docker CLI，不要求 daemon。Dashboard lint/build 后产生的 ignored `dist/` 不计入跟踪范围；Python 定向生成的源码树 `__pycache__` 已清理，最终 tracked/untracked inventory 未发现新增临时脚本、Secret、backup 或 preview 产物。

fresh correctness/lifecycle reviewer 对上述 partial-stop 修复复核后明确 `PASS / no known correctness or reliability bug / no omitted correctness-lifecycle acceptance item`：状态只在 stop 成功后进入 `stopped`，失败 slot 保持 residual；residual 阻断新 candidate，补偿失败保持 admission gate 关闭；两条 fault test 分别证明 subscription stop 失败复用原实例、Provider partial-stop 无第二实例且 residual/gate 状态可见。fresh R1 尚待部署/UI reviewer 最终结论，不能仅凭两类 PASS 宣告本轮闭环。

主代理按硬约束复核时另发现 schema 合同偏差：`dashboard.listenPort` 已由 Dashboard reload handler 自动换 listener，却同时错误标记 `deploymentApplyRequired`。现移除其 deployment effect/pending 标记；只有 `deployment.ports.*`（宿主 hostPort）、`deployment.mounts.*` 与 `deployment.network.*` 要求 `setup.sh --apply`。legacy `DASHBOARD_PORT/dashboardPort` 仍同时冻结为容器 `dashboard.listenPort` 与 `deployment.ports.dashboardHost`，保持首次迁移前后有效端口一致。对应 ConfigService baseline 测试改为断言 `dashboard.listenPort` 不进入 pending；该修订必须纳入 fresh 部署/UI reviewer 及后续 R2。

fresh 部署/UI reviewer 随后判定 `FAIL`：普通 upgrade 虽先 snapshot Compose，却从 live Compose render，且 render→publish 前没有最终 fingerprint CAS；用户/自动化并发修改自定义 labels/resources/logging/additional networks 可能被静默覆盖。现普通 upgrade 只从 `/staging/snapshot/docker-compose.yml` render，紧邻 `apply_candidate_files` 前校验 live Compose 仍为 snapshot hash/type；冲突时把并发字节保护到 attempt、走旧 runtime rollback，最后恢复并发 Compose 而不是 snapshot。新增 legacy 与 managed upgrade 的发布前并发替换 fixture，以及明确断言 render 参数只指向 frozen snapshot；三项定向 `3 passing`。该修复仍须原部署/UI reviewer 复核后才能关闭 fresh R1。

上述 listenPort/Compose 修复后的冻结验证：完整 `npm test` 仍为 `229 unit test files passed`，日志 `/tmp/bili-qq-bot-npm-test-r1-compose-cas-final-20260711.log`，setup state machine 增至 `79 passing (7m)`；ConfigService + Dashboard listener 定向 `37 passing`；Dashboard lint/build、`bash -n setup.sh`、`git diff --check` 通过。三份真实文件冻结 hash 再次不变，源码/测试树 Python cache 已清理。该日志取代 18.16 前半段的 `76 passing` 作为 fresh R1 当前冻结证据。

最终环境复核仍为：`shellcheck` 不存在，`docker info` 退出 `1`（daemon socket 不存在）；隔离临时 Compose candidate 的 `docker compose config -q` 退出 `0`。因此即使后续静态 reviewer 全部 PASS，真实临时容器/API health smoke 仍是目标审核的外部 blocker，不能宣布 100% 完成。

fresh 部署/UI reviewer 对 upgrade CAS 修复确认通过，但追加发现 fresh install 在已有源码 checkout/custom Compose 时未把 snapshot 传入 renderer，会静默覆盖用户 labels/resources/额外 service/network。现 install/upgrade/apply 统一优先使用 snapshot Compose，fresh install 也在发布前执行 snapshot CAS；真实 renderer 的 CLI 测试加入用户 labels、deploy resources、reverse-proxy service 与 external network 并逐项证明保留，setup fixture 证明 fresh install 传入 `/staging/snapshot/docker-compose.yml`。连同 legacy/managed 并发替换定向共 `5 passing`；该追加修复仍须 reviewer 复核，当前 fresh R1 状态不变。

部署/UI reviewer 再次复核时确认 custom Compose merge 已关闭，但发现仓库 canonical Compose + fresh Official 会因无 ownership 而 fail-closed。现 Config CLI 增加仅供 setup fresh install 使用的 `--adopt-known-template`：`matchesKnownSetupTemplate()` 严格验证 canonical bot/NapCat image、ports、required mounts、NapCat dependency、managed network 与 NapCat service key 集合；只有该白名单模板才允许建立 v2 ownership，任一 managed pointer 改动返回 `COMPOSE_UNKNOWN_TEMPLATE_ADOPTION_REQUIRED`。真实 CLI fixture 证明 Official 会移除 canonical NapCat/dependency，同时保留 bot labels/resources、reverse-proxy 与 external network；篡改 NapCat port 的未知模板被拒绝。Config CLI `13 passing`、fresh/upgrade Compose setup 定向 `4 passing`。该修复仍须 reviewer 复核并完成新的冻结全测。

reviewer 对首版 matcher 继续判定 `FAIL`：部分匹配会允许 NapCat plugin env/volume/network/duplicate managed target，而 Official 随后整块删除 NapCat service；显式 `--adopt-existing` 也被 known-template guard 提前阻断。现 matcher 对会被删除的 NapCat service 使用完整 canonical object 精确相等，对 Bot setup-managed volume target 要求唯一 source/target exact、healthcheck 与 `depends_on.napcat` exact；Bot labels/resources、额外 service/network 仍因 renderer 原样保留而不参与白名单。unknown guard 在用户显式 `--adopt-existing` 时让位。fixture 新增 plugin env、plugin volume、duplicate `/app/.config/QQ`、extra NapCat network/label 全部拒绝，并证明 explicit adoption 出口可用；定向 `1 passing`。该轮仍须 reviewer 复核和最终冻结全测。

strict matcher 最终冻结日志 `/tmp/bili-qq-bot-npm-test-r1-strict-template-final-20260711.log` 为 `229 unit test files passed`。部署/UI reviewer 最终确认：NapCat full canonical exact、Bot managed target unique/exact、healthcheck/depends exact、unknown template 与 explicit adoption 分流、install/upgrade/apply snapshot render/CAS 和相应 fixtures 均成立，结论 `PASS / no known bug / no omitted acceptance item`。结合 18.16 已记录的 correctness/lifecycle PASS 与 migration/security PASS，fresh R1 正式闭环为 PASS，下一门禁为三名全新 R2 reviewer。

该严格模板版本的最终日志中 setup state machine 为 `80 passing (7m)`；完整 suite 仍为 `229 unit test files passed`。R2 三路 reviewer 已以该日志、当前完整 diff 和本方案为输入启动。

### 18.17 R2 独立复核与打回

三名全新 R2 reviewer 均判定 `FAIL`，共 8 个 P1，已按互斥文件所有权打回三个 implementer：

- correctness/lifecycle：`dashboard.listenPort` 虽不再标 deployment apply，但容器端口映射/health 仍绑定旧端口，热换 listener 后会令 Dashboard 不可达；Provider partial-stop residual 后 generic rollback 仍无条件 resume 本地 ingress、operation registry 与 subscription timer。
- migration/security：通用 JSON data migrator 的 backup 与 source hash 双读可能形成 A/B 混合恢复点；`cleanup_orphan_setup_intents` 无 owner marker/结构证明就删除 `data/.setup-intent-*`，可能误删用户目录。
- deployment/UI：Compose verify→copy 仍有 check-then-copy 窗口；ownership 从 live 而非 snapshot 读取且无同事务 CAS；dry-run 宣称检查 Compose 却未执行 strict render/adoption；文档承诺的空目录 fresh `setup.sh --dry-run` 无配置时不能生成可用计划。

上述问题全部修复、定向和全量冻结验证、原 R2 reviewer 复核前，R2 保持 FAIL；外部 Docker daemon/shellcheck blocker 继续独立保留。

### 18.18 R2 打回修复与冻结验证

R2 的 8 个 P1 已由三个互斥所有权 implementer 完成修复：

- correctness/lifecycle：Provider rollback 一旦存在 residual，不再恢复 Provider 本地 ingress、operation registry、subscription/download timer；全局 admission gate 与 Provider ingress 保持关闭，直到 residual cleanup 成功。新增 ReloadRegistry 端到端 partial-stop fault test。Dashboard 容器 ingress 与 healthcheck 固定使用 `DASHBOARD_INGRESS_PORT=3000`，宿主端口始终映射容器 3000；`dashboard.listenPort` 继续作为应用级热配置，由稳定 listener 内的 app swap 生效。login-rate-limit 与 notification history 的模块级 cleanup interval 均 `unref()`，测试可自然退出。
- migration/security：通用 JSON migrator 只做一次 fd-anchored Buffer 捕获，解析、source hash、backup artifact 与 artifact hash 绑定相同字节；journal 发布前重验 source、inventory 与 artifact，冲突不留 journal。setup intent staging 增加 typed private owner marker；orphan cleanup 在删除前先完整验证 mode、owner、marker、attempt ID 与目录结构，未知、损坏、symlink、hardlink 或宽权限前缀均原样保留并 fail closed。
- deployment/UI：Compose 与 ownership 从同一冻结 snapshot generation 读取；Compose 发布改为原路径 claim + atomic no-replace，关闭 verify→copy 窗口，并在冲突 rollback 后恢复并发用户字节。dry-run 现在真实执行 candidate config、deployment plan、strict render/adoption 与 Compose syntax validation；fresh 无配置 dry-run 使用私有临时 staging，安装目录零写入。known-template matcher 保持 NapCat 全对象 canonical exact、Bot managed target 唯一且 exact、healthcheck/depends exact，plugin env/volume/network/label 与 duplicate target 均按 unknown fail closed；显式 `--adopt-existing` 仍为人工出口。

合并后的定向验证为 Node `104 passing`，覆盖 data registry、Provider slot/Bot wiring、Dashboard listener、Config CLI 与 ConfigService；Dashboard `npm run lint && npm run build` 通过，仅有 Browserslist、第三方 PURE 注释与 chunk-size warning；本地 `venv` Python runtime `3 tests OK`；`bash -n setup.sh` 与 `git diff --check` 通过。日志：`/tmp/bili-qq-bot-r2-merged-targeted-20260711.log`。

setup state-machine 独立全集为 `89 passing (7m)`，日志 `/tmp/bili-qq-bot-r2-setup-state-machine-20260711.log`。其后根 `npm test` 冻结为 `229 unit test files passed`，其中 setup state-machine 再次 `89 passing (7m)`；日志 `/tmp/bili-qq-bot-npm-test-r2-final-20260711.log`。`docker compose config -q` 通过。冻结真实文件 hash 再次不变：`config/config.json=839e30445700c6723ec575b690313d75d7d8fdf5fbc73c259c43853e89cc8b5a`、delivery current=`4a05b6f42fad51fdd55c3c6e76d6b3a18872f3f8bee486f103ebab68201ce9b6`、delivery bak=`485f94d42f580772e7272c0a39c761f77a74191a17cb28d6d5cae92956b93f81`。Secret 模式扫描未发现真实凭据；fixture 中的 `.bak` 为受测迁移输入，不是运行生成物。

当前环境仍未安装 `shellcheck`，Docker CLI/Compose 可用但 daemon socket 不存在，因此真实临时容器与 API health smoke 尚无法执行。以上记录只构成 R2 修复冻结基线；必须由三名未参与实现的全新 reviewer 检查当前完整 diff、方案和上述日志并全部明确 PASS，随后完成第 14 节 14 项独立审计，才能进入最终结论。

### 18.19 R2 最终复核再次打回

三名未参与实现的全新 reviewer 检查完整 diff、18.18 冻结方案与三份最终日志后均判定 `FAIL`，共发现 6 个阻断项：

- correctness/lifecycle P1：旧 Provider 已成功 stop 后，若候选在后续 rollback 的 close/retire 失败，`ProviderRuntimeManager.restoreOldSlot()` 记录 residual 后仍调用 Bot `restorePrevious()`；Bot 会按旧配置 rebuild 第二个 Official session，绕过 candidate residual 门禁。必须在任一 candidate cleanup failure/residual 存在时禁止重建，保持所有 gate/operation/timer fail closed，并补完整 ReloadRegistry + Official sequential fault test。
- deployment P1：Compose ownership 虽从同一 snapshot render，但最终 CAS/no-replace 只保护 Compose；Compose 发布后仍会直接覆盖 live `compose-ownership.json`。必须把 ownership 纳入同一 claim、snapshot byte CAS、no-replace、attempt journal 与 rollback 合同，覆盖发布前修改、发布时出现、双 artifact 间 crash 及保留并发字节。
- Dashboard P2：Settings 同时请求 `/api/config` 与 `/api/config/status`，当前 hydration 会把 document generation N 与 effective/deployment/pending generation N+1 混合。必须由同一快照返回，或仅在 generation 相等时接纳 status 并重试；测试须明确拒绝混代。
- migration/security P1：通用 `config set PATH VALUE` 未拒绝 schema Secret，Secret 可进入 argv、shell history 和进程列表。普通 set 必须拒绝 Secret；显式 secret action 只能从私有文件或 stdin/FD 读取，响应与错误不得回显明文。
- migration/security P1：`.setup-intent-*` orphan cleanup 只校验目录/marker 自身后 `rm -rf`，marker 未绑定 attempt ID，也未验证目录精确结构与递归安全；夹带未知文件、嵌套 link 或宽权限内容仍可能被删除。必须先对全部候选做 all-or-nothing 完整验证，未知内容原样保留并 fail closed。
- migration/security P1：health 后 legacy archive 与 relocated old config archive 仍使用路径级 `[ -f ] -> mv -> chmod`，早期 preflight 后存在 symlink/hardlink/byte replacement 窗口。必须用 anchored `O_NOFOLLOW`/dirfd helper 做 late ordinary/nlink/hash/inode CAS、no-replace archive、fd chmod 与双父目录 fsync；冲突不得写 `upgrade_complete`，并补原路径与 relocation 等价 fault fixtures。

18.18 的通过日志未覆盖这些组合，因此不能作为 R2 PASS。修复按 Runtime、Dashboard、setup+CLI 三个互斥范围执行；每批先跑定向验证，随后重新冻结 setup 全集、根 `npm test`、Dashboard lint/build、Python、Compose 与真实数据 hash，再交回独立 reviewer。

### 18.20 R2 第二次打回修复与最终冻结基线

18.19 的 6 个阻断项已全部修复：

- Provider rollback 的 candidate close/retire 一旦失败或 residual 非空，锁存 pending external restore，返回 typed `PROVIDER_RESIDUAL_CLEANUP_REQUIRED`，不调用 Bot rebuild；只有显式 `retryResidualCleanup()` 成功并推进 cleanup generation 后才允许后续恢复。完整 ReloadRegistry + Bot/Official sequential fault test 证明旧 stop 成功、候选 READY、下游失败且候选 stop 失败时 factory/start 均保持 `1`，不存在第二 session，global/local ingress、operations 与 subscription/download timer 均保持关闭。Runtime 定向 `32 passing`，无 `--exit` 自然退出。
- Dashboard Settings 通过 bounded consistent-read helper 获取 `/api/config` 与 `/api/config/status`；只接受 document generation 相等的组合，最多三轮后明确失败。初次 hydration、reload 与 expected generation 均来自同一 generation，卸载后禁止 setState。定向 `4 passing`，覆盖 mismatch 拒绝、同代 hydration、interleaving retry 与 bounded failure。
- Compose 与 ownership 现在是双 artifact claim/no-replace 发布合同：两者都以同一 snapshot 做 byte CAS，snapshot 后 mutation、absent→appear、第二 artifact publication race 均保留并发用户字节；Compose/ownership 两次发布之间 crash 进入同 release epoch recovery，rollback 恢复 provenance/ownership。
- CLI 普通 `set` 拒绝 schema Secret path；`set-secret` 只从 `0600`、同 owner、单 hardlink、no-follow 普通文件或 stdin/FD 读取，`clear-secret` 使用显式 clear op，任何结果与错误均不返回 Secret。Config CLI 全集 `16 passing`。
- `.setup-intent-*` marker 绑定 attempt ID；cleanup 对全部候选先做 closed-shape 与递归 owner/mode/symlink/hardlink 检查，再 all-or-nothing 删除。extra file、nested entry、attempt mismatch 与任一未知候选都会保留全部候选并 fail closed。
- legacy 与 relocated config archive 均在 sandbox helper 内执行 `lstat -> O_NOFOLLOW open -> fstat ordinary/nlink/dev/ino -> fd bytes/hash -> destination O_EXCL + fchmod/fsync -> late pathname inode/hash CAS -> unlink + parent fsync`。proof 在 intent 原子发布后、runtime mutation 前冻结；relocated config 按 candidate 新 inode 重锚定。symlink、hardlink、byte-swap 或 relocation provenance 冲突不得进入 `upgrade_complete`。

主代理合并验证：Config CLI `16 passing`、Provider/Bot `32 passing`、Dashboard snapshot `4 passing`；setup state-machine 独立全集 `100 passing (8m)`，日志 `/tmp/bili-qq-bot-r2-final-blockers-merged-20260711.log`。根 runner 的 setup 单文件预算由旧 `480s` 调整为 `720s`；最终 `npm test` 为 `229 unit test files passed`，其中 setup 再次 `100 passing (8m)`，日志 `/tmp/bili-qq-bot-npm-test-r2-final3-20260711.log`。第一次根重跑仅因旧 runner 预算在最后一个 setup case 前 `ETIMEDOUT`，不是用例断言失败，已由最终成功日志取代。

其余门禁：Dashboard lint/build 通过，仅保留 Browserslist、第三方 PURE 注释与 chunk-size warning；本地 `venv` Python `3 tests OK`；`bash -n setup.sh`、`node --check`、`git diff --check`、`docker compose config -q` 全部通过。Docker daemon 启动后，使用 `koalaman/shellcheck:stable` 对只读挂载的 `setup.sh` 执行 `-S warning` 为 `0 warnings`，日志 `/tmp/bili-qq-bot-r2-final-static-gates-20260711.log`。

真实容器/API smoke：基于当前 lockfile 的 `deps` stage 构建 Linux node_modules，再在仅增加 Python 3 的临时 smoke 镜像中只读挂载当前 `src/` 与 Dashboard dist，挂载 `/tmp` 下私有 `0600 config.yaml` 和隔离 data/logs/fonts/QQ；真实 ConfigService 初始化后启动 Dashboard listener。容器内 `/api/live` 返回 `200/live=true`，`/api/ready` 返回 `200/ready=true/mode=container-smoke`，document/effective generation 均为 `1`，证据 `/tmp/bili-qq-bot-container-ready.json` 与 `/tmp/bili-qq-bot-container-smoke.log`。完整生产 Dockerfile 构建另行尝试，但固定的清华 Debian HTTP mirror 在 apt 下载阶段拒绝连接，日志 `/tmp/bili-qq-bot-docker-build-smoke-20260711.log`；此失败是外部 package mirror，不影响已完成的当前代码 Linux 容器/API smoke，但最终报告必须披露完整生产镜像构建未成功。

冻结真实文件 hash 再次保持不变：`config/config.json=839e30445700c6723ec575b690313d75d7d8fdf5fbc73c259c43853e89cc8b5a`、delivery current=`4a05b6f42fad51fdd55c3c6e76d6b3a18872f3f8bee486f103ebab68201ce9b6`、delivery bak=`485f94d42f580772e7272c0a39c761f77a74191a17cb28d6d5cae92956b93f81`。本节只是新的 R2 冻结基线；三名 reviewer 必须重新检查当前完整 diff、方案与这些日志并全部明确 PASS，才能进入第 14 节审计。

### 18.21 R2 第三次打回

三路 reviewer 对 18.20 再次复核后仍判定 `FAIL`，发现 4 个 P1：

- correctness/lifecycle：residual fail-closed 与“零第二 session”成立，但生产调用链没有可达的 pending external restore。`retryResidualCleanup()` 只清理 residual 并推进 generation；原 ReloadTransaction 已 closed，ConfigService 已 recovery-required 且阻止新事务，测试通过人工再次调用 handler `restorePrevious()`，生产 API 无此路径。必须提供原子 `resumePendingExternalRestore()` 或由 cleanup 成功自动触发，恢复旧 Provider/global handle/operations/timers，token-fenced reopen admission，并受控清除 ConfigService recovery；失败继续保持关闭。测试必须覆盖真实 ConfigService + Bot Official 的失败→cleanup→恢复全链。
- deployment：四个 deterministic Compose/ownership candidate/claimed 路径缺少 publication ownership journal。若路径由用户预存或在 cleanup 前被替换，当前 rollback cleanup 会无条件删除。必须在本 attempt 创建路径后持久记录 type/dev/ino/hash，cleanup 只删除 journal 证明且 identity/hash 仍匹配的路径；未知/替换路径原样保留并 recovery-required。补四类预存冲突与 cleanup 前 inode replacement fixture。
- migration durability：secure archive 当前 `fsync(destination file) -> unlink(source) -> fsync both parents`，断电窗口可能让源删除持久化而目标目录项丢失。必须改为 `create destination -> fsync destination file -> fsync destination parent -> late source CAS -> unlink source -> fsync source parent`，并补 destination-file-fsync、destination-dir-fsync、unlink-before-source-dir-fsync 三个 crash/resume fixture。
- migration provenance/idempotency：legacy 与 relocated archive 调用方仍以 `[ -f source ]` 条件跳过 helper；proof 后删除源或换成 dangling symlink 会同时绕过源和目标验证并继续 `upgrade_complete`。必须对 proof 每项无条件 reconcile：源存在则安全归档；源不存在则要求安全 `0600`、单 hardlink、hash 匹配的目标已存在；两者均缺失或源不安全则 same-epoch recovery。补 legacy/relocated missing-source、dangling-symlink，并保留 post-archive resume 幂等测试。

18.20 的测试与容器证据仍有效，但未覆盖上述生产可达恢复、claim namespace 与断电/缺失源场景，因此不能进入 auditor。

### 18.22 R2 第三次打回修复与冻结验证

18.21 的 4 个 P1 已修复：

- 失败 ReloadTransaction 不复用，而把唯一 admission token 转移到 `ReloadRegistry.pendingRecovery`。`ConfigService.recover()`、兼容 facade 与 `POST /api/config/recover` 触发串行恢复：Provider manager 先 retry residual cleanup，再只执行一次 pending external rebuild/global slot+handle restore，随后恢复 subscription/download operations、timers 与 local ingress；Registry 在恢复前和 reopen 前两次验证同一 active token，只用原 token reopen，成功同步 complete 后 ConfigService 才清 recoveryState。cleanup、rebuild、pause、token fence 任一步失败均保留 pending token、closed gate 与可重试 recovery；半创建 Provider 的 stop failure 重新进入 residual。真实 ConfigService + ReloadRegistry + Bot Official fault/recovery test 覆盖首次 cleanup 失败仍关闭、第二次成功、旧 factory/start 各一次、旧 snapshot/global handle/timers/operations 恢复、gate open/recovery clear；Runtime/Config/API 定向 `71 passing (8s)`，无 `--exit` 自然退出。
- publication 使用 attempt 私有原子 JSON journal，完整记录四个 deterministic candidate/claimed path 的 absent/file、dev、ino、hash，并 fsync journal 与父目录。生成和 cleanup 都通过 `lstat + O_NOFOLLOW + fstat + fd hash`；cleanup 对全路径做两次完整验证后才 all-or-nothing unlink。journal 缺失/损坏、预存路径或 cleanup 前 inode replacement 均保留并 recovery-required；rollback 全量 data restore 前对 ownership temp 做同 inode stash/restore。四类预存冲突与 inode replacement `5/5` 通过。
- secure archive 顺序改为 destination `O_EXCL`、destination file fsync、destination parent fsync、late source fd/inode/hash CAS、unlink source、source parent fsync。destination-file-fsync、destination-parent-fsync、source-unlink 三个 crashpoint 的 same-epoch resume `3/3` 通过。
- legacy proof 每项与 relocated config proof 均无条件 reconcile：source 存在则安全归档；source 缺失只接受安全 `0600`、同 owner、单 hardlink且 hash 匹配的 destination；both absent、dangling 或 unsafe source 均保持 same-epoch recovery。legacy/relocated missing-source 与 dangling `4/4`，post-archive resume、between-artifact crash 与 rollback provenance 回归均通过。

主代理合并定向：Runtime/Config/API `71 passing`；setup 第一次合并运行中一个既有 candidate-publication race case 单次失败，但立即单测 `1/1` 与完整相邻并发序列 `7/7` 均通过，未修改代码；最终根全集中该 case 再次通过。最终 `npm test` 为 `229 unit test files passed`，setup state-machine `112 passing (9m)`，日志 `/tmp/bili-qq-bot-npm-test-r2-third-fix-final-20260711.log`。Dashboard lint/build、Python `3 tests OK`、ShellCheck `0 warnings`、`bash -n`、`docker compose config -q`、`git diff --check` 均通过。冻结真实文件 hash 仍完全不变。

本节仍只构成 R2 冻结基线；三路 reviewer 必须重新确认 18.21 的生产恢复、claim journal 与 archive durability/provenance 均无遗漏，全部明确 PASS 后才能进入 auditor。

### 18.23 R2 第四次打回

18.22 复核中 migration/security 已明确 PASS，但 correctness 与 deployment 各发现 1 个 P1：

- correctness/lifecycle：pending recovery 内部链与 token fence 正确，但生产入口不可达。recovery-required 时 application admission gate 必然关闭，Dashboard listener 在 Express/auth/router 前除 `/api/live` 外统一返回 503，因此 `POST /api/config/recover` 永远无法触发；Unix config control socket 和 CLI 也没有 recover action。必须让严格 method/path 的 recovery 请求穿透 listener gate、仍经过原 auth+CSRF，其他 API 继续 503；增加真实 listener HTTP test，覆盖未认证/CSRF拒绝、合法 recover 使用 transferred token 成功 reopen、其他 API 保持关闭。
- deployment：publication cleanup 第一轮虽全量验证，但第二轮逐项验证后立即 unlink；若后序路径在第二轮替换，会先删除前序路径，违反 all-or-nothing。第二轮也缺少完整 lstat/open-fd dev/ino 对比，close 到 unlink 仍有 pathname replacement 窗。必须采用 journaled 原路径 claim/quarantine 或等价 dirfd/inode-safe 协议：任何删除前先全量验证，将每项以 no-replace/identity-checked rename claim 到 attempt-private quarantine，journal 状态支持 crash resume；冲突恢复/保留所有未知字节。补第二/第四路径替换、lstat→open、open→unlink 与每次 unlink 间 crash fixtures，断言无 partial cleanup。

18.22 migration/security PASS 保留，但 R2 仍为 FAIL；上述两项修复、定向与全量冻结后需由 correctness 和 deployment reviewer 再次明确 PASS。

### 18.24 R2 第四次打回修复与最终冻结

18.23 的两个 P1 已修复：

- Dashboard listener 在 gate closed 时只允许严格 `POST` 且 origin-form raw pathname 与 WHATWG pathname 都精确等于 `/api/config/recover` 的请求穿透到原 Express 链；absolute-form、`//`、尾斜杠、编码路径、dot normalization、GET 与其他 API 均继续 503，WebSocket 不放宽。穿透请求仍依次经过 CSRF、API logger、JWT auth 与 config router。真实 `createListener` test 关闭 singleton gate，证明其他 API/GET/变体 503、未认证 exact recovery 401、合法 JWT + 恶意 Origin 403、合法 Bearer/Origin 调用 recovery 并用 transferred token reopen 后返回 200。listener + config API 定向 `16 passing`，无 `--exit` 自然退出。
- publication cleanup 改为两个 journal 绑定的 attempt-private `0700`/current-owner quarantine（install 与 setup-state 各一），journal 记录目录 dev/ino/state。四个 original 先全量 anchored 验证，再逐项原子 rename claim，每步 atomic journal + file/parent fsync；四个 claim 全量 `O_NOFOLLOW` open/fstat/hash并保持 fd，完成全量 late inode 验证后才 unlink，每次 unlink 再 journal/fsync。状态机可 reconcile rename-before-journal 与 unlink-before-journal；ownership quarantine 整目录在 rollback data restore 前按同 inode stash/restore。不存在 close-fd→公开 pathname unlink 窗口，claim 只位于私有 namespace。
- pathname replacement fixtures 覆盖 lstat→open 第 2/4 路径、open→claim 第 2/4、claim→unlink 第 2/4，共 `6/6`，均证明四项无 partial cleanup且未知字节保留；crash/resume 覆盖 after-claim 1..4 与 after-unlink 1..4，共 `8/8`。既有 Compose/ownership publication race 回归 `2/2`；移除了 journal 后旁路手工 rm candidate，统一进入 quarantine。

主代理合并定向：listener/API `16 passing`，publication 关键回归 `7 passing`，ShellCheck `0 warnings`、`bash -n`、`git diff --check` 通过，日志 `/tmp/bili-qq-bot-r2-fourth-fix-targeted-20260711.log`。最终根 `npm test` 为 `229 unit test files passed`，setup state-machine `126 passing (11m)`，日志 `/tmp/bili-qq-bot-npm-test-r2-fourth-fix-final-20260711.log`。18.22 migration/security PASS 继续有效；correctness 与 deployment reviewer 必须对本节修复再给出明确 PASS，R2 才能闭环。

### 18.25 R2 第五次打回

18.24 correctness/lifecycle 已明确 PASS，18.22 migration/security PASS 继续有效；deployment/UI reviewer 对 quarantine 主 cleanup 的 private namespace、full validation、fd-held unlink、6 race 与 8 crash/resume 均确认闭环，但发现 rollback 外围状态机仍有 1 个 P1：

- 全量 data restore 前，ownership candidate/claim/quarantine 通过路径级 `mv` 移到 install 下 deterministic stash，restore 后再移回；该 stash/restore 没有纳入 publication journal、没有 anchored identity 校验、每次 rename 后未 fsync 两侧父目录、没有逐步 checkpoint 或 rename-before-journal reconcile。任一 stash、data delete/copy 或逐项 restore 间 crash 会因遗留 stash 而无法自动续跑，也可能使需要保留的 unknown replacement bytes 失去可靠位置。
- 两个 quarantine 目录当前先 `mkdir`，全部完成后才首次写 journal；任一 mkdir 后 crash 会留下无 journal 的 `0700` 目录，重跑因 EEXIST fail 而无法证明/续跑。

必须把 quarantine create、ownership stash、data delete/copy 与逐项 restore 全部纳入同一 journaled identity state machine：每个对象以 anchored `lstat/O_NOFOLLOW/fstat` 验证 dev/ino/type，每次 rename 后 fsync source/destination parent并原子写 journal，支持 rename-before-journal reconcile；未知/冲突 stash 不覆盖。补 quarantine-create 1/2、stash 1..3、data-delete、restore 1..3 前后 crash/resume，并验证 journal 目录 identity 与 unknown bytes 不丢失。该项关闭前 deployment/UI 仍为 FAIL，不能进入 auditor。

### 18.26 R2 第六次打回、恢复状态机重构与当前复核基线

18.25 的 quarantine/stash 修复完成后，主代理先复验 stale apply、relocation fsync crash 与 invalid relocation Compose，三项 `3 passing`；实现者相邻 claim/unlink/restore 组合 `10 passing`。随后三名未参与该修复的全新 reviewer 重新检查完整 diff，仍一致判定 R2 `FAIL`，补充发现以下 crash-safety 阻断项：

- publication journal 缺失不能等同“从未 publication”。candidate、claimed、quarantine、restore workspace、journal temp 或已经进入 publication-capable checkpoint 任一存在时，missing/corrupt/symlink/unsafe journal 必须 fail closed；不得走普通 `rm -rf data` 快照恢复而删除无法证明归属的并发字节。
- publication 阶段 live Compose/ownership rename 到 claimed 前缺少 durable transition intent；rename 后、journal 前崩溃时无法自动 reconcile。restore 阶段 stash rename 回 destination 后、journal 前崩溃也不得学习一个并发替换的未知 inode，必须严格匹配原 stash identity。
- data snapshot 递归复制中途崩溃后，不能因目标顶层已存在而跳过残缺树并标记 copied；恢复内容必须在私有 staging 中完整复制、递归 fsync、验证后原子发布。config/log/NapCat/font 等恢复树也必须在推进 rollback checkpoint 前递归 fsync。
- authoritative publication journal 的 external/restored copy 必须使用私有原子 `0600` writer（temp file fsync、rename、parent fsync），workspace 删除必须 journaled、可续跑；cleanup 的 missing-journal namespace 检查必须包含 quarantine 与两个 workspace。

setup 状态机已按上述证据重构：attempt 先原子持久化并验证 typed `publication-intent.json`，随后 publication journal 记录 claim pending/identity；Compose 与 ownership claim 的 before/after-rename 窗口均可按 dev/ino/hash reconcile。rollback 使用 install 与 data/setup-state 两个 attempt-private `0700` restore workspace，workspace 自身 identity、stash、data staging/publish、逐项 restore、terminal intent/journal 删除和 workspace cleanup 全部进入原子 journal；恢复树先 `sync_tree`，data 通过临时 candidate 完整持久化后发布；外部 journal replacement、unsafe intent、unknown namespace 和 identity 冲突均保留原字节并 fail closed。

新增故障注入覆盖：双 workspace 预占、mkdir 后续跑与 inode replacement；journal missing/symlink/0644；intent corrupt/symlink/0644/hardlink/fifo/wrong-attempt/wrong-kind；Compose/ownership claim before/rename-before-journal；terminal intent/journal 清理；双 workspace 清理；external journal symlink/0644/hardlink/inode replacement；stash 1..4、data delete/staged publish、restore 1..4 前后崩溃续跑。主代理独立运行上述组合为 `52 passing (12m)`；`bash -n setup.sh`、ShellCheck warning 级别与 `git diff --check` 通过。此前同一轮、但早于本次最终重构的根基线为 `229 unit test files passed`、setup `149 passing (18m)`，不能替代重构后的新根全量冻结。

当前门禁：必须由三名全新、未参与实现的 reviewer 基于本节代码、完整 diff、方案与 `52 passing` 证据分别复核 correctness/lifecycle、migration/security、deployment/UI；三路全部明确 `PASS / no known bug / no omitted acceptance item` 后，重新执行根 `npm test`、Dashboard lint/build、Python venv、ShellCheck/bash、Compose、容器 health、真实文件 hash 与生成物/Secret 扫描，最后才可进入第 14 节 14 项 auditor 矩阵。

### 18.27 R2 第七次打回与 pre-publication/data publish 恢复闭环

18.26 后三名全新 reviewer 中 migration/security 明确 PASS，但 correctness 与 deployment 仍判定 FAIL，发现 3 类 P1：

- publication data candidate 虽完整复制与 `sync_tree`，但顶层 entry 逐项 rename 到 live data 时没有 per-entry journal；任意两个 rename 间崩溃会在重入时因 destination 已存在而退出，无法自动完成 rollback。candidate 本身也未绑定 dev/ino 与 snapshot inventory。
- publication intent 前的普通 rollback 仍把 attempt 临时复制到随机 `/tmp`，再删除 live `data/` 并回拷；删除或复制中再次崩溃会同时失去 active attempt/snapshot 的 durable locator，无法自动续跑。
- publication cleanup 对 journal state=`original` 且 original/claim 同时缺失的情况直接学习为 removed；合法协议中任何 unlink 前都必须先持久化 claimed，因此该无证据消失必须 fail closed。

修复后，publication restore journal 绑定 `dataCandidate` 的 dev/ino 与 snapshot fingerprint，并为每个顶层 entry 记录 name/type/dev/ino/subtree fingerprint、`pending -> published`；每次 rename 后 fsync source/destination parent，再原子推进 journal。pending 重入只接受与原 proof 完全一致的 destination；candidate inode replacement 与无证据 original disappearance 均保留 active attempt并 fail closed。

pre-publication restore 已移除随机 `/tmp` 路径，改为 `data/setup-state/<attempt>/prepublication-data-restore` 同文件系统、attempt-private transaction。`0600` journal 与 `0700` workspace/candidate/discard 绑定 uid/dev/ino；live entry stash、snapshot entry publish、discard entry 删除及 candidate/discard/workspace 删除均有逐项状态、identity/fingerprint、双父目录 fsync、原子 journal 与 rename/delete-before-journal reconcile。恢复完成后 workspace 按 journal 可续跑清理，snapshot 外业务 inventory 必须与升级前 byte-identical。

新增验证：pre-publication workspace、首/中/末 live stash、snapshot publish、discard cleanup、candidate/discard/workspace cleanup 的 before/after crash-resume 共 `25 passing (4m)`；publication per-entry publish、candidate inode replacement、original disappearance fail-close 共 `11 passing (2m)`。`bash -n setup.sh`、ShellCheck warning 级别 `0 warnings`、`git diff --check` 通过。以上仍只是新复核基线；必须重新进行三路独立 reviewer，并在全部 PASS 后从头冻结根全量与其余门禁。

### 18.28 R2 第八次打回

三名全新 reviewer 检查 18.27、完整 diff 与 crash fixtures 后均判定 FAIL。本轮确认的 setup P1 为：

- publication restore 在删除 live data 时仍是阶段级整批 `rm`，没有逐 entry identity/fingerprint、`pending/deleting/removed` journal；未知或迟到替换可能被静默删除。
- prepare 重入把已 restored 的 ownership source rename 回 stash 后才写 journal，rename-before-journal 崩溃无法收敛；ownership live hardlink detach 也先 unlink、后记录 detached，存在等价 delete-before-journal 窗口。
- pre-publication candidate/discard 目录 mkdir+parent fsync 后才首次写 journal；崩溃后目录已存在、journal 无 identity，重入只能失败。deterministic `.next` journal temp 被无条件 unlink，可能删除 unknown bytes；journal 读取先验证后关闭 fd，再 pathname 读取，存在身份脱锚。
- pre-publication snapshot 在生成 candidate 和删除 discard 前未绑定 dev/ino/recursive fingerprint，也未先验证 rollback inventory；损坏 snapshot 可能先被发布、正确 live bytes 已删除，之后才发现 mismatch。
- publication claim cleanup 最终仍是 `late lstat -> pathname unlink`；替换发生在两者之间时会删除 unknown inode。必须先原子转移到 attempt-private terminal/rescue，再验证转移 identity，冲突保留并 recovery-required。

deployment/UI reviewer 另发现 Dashboard recovery 操作闭环缺失：后端已有认证、CSRF 保护的 `POST /api/config/recover`，但状态组件不展示 `recovery-required`、失败阶段或脱敏原因，普通 reload/save 仍可操作，也没有串行 recovery 按钮、失败重试和 generation/status 刷新测试。Provider residual recovery 在生产 UI 中因此不可操作。

可执行修订：setup 所有 mkdir/rename/unlink/rm 必须先持久化 typed intent，再按 recorded dev/ino/hash 与两侧布局 reconcile；live data 删除逐 entry journal；snapshot 在任何 live mutation 前和 discard cleanup 前验证持久 inventory/fingerprint；journal 使用随机私有 `O_EXCL` temp、同一 `O_NOFOLLOW` fd 验证/读取；claim terminal delete 使用私有 rescue rename。Dashboard 在 recovery 状态展示脱敏详情、禁用普通 mutation/reload、提供防重复的 recover action，并在结果后重新获取同 generation 配置/status。

上述问题按互斥所有权打回 setup/test 与 Dashboard/test 两个 implementer。全部修复、定向验证和三路重新复核前，R2 保持 FAIL。

### 18.29 R2 第八次打回修复与第九轮复核基线

18.28 的 setup 阻断项已统一修复：publication live data 删除使用逐 entry type/dev/ino/fingerprint proof 与 `pending -> deleting -> removed` journal；未知、替换或无证据消失 fail closed。ownership live detach、restored source 回 stash、claim terminal cleanup 均改为 mutation 前持久 intent，并按 source/stash/terminal 两侧 identity reconcile。claim 不再 `late lstat -> pathname unlink`，而是先 rename 到 attempt-private terminal，验证搬入 inode/hash、原子写 journal后再 unlink；terminal rename、journal 与 unlink 各窗口可续跑。

pre-publication candidate/discard 使用 `pending -> active` mkdir 状态；journal 写入使用随机 private `O_EXCL` temp，deterministic unknown temp 原样保留并 fail closed；authoritative journal 通过同一 `O_NOFOLLOW` fd 完成 fstat、读取与解析。snapshot 在任何 live mutation 前绑定 dev/ino 与递归 fingerprint，并在 discard cleanup 前复核；损坏或替换 snapshot 不得删除 live/discard 正确数据。

主代理独立运行新增矩阵：candidate/discard mkdir、claim terminal before/rename-before-journal/after-journal、live data delete before/after 共 `20 passing (4m)`。实现者此前 pre-publication 27 项、publication per-entry/candidate/original disappearance 11 项均通过；`bash -n setup.sh`、ShellCheck warning 级别 `0 warnings`、`git diff --check` 通过。

Dashboard recovery UI 已落地：显示 recovery-required、阶段与结构化脱敏 code/reason，recovery 状态下禁用普通保存/reload及相关配置 mutation；恢复按钮串行去重调用现有认证+CSRF `POST /api/config/recover`，失败保留可重试状态，成功后重新获取同 generation config/status。错误投影不接纳任意 message/error，Secret hydration 仍为空。Dashboard recovery/snapshot 定向 `10 passing`，lint/build 通过，仅有既有 Browserslist、第三方注释和 chunk-size warning。

本节仅构成第九轮 reviewer 基线。三名全新 reviewer 必须检查当前完整 diff、方案和上述证据并全部明确 PASS，之后从头重跑根全量及全部最终门禁。

### 18.30 R2 第九次打回

第九轮三路 reviewer 再次全部判定 FAIL，setup 尚有 4 个 P1：

- prepare 重入把已 restored source rename 回 stash 后才更新 journal，rename-before-journal 崩溃后 `restoreItem=restored` 与 destination 缟失/stash 存在无法收敛。
- ownership hardlink detach 虽先写 pending intent，但验证 live/candidate 后仍 pathname unlink；验证与 unlink 间 replacement 会删除 unknown inode。
- publication live data 虽逐 entry journal并校验 recursive fingerprint，但仍 `validate(pathname) -> rmSync(pathname, recursive)`；顶层或 descendant 在末端窗口被替换/新增时会删除未知 bytes。
- pre-publication discard entry 的 `pending` 删除校验完整 fingerprint，但 crash 后 `deleting` 重入只校验 type/dev/ino；同 inode 原地改写会被静默删除。

统一修订要求：所有 live/discard 删除先持久化 move intent，再把 recorded object 原子 rename 到 attempt-private quarantine/terminal，fsync 双父目录，验证搬入 object 的 dev/ino/recursive fingerprint并写 journal；只有隔离且 identity/fingerprint 仍匹配后才删除。restored->stash 使用 `restashing` 状态，rename 前 journal，按 source/stash 两侧布局 reconcile。任何 replacement、descendant mutation、无证据消失均保留 unknown bytes并 recovery-required。

Dashboard recovery 功能链未发现新 bug，但当前 disabled、错误展示、点击和失败重试主要由源码 regex 与纯 coordinator 测试证明，缺少真实 React 渲染/交互测试。需以组件测试覆盖 recovery 状态渲染、各 mutation disabled、重复点击单 POST、失败显示与 retry 成功刷新。

上述修复完成、定向验证和新的三路全量 diff reviewer 前，R2 保持 FAIL。

### 18.31 R2 第九次打回修复与第十轮基线

18.30 的四个 setup P1 已按统一私有隔离协议修复：restored source 回 stash 先持久化 `restashing` intent，再按 source/stash identity 与两侧布局 reconcile；ownership live hardlink 不再 pathname unlink，而是先 rename 到 attempt-private terminal、fsync 双父目录、验证 inode/hash/lineage并写 journal后删除。publication live data 与 pre-publication discard 都逐 entry 记录 move/delete state，先原子搬入 attempt-private quarantine、复核 recursive fingerprint，再隔离删除；`deleting` 重入也必须完整 fingerprint 匹配，replacement 或同 inode mutation均 fail closed。

实现者定向验证覆盖 pre-publication discard cleanup before 与 rename-before-journal、publication live delete before 与 rename-before-journal、ownership detach seeded rollback，共 `5 passing (55s)`；`bash -n`、ShellCheck warning `0`、`git diff --check` 通过。

Dashboard 新增真实 jsdom + React Testing Library 测试栈，3 个测试文件/5 个交互测试覆盖 recovery-required code/phase 与脱敏、Settings mutation disabled、重复 recover 单 POST、失败展示与 retry、成功后同 generation config/status hydration。Dashboard `npm test`、lint、build 均通过；只新增 dev test dependencies，`npm audit` 报告的现有依赖树 6 个 vulnerability 不在本任务内自动修复，最终报告需披露。

本节仍只是第十轮 reviewer 基线；必须三路全新 reviewer 全部 PASS 后才能从头冻结完整测试与最终审计。

### 18.32 R2 第十次打回

第十轮三路 reviewer 仍判定 FAIL。setup 阻断项包括：主 `write_publication_journal` 与 claim writer 仍 pathname 读取 authoritative journal、使用 deterministic `.tmp/.claim-next`，前者会无条件删除 unknown bytes，后者 crash 后无法 reconcile；ownership detach terminal unlink 缺 `deleting` intent；restash 只校验 dev/ino，未校验 file hash/dir recursive fingerprint；pre-publication/publication quarantine 在最终 fingerprint 校验后仍 pathname recursive rm，存在顶层/descendant 同 UID 末端竞态；publication data candidate deterministic `.tmp` 也会无 proof 递归删除。

setup 必须统一采用安全 fd 读取、随机 private `O_EXCL` temp、unknown deterministic temp fail closed；terminal 删除先持久 `deleting`；restash 保存并验证完整 fingerprint；隔离对象通过 anchored recursive deletion（dirfd/openat/unlinkat 等价）逐 descendant identity/proof 删除，不能重新解析公开 pathname；candidate temp 必须 journal 绑定或随机私有。

deployment/UI reviewer 发现 recovery UI 的真实生产入口仍不可达：closed admission listener 只放行 `/api/live` 和 exact `POST /api/config/recover`，静态 SPA、`GET /api/config` 与 `GET /api/config/status` 均 503；Settings 新开/刷新无法渲染 recovery UI。React 测试却 mock 这些 GET 成功，未覆盖真实合同。必须提供最小 recovery bootstrap：允许静态恢复 UI 与严格认证、只读、脱敏的 config/status 通路穿透 closed gate，或独立不依赖普通 API 的恢复页面；其他 API/WebSocket 继续关闭，recover 仍经 JWT/CSRF。新增真实 listener + React 集成测试。

上述修复完成并重审前，R2 保持 FAIL。

### 18.33 R2 第十次打回修复与第十一次基线

setup 已完成统一安全协议：authoritative publication/claim journal 使用同一 `O_NOFOLLOW` fd 做 lstat/fstat、owner/mode/nlink 校验与读取，写入使用随机 private `O_EXCL` temp；deterministic `.tmp/.claim-next` 或未知 data candidate temp 一律保留并 fail closed。ownership terminal 删除增加 durable `deleting` intent；restash proof 包含 file hash 或 directory recursive fingerprint。

pre-publication discard、publication live-data quarantine 与 claim terminal 删除均改用 Python `dir_fd` anchored helper，逐 descendant 以 `openat/stat/unlinkat/rmdir(dir_fd)` 等价协议校验和删除，避免最后 pathname re-resolution。fault fixtures 覆盖顶层 replacement、同 inode write、descendant add/replace。data candidate 使用随机 journal-bound path，并对 mkdir/ready/rename-before-journal crash 做 identity reconcile。

新增 race/fault 全部通过，关键历史组合 `8 passing`；`bash -n`、Node syntax、Docker ShellCheck warning `0`、`git diff --check` 通过。

Dashboard recovery bootstrap 已实现：closed gate 仅放行 GET/HEAD 的 SPA recovery shell、flat assets、严格 exact `/api/config` 与 `/api/config/status`；两只读 API 仍经过 JWT 且 Secret 脱敏，recover POST 仍经 JWT+CSRF，其他 API/temp media/WebSocket 保持关闭。Settings 先取一致 config/status，仅 recovery 状态容忍非 bootstrap API 的 503。真实 listener/backend `26 passing`，Dashboard Vitest 3 files/6 tests、lint/build 通过。

本节仍是第十一次 reviewer 基线；三路全新 reviewer 全部 PASS 前不得运行最终 auditor。

### 18.34 R2 第十一次打回与终态保留策略

第十一次 migration/security reviewer PASS，但 correctness 与 deployment 仍 FAIL。根因是 POSIX `unlink/unlinkat(name)` 不提供“仅当 pathname 仍指向已验证 inode 时删除”的原子 compare-delete；即使持有旧 fd/dirfd，final stat 到 unlink 之间仍可能被 same-UID replacement。external journal、intent、authoritative journal、quarantine root/child 与 anchored recursive deletion 都存在同类最后窗口。

因此终态策略改为不删除安全敏感对象：已 claim 的旧 live data、publication artifact、quarantine、intent/journal 与 restore discard 只原子 rename 到 attempt-private `0700` vault，验证搬入 identity/fingerprint并写 terminal manifest，随后保留为受保护 rollback/recovery archive；任何 replacement 只会被搬入/保留，不会被 unlink。vault 由 attempt/releaseEpoch 唯一绑定，状态机不再以删除为完成条件。后续容量治理必须另做显式、人工授权的安全清理，不属于自动 upgrade rollback。

Dashboard closed-gate recovery 还有生产入口缺口：无 JWT/过期 JWT 时 `POST /api/login` 被 gate 拒绝；登录成功固定跳 `/`，不能进入 recovery Settings；CSRF 默认 origin 使用 container `dashboard.listenPort` 而非外部 `deployment.ports.dashboardHost`，自定义 hostPort 同源请求会 403。需开放严格 exact closed-gate login（仍走原 rate-limit/auth），登录后 recovery 模式跳 Settings；CSRF 接受规范化且 Host/Origin 严格同源的实际请求 host，同时恶意 Origin继续拒绝。新增真实 listener 无 token→login→config/status→recover、自定义 hostPort 与过期 JWT测试。

上述两组修复、验证与新 reviewer 前，R2 保持 FAIL。

### 18.35 R2 第十一次打回修复与第十二轮基线

setup publication/rollback 终态已改为 retention vault：pre-publication discard/live data、publication artifact、quarantine root、intent、authoritative/external journal 与 restore workspace 均原子保留到 attempt-private `retained-vault`，不再自动 unlink/rm/rmdir。vault dir/file 强制 `0700/0600`；inventory 绑定 attemptId、releaseEpoch、原路径、retained path、type、dev/ino、source/retained fingerprint与 disposition。replacement race 只会搬入并保留 unknown bytes，记录 unknown 并 recovery-required；resume 可从 retained journal/vault 继续。rollback 成功不再要求 workspace/quarantine 为空。

vault 关键组合 `9 passing (2m)`，ownership/data retention `3 passing (36s)`，完整 vault inventory/resume `1 passing (12s)`；`bash -n`、ShellCheck warning `0`、`git diff --check` 通过，真实冻结文件 hash 未变化。setup 单文件全量和根 `npm test` 尚未重跑。

Dashboard closed gate 严格放行 exact `POST /api/login` 进入原 auth/rate-limit；登录响应包含 recoveryRequired/redirectPath，前端 recovery 模式进入 Settings。CSRF 保留 configured allowedOrigins，并接受经过严格 scheme/hostname/port 解析且 Origin 与实际 Host 同源的请求，支持自定义 dashboardHost，恶意/malformed Origin仍拒绝。真实 listener 测试覆盖无/过期 JWT、错误密码、恶意 Origin、自定义 8123 同源登录、脱敏 config/status、recover、其他 API 503 与 WebSocket 1013。backend `12 passing`，Dashboard Vitest 4 files/8 tests、lint/build通过。

本节为第十二轮 reviewer 基线。三路全新 reviewer 全部 PASS 后才可执行最终全量冻结与 auditor。

### 18.36 R2 第十二次打回

第十二轮三路 reviewer 一致判定 setup FAIL，Dashboard closed-login/hostPort recovery 链明确 PASS。setup 剩余 3 个 P1：

- legacy/relocated `secure_archive_file` 最终仍是 compare/hash 后 pathname unlink，未纳入 retention vault；同 UID late replacement 可被误删。必须先 rename 到 attempt-private archive vault，验证搬入 identity/hash并记录 inventory，绝不自动 unlink。
- vault `hardenTree` 未递归拒绝 `nlink > 1`，可能把 vault 外可达 hardlink 当作私有对象，并通过 chmod 改变外部 inode 权限。vault admission/resume 必须递归验证 owner、type、mode、nlink；对合法内部双链接需安全复制断链或 fail closed，外部 alias 权限/bytes不得改变。
- retention+snapshot+candidate 使峰值接近 3x data，但 runtime mutation 前没有按文件系统的容量/inode preflight。必须用 statfs 与实际 allocated bytes 按 device 计算 snapshot/candidate/temp/vault保守峰值和 reserve；空间不足在 stop writer/data mutation前 typed fail closed。resume复制阶段重验，ENOSPC保留live/journal可续跑；inventory记录 retained bytes并文档化人工清理。

上述三项修复、fault fixture与新 reviewer 前，R2 保持 FAIL。

### 18.37 R2 第十二次打回修复与第十三轮基线

legacy/relocated secure archive 已纳入 retention：durable intent、同 filesystem rename、双父目录 fsync、搬入 inode/hash验证、retained inventory，不再 unlink source pathname。archive intent/source-rename crash 可续跑。

vault hardlink admission 会在 chmod 前递归校验 owner/type/nlink；`nlink > 1` 的已知对象通过 fd 读取、private `O_EXCL` copy、file/parent fsync生成独立 inode后进入 vault，外部 alias bytes/inode/mode不变。direct 与 nested external hardlink fixtures均证明 alias 0644不变，vault copy nlink=1/0600。

setup 在 runtime stop/data mutation前使用 statfs 按 device 计算 allocated live/snapshot/candidate/temp/retention 的保守 3x 峰值、inode与 reserve；不足空间 typed fail closed且零 runtime/data mutation。resume copy阶段重新验证。candidate durable copy 后、restoreEntries journal 前崩溃会以 snapshot names+recursive fingerprint补写 proof并续跑。

验证：secure archive/capacity `10 passing (1m)`，candidate/vault resume `3 passing (36s)`，hardlink+vault resume `3 passing (25s)`；`bash -n`、ShellCheck warning `0`、`git diff --check` 通过。README 已说明 retained vault 与人工清理。

本节为第十三轮 reviewer 基线；三路全部 PASS 后才从头执行 setup 全集、根全量与 auditor。

### 18.38 R2 第十三次打回

第十三轮三路 reviewer 均判定 FAIL，问题收敛到 archive 控制平面与 resume capacity：

- deterministic archive intent 已存在时未验证 owner/mode/nlink/attempt/epoch/source/destination，终态仍 pathname unlink，且未进入 retained inventory。
- archive destination 使用 pathname lstat/read/chmod，存在 verify→chmod replacement；vault inventory pathname read+无条件 rename 覆盖，缺 O_NOFOLLOW fd、私有权限、attempt/release/path containment、generation/inode CAS，并发可丢 retained records。
- capacity preflight 只在新 upgrade/apply 前执行；resume_active_attempt 与 rollback/candidate/archive copy/断链阶段未重验容量/inode，方案 18.37 的 resume ENOSPC 承诺没有实现/fixture。

必须把 archive intent/destination/inventory 全部复用 typed private retention transaction：同 fd校验/read/fchmod、identity/hash/path containment、generation CAS、unknown replacement保留；intent也 retained不删除。所有 resume copy/断链入口按 journal remaining work重验目标 filesystem容量/inode，ENOSPC typed recovery-required且可再次续跑。补 intent/inventory unsafe/replacement、destination verify→chmod、initial-pass→resume-low-space fixtures。

修复与新 reviewer 前，R2 保持 FAIL。

### 18.39 R2 第十三次打回修复与第十四轮基线

secure archive 控制平面已重构为 typed private transaction：active/completed intent 校验 version/kind/attempt/release/scope/source/destination/dev/ino/hash/transactionKey，要求 owner、0600、nlink=1，并以同一 O_NOFOLLOW fd读取。完成 intent rename到 retained-vault/archive-control/completed并进入 inventory，不再 unlink。destination 使用同fd read/fchmod与late identity；replacement fail closed。inventory 增加 generation，0600/O_NOFOLLOW读取，写前 inode+hash CAS，竞争替换不覆盖。

capacity/inode preflight 已加入 runtime_released/runtime_ready resume、pre-marker rollback、restore_snapshot与每个 archive/copy/断链入口；resume low-capacity typed recovery-required，可再次续跑。README同步 retained vault与人工清理。

验证：archive 新/关键组合 `11 passing (1m)`，原三回归+rollback inventory `4 passing (56s)`；`bash -n`、ShellCheck warning `0`、`git diff --check` 通过。

本节为第十四轮 reviewer 基线；三路全部 PASS 后才开始最终全量冻结与 auditor。

### 18.40 R2 第十四次打回

第十四轮三路 reviewer 判定 FAIL，并发现两个 P0：archive destination/completed intent 使用 `stat -> rename`，可覆盖间隙出现的 unknown object；inventory inode/hash检查后仍无条件 rename temp，所谓 CAS 非原子。completed intent 还在关闭安全 fd 后 pathname重读，验证证明脱锚。必须使用真正 no-replace publication（link/O_EXCL copy或平台安全 helper）与 owner lock+generation transaction，任何 replacement 保留且 recovery-required；安全 fd metadata/digest直接进入 inventory，不 pathname重读。

Runtime P0/P1：ServiceManager 在新 Python candidate 已 commit/admission 后才 terminate old child；old retire失败时没有 post-commit residual journal/retry，candidate/old/generation状态可能错位。必须把旧 child retirement纳入可恢复状态：admission保持关闭直到 retire成功，或记录 typed residual并提供串行 retry，失败不暴露错误 handle；补 old-child termination failure与恢复测试。

migration/security 另指出 data registry rollback_complete仍 pathname unlink journal。需明确安全敏感 journal采用 identity-safe retention/terminal协议，不能与18.34全局策略冲突。

三条互斥实现线完成和重审前，R2 保持 FAIL。

### 18.41 R2 第十四次打回修复与第十五轮基线

archive destination 与 completed intent 使用同 filesystem hardlink no-replace 发布，校验两端 inode/nlink/hash后才推进；inventory 使用私有 owner lock（含安全 stale reclaim）、generation+inode+digest transaction、随机 O_EXCL temp与锁内二次 CAS。completed intent inventory metadata直接来自安全 fd。新增 destination/intent/inventory 三个精确 race fixtures `3 passing`，archive关键回归 `15 passing`。

ServiceManager 跨端口切换改为 candidate staged、ingress/admission保持关闭，先 terminate old并等待真实 exit，再二次健康检查 candidate，最后原子发布 config/resourceGeneration/process/activeIdentity。old retire失败不发布 candidate，不暴露终止中 handle，可健康 reclaim old且不 spawn第二 child；定向 `19 passing`。

data registry rollback_complete journal 改为 retained terminal：0700 parent/0600 attempt-bound file，安全 fd捕获active bytes/stat，O_EXCL发布；terminal durable后再次验证active dev/ino/mode/nlink/digest才移除active，late replacement保留fail-close。完整 data-registry `26 passing`。

静态门禁通过。此节为第十五轮 reviewer 基线，三路全部 PASS 后才执行最终全量冻结。

### 18.42 R2 第十五次打回

第十五轮三路 reviewer 判定 FAIL。setup archive source、completed/active intent、owner lock与 data registry active journal仍在安全校验后 pathname unlink，存在 late replacement误删。archive inventory虽然有二次检查，最终仍覆盖式 rename；publication vault intent/journal目的端也会被 rename覆盖，source identity未在搬入前锚定；publication vault manifest无 owner lock/generation/inode+digest CAS。

修订策略：所有终态对象采用 append-only/no-replace generation或 rename-to-private-retained claim，绝不 pathname unlink/覆盖；source先原子搬入唯一private claim再验证，unknown保留。inventory/manifest写新 generation O_EXCL，reader扫描并验证连续generation，不维护可覆盖current文件；owner lock终态retain/rename，不unlink。补每个final-check→mutation race。

Dashboard 把所有 `CONFIG_RELOAD_ERROR` 当 recovery-required，可能在完整回滚的普通应用失败后错误锁死UI。后端错误响应必须携带真实 typed `recoveryRequired/pendingRuntimeRecovery`，前端只在明确 required=true时进入恢复状态；补 rollback成功不进入恢复测试。

修复和新review前，R2保持FAIL。

### 18.43 R2 第十五次打回修复与第十六轮基线

setup archive source 先原子搬入唯一private claim再验证/发布；archive与publication vault inventory改为连续 generation 的 append-only O_EXCL文件，reader扫描验证；archive owner lock终态rename-retain不unlink。publication intent/journal使用no-replace retained目标。新增archive final-check与publication race，archive `3 passing`、publication `2 passing`。

data registry active rollback journal先rename到0700 attempt-private claim，搬入后验证0600/nlink1/dev/ino/bytes/typed fields；terminal O_EXCL append-only，claim不unlink。完整registry `27 passing`。

Dashboard backend错误响应携带真实typed recoveryRequired/pendingRuntimeRecovery，前端只required=true锁UI，普通CONFIG_RELOAD_ERROR完整回滚不误判。Dashboard全量4 files/10 tests、backend组合14 passing。

静态门禁通过。本节为第十六轮reviewer基线。

### 18.44 R2 第十六次打回与修复

第十六轮 correctness 发现 archive destination、publication claim terminal、vault intent 与 vault journal仍残留 `absent check -> renameSync` 覆盖窗口；另两项 same-inode race测试失败经主代理复现，确认是 fault hook 对目录新增descendant却断言同inodemarker的测试不一致，已改为在既有文件inode原地append并 `2 passing`。

四类终态普通文件发布现统一为 hardlink O_EXCL no-replace，验证source/destination同 inode后移除source namespace并fsync双父；冲突保留双方fail-close，crash后source/dest双路径可收敛。新增claim/intent/journal final-window fixtures，archive既有fixture继续通过；相关定向与静态门禁通过。

本节为下一轮reviewer基线。

### 18.45 用户接受的 setup 崩溃边界与最终复核口径

用户于 2026-07-11 明确决定：不再继续打磨 `setup.sh` 升级过程中极端进程崩溃、同 UID 并发 namespace replacement 与终态 no-replace 的剩余边界；若最新 review 未发现配置、迁移、Secret、运行时热重载、Dashboard/API、正常安装升级回滚或测试方面的其他问题，可视为完成。

因此后续 reviewer/auditor 将这些 setup crash-only 竞态列为 accepted residual risk，不再作为阻断项；正常成功路径、显式失败回滚、数据完整性、权限、Secret、Compose CAS、health gate 与幂等仍必须通过。已稳定通过的 crash/resume fixtures 继续保留；若精确 fault-injection 仅证明本节已接受的进程中断窗口，可在测试中以本节编号和原因标记 pending，不再修改生产 setup 状态机追求自动收敛。用户此前接受的 legacy-v0 首次 cutover in-flight 极小概率重复/漏推例外继续保留，且不得扩散。

### 18.46 最终独立 review、普通路径修复与冻结基线

按 18.45 口径停止扩展 setup crash-only 边界后，三路 reviewer 重新检查完整 diff、当前方案与定向测试。deployment/UI 与 runtime correctness 两路明确 PASS；migration/security 首轮发现两个不属于已接受风险的问题，均已修复并由未参与实现的 reviewer 复核：

- 普通 health probe 失败的 pre-marker rollback 曾因 publication cleanup 后 quarantine proof 为 `retained`、恢复逻辑仅接受 `present` 而未恢复旧 Compose。恢复现在接受经过 journal 证明且 dev/ino/fingerprint 严格匹配的 `retained` proof；Official 首装、legacy 正常升级、Compose 并发 CAS/stale apply 与 health 失败完整回滚组合 `7 passing`。
- data inventory 原先未保护统一 `subscription_state.json` 的 `users.*.video.lastCreated`、`users.*.article.lastPublishTime`、`users.*.live.lastStatus`。inventory 现仅在 subscription state 及备份的精确 namespace 收集三类 anchor，metadata/unrelated 同名字段不误报；anchor 比较先于 touched validator，changed/missing 不可被声明迁移绕过。完整 migration 组合 `65 passing`，独立复核 PASS。
- ConfigService 原先在最终 hash check 后仍以覆盖式 replace 发布，可能吞掉最后窗口内的手工 YAML revision。atomic helper 现以 Linux `renameat2(RENAME_NOREPLACE)` / macOS `renameatx_np(RENAME_EXCL)` 原子领取 expected target 到 hash-bound private claim，验证 dev/ino/size/mtime/nlink 与 SHA-256，再以 no-replace rename 发布 candidate；外部 revision 抢占时保留其字节并返回 typed conflict。helper 严格扫描并协调 target 全部 claim，多 claim/指纹不符 fail closed，覆盖 publish 前后中断、无 expectedHash state 写、absent-target 抢占、普通写与 rollback。writer/core/watcher `50 passing`，独立聚焦复核 PASS；Linux 路径为静态核验，macOS 路径为本机实测。

最终三路结论：runtime correctness/lifecycle PASS，migration/config/security 在上述修复后 PASS，Dashboard/API/setup/Docker/compat/docs PASS；除 18.45 与第 14.7 条已明确接受的窄化风险外，无已知 P0/P1/P2 可执行问题。Dashboard Vitest `4 files / 10 tests`、lint、build、Python venv `3 passing`、`bash -n setup.sh`、`docker compose config -q` 与 `git diff --check` 已通过；完整根 `npm test`、最终容器 smoke、产物/Secret 扫描和第 14 节多 auditor 矩阵仍须在本节之后重新冻结。

首次根冻结运行在 publication restore 的 9 个逐 entry process-kill checkpoint 出现预期不收敛；单独复现确认普通安装、升级与显式 health 失败回滚不受影响。继续运行又识别出同一 accepted-risk 范围内的 1 个 terminal process-kill、3 个 external journal same-UID replacement、6 个 publication artifact namespace replacement、2 个 after-quarantine-create process-kill 与 1 个 publish-before-journal process-kill。上述 22 项均已在 `setup-state-machine.test.js` 以本节原因标记 pending；相邻正常、fail-closed、capacity、Compose CAS、health rollback 与其余 crash/resume fixtures继续执行，生产 `setup.sh` 不再为这些窗口扩展协议。部署 fixture 数量和隔离启动成本超过旧的 20/40 分钟单文件 runner 上限，上限仅对该文件放宽至 2 小时以避免外层误杀；单个 fixture 仍由 setup 自身 health timeout 与测试命令约束。新增 subscription state anchor fixture 在本机约 2.5 秒，migration inventory suite 的 Mocha 上限调整为 10 秒；断言行为不变。另修正两条过时断言：rollback fault aggregate 不再要求未执行的 snapshot verification，安全 pre-marker rollback 允许 retention 策略保留受保护 quarantine/workspace。其余根测试须从头重跑并全部通过。

### 18.47 最终冻结、14 项验收矩阵与完成判定

三名未参与对应实现的 auditor 分别审计配置/运行时、迁移/数据、部署/UI，并全部给出 `PASS / no known bug / no omitted acceptance item`。配置/运行时 auditor 独立组合 `169 passing`；迁移 auditor 独立执行 legacy `15`、inventory `8`、registry `27`、manifest `9`，以及 Official 首装、legacy 正常升级、普通 health 失败完整 rollback；部署/UI auditor复核 Docker、Compose、Dashboard recovery、apply/relocation 与文档一致性。

| # | 要求 | 主要实现证据 | 验证结果 |
|---|---|---|---|
| 1 | 新安装 `config/` 仅 `config.yaml` | ConfigService、ConfigWriter、setup config policy | 私有单文件与 Official/NapCat 首装 PASS |
| 2 | 生产不加载四类 legacy | 生产 config facade；legacy 读取仅在 migration loader | 源码扫描与兼容测试 PASS |
| 3 | 旧安装自动迁移 | config migration coordinator、legacy loader、setup chain | legacy 正常升级 PASS |
| 4 | effective config 一致 | 字段级 priority、runtime env、Official/JWT、existing YAML authority | legacy resolver `15 passing` |
| 5 | Secret 全链路脱敏/私有 | Secret schema、public projection、private manifest、0600 writer | Secret/API/CLI/manifest tests PASS |
| 6 | data/napcat/fonts/Cookie/Agent/Official ID 保留 | data inventory/registry、snapshot/relocation/retention | inventory `8`、registry `27`、relocation/rollback PASS |
| 7 | anchors/ledger 不丢失 | scoped unified-state anchors、delivery parts、Official identities | changed/missing/ledger PASS；仅 14.7 accepted best-effort |
| 8 | 合法 YAML 全应用生效/重建 | ConfigService transaction、reload registry、runtime handlers | config/runtime auditor组合 PASS |
| 9 | 非法 YAML 保持 last-good | validator、watcher、last-good | watcher valid/invalid/permission PASS |
| 10 | Provider/Python/Chromium 受控重建 | provider slot、ServiceManager staged reconfigure、browser generation | lifecycle/rollback/resource cleanup PASS |
| 11 | hostPort/volume/network 明确 apply | deployment baseline/pending、setup apply、Compose CAS | port apply、Official switch、relocation、stale apply PASS |
| 12 | marker 前完整恢复、marker 后 same epoch | rollback/health gates、releaseEpoch、readiness | 普通 health rollback与same-epoch PASS；18.45 22项 pending |
| 13 | migration/setup 幂等 | existing YAML authority、checkpoint/source hash、data journal | retry/resume/rollback/completed marker PASS |
| 14 | README/CLAUDE/Dashboard/代码一致 | README、CLAUDE、冲突计划、Dashboard recovery/status | deployment/UI auditor PASS |

最终验证摘要：Dashboard Vitest `4 files / 10 tests`、lint、build PASS（仅 Browserslist、第三方 PURE comment、chunk-size warning）；Python venv runtime `3 passing`；Config CAS `50 passing`；migration 全组合 `65 passing`；`bash -n setup.sh`、`docker compose config -q`、`git diff --check` PASS。非部署 231 个测试文件以根 runner 等价隔离入口全量执行，修正 migration suite timeout 后无失败；部署状态机长跑覆盖全部非 pending 场景，外层在最后阶段达到旧上限后，未执行尾项与两条更新断言均定向复验通过。22 个 18.45 fault-injection 场景明确 pending，不伪称通过。冻结 hash：真实 `config/config.json`、`subscription_delivery.json` 与其 `.bak` 分别保持 `839e3044…`、`4a05b6f4…`、`485f94d4…`。

环境说明：当前主 shell 无 `shellcheck` 可执行文件；此前独立 deployment reviewer 在可用入口运行 warning 级别为 0，本轮以 `bash -n`、部署状态机与 Docker Compose 解析作为当前环境证据。Linux atomic no-replace 路径完成静态审计，macOS 路径完成实际测试。

数据事故披露：早期测试隔离缺口曾误写真实 `config/config.json`，原始字节无法恢复；Bangumi 测试曾误写 delivery ledger 并覆盖原历史 `.bak`。最终冻结仅证明当前三个文件从既定冻结点起未再变化；不得把该 hash 证明描述为恢复了事故前原始字节。

完成判定：在用户明确接受第 14.7 与 18.45 两项窄化风险的前提下，第 14 节 14 项全部 PASS，无其他已知 correctness/reliability/security/migration/deployment/test 缺口，目标完成。
