# Docker 启动自动迁移实施计划

**日期：** 2026-07-12
**状态：** IMPLEMENTED — 定向验证完成
**目标：** 用户仅替换或拉取新版 Docker 镜像并重新创建容器时，主程序自动完成 legacy 配置合并、配置 schema 升级和业务数据 migration，无需额外设置 `BILI_LEGACY_WRITER_FENCED=1`。

## 1. 用户预期

标准升级入口应支持：

```bash
docker compose pull
docker compose up -d
```

或者将 Compose 中的 Bot 镜像改为新版后重新创建容器。新容器启动时应自动：

1. 检查挂载的 `config/` 和 `data/`。
2. 已有合法 `config.yaml` 时，以 YAML 为唯一权威配置，并按 schema registry 顺序升级。
3. 没有 YAML、只有 legacy 文件时，按既有四类 legacy priority 合并并创建 `config.yaml`。
4. 执行业务数据 migration registry。
5. 成功后才启动 ConfigService、Dashboard、Provider、Python、browser 和 subscription timer。
6. 失败时保留原始配置与业务数据，输出 typed error，允许修复后重复启动。

单独执行 `docker pull` 只下载镜像，不会触发迁移；迁移发生在新容器启动阶段。

## 2. 部署假设

本项目采用以下正常部署假设：

- 同一套 `config/`、`data/` 挂载目录在正常运行中只由一个 Bot 容器使用。
- Docker Compose 的镜像替换会停止旧 Bot 容器，再创建新 Bot 容器。
- 不支持用户主动启动两个不同版本的 Bot 容器并让它们同时写入同一目录。
- 对两个新版本实例的并发启动，仍由 bootstrap/config owner lock fail closed。

基于该产品假设，Docker 普通启动不再要求操作者额外声明 `BILI_LEGACY_WRITER_FENCED=1`。该环境变量可保留为兼容输入，但不再是标准 Docker legacy migration 的必要条件。

## 3. 目标行为矩阵

| 挂载状态 | 新容器行为 |
| --- | --- |
| 合法 current YAML | 验证配置，运行 data registry，然后启动 runtime |
| 合法旧 schema YAML | 私有备份、schema 升级、data migration，然后启动 runtime |
| 合法 YAML + legacy 残留 | YAML 权威；legacy 不覆盖 YAML，也不由主程序删除 |
| 无 YAML + legacy 文件 | 自动读取四类 legacy、生成 YAML、运行 data migration |
| 空 config 目录 | 按明确的容器 fresh-install policy 创建默认 YAML，或在缺少必要 Provider 凭据时返回 typed input error |
| future schema YAML | fail closed，不降级、不读取 legacy 回退 |
| invalid/unsafe YAML | fail closed，不读取 legacy 掩盖损坏 YAML |
| bootstrap owner 冲突 | fail closed，不写配置或业务数据 |
| migration 中断后重启 | 根据私有 manifest、backup 和 hash 幂等续跑或恢复 |

## 4. 安全边界调整

### 4.1 删除正常 Docker 启动的人工 fencing gate

实施前 `src/bot.js` 只有在 `BILI_LEGACY_WRITER_FENCED=1` 时才允许 legacy migration。本轮已改为：

- Docker/容器启动默认允许 legacy migration；
- direct Node 启动也遵循单目录单实例产品假设，或根据可识别的运行环境采用同一策略；
- bootstrap owner lock 继续阻止两个新版本 migration owner 并发；
- ConfigService owner handoff 继续保持无空窗；
- 不把 fencing 标志写入 `config.yaml`。

### 4.2 明确不解决的异常部署

如果用户绕过 Compose 生命周期，故意让旧版容器与新版容器同时挂载并写入同一目录，旧版进程不理解新 owner lock，因此无法由新程序绝对证明安全。该场景不属于项目支持的正常部署模型，应在文档中作为运维误用明确说明，而不是阻断普通镜像升级。

### 4.3 保留的数据保护

- 配置和 migration 私有目录保持 `0700`。
- YAML、manifest、backup、proof 和 install input 保持 `0600`。
- existing YAML 永远优先于 legacy 文件。
- schema 替换前保存原始 YAML，并在后续阶段失败时进行 hash-fenced restore。
- data registry 继续校验 anchor、delivery ledger、Cookie、Agent、Official ID 和 preserve inventory。
- Secret 不进入日志、公开 readiness 或公开 manifest。

## 5. 配置合并语义

“自动合并”只指首次从 legacy-v0 冻结 effective config：

- 继续复用现有 `legacyLoader` 的字段级 priority 和 normalizer；
- `.env`、`config.json`、`.jwtSecret`、`.qqOfficialClientSecret` 只在 `config.yaml` 不存在时读取；
- 一旦合法 `config.yaml` 存在，legacy 文件永远不能覆盖其中任何字段；
- schema-to-schema migration 只通过 config schema registry 执行；
- 不在每次启动时把环境变量重新合并进 YAML，避免形成第二配置真源。

