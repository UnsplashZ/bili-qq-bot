# `src/dashboard/routes/api.js` 完备解构方案（零接口回归）

日期：2026-03-04  
作者：Codex

## 1. 目标

将 `src/dashboard/routes/api.js` 从单文件巨型路由拆分为「入口路由 + 领域子路由 + 共享校验/工具」结构，同时确保：

1. 不改变任何 API 路径、HTTP 方法、请求参数、响应字段与状态码语义。
2. 不改变认证边界（`/api/login` 公开，其余默认需 JWT）。
3. 不改变关键副作用行为（配置持久化、MCP reload、重启、登录限流、订阅联动）。
4. 不改变前端现有调用方式（`dashboard/src/...` 已使用的 `/api/*` 全兼容）。

## 2. 现状盘点

## 2.1 文件规模与复杂度热点

- 文件规模：`api.js` 共 1757 行。
- 路由总数：34（`GET 14` / `POST 12` / `PUT 2` / `DELETE 6`）。
- Top 大处理器：
  1. `POST /mcp`（约 189 行）
  2. `POST /groups/:id/config`（约 181 行）
  3. `POST /ai`（约 154 行）
  4. `POST /login`（约 93 行）
  5. `PUT /groups/:groupId/ai-config`（约 81 行）

结论：主要复杂度集中在 MCP、群配置、AI 配置与登录安全逻辑。

## 2.2 当前路由清单（冻结基线）

1. `POST /login`
2. `GET /config`
3. `POST /config`
4. `GET /groups`
5. `POST /groups/:id/toggle`
6. `POST /groups/:id/config`
7. `DELETE /groups/:id`
8. `GET /groups/:groupId/ai-config`
9. `PUT /groups/:groupId/ai-config`
10. `DELETE /groups/:groupId/ai-config`
11. `GET /groups/:groupId/video-download-config`
12. `PUT /groups/:groupId/video-download-config`
13. `DELETE /groups/:groupId/video-download-config`
14. `GET /groups/:id/bili-groups`
15. `GET /bili/login-url`
16. `POST /bili/check-login`
17. `GET /bili/my-info`
18. `GET /bili/global-status`
19. `POST /bili/logout`
20. `GET /groups/:id/subscriptions`
21. `GET /groups/:id/atall-targets`
22. `POST /groups/:id/subscriptions`
23. `DELETE /groups/:id/subscriptions`
24. `GET /blacklist/global`
25. `POST /blacklist/global`
26. `DELETE /blacklist/global/:qq`
27. `GET /mcp`
28. `POST /mcp`
29. `POST /ai`
30. `POST /ai/reset`
31. `POST /restart`
32. `GET /monitor`
33. `GET /profiles/:groupId`
34. `DELETE /profiles/:groupId/:userId`

## 2.3 对外依赖边界（不可破坏）

前端已在多个 hooks 中强依赖上述路径与响应结构（`dashboard/src/pages/settings/hooks/*`、`dashboard/src/pages/groups/hooks/*`、`dashboard/src/utils/auth.js`）。拆分后必须保持：

1. 接口路径不变（含动态参数命名）。
2. `login` 失败/锁定响应字段不变（`remainingAttempts`、`retryAfter`）。
3. `mcp` 的并发冲突 `409`、部分成功 `207` 语义不变。
4. `video-download-config` 中 `null = 清除群级覆盖` 语义不变。
5. `groups/:id/config` 中 `null` 回退全局默认语义不变。
6. `restart` 立即响应后延迟退出行为不变。

## 2.4 主要耦合问题

1. 单文件混合：认证、校验、配置 IO、安全策略、业务路由全部耦合。
2. 校验逻辑重复：AI 配置、群配置、视频下载配置存在字段验证分散。
3. 安全逻辑分散：登录限流、cookie 文件删除安全校验、认证中间件边界混在一起。
4. 隐式副作用：`setInterval` 登录限流清理在模块顶层初始化，后续拆分若处理不当易重复注册。

## 3. 设计原则（必须遵守）

1. **先搬运后优化**：先拆文件，不重写业务语义。
2. **边界显式**：路由层只做参数解析、调用 domain handler、返回响应。
3. **中间件顺序冻结**：`/login` 公开，其后统一 `router.use(authenticateToken)`。
4. **状态码冻结**：保留当前 `400/401/404/409/429/500/207` 判定与返回格式。
5. **单次初始化**：登录限流清理定时器仅初始化一次。

## 4. 目标结构

```text
src/dashboard/routes/
├── api.js                              # 兼容入口壳（装配子路由）
└── api/
    ├── index.js                        # createApiRouter() / middleware wiring
    ├── shared/
    │   ├── normalize.js                # normalizeGroupId/QQ/blacklist/sync names
    │   ├── validators.js               # ai/group/videoDownload/nightMode 校验
    │   ├── config-store.js             # read/write config + MCP config
    │   ├── mcp-utils.js                # deep sort / version-stripped compare
    │   ├── response.js                 # 统一 error/success helper（不改字段）
    │   └── login-rate-limit.js         # check/record/reset/cleanup interval
    ├── middleware/
    │   └── auth-gate.js                # 包装 authenticateToken 边界（可选）
    └── modules/
        ├── auth.js                     # /login
        ├── config.js                   # /config
        ├── groups.js                   # /groups*（基础配置、开关、删除）
        ├── group-ai.js                 # /groups/:groupId/ai-config*
        ├── group-video-download.js     # /groups/:groupId/video-download-config*
        ├── bili.js                     # /bili/*
        ├── subscriptions.js            # /groups/:id/subscriptions*
        ├── atall-targets.js            # /groups/:id/atall-targets
        ├── blacklist.js                # /blacklist/global*
        ├── mcp.js                      # /mcp*
        ├── ai.js                       # /ai*（保存+重置）
        ├── system.js                   # /restart /monitor
        └── profiles.js                 # /profiles/:groupId*
```

