# 主程序接管配置与业务数据升级实施计划

**日期：** 2026-07-12  
**状态：** IMPLEMENTED — 定向验证与独立评审完成于 2026-07-12
**目标：** 将配置 schema 升级、四类 legacy 配置迁移和业务数据 migration 的正常 owner 从 `setup.sh` 迁入主程序启动链；当前 `setup.sh` 已收缩为首次配置初始化和已有安装的容器更新助手。
**基线提交：** `ba2121e`、`68ff17e`、`d4ae91c`、`202a1b5`、`f82f962`

> **当前合同（2026-07-19）：** 主程序接管 migration 的实现仍有效。`setup.sh` 只保留首次配置初始化和已有安装的容器更新；不承担 migration、publication 或 rollback，并在首次安装和更新后都等待最终 readiness。本文早期章节中的 bootstrap/config owner lock 设计已废止：产品明确只支持单 Bot 实例，不创建或检查文件锁；旧版本遗留锁目录会被忽略。本文后续复杂部署协调内容仅作为历史方案保留。

## 1. 背景与问题定义

当前仓库已经具备：

- 唯一 `config/config.yaml`；
- versioned schema、validator、YAML Document；
- generation/CAS/last-good/watcher；
- 四类 legacy 配置 loader；
- config migration manifest；
- 业务数据 migration registry；
- Config CLI 和 data migration CLI；
- setup 的部署 snapshot、probe、health gate 和 rollback。

但正常升级入口仍是 `setup.sh`：脚本调用 Config CLI 生成 candidate，再调用 data CLI 执行 migration，最后启动新程序。主程序本身只会加载已经存在的合法 YAML。

这造成两个问题：

1. 通过非 setup 方式部署时，新版本无法自动升级旧配置。
2. setup 被迫理解应用 schema、migration checkpoint 和业务数据细节，部署状态机过重。

本计划重新划分 owner：

```text
主程序 / ApplicationMigrationBootstrap
  ├─ 配置发现与 legacy/schema migration
  ├─ 业务数据 migration registry
  ├─ migration manifest 与幂等恢复
  └─ ConfigService 初始化前的逻辑 readiness

setup.sh / DeploymentCoordinator
  ├─ 安装问答与目录准备
  ├─ 镜像、Compose、volume、网络、端口
  ├─ 旧进程 fencing、部署快照与 candidate 启动
  ├─ health gate
  └─ 旧部署恢复
```

## 2. 设计原则

### 2.1 主程序是逻辑 migration 的唯一 owner

主程序、Config CLI 和 data CLI 必须调用同一个 service。不得保留三套状态推进规则。

### 2.2 migration 先于所有应用副作用

bootstrap 必须在以下行为前完成：

- Dashboard listen；
- NapCat/Official 连接；
- Python child 启动；
- browser 初始化；
- subscription timer；
- notification ingress；
- ConfigService watcher。

如果 migration 失败，进程不得进入部分可用状态。

### 2.3 existing YAML 永远优先

如果 `config.yaml` 已存在且合法：

- 不读取四类 legacy 文件来覆盖它；
- 只根据 YAML 的 `version` 执行 schema-to-schema migration；
- legacy 文件仅作为待归档历史输入，由部署层在新版本 ready 后处理。

### 2.4 无 setup 也可以安全启动

直接启动场景没有部署 snapshot，因此 bootstrap 必须：

- 使用私有 backup/manifest；
- migration 失败保持原始文件；
- 不归档或删除 legacy 输入；
- 输出可重试 typed error；
- 不假设 Docker、Compose 或旧镜像存在。

### 2.5 setup 仍拥有跨版本部署 fencing

主程序无法安全完成以下操作，必须继续由 setup 管理：

- 停止仍在写入的旧容器；
- 拉取和 pin 镜像；
- 修改 Compose、volume 和网络；
- 创建整个 config/data 的部署快照；
- 恢复旧镜像和旧容器；
- 判断新版本 health 是否达到部署 release gate。

## 3. 目标启动流程

### 3.1 主程序正常启动

```text
process entry
  → resolve runtime paths
  → acquire ApplicationMigrationBootstrap owner lock
  → inspect config source class
      ├─ config.yaml vCurrent → validate
      ├─ config.yaml vOlder   → schema migration chain
      ├─ no YAML + legacy     → legacy migration
      └─ no YAML + no legacy  → fresh-install policy
  → run business data migration registry
  → persist migration result and release bootstrap lock
  → ConfigService.initialize({ createIfMissing: policy, watch: true })
  → register reload handlers
  → start Dashboard/Provider/Python/subscription runtime
```

