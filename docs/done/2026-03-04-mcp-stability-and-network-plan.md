# 2026-03-04 MCP 稳定性与网络优化计划（更新版）

## 1. 背景

- 2026-03-04 的历史日志出现 `McpManager` 高频并发重连与 `uvx` 反复下载依赖。
- 当前阶段先收敛网络配置改动范围，只保留镜像源配置，避免一次引入过多变量。

## 2. 本次已落地

- `docker-compose.yml` 仅保留镜像源相关环境变量：
  - `NPM_CONFIG_REGISTRY=https://registry.npmmirror.com`
  - `UV_DEFAULT_INDEX=https://pypi.tuna.tsinghua.edu.cn/simple`
  - `UV_EXTRA_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/`

## 3. 暂不实施项（已明确移除）

- 不在 `docker-compose.yml` 中新增 DNS 配置。
- 不在 `docker-compose.yml` 中新增 `npm/uv` 超时和重试参数。
- 不在 `docker-compose.yml` 中新增缓存目录挂载（`/app/.npm`、`/app/.cache/uv`）。

## 4. 后续代码修复计划（未执行）

目标：修复 `McpManager` 重连风暴风险，保证单服务同一时刻仅有一条重连链路。

计划改动（`src/services/mcpManager.js`）：

1. 增加每服务连接状态（connecting/reconnectTimer/retryCount/generation）。
2. 重连统一入口，去除分散 `setTimeout` 重试路径。
3. 对 `onerror/onclose` 做短窗口去重，避免双触发叠加。
4. 失败后显式清理当次 client/transport，防止资源残留。
5. reload 期间暂停自动重连，reload 结束后恢复。

## 5. 验证计划

1. 配置镜像源后重建容器，确认容器内环境变量生效。
2. 人工制造网络抖动，观察是否仍出现同秒几十条 `Attempt 1`（用于后续代码修复验收）。
3. 记录 30~60 分钟内的内存与重连日志，建立修复前基线。
