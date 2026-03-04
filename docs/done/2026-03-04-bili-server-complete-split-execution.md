# `bili_server.py` 全量 phase 执行记录

日期：2026-03-04  
对应方案：`docs/plans/2026-03-04-bili-server-complete-split-plan.md`

## 执行结果总览

- 已按 Phase 1~6 完成拆分与落地。
- `src/services/bili_server.py` 已收敛为 16 行兼容入口壳（目标 `< 200` 达成）。
- `bili_server_core` 已建成分层结构并接管全部 25 条路由。
- Node 侧 `src/services/biliApi.js` 与 `ServiceManager.js` 无需改动即可联动。

## Phase 完成明细

## Phase 1：入口壳与包骨架

- 新增 `src/services/bili_server_core/` 包骨架。
- 新增 `main.py`、`app.py`、`web/routes.py`、`web/handlers.py`。
- `src/services/bili_server.py` 改为兼容入口，仅委托 `bili_server_core.main.main()`。

## Phase 2：基础设施抽离

- 新增 `config.py`（headers、ticket、路径、下载/超时常量）。
- 新增 `auth/credential_store.py`、`auth/credential_refresh.py`、`auth/login.py`。
- 新增 `media/image_focus.py`、`media/opus_enricher.py`。

## Phase 3：低耦合业务拆分

- 新增：
  - `services/video_service.py`
  - `services/bangumi_service.py`
  - `services/user_service.py`
  - `services/feed_service.py`
  - `services/follow_service.py`
- Web handler 改为薄层调用服务函数。

## Phase 4：高复杂业务拆分

- 新增：
  - `services/article_service.py`
  - `services/dynamic_service.py`
- 保留原有回退链路与富化逻辑：
  - article <-> opus 回退
  - dynamic 话题修复
  - vote 信息补全
  - opus/article 文本与图片补全

## Phase 5：下载子系统拆分

- 新增：
  - `download/io_utils.py`
  - `download/ffmpeg.py`
  - `download/service.py`
- 保留错误语义：
  - `invalid resolution`（handler 参数校验）
  - `download_timeout`
  - `no_streams_available`
  - `invalid output_dir`

## Phase 6：Web 层收敛与收尾

- 新增 `web/responses.py` 统一响应构造。
- 移除旧文件中重复 logger 配置问题（统一在 core 模块内）。
- 文档更新：
  - `README.md` 新增 `bili_server_core` 结构说明。
  - `CLAUDE.md` 更新 Python API 关键位置和扩展步骤路径。

## 路由兼容性校验

- `get_routes()` 校验结果：共 25 条路由（24 POST + 1 GET `/health`）。
- 路径与旧实现保持一致：
  - `/video`, `/bangumi`, `/article`, `/live_room`, `/login_url`, `/login_check`
  - `/user_dynamic`, `/user_live`, `/user_videos`, `/user_articles`
  - `/dynamic_detail`, `/opus`, `/ep`, `/media`
  - `/user_info`, `/user_card`, `/my_followings`, `/my_info`
  - `/get_follow_groups`, `/dynamic_feed`, `/live_feed`
  - `/credential_info`, `/refresh_credential`, `/video_download`
  - `GET /health`

## 本地测试记录

## 1) Python 服务直连冒烟

命令：

```bash
python3 src/services/bili_server.py --port 10101
curl http://127.0.0.1:10101/health
curl -X POST http://127.0.0.1:10101/video -H 'Content-Type: application/json' -d '{"bvid":"BV1xx411c7mD"}'
curl -X POST http://127.0.0.1:10101/user_videos -H 'Content-Type: application/json' -d '{"uid":"2"}'
curl -X POST http://127.0.0.1:10101/dynamic_detail -H 'Content-Type: application/json' -d '{"dynamic_id":"1"}'
curl -X POST http://127.0.0.1:10101/get_follow_groups -H 'Content-Type: application/json' -d '{}'
curl -X POST http://127.0.0.1:10101/refresh_credential -H 'Content-Type: application/json' -d '{}'
curl -X POST http://127.0.0.1:10101/video_download -H 'Content-Type: application/json' -d '{"bvid":"BV1xx411c7mD","page_index":0,"resolution":"bad"}'
```

结果：

- `/health` 返回 `{"status":"ok"}`。
- `/video`、`/user_videos` 正常返回 `status=success`。
- `/dynamic_detail` 对 `dynamic_id=1` 返回业务错误（4101105）且结构完整（`status=error`，含 `detail`）。
- `/get_follow_groups` 正常返回分组列表。
- `/refresh_credential` 返回 `{"status":"ok","refreshed":false,...}`。
- `/video_download` 非法清晰度返回 `400 + {"status":"error","message":"invalid resolution"}`。

## 2) Node 联动验证（真实调用链）

调用链：`biliApi.js -> ServiceManager.sendCommand -> Python routes`

测试项：

- `biliApi.getVideoInfo('BV1xx411c7mD')` -> success
- `biliApi.getUserVideos('2')` -> success
- `biliApi.getDynamicInfo('1')` -> error（业务错误，结构正常）
- `biliApi.refreshCredential()` -> ok

结论：Node 侧无需改动即可联调通过。

