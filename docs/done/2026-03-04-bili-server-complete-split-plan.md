# `src/services/bili_server.py` 完整解构方案（零协议回归）

日期：2026-03-04  
作者：Codex

## 1. 背景与目标

`src/services/bili_server.py` 当前约 2276 行，承载了 Python 子进程服务的全部能力：

1. Cookie 凭证读写与刷新。
2. B 站内容聚合（视频/番剧/专栏/动态/用户/关注流）。
3. 动态与专栏正文修复、话题/投票补全、色彩提取。
4. 视频下载（DASH 探测、分流下载、FFmpeg 合并）。
5. aiohttp Web 路由与 handler。

本方案目标是将其拆分为「入口壳 + Web 层 + 领域服务层 + 基础设施层」，在不改变 Node 侧调用协议的前提下，降低维护复杂度与回归风险。

## 2. 现状盘点

### 2.1 文件规模与复杂函数

按函数跨度统计（Top）：

1. `get_dynamic_detail`：约 306 行
2. `get_user_dynamic`：约 188 行
3. `get_my_followings`：约 167 行
4. `download_video_file`：约 156 行
5. `get_article_info`：约 106 行

结论：当前复杂度集中在 `dynamic/article/followings/download` 四大域。

### 2.2 对外接口边界（不可破坏）

`biliApi.js` 通过 `ServiceManager.sendCommand(endpoint, data)` 与本服务通信，强依赖以下契约：

1. 命令名与路由路径严格对应（例如 `video` -> `POST /video`）。
2. 绝大多数接口返回 `{"status": "success|error", ...}` 格式。
3. `ServiceManager` 依赖 `GET /health` 检测服务可用。
4. 视频下载接口是直连 `POST /video_download`，并依赖现有错误码语义（如 `download_timeout`）。

当前路由共 25 个（24 个 `POST` + 1 个 `GET /health`），拆分后必须全量保持。

### 2.3 主要耦合问题

1. Web handler、业务逻辑、B 站 SDK 调用和文件系统操作混在一处。
2. 存在重复的异常处理与响应封装，handler 大量模板代码。
3. 日志配置与 `logger` 定义在文件中出现两次（顶部与 Web 区域）。
4. `group_id` Cookie 语义已废弃，但仍残留部分兼容逻辑与映射文件路径。
5. 下载流程（网络、临时文件、FFmpeg 子进程）和业务服务未隔离，测试困难。

## 3. 设计原则（必须遵守）

1. **协议不变**：路由、HTTP 方法、请求字段、响应结构保持兼容。
2. **先迁移后优化**：先做结构搬迁，不在同阶段重写算法。
3. **入口兼容**：保留 `src/services/bili_server.py` 作为默认启动路径（`config.biliScriptPath` 兼容）。
4. **显式边界**：Web 层不直接写业务逻辑，只做入参校验/调用/响应。
5. **高风险模块后拆**：`dynamic/article/followings/download` 放到后续阶段单独收敛。

## 4. 目标结构

建议新建包：`src/services/bili_server_core/`，并保留 `src/services/bili_server.py` 作为入口壳。

```text
src/services/
├── bili_server.py                        # 兼容入口：解析参数并调用 core.main
└── bili_server_core/
    ├── __init__.py
    ├── main.py                           # CLI 启动（run_app）
    ├── app.py                            # create_app / startup / cleanup
    ├── config.py                         # 常量、路径、headers、timeout
    ├── web/
    │   ├── routes.py                     # 路由注册（保持 25 条）
    │   ├── handlers.py                   # HTTP handlers（薄层）
    │   └── responses.py                  # success/error 统一响应工具
    ├── auth/
    │   ├── credential_store.py           # load/save/ensure_buvid3
    │   ├── credential_refresh.py         # refresh_credential_if_needed
    │   └── login.py                      # get_login_url / poll_login
    ├── services/
    │   ├── video_service.py              # get_video_info
    │   ├── bangumi_service.py            # get_bangumi_info / get_ep_info / get_media_info
    │   ├── article_service.py            # get_article_info / get_opus_detail
    │   ├── dynamic_service.py            # get_user_dynamic / get_dynamic_detail
    │   ├── user_service.py               # get_user_info / get_user_card / get_my_info
    │   ├── follow_service.py             # get_my_followings / get_follow_groups
    │   └── feed_service.py               # get_dynamic_feed / get_live_feed / get_user_live/videos/articles
    ├── media/
    │   ├── image_focus.py                # _fetch_bytes / get_image_focus_color / color utils
    │   └── opus_enricher.py              # 正文提取、placeholder 处理、Opus 富化
    └── download/
        ├── service.py                    # download_video_file / handle_download params
        ├── io_utils.py                   # _download_stream_to_file
        └── ffmpeg.py                     # remux/merge 与超时控制
```