### 3.2 setup 首次安装

首次安装仍由 setup 收集必要输入，但不直接生成最终 YAML：

1. setup 询问 Provider、管理员、端口、Secret 等安装信息。
2. 将安装 DTO 写入 attempt-private `0600` bootstrap input，或通过只读 fd/受保护 mount 提供给新容器。
3. 启动新程序的 `bootstrap/probe` 模式。
4. 主程序识别 fresh-install input，创建 `config.yaml` 并执行 data registry。
5. 主程序 readiness 返回 migration generation、config generation 和 deployment requirements。
6. setup 通过 health gate 后删除或 retained-archive bootstrap input。

安装 DTO 不得成为第二配置真源；完成后 `config/` 仍只有 `config.yaml`。

### 3.3 setup 旧版升级

1. setup 发现旧 runtime，冻结 source class 和 deployment snapshot。
2. 停止/隔离旧 writer。
3. 不调用 `config migrate-legacy` 或 `data-migrate apply`。
4. 启动 target image 的 probe runtime，并挂载原 config/data。
5. target 主程序 bootstrap 自动执行逻辑 migration。
6. probe health 必须报告：
   - migration status complete；
   - config generation/effect generation 对齐；
   - business data registry complete；
   - Provider 未消费或已满足 probe 合同；
   - deployment apply requirements 明确。
7. setup 达到 release gate 后启动正式 runtime。
8. 正式 health 成功后，setup 才根据主程序提供的 archive proof 归档 legacy 文件。
9. 任何 pre-marker 失败由 setup 恢复部署 snapshot。

### 3.4 非 setup 旧版启动

1. 主程序检测 legacy 输入。
2. 获取 bootstrap owner lock，证明没有另一个新版本 bootstrap/runtime owner。
3. 如果无法证明旧进程已停止：返回 `MIGRATION_LEGACY_WRITER_UNSAFE`，不迁移。
4. 如果安全：创建私有 backup、candidate 和 manifest，执行 migration。
5. legacy 输入不自动删除；日志提示用户迁移完成和待归档文件。
6. 启动 ConfigService 和 runtime。

## 4. 新组件设计

### 4.1 `ApplicationMigrationBootstrap`

建议新增：

```text
src/bootstrap/applicationMigrationBootstrap.js
src/bootstrap/sourceDiscovery.js
src/bootstrap/bootstrapResult.js
src/bootstrap/bootstrapErrors.js
```

接口建议：

```js
const result = await bootstrap.run({
  configDir,
  dataDir,
  mode: 'normal' | 'probe' | 'fresh-install',
  installInput,
  releaseEpoch,
  deploymentAttemptId,
  allowLegacyMigration,
  createIfMissing
})
```

返回值必须是 typed DTO：

```js
{
  status: 'ready' | 'recovery-required' | 'deployment-apply-required',
  sourceClass: 'fresh-install' | 'legacy-v0' | 'managed-v1+',
  config: {
    path,
    schemaVersion,
    documentHash,
    migrated,
    created
  },
  data: {
    migrationsApplied,
    generation,
    warnings
  },
  archive: {
    eligible,
    proofId,
    legacyFiles
  },
  warnings,
  publicError
}
```

返回值不得包含 Secret、原始 legacy 字节、私有路径 fingerprint 或自由文本内部异常。

### 4.2 Source discovery

发现顺序固定为：

1. 检查 `config.yaml` 是否存在、安全、可解析。
2. 存在 YAML：确定 schema version；legacy 文件不参与 effective config。
3. 不存在 YAML：扫描四类 legacy 文件，确定是否为 legacy-v0。
4. 两者均不存在：仅在 `createIfMissing` 或 fresh-install input 明确时创建默认配置。
5. 不安全文件、future schema、混合损坏输入一律 typed fail closed。

不得因为 legacy 文件存在就覆盖已有 YAML。

### 4.3 Schema migration registry

当前只有 v1，也必须先建立版本链接口：

```text
src/migrations/config/schemaRegistry.js
src/migrations/config/versions/v1-to-v2.js
```

registry 合同：

