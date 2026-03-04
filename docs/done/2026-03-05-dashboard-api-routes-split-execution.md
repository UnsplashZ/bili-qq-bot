# `src/dashboard/routes/api.js` 全阶段执行记录

日期：2026-03-05  
对应方案：`docs/plans/2026-03-04-dashboard-api-routes-split-plan.md`

## 执行结论

- Phase 1~6 已全部执行完成。
- `src/dashboard/routes/api.js` 已收敛为 6 行兼容入口。
- 路由实现已拆分到 `src/dashboard/routes/api/`。
- 路由总数保持 34 条，路径与方法与拆分前一致。

## 结构结果

新增目录：

```text
src/dashboard/routes/api/
├── index.js
├── modules/
│   ├── ai.js
│   ├── auth.js
│   ├── bili.js
│   ├── blacklist.js
│   ├── config.js
│   ├── group-ai.js
│   ├── group-video-download.js
│   ├── groups.js
│   ├── mcp.js
│   ├── profiles.js
│   ├── subscriptions.js
│   └── system.js
└── shared/
    ├── config-store.js
    ├── login-rate-limit.js
    ├── mcp-utils.js
    └── normalize.js
```

`src/dashboard/routes/api.js` 仅做转发：

- `module.exports = require('./api/index')`

## 兼容性校验

## 路由数量与清单

- 统计结果：`count 34`
- 方法分布：`GET 14 / POST 12 / PUT 2 / DELETE 6`
- 包含关键路径：
  - `/login`
  - `/config`
  - `/groups/:id/config`
  - `/groups/:id/atall-targets`
  - `/mcp`
  - `/ai` `/ai/reset`
  - `/bili/*`
  - `/monitor`
  - `/profiles/:groupId`

## 本地联调结果

使用本地 `dashboard server` 启动于临时端口进行验证：

1. 认证与边界
   - `POST /api/login` 成功返回 token
   - 错误密码返回 `401` 且包含 `remainingAttempts`
2. 受保护路由
   - `GET /api/config` 返回成功
   - `POST /api/config` 仅无效字段时返回 `400`
3. MCP 语义
   - 非数组 `mcpServers` 返回 `400`
   - 版本冲突返回 `409` + `conflict: true`
   - 内容无变化返回 `200` + `skippedReload: true`
4. 群配置与参数校验
   - `POST /api/groups/:id/config` 非法 nightMode 时间返回 `400`
   - `PUT /api/groups/:groupId/video-download-config` 非法分辨率返回 `400`
5. AI 校验
   - `POST /api/ai` 越界 `aiProbability` 返回 `400` 且字段名正确
6. 其他
   - `GET /api/monitor` 返回系统指标
   - `GET /api/blacklist/global` 返回数组
   - `GET /api/bili/global-status` 可正常返回登录状态结构
   - `POST /api/bili/logout` 非法 groupId 返回 `400`

## 风险复核

- 认证顺序保持不变：`/login` 公开，其余在 `router.use(authenticateToken)` 之后。
- 登录限流保持原策略：5 次失败锁定 5 分钟，并保留定期清理。
- `mcp` 路由保留 `409` 并发冲突与 `207` 重载失败语义。
- `groups/:id/config` 中 `null` 覆盖清理语义保持一致。