## 5. 方法迁移映射（旧 -> 新）

### 5.1 认证与凭证

1. `load_credential` / `save_credential` / `ensure_buvid3` -> `auth/credential_store.py`
2. `_fetch_buvid3` / `refresh_credential_if_needed` -> `auth/credential_refresh.py`
3. `get_login_url` / `poll_login` -> `auth/login.py`

### 5.2 内容聚合

1. `get_video_info` -> `services/video_service.py`
2. `get_bangumi_info` / `get_ep_info` / `get_media_info` -> `services/bangumi_service.py`
3. `get_article_info` / `get_opus_detail` -> `services/article_service.py`
4. `get_user_dynamic` / `get_dynamic_detail` -> `services/dynamic_service.py`
5. `get_user_info` / `get_user_card` / `get_my_info` -> `services/user_service.py`
6. `get_my_followings` / `get_follow_groups` -> `services/follow_service.py`
7. `get_user_live` / `get_user_videos` / `get_user_articles` / `get_dynamic_feed` / `get_live_feed` -> `services/feed_service.py`

### 5.3 媒体与正文工具

1. `get_image_focus_color` 及色彩工具 -> `media/image_focus.py`
2. `_extract_cv_id` / `_normalize_preview_text` / `_count_image_placeholders` / `_strip_image_placeholders` / `_extract_opus_content_payload` -> `media/opus_enricher.py`

### 5.4 下载

1. `_download_stream_to_file` -> `download/io_utils.py`
2. `download_video_file` -> `download/service.py`
3. FFmpeg 调用细节 -> `download/ffmpeg.py`

### 5.5 Web 层

1. `handle_*` 系列 -> `web/handlers.py`
2. `create_app` + `app.add_routes` -> `app.py` + `web/routes.py`
3. `health_check` / `on_startup` / `on_cleanup` -> `app.py`

## 6. 分阶段实施计划（可执行）

## Phase 0：基线冻结

1. 记录当前 25 个路由清单与命令映射。
2. 保存关键接口样本（成功/错误各至少 1 例）：
   - `/video` `/article` `/dynamic_detail` `/my_followings` `/video_download` `/refresh_credential`
3. 记录本地校验命令基线（见第 9 节）。

产出：基线文档 + 样本 JSON。

## Phase 1：入口壳与包骨架

1. 新建 `bili_server_core` 包与 `main.py`/`app.py`。
2. `src/services/bili_server.py` 保留启动参数解析，仅委托到 core。
3. `create_app` 与现有路由先原样迁移（不改逻辑）。

验收：`python3 src/services/bili_server.py --port 10001` 可启动，`/health` 正常。

## Phase 2：基础设施抽离（低风险）

1. 抽离 `config.py`（headers/paths/timeout 常量）。
2. 抽离 `auth/credential_store.py` 与 `auth/credential_refresh.py`。
3. 抽离 `media/image_focus.py`（纯工具）。

验收：登录状态、凭证读取、头像/封面主色结果不变。

## Phase 3：低耦合业务服务拆分

1. 先拆 `video/bangumi/live/user_card/user_info/my_info`。
2. handler 保持调用名称不变，仅改 import。
3. 引入 `web/responses.py` 统一成功/错误格式（不改字段）。

验收：上述接口返回 JSON 字段不变（键名/类型）。

## Phase 4：高复杂业务拆分（重点）

1. 拆 `article_service.py`（抓取回退 + Opus 回退）。
2. 拆 `dynamic_service.py`（话题修复、投票富化、正文富化）。
3. 拆 `follow_service.py`（分组聚合与分页）。