- 每个 migration 声明 `fromVersion`、`toVersion`；
- 输入/输出均通过 schema validator；
- migration 必须是确定性的；
- Secret 不进入日志；
- 每一步记录 source hash、candidate hash 和 checkpoint；
- future version 拒绝降级；
- 中断后根据 manifest 续跑或恢复 last-good。

第一阶段即使没有 v2，也要把 v1 identity migration 和 registry contract 测通，避免以后再次把版本判断塞入 setup。

### 4.4 业务数据 migration

复用 `src/migrations/data/registry.js`，但 owner 改为 bootstrap：

- bootstrap 在 ConfigService/runtime 启动前调用 registry；
- data migration manifest 绑定 config document hash 和 schema version；
- migration 只能触碰声明路径；
- anchor、delivery ledger、Official ID 和 preserve inventory 继续强校验；
- data failure 使整个 bootstrap 失败；
- probe health 不得在 data registry incomplete 时 ready。

### 4.5 Bootstrap owner lock

不能直接复用运行中 ConfigService owner lock表达全部状态。建议：

- `bootstrap-owner.lock`：保护 migration/bootstrap；
- `config-owner.lock`：保护运行时 ConfigService；
- bootstrap 成功后，在同一进程内完成 owner handoff；
- handoff 期间不得出现其他离线 CLI writer 可以插入的窗口；
- CLI offline migration 也获取 bootstrap owner lock；
- setup 只负责旧进程 fencing，不直接写这两个 lock。

需要明确 lock order，避免死锁：

```text
bootstrap owner → migration private files → ConfigService owner → release bootstrap owner
```

## 5. Manifest 与 owner 边界

### 5.1 应用 migration manifest

由主程序 bootstrap 独占写入，记录：

- config source class；
- schema migration chain；
- data migration generation；
- source/candidate hashes；
- archive eligibility proof；
- typed warning；
- recovery-required 状态。

### 5.2 deployment manifest

由 setup 独占写入，记录：

- image IDs；
- Compose snapshot和 ownership；
- volume/network/port plan；
- release epoch；
- probe/normal health；
- deployment rollback 状态。

### 5.3 关联方式

两个 manifest 只通过不可变标识关联：

- `deploymentAttemptId`；
- `releaseEpoch`；
- `applicationMigrationId`；
- config document hash；
- data migration generation。

任何一方不得修改另一方的 checkpoint。

## 6. Health 与 API 合同

### 6.1 Probe readiness

`/api/ready` 或内部 readiness DTO 增加：

```js
applicationBootstrap: {
  status: 'ready',
  migrationId,
  sourceClass,
  configSchemaVersion,
  configGeneration,
  dataGeneration,
  archiveEligible,
  warnings
}
```

Secret、legacy 路径、文件 hash 和内部错误不得公开。

### 6.2 Migration status API

现有 Dashboard migration status 改为读取 bootstrap service 的 public projection。至少提供：

- 是否自动迁移；
- source class；
- 当前 schema version；
- data migrations；
- 是否需要 deployment apply；
- 是否 recovery-required；
- legacy 文件是否等待 setup 归档；
- best-effort cutover warning。

### 6.3 Typed process exit

主程序在 bootstrap 失败时应使用稳定的 exit class，而不是让 setup 匹配自由文本：

- `CONFIG_BOOTSTRAP_INVALID_INPUT`；
- `CONFIG_BOOTSTRAP_RECOVERY_REQUIRED`；
- `CONFIG_BOOTSTRAP_OWNER_CONFLICT`；
- `CONFIG_SCHEMA_FUTURE_VERSION`；
- `DATA_MIGRATION_FAILED`；
- `MIGRATION_LEGACY_WRITER_UNSAFE`；
- `DEPLOYMENT_APPLY_REQUIRED`。

具体 shell exit code 可以统一为少量类别，详细 code 从私有 status DTO 或健康接口读取。

## 7. setup.sh 收缩方案

### 7.1 删除的正常职责

实施完成后，setup 正常路径不再：

- 调用 `config_cli migrate-legacy`；
- 调用 `data_migrate_cli apply`；
- 解释 legacy 字段级 priority；
- 生成最终 config candidate；
- 推进应用 migration manifest；
- 判断 schema version；
- 验证业务 anchor 的应用语义。

### 7.2 保留的职责

setup 继续：

