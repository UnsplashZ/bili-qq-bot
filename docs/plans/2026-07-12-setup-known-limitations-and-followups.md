# setup.sh 初始化与容器更新合同

**更新日期：** 2026-07-19
**状态：** IMPLEMENTED
**相关归档：** [统一配置、热重载与自动迁移完成记录](../done/2026-07-10-unified-config-hot-reload-and-auto-migration-plan.md)

## 1. 产品职责

`setup.sh` 只负责两类操作：

1. 首次安装时收集必要输入、生成部署文件和唯一的 `config/config.yaml`，然后启动容器。
2. 已有安装再次运行时保留全部配置和数据，只校验 Compose、拉取镜像、重建容器并检查 Bot 健康状态。

配置 schema、legacy 配置合并和业务数据 migration 由主程序启动阶段的 `ApplicationMigrationBootstrap` 负责。setup 不解析 schema，不推进 migration manifest，也不执行应用数据 rollback。

## 2. 已有安装判定

安装目录同时满足以下条件时进入容器更新路径：

- 存在一个标准 Compose 文件：`compose.yaml`、`compose.yml`、`docker-compose.yaml` 或 `docker-compose.yml`；
- 存在 `config/config.yaml`、`config/config.json` 或 `config/.env` 之一。

Compose 文件按上述顺序选择并通过显式 `-f` 传给 Docker Compose，因此 Docker Compose v2 和旧 `docker-compose` v1 使用相同文件。

## 3. 首次安装路径

首次安装执行：

1. 检查 root 权限和 Docker；Docker 缺失时要求 `curl` 后执行安装流程。
2. 创建 `config/`、`data/`、`logs/`、字体和 NapCat 挂载目录。
3. 校验镜像引用、端口、QQ 号、WebSocket URL 和 Token。
4. 优先复制脚本旁的 Compose 模板；远程下载时先写临时文件，成功后原子替换目标文件。
5. 生成 `.env`、NapCat OneBot JSON 和 canonical YAML。
6. 校验 Compose、拉取镜像、启动容器并等待 Bot health。
7. NapCat 部署继续等待登录或 WebSocket 服务就绪；超时只提示用户查看二维码日志。

Token 被限制为字母、数字及 `.`、`_`、`~`、`-`，避免把未经转义的内容写入 NapCat JSON。

## 4. 容器更新路径

已有安装更新只执行：

```bash
docker compose -f <existing-compose> config -q
docker compose -f <existing-compose> pull
docker compose -f <existing-compose> up -d
```

随后解析 `bili-qq-bot` 服务对应的容器，先确认容器没有进入 terminal 状态，再从容器内请求 `/api/ready`。只有返回 `ready: true` 才报告更新成功。这样可以同时验证配置 migration、Dashboard、Provider 和运行时子系统，而不是只依赖 `/api/live` liveness。

- `unhealthy`、`exited`、`dead`、`removing` 立即失败；
- `/api/ready` 持续非 ready 或超时返回失败；
- 首次安装只等待容器 liveness，然后进入 NapCat 登录提示流程，不要求尚未扫码的 Provider ready。

更新路径不会：

- 覆盖或下载新的 Compose；
- 重写根目录 `.env`；
- 重新生成 NapCat 配置或 `config.yaml`；
- 创建或清理业务数据；
- 要求服务器安装 `curl` 或 `wget`（Docker 已存在时）。

## 5. 失败语义

- Compose 校验失败：不执行 pull。
- pull 失败：不执行 up。
- up 失败：立即返回原始非零状态。
- health 失败：打印 Compose 状态并返回非零，不输出“更新完成”。
- 配置与数据文件在上述失败路径中保持不变。

脚本不提供镜像级自动 rollback。`pull` 可能已把新镜像下载到本机，但在 `up` 或 health 失败时，用户应根据日志修复配置或显式恢复旧镜像标签。

## 6. 支持边界

- 同一套 `config/` 和 `data/` 同一时间只允许一个 Bot 容器写入。
- 更新路径故意保留现有 Compose；新版需要新增 volume、端口或环境变量时必须人工同步。
- Compose 中 Bot 服务名保持为 `bili-qq-bot`，用于 health 定位。
- setup 是 NapCat 首次安装助手；已有 QQ Official Compose 可以进入通用容器更新路径。

## 7. 验证矩阵

当前自动化与故障注入覆盖：

- canonical YAML、legacy JSON 和 legacy `.env`；
- 四种标准 Compose 文件名；
- 安装路径包含空格；
- Docker Compose v2 与 `docker-compose` v1 fallback；
- 已有安装环境没有 curl/wget；
- Compose config、pull、up 和 health 分阶段失败；
- 失败时文件保持不变且不误报完成；
- 首次安装非法 QQ、端口、镜像、URL 和 Token 输入；
- shell 语法、测试脚本语法和 `git diff --check`。