验收：

1. `dynamic_detail` 关键字段保持：`item.modules.module_dynamic.*`、`author.*`。
2. `article`/`opus` 回退链路一致。
3. `my_followings` 的 `biliGroups` 注入行为一致。

## Phase 5：下载子系统拆分

1. 抽离下载 I/O、DASH 检测、FFmpeg 合并逻辑。
2. 保留 `download_timeout`、`invalid resolution` 等错误语义。
3. 保留输出目录白名单安全策略。

验收：

1. 720p/1080p+ 下载流程可跑通。
2. 超时与失败时的清理行为一致（临时文件/子进程）。

## Phase 6：Web 层收敛与收尾

1. 将 `handle_*` 收敛为薄层 + 参数校验。
2. 去掉重复 logger 配置与重复 import。
3. 补充 README/CLAUDE 中 Python 服务结构说明。

验收：

1. `bili_server.py` < 200 行（壳层）。
2. 25 路由仍全部存在。

## 7. 高风险点与缓解

1. 风险：命令/路由名变更导致 Node 全面失效。  
   缓解：冻结 `biliApi.js` endpoint 字符串，拆分期间禁止改名。

2. 风险：动态富化逻辑微调导致渲染回归。  
   缓解：为 `get_dynamic_detail` 建立 golden 样本对比（关键字段对比，不比时间戳）。

3. 风险：下载流程拆分后出现僵尸 FFmpeg 或临时文件泄漏。  
   缓解：保持 `finally` 清理与超时 kill 逻辑原样迁移，再逐步重构。

4. 风险：Cookie 语义混淆（全局 vs 群组）。  
   缓解：在 `auth/credential_store.py` 明确“仅全局 Cookie”策略，保留 `group_id` 兼容参数但不改变行为。

5. 风险：广义 `except` 重构时吞掉关键错误上下文。  
   缓解：先迁移不改异常分支，再分阶段引入统一错误类型。

## 8. 完成定义（DoD）

1. `src/services/bili_server.py` 仅保留入口逻辑，不再承载核心业务。
2. `bili_server_core` 目录按域拆分完成。
3. `biliApi.js` 无需改动即可正常调用。
4. 25 路由协议与返回结构保持兼容。
5. 本地回归清单全部通过。

## 9. 本地回归清单（建议）

### 9.1 基础链路

```bash
python3 src/services/bili_server.py --port 10001
curl http://127.0.0.1:10001/health
```

### 9.2 核心接口冒烟

```bash
curl -s -X POST http://127.0.0.1:10001/video -H 'Content-Type: application/json' -d '{"bvid":"BV1xx411c7mD"}'
curl -s -X POST http://127.0.0.1:10001/user_videos -H 'Content-Type: application/json' -d '{"uid":"2"}'
curl -s -X POST http://127.0.0.1:10001/dynamic_detail -H 'Content-Type: application/json' -d '{"dynamic_id":"1"}'
curl -s -X POST http://127.0.0.1:10001/get_follow_groups -H 'Content-Type: application/json' -d '{}'
```

### 9.3 Node 联调（关键）

1. 启动 Bot，确保 `ServiceManager` 正常拉起 Python 服务。
2. 走 `biliApi` 调用链验证：
   - `getVideoInfo`
   - `getUserDynamic`
   - `getDynamicInfo`
   - `getUserVideos`
   - `refreshCredential`
3. 验证下载链路：`videoDownloadService -> biliApi.downloadVideo -> /video_download`。

## 10. 非目标

1. 本次不更换 `bilibili_api` 库。
2. 本次不改 Node 侧缓存策略。
3. 本次不修改接口协议为 RESTful 风格（保留现有 POST 命令风格）。
4. 本次不在同阶段引入大量行为重写（如分页策略重构）。

## 11. 实施顺序建议

1. 先做 Phase 1 + Phase 2（快速降低文件尺寸，风险最低）。
2. 再做 Phase 3（常规接口服务化）。
3. 最后做 Phase 4 + Phase 5（复杂逻辑与下载，分支验证更充分）。
4. Phase 6 收尾时同步文档与运维说明。

