# setup.sh 已知限制与后续收缩记录

**日期：** 2026-07-12  
**状态：** ACTIVE ACCEPTED-RISK — 正常 migration owner 已收缩，22 个极端边界继续保留  
**相关归档：** [统一配置、热重载与自动迁移完成记录](../done/2026-07-10-unified-config-hot-reload-and-auto-migration-plan.md)  
**后续计划：** [主程序接管配置升级实施计划](./2026-07-12-main-program-owned-config-migration-plan.md)

## 1. 记录目的

2026-07-12 更新：正常 install/upgrade 已不再调用 `config migrate-legacy` 或 `data-migrate apply`；主程序 `ApplicationMigrationBootstrap` 负责配置/schema/data migration。setup 仍负责部署 fencing、snapshot、Compose、health、rollback 和 ready 后 archive proof 归档。本记录中的 crash-only/same-UID 极端场景没有因此被宣称解决。

当前 `setup.sh` 已经能够完成首次安装、旧版本升级、NapCat/Official 分支、Compose 渲染、deployment apply、health gate 和普通失败回滚。但上一阶段为了让 shell 脚本同时承担“部署事务协调器”和“配置/数据迁移驱动器”，脚本规模、状态数量和故障面显著膨胀。

本记录不重新打开已经由用户接受的极端崩溃边界，也不要求继续为这些边界增加 shell 状态机。它用于明确：

- 当前版本哪些正常能力可以依赖；
- 哪些风险已经接受并保留；
- 哪些职责应在下一阶段移入主程序；
- 后续修改不能把已接受风险误写成已完全解决。

## 2. 当前可靠能力

以下路径已经实现并有测试证据，不属于已知缺陷：

1. 首次安装 NapCat 或 Official Provider。
2. 生成并校验 Compose，避免使用 `sed`/`awk` 解析 YAML。
3. `--dry-run`、`--non-interactive` 与 `--apply`。
4. 旧安装配置迁移、业务数据 migration registry 和 existing YAML 权威规则。
5. 新镜像 probe/ready health gate。
6. 普通 pre-marker health 失败时恢复旧镜像、旧配置、原数据、Compose、网络和 managed writer 状态。
7. marker 后进入同一 release epoch 恢复，不创建第二个运行 epoch。
8. 自定义 Compose 或 stale deployment plan 无法证明安全时 fail closed。
9. 配置、数据、NapCat、字体、Cookie、Agent、Official ID、订阅 anchor 和 delivery ledger 的隔离验证。

## 3. 已接受的残余风险

用户已经明确接受以下两类风险：

### 3.1 legacy-v0 首次 cutover 在途消息

旧版本缺少 durable child/target delivery record 时，首次切换窗口内存在极小概率重复或漏推。该例外只适用于无法证明提交状态的在途操作，不允许扩散到已经持久化的 anchor 或 delivery ledger。

### 3.2 setup 极端进程中断和同 UID namespace replacement

上一阶段识别的 22 个 fault-injection 场景已经在部署测试中明确标记 pending，主要包括：

- publication restore 逐 entry rename/journal 之间被杀死；
- terminal intent 已移动但 journal 尚未持久化；
- quarantine 创建完成但状态尚未记录；
- data candidate 已发布但 journal 尚未更新；
- same-UID 并发替换 external journal；
- publication artifact 在最终 open/claim/unlink 窗口被替换。

这些边界不再通过扩大 `setup.sh` 的 claim、vault、journal 和恢复分支解决。测试必须保留 pending 原因和本文件链接，不能删除后伪装成通过。

## 4. 当前结构性问题

### 4.1 setup 同时承担两种不同事务

当前脚本既管理：

- 镜像、容器、网络、volume、Compose 和 health；

又直接驱动：

- `config migrate-legacy`；
- config candidate 生成；
- data migration apply；
- legacy 配置归档；
- migration manifest checkpoint。

部署事务和应用数据事务交织后，任何一步中断都需要 shell 同时理解文件 identity、应用 schema、业务 anchor 和容器生命周期。

### 4.2 脚本状态机规模过大

`setup.sh` 已超过五千行，包含大量内嵌 Node/Python、fault hook、私有文件协议、retention vault 和 resume 分支。继续增加逻辑会提高以下风险：

- 正常路径被极端恢复逻辑回归；
- shell 与主程序对 migration 状态的理解不一致；
- 一个 manifest checkpoint 同时被两个 owner 修改；
- 测试执行时间过长，完整部署文件串行运行超过四十分钟；
- review 很难区分部署正确性和应用迁移正确性。

### 4.3 非 setup 启动不能自动升级

当前主程序在 `src/bot.js` 中直接执行：

```js
await config.initialize({ createIfMissing: false, watch: true })
```

如果用户通过手写 Compose、Docker、systemd 或直接 `node src/bot.js` 启动新版本，而目录中只有旧配置，主程序不会自行迁移。迁移能力虽然位于 Node 模块中，但正常入口仍由 `setup.sh` 驱动。

### 4.4 migration owner 不够清晰

当前存在三个相关入口：

- `setup.sh`：部署状态机和迁移编排；
- `src/cli/config.js` / `src/cli/data-migrate.js`：离线迁移命令；
- `src/bot.js` / ConfigService：运行时配置 owner。

下一阶段需要明确主程序是逻辑 migration 的唯一 owner；CLI 只是同一 bootstrap service 的离线适配器；setup 只提供部署 fencing 和快照。

## 5. 后续收缩原则

1. 不重写已经验证过的 `legacyLoader`、ConfigWriter、manifest 和 data registry。
2. 把它们封装进主程序启动前的 `ApplicationMigrationBootstrap`。
3. `setup.sh` 不再解释应用 schema，不再决定字段级配置优先级。
4. setup 只负责确保旧进程不再写入、创建目录快照、启动新版本、检查 health 和恢复部署快照。
5. Config CLI 保留，但调用 bootstrap service，不再拥有独立迁移语义。
6. 主程序 migration 在任何 Provider、Dashboard listener、Python child、browser、subscription timer 启动前完成。
7. 逻辑 migration 失败时进程以 typed exit code 退出，不启动部分 runtime。
8. setup 根据 typed exit/health 结果决定恢复旧部署；直接启动用户可根据同一错误码修复后重试。

## 6. 暂不处理事项

- 不继续关闭第 3.2 节的 22 个极端 fault-injection 窗口。
- 不提供任意未知 Compose 的自动合并。
- 不让主程序自行拉取镜像、修改 Compose 或切换 Docker 网络。
- 不让运行中的新主程序覆盖另一个活跃实例的配置或 migration owner lock。
- 不删除 retention vault；容量清理由后续独立、显式授权的维护功能处理。

## 7. 完成条件

当后续计划完成后，本记录可以归档，但第 3 节仍必须保留在历史记录中。至少应满足：

- 没有 `setup.sh` 也能从 legacy 配置首次启动新程序；
- setup 正常升级不再调用独立的 config/data migrate 命令；
- 主程序、CLI 和 setup 使用同一套 migration service 和 typed result；
- 部署回滚与逻辑 migration rollback 的 owner 边界有明确测试；
- setup 脚本明显减少应用 schema 和业务数据细节。