- 检查 Docker 与安装目录；
- 首次安装时交互收集并校验 NapCat 配置；
- 生成 Compose、`.env`、NapCat JSON 和 canonical YAML；
- 已有安装时保留现有文件并执行 Compose config、pull 和 up；
- 更新完成前读取 `/api/ready`，失败时返回非零并提示查看日志。

setup 不再执行 writer fencing、部署 snapshot、自动 rollback、archive proof 归档或 migration checkpoint。

### 7.3 归档协议

主程序 bootstrap 只产生 archive proof，不删除 legacy 文件。setup 在 normal health 成功后：

1. 读取受保护 archive proof；
2. 复核 legacy 文件 identity/hash；
3. 移入 retained archive；
4. 验证 `config/` 最终只有 `config.yaml`；
5. 更新 deployment manifest。

非 setup 启动时不执行归档，避免主程序擅自删除用户输入。

## 8. CLI 调整

保留以下用途：

- 离线诊断；
- 管理员显式 `--migrate-only`；
- fixture 和 CI；
- recovery-required 修复；
- schema migration dry-run。

CLI 必须改成 bootstrap service adapter：

```text
src/cli/config.js migrate-legacy
  → ApplicationMigrationBootstrap.run({ mode: 'offline-migrate-only' })

src/cli/data-migrate.js apply
  → ApplicationMigrationBootstrap.runDataOnly(...) 或内部 registry adapter
```

不得保留 CLI 与主程序不同的 priority、manifest 或错误语义。

## 9. 实施阶段

### 阶段 A：抽取统一 bootstrap service

文件范围：

- 新增 `src/bootstrap/**`；
- 调整 `src/migrations/config/index.js`；
- 调整 `src/migrations/data/registry.js` 的调用入口；
- 不修改 setup 正常流程。

任务：

1. 建立 source discovery DTO。
2. 封装 legacy migration、schema validation、data registry。
3. 建立 bootstrap owner lock和 ConfigService owner handoff。
4. 返回 typed result/public projection。
5. CLI 切换到统一 service。

门禁：现有 CLI/migration 测试全部继续通过，新 bootstrap fixture覆盖 fresh/legacy/existing YAML/retry。

### 阶段 B：接入主程序启动链

文件范围：

- `src/bot.js`；
- ConfigService bootstrap接口；
- Dashboard readiness/migration status；
- 启动测试。

任务：

1. 在 `config.initialize()` 前运行 bootstrap。
2. 确保没有 runtime side effect 提前发生。
3. bootstrap 成功后原子 handoff ConfigService owner。
4. 失败输出 typed error并退出。
5. 增加 probe readiness字段。

门禁：直接启动 legacy fixture可迁移；失败时无 listener/socket/child/timer；existing YAML不读legacy。

### 阶段 C：setup 改为 target-owned migration

文件范围：

- `setup.sh`；
- Compose probe mode；
- deployment fixtures。

任务：

1. setup 不再调用 migrate/apply CLI。
2. fresh install传递一次性 bootstrap input。
3. upgrade直接启动 target probe。
4. health gate验证 bootstrap DTO。
5. ready 后按 archive proof归档。
6. pre-marker失败继续恢复部署 snapshot。

门禁：Official/NapCat 首装、legacy upgrade、existing YAML upgrade、normal health rollback、apply/relocation全部通过。

### 阶段 D：删除重复状态和收缩脚本

任务：

1. 删除只为 shell 驱动应用 migration存在的 checkpoint和 helper。
2. 删除 setup 内 schema/legacy字段逻辑。
3. 保留 deployment snapshot、health和archive proof协议。
4. 更新 README、CLAUDE、Dashboard提示和历史计划。
5. 统计 setup 行数、分支和测试时长变化。

门禁：不得以“重构”为名删除正常 rollback、Compose CAS、自定义部署保护或 accepted-risk记录。

## 10. 测试矩阵

### 10.1 主程序 bootstrap

- fresh install input → 创建唯一 YAML；
- no YAML + 四类 legacy 冲突 → effective一致；
- existing YAML + legacy残留 → YAML权威；
- old schema → 顺序升级；
- future schema → fail closed；
- invalid YAML → 不回退 legacy；
- legacy unsafe mode/symlink/hardlink/FIFO → fail closed；
- bootstrap中断于 backup/candidate/manifest/data各阶段 → 幂等续跑或 recovery-required；
- owner conflict → 不写文件；
- Secret不进入stdout/stderr/API/manifest public projection；
- bootstrap失败时无 Dashboard/Provider/Python/timer副作用。