## 6. setup.sh 与手写 Compose

### 6.1 setup.sh

setup 继续提供更强的部署保护：

- 旧进程 fencing；
- 配置和数据部署 snapshot；
- Compose、volume、网络和端口协调；
- probe/normal health gate；
- 普通失败部署回滚；
- ready 后根据主程序 archive proof 归档 legacy 文件。

setup 不再是自动 migration 的必要入口；它是推荐的、带部署事务保护的入口。

### 6.2 手写 Compose 或只替换镜像

只要继续挂载原来的 `/app/config` 和 `/app/data`，新容器即可自动 migration。主程序不依赖 setup state、Docker socket 或旧镜像存在。

非 setup 启动不自动删除或归档 legacy 文件；migration 成功后这些文件可以保留，由 YAML 权威规则保证它们不影响运行。

## 7. 实施范围

预计修改：

- `src/bot.js`：移除正常 legacy migration 对人工 fencing 环境变量的硬依赖。
- `src/bootstrap/applicationMigrationBootstrap.js`：明确自动 legacy policy 与 typed result。
- `src/bootstrap/sourceDiscovery.js`：保持 YAML-first discovery。
- `docker-compose.yml` 和 Compose renderer：确保旧挂载可直接交给新容器，不要求额外 migration 环境变量。
- bootstrap/runtime/setup 测试：增加纯镜像替换启动场景。
- README、CLAUDE、Dashboard/部署文档：说明自动迁移与不支持的并发误用。

不进行与本目标无关的 setup crash-only 协议扩展。

## 8. 测试矩阵

### 8.1 Docker 镜像替换

- legacy NapCat 安装直接启动新版镜像，自动生成并加载 YAML；
- legacy Official 安装直接启动新版镜像，保留 AppID、ClientSecret 和 root openids；
- 已有 YAML 直接启动，不读取损坏 legacy 文件；
- 旧 schema YAML 自动升级；
- data registry 在 Provider/Dashboard/Python 等副作用前完成；
- 第二次重启不重复修改配置或业务数据；
- migration 中断后重建容器可续跑或恢复；
- 不设置 `BILI_LEGACY_WRITER_FENCED` 也能完成正常 legacy migration。

### 8.2 失败与安全

- future schema、invalid YAML、unsafe file、owner conflict 均 fail closed；
- bootstrap 失败时无 runtime 副作用；
- schema/data migration 失败保留或恢复原数据；
- Secret 不进入日志/API/manifest public projection；
- legacy 残留不覆盖已有 YAML；
- 两个新容器并发启动时只有一个 owner 可以写入。

### 8.3 回归

- ConfigService CAS/watcher/last-good；
- Config CLI 与 data CLI；
- setup Official/NapCat 首装、legacy/managed upgrade、health rollback、archive proof；
- port apply、volume relocation、stale Compose CAS；
- Dashboard test/lint/build；
- Python tests；
- `bash -n setup.sh`、`docker compose config -q`、`git diff --check`。

所有演练必须使用隔离目录，不修改真实 `config/`、`data/` 或 `napcat/`。

## 9. 验收标准

1. 用户替换为新版镜像并执行 `docker compose up -d` 后，legacy 安装无需额外环境变量即可自动迁移并启动。
2. 已有合法 YAML 不受任何 legacy 残留影响。
3. schema 和 data migration 均在所有 runtime 副作用前完成。
4. migration 可重复执行，可从中断安全恢复。
5. 普通单实例 Docker 升级不因缺少人工 fencing proof 被拒绝。
6. 两个新版本实例并发时仍由 owner lock fail closed。
7. setup 的部署 rollback、CAS、apply、relocation 和 ready 后归档能力不回归。
8. 文档明确单目录单实例假设及旧、新容器并发写入不受支持。

## 10. 发布要求

实现合入 `main` 后，必须等待 GitHub Actions 的 validate、multi-arch build/push 和 release 全部成功。只有此后 Docker Hub 的 `unsplash/bili-qq-bot:<version>` 与 `latest` 才包含自动迁移能力；功能分支提交或本地文档不代表公开镜像已更新。

## 11. 实施结果

- 主程序启动固定允许 legacy 自动迁移，不再读取 `BILI_LEGACY_WRITER_FENCED` 作为准入条件。
- setup runtime override 不再注入该环境变量。
- 新增无标志启动测试，以及 NapCat 四源 priority 和 Official AppID/ClientSecret/root openids 保留测试。
- 保持 existing YAML 权威、bootstrap/config owner handoff、schema hash-fenced restore、data preserve 校验与失败零副作用。
- 定向验证通过：bootstrap/legacy/data preserve、CLI/ConfigService/runtime/readiness，以及 setup Official/NapCat 首装和 legacy ready 后归档；Dashboard test/lint/build、Python runtime、Compose/shell/语法和 diff 静态检查结果见本轮执行记录。