说明：`src/dashboard/server.js` 继续 `app.use('/api', apiRoutes)`，无需改调用方。

## 5. 分阶段实施计划

## Phase 0：基线冻结

1. 导出当前 34 路由清单（方法+路径）。
2. 抽样保存关键接口响应（成功/失败）：
   - `/login`（成功、失败、锁定）
   - `/groups/:id/config`（合法、非法 nightMode）
   - `/mcp`（正常、冲突 409、reload 失败 207）
   - `/ai`（合法、字段越界）
   - `/bili/logout`（非法 groupId 拒绝）
3. 记录前端依赖点（Groups/Settings hooks）。

产出：基线文档与样例 JSON。

## Phase 1：入口壳与目录骨架

1. 新建 `routes/api/` 目录与 `index.js`。
2. `src/dashboard/routes/api.js` 保留兼容导出，内部委托新入口。
3. 暂不改 handler 逻辑，仅搬迁组织结构。

验收：服务启动正常，`/api/status` 与 `/api/login` 可用。

## Phase 2：共享工具抽离（低风险）

1. 抽离 `normalize*`、`MCP compare`、`config read/write`、`login rate limit`。
2. 保持函数签名一致，路由调用方式不变。
3. 为 login rate limiter 增加单例保护，避免定时器重复注册。

验收：登录限流行为（5 次失败后 5 分钟锁定）不变。

## Phase 3：低耦合路由拆分

1. 拆分 `config`、`blacklist`、`system`、`monitor`、`profiles`。
2. 路由层保持原响应字段与状态码。
3. 不改业务服务依赖（`sysConfig`、`userProfileService`）。

验收：Settings 页面基础功能与监控页正常。

## Phase 4：群组与订阅域拆分（中风险）

1. 拆 `groups`、`group-ai`、`group-video-download`、`subscriptions`、`atall-targets`。
2. 保持 `null` 语义与 `subscriptionAtAllRules` normalize 逻辑。
3. 保持 `global.bot.groupList` 存在性校验逻辑。

验收：Groups 页面全链路（切群/保存/订阅/权限/@all）不回归。

## Phase 5：Bili 与 MCP/AI 高复杂路由拆分（高风险）

1. 拆 `bili`（登录/状态/logout/分组）模块。
2. 拆 `mcp` 模块，冻结版本冲突与 reload 状态码语义。
3. 拆 `ai` 模块，冻结数值范围验证与 reset 行为。

验收：Settings 的 Bili、MCP、AI 三大区域行为一致。

## Phase 6：收尾与 review

1. `api.js` 收敛为入口壳（目标 `< 200` 行）。
2. 清理重复中间件声明与重复校验逻辑。
3. 补充开发文档（新增路由模块组织说明）。

验收：34 路由全部存在且响应兼容。

## 6. 高风险点与缓解

1. 风险：认证边界漂移导致未授权访问或误拦截。  
缓解：保持 `/login` 在 auth middleware 之前注册，其余统一在之后。

2. 风险：`mcp` 冲突控制回归，导致并发写覆盖。  
缓解：先原样搬运版本比对逻辑，再做结构清理。

3. 风险：`groups/:id/config` 的 `null` 继承语义丢失。  
缓解：抽离“null 清理”纯函数并建立快照对比测试。

4. 风险：登录限流清理定时器重复注册造成内存泄漏。  
缓解：单例模块 + 导出初始化函数，入口仅调用一次。

5. 风险：`bili/logout` 路径校验调整导致安全回退。  
缓解：三层校验（文件名白名单、路径前缀、groupId 数字校验）原样保留。

## 7. 完成定义（DoD）

1. `src/dashboard/routes/api.js` 不再承载大量业务实现，仅做装配。
2. `src/dashboard/routes/api/modules/*.js` 完成按域拆分。
3. 34 个 API 路径、方法、主要状态码保持一致。
4. Dashboard 前端（Settings / Groups / Dashboard）无需改动即可工作。
5. 本地回归清单全部通过。

## 8. 本地联调与回归清单（建议）

## 8.1 基础与静态

```bash
npm run lint
npm run build
```

## 8.2 API 冒烟

```bash
# 1) 登录成功
curl -s -X POST http://127.0.0.1:3000/api/login \
  -H 'Content-Type: application/json' \
  -d '{"password":"<dashboard_password>"}'

# 2) 登录失败与限流（连续错误密码 >=5 次）
# 预期第 6 次出现 429 + retryAfter

# 3) 全局配置读取与更新
curl -s http://127.0.0.1:3000/api/config -H "Authorization: Bearer <token>"
curl -s -X POST http://127.0.0.1:3000/api/config -H "Authorization: Bearer <token>" -H 'Content-Type: application/json' -d '{"linkCacheTimeout":300}'

# 4) MCP 冲突测试（version 不一致预期 409）

# 5) 群配置非法时间校验（预期 400）
# POST /api/groups/:id/config 传非法 nightMode
```

## 8.3 前端联动（精选）

1. Settings：
   - 全局配置保存
   - Bili 扫码登录与状态刷新
   - MCP 增删改启停 + 并发冲突弹窗
   - AI 配置保存/重置
2. Groups：
   - 群开关、配置保存
   - 订阅增删
   - `@全体` 目标列表联动
   - 群级 AI 与视频下载配置保存/重置
3. Dashboard：
   - `/api/monitor` 指标刷新正常。

## 9. 非目标

1. 本次不改 API 协议，不改前端调用层。
2. 本次不替换 `sysConfig` 持久化机制。
3. 本次不重写业务逻辑（仅结构重组）。
4. 本次不引入新的框架级路由库。