### 10.2 setup 集成

- Official首次安装；
- NapCat首次安装；
- legacy-v0升级；
- managed YAML升级；
- target主程序migration失败；
- probe失败后的旧镜像/config/data/Compose恢复；
- ready后legacy归档；
- archive proof stale/replaced；
- hostPort apply；
- volume relocation；
- stale Compose CAS；
- 自定义Compose fail closed；
- rollback后下一次重试。

### 10.3 非 setup 部署

- 直接 Node 启动；
- 手写 Compose 启动；
- 只读 config mount；
- legacy writer仍活跃；
- 无归档权限但migration可完成；
- migration完成后正常热重载。

### 10.4 回归与性能

- Config CAS、watcher、last-good；
- Provider/Python/browser/subscription runtime suites；
- Dashboard recovery；
- migration inventory/ledger/anchor；
- 根 `npm test`；
- Dashboard test/lint/build；
- Python venv；
- `bash -n setup.sh`；
- ShellCheck可用时执行；
- `docker compose config -q`；
- 临时目录容器 live/ready smoke；
- bootstrap冷启动时间和setup状态机测试耗时基线。

## 11. 文件所有权建议

并行实施时避免共享文件冲突：

- Bootstrap implementer：`src/bootstrap/**`、migration service adapter。
- Runtime implementer：`src/bot.js`、ConfigService handoff、readiness。
- Setup implementer：`setup.sh`、Compose、deployment fixtures。
- Dashboard implementer：migration status/recovery UI/API。
- 主代理：共享 manifest DTO、错误码、文档和最终整合。

原实现者不得作为对应范围的最终 reviewer。

## 12. Review 要点

### 配置与 migration reviewer

- existing YAML 是否绝对权威；
- schema chain 是否可恢复；
- bootstrap/ConfigService lock handoff 是否有窗口；
- Secret、权限、CAS和last-good；
- CLI和主程序是否真正复用同一 service。

### 生命周期 reviewer

- migration前是否存在任何 runtime副作用；
-失败是否清理 listener、socket、child、timer；
- probe与normal是否可能执行两次migration；
- same release epoch和generation是否一致。

### 部署与数据 reviewer

- setup是否真正不再拥有应用migration checkpoint；
-旧writer fencing是否足够；
- deployment snapshot和应用manifest边界；
- data anchor/ledger/Official ID/Cookie/Agent；
-普通失败回滚与legacy归档时序。

## 13. 验收标准

全部满足才算完成：

1. 不使用 `setup.sh`，主程序也能从合法 legacy 安装自动生成并加载唯一 `config.yaml`。
2. 已有合法 YAML 不受残留 legacy 文件影响。
3. schema version 升级由主程序 registry 完成，setup 不判断 schema。
4. 业务数据 migration 在 runtime 启动前由主程序完成。
5. bootstrap 失败时没有 Provider、Dashboard、Python、browser或subscription副作用。
6. Config CLI 和 data CLI 与主程序使用同一 migration service。
7. setup 正常 install/upgrade路径不再调用独立 config/data migrate命令。
8. setup仍可完成旧进程 fencing、部署 snapshot、health gate和普通失败完整回滚。
9. ready前不归档legacy；ready后config目录只有config.yaml。
10. Secret不回显，私有文件保持0700/0600。
11. anchor、ledger、Cookie、Agent、Official ID和preserve数据不丢失。
12. migration重复执行和中断重试幂等。
13. direct Node、手写Compose、setup三种入口行为一致。
14. Dashboard/API准确显示bootstrap、migration、recovery和deployment apply状态。
15. setup中与应用schema/字段priority/data migration有关的代码明显减少，且无正常能力回归。
16. 第14.7 legacy in-flight和setup 22个accepted-risk边界继续如实记录，不宣称被本重构顺带解决。

## 14. 回滚策略

实施分阶段提交，任何阶段失败可以回到前一阶段：

- A失败：CLI继续调用旧migration模块，主程序入口不变。
- B失败：通过feature flag暂时禁用startup bootstrap，恢复setup驱动。
- C失败：setup保留一版兼容fallback，仅在明确版本能力检测失败时调用旧CLI；fallback必须有移除期限和测试。
- D只在A-C稳定后进行，不提前删除旧路径。

不得通过自动回退读取legacy来掩盖损坏YAML；不得在无法证明旧writer停止时强制迁移。

## 15. 文档同步

实施时更新：

- README：安装、直接启动、升级和故障处理；
- CLAUDE.md：启动链、migration owner和测试命令；
- Dashboard README：migration/recovery状态；
- setup已知限制记录：标记已完成的职责收缩；
- 本计划：每轮review、修复、验证和最终矩阵。

完成后将本计划移入 `docs/done/`，但 setup accepted-risk 历史记录继续保留。

## 16. 实施结果（2026-07-12）

- 新增 `ApplicationMigrationBootstrap`、source discovery、typed/public error、schema registry、应用 migration manifest 与 bootstrap owner lock。
- 主程序在 ConfigService、Dashboard、Provider、Python、browser 和 subscription timer 前运行 bootstrap，并在 ConfigService owner 获取后释放 bootstrap owner。
- Config CLI 与 data migration CLI 复用同一 bootstrap service；setup 正常 install/upgrade 不再执行两条 migration CLI。
- fresh install 使用 0600 一次性 input；legacy archive proof 跨 probe/normal 保留，normal ready 后才由 setup 归档。
- 已有 YAML 权威、future/invalid fail closed、owner conflict、重复执行、中断恢复、零副作用失败均有隔离测试。
- setup 的 deployment checkpoint 仍只服务 fencing、snapshot、health、rollback、Compose CAS、relocation 与归档；22 个 accepted-risk 保持原状。

独立审查重点覆盖启动副作用、owner handoff、migration 幂等、数据 preserve 与 setup 边界；审查发现与修复记录包括 probe/normal 间 archive proof 保留和 release epoch 公开关联。

### 16.1 验证结果与未完成范围

已明确通过：bootstrap/legacy/data registry、ConfigService、CLI、启动零副作用、Provider runtime、Dashboard readiness；Dashboard 4 个 test file 共 10 项、lint、build；Python runtime 3 项；`bash -n setup.sh`、`docker compose config -q`、JavaScript syntax 和 `git diff --check`。

setup 状态机完整执行受单次工具执行窗口限制，在连续 23 项通过且未出现失败后终止；Official/NapCat 首装、legacy 升级和 ready 后 archive proof 归档等关键路径另有定向通过记录。根 `npm test` 同样因执行窗口限制，在大量 suite 通过且未出现失败后终止。因此不能把完整 setup fault-injection 矩阵或根测试全量描述为已执行通过。

未完成的全量执行不改变已接受风险边界：legacy-v0 首次 cutover 的极小概率重复/漏推，以及 setup 已知限制文档记录的 22 个 crash-only/same-UID 场景仍然存在。发布到 `main` 后，镜像工作流还会重新执行根测试、Python Bilibili 测试、Dashboard lint/build；只有该 workflow 成功后才能认为发布镜像可用。

### 16.2 后续 Docker 自动迁移策略调整

根据项目实际部署模型，普通镜像替换采用“一套 config/data 挂载目录只运行一个 Bot 容器”的产品假设。主程序不再要求 `BILI_LEGACY_WRITER_FENCED=1` 才执行 legacy migration；`docker compose pull && docker compose up -d` 重建单个 Bot 容器即可自动迁移。多个实例共享写同一目录明确不受支持，也不由程序主动检测或互斥。

### 16.3 配置 owner lock 移除（2026-07-19）

生产部署不考虑多个 Bot 容器共享一套 `config/`、`data/` 的场景。跨进程 owner lock 会把正常镜像替换、容器 PID namespace 差异和遗留目录转化为新的启动故障，因此已从 bootstrap、ConfigService 和离线 CLI 中全部移除：

- 不再创建 `bootstrap-owner.lock` 或 `config-owner.lock`；
- 不再因旧锁目录、PID、heartbeat 或 process identity 判断而拒绝启动；
- bootstrap 完成后直接初始化 ConfigService，不执行 owner handoff；
- ConfigService 仅保留单进程内的事务队列和事务令牌，用于维持异步 prepare/commit/rollback 顺序；
- 配置落盘仍使用 0600、原子替换、generation/CAS、journal 和 last-good rollback；
- 多容器共享写入明确不受支持，且不由程序检测、互斥或恢复。
