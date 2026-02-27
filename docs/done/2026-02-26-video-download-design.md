# 视频下载功能设计

## Context

用户发送 Bilibili 视频链接或订阅系统推送新视频时，机器人目前只发送预览卡片。本功能在此基础上自动下载视频并以合并转发消息独立发送，支持全局与群级配置，并提供 WebUI 管理界面。

## 需求确认

- **触发场景**：用户发送投稿视频链接 + 订阅系统推送新视频
- **内容类型**：普通投稿视频（BV/AV 号），不含番剧/直播
- **多 P 视频**：下载第一 P，并提示剩余 P 数及 `/下载 P2` 命令
- **超出时长限制**：预览卡片正常发送，另发一条独立文字提示
- **发送方式**：合并转发消息（含视频标题、UP 主、视频文件），独立于预览卡片
- **文件清理**：发送成功后自动删除 + 超过 6 小时自动清理残留

## 架构设计

```
视频链接 / 订阅推送
        ↓
  linkHandler.js / updateChecker.js
        ↓
   [发送预览卡片]  ← 不变
        ↓（异步，不阻塞预览卡片）
  VideoDownloadService.js（新）
        ↓ HTTP POST
  bili_server.py → /video_download（新端点）
        ↓
  bilibili-api-python get_download_url()
  + aiohttp 分块下载 DASH 流（视频流 + 音频流）
  + FFmpeg 合并 → MP4
        ↓
  返回本地文件路径
        ↓
  构建合并转发消息（标题 + UP主 + 视频文件）
        ↓
  [独立发送合并转发]
        ↓
  发送成功 → 删除文件
  6小时定时任务清理残留文件
```

**关键原则**：
- 下载逻辑完全在 Python 侧（利用 bilibili-api-python + aiohttp）
- Node.js 只负责调度触发和消息发送
- 下载异步执行，不阻塞预览卡片发送

## 配置系统

### 新增 META 配置项（`src/config.js`）

| 配置键 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `videoDownloadEnabled` | bool | false | 全局开关 |
| `videoDownloadResolution` | string | `1080p` | 默认分辨率（360p/480p/720p/1080p/1080p+） |
| `videoDownloadMaxDuration` | number | 600 | 最大时长（秒），0 为不限制 |
| `videoDownloadAutoClean` | bool | true | 发送后自动删除 |
| `videoDownloadCleanTimeout` | number | 6 | 定时清理超时（小时） |

群级配置（`groupConfigs[groupId]`）可独立覆盖：
- `videoDownloadEnabled`
- `videoDownloadResolution`
- `videoDownloadMaxDuration`

### 配置读取函数

```javascript
// 检查群是否启用视频下载
config.isVideoDownloadEnabledForGroup(groupId)

// 获取群的下载分辨率（群级 > 全局 > 默认）
config.getVideoDownloadResolutionForGroup(groupId)

// 获取群的最大时长限制（群级 > 全局 > 默认）
config.getVideoDownloadMaxDurationForGroup(groupId)
```

## 文件结构变更

```
src/services/
└── videoDownloadService.js   # 新增：下载调度、发送、清理

src/services/bili_server.py   # 新增 /video_download 端点

src/config.js                 # 新增 5 个 META 配置项 + 3 个 helper 函数

src/handlers/linkHandler.js   # 新增：视频链接触发下载逻辑

src/services/subscription/
└── updateChecker.js          # 新增：订阅推送触发下载逻辑

src/commands/
└── download.js               # 新增：下载相关命令

src/commands/index.js         # 注册新命令

data/downloads/               # 新增：视频临时存储目录（不入 git）

dashboard/src/pages/
└── Settings.jsx              # 新增：视频下载全局配置卡片
└── Groups.jsx                # 新增：视频下载群级标签页

src/dashboard/routes/api.js   # 新增：视频下载配置 API
```

## Python 端点设计（`bili_server.py`）

### POST `/video_download`

**请求参数：**
```json
{
  "bvid": "BV1xx411c7mD",
  "page_index": 0,
  "resolution": "1080p",
  "output_dir": "/app/data/downloads"
}
```

**处理流程：**
1. `video.Video(bvid).get_info()` 获取视频元信息（时长、分 P 数、标题）
2. `video.Video(bvid).get_download_url(page_index)` 获取 DASH 流地址
3. `VideoDownloadURLDataDetecter` 按分辨率选择最佳流
4. `aiohttp` 分块下载视频流 → `{bvid}_{timestamp}_video.tmp`
5. `aiohttp` 分块下载音频流 → `{bvid}_{timestamp}_audio.tmp`
6. `subprocess` 调用 FFmpeg 合并 → `{bvid}_{timestamp}.mp4`
7. 删除临时 `.tmp` 文件

**返回：**
```json
{
  "status": "success",
  "file_path": "/app/data/downloads/BV1xx_1234567890.mp4",
  "title": "视频标题",
  "owner": "UP主名称",
  "duration": 360,
  "total_pages": 3,
  "page_index": 0
}
```

**错误响应：**
```json
{
  "status": "error",
  "message": "duration_exceeded",
  "duration": 720,
  "max_duration": 600
}
```

### 分辨率映射

| 配置值 | DASH quality_number |
|--------|-------------------|
| `360p` | 16 |
| `480p` | 32 |
| `720p` | 64 |
| `1080p` | 80 |
| `1080p+` | 112 |

## Node.js 服务设计（`videoDownloadService.js`）

```javascript
class VideoDownloadService {
    // 主入口：下载并发送
    async downloadAndSend(ws, groupId, bvid, videoInfo)

    // 构建合并转发消息
    buildForwardMessage(filePath, title, owner, pageIndex, totalPages)

    // 发送合并转发
    async sendForwardMessage(ws, groupId, nodes)

    // 删除文件
    async cleanupFile(filePath)

    // 定时清理（启动时注册，每小时执行）
    startCleanupScheduler()
}
```

**合并转发消息结构（OneBot v11）：**
```
Node 1: [Bot] 「{title}」- {owner}
Node 2: [Bot] [CQ:video,file=file://{filePath}]
Node 3: [Bot] 共 {totalPages}P，已发送第 {pageIndex+1}P（如多P才显示）
```

## 命令设计（`src/commands/download.js`）

| 命令 | 权限 | 说明 |
|------|------|------|
| `/下载 P{n}` | 普通用户 | 下载上一条视频链接的第 n P |
| `/下载状态` | 群管理员 | 查看下载队列状态和磁盘占用 |
| `/清理下载` | 群管理员 | 手动清理 `data/downloads/` |
| `/设置 下载 开/关` | 群管理员 | 快速切换当前群下载开关 |

**多 P 提示消息（独立文字消息）：**
```
📺 当前视频共 5P，已下载第 1P
回复 /下载 P2 可继续下载其他分集
```

**超出时长限制提示消息（独立文字消息）：**
```
⚠️ 视频时长 12 分钟，超出当前限制（10 分钟），已跳过下载
```

## WebUI 设计

### Settings 页面（全局配置）

```
┌─────────────────────────────────────────┐
│  视频下载                                │
│                                         │
│  启用视频下载          [开关]            │
│  默认分辨率            [下拉选择]        │
│  最大时长限制     [____] 秒 (0=不限制)  │
│  发送后自动删除        [开关]            │
│  文件清理超时     [____] 小时           │
└─────────────────────────────────────────┘
```

### Groups 页面（群级配置，新标签页）

```
┌──────────────────────────────────────────┐
│  视频下载                                 │
│                                          │
│  启用视频下载   ○ 跟随全局  ○ 开  ○ 关   │
│  默认分辨率    ○ 跟随全局  [下拉选择] ▼  │
│  最大时长限制  ○ 跟随全局  [____] 秒     │
└──────────────────────────────────────────┘
```

## Docker 依赖

需在 `Dockerfile` 中添加 FFmpeg：
```dockerfile
RUN apt-get install -y ffmpeg
```

## 错误处理

| 场景 | 处理方式 |
|------|----------|
| 视频超出时长限制 | 发送独立提示消息，不报错 |
| FFmpeg 未安装 | 启动时检测，记录 error 日志，下载功能自动禁用 |
| 下载超时（>5分钟） | 取消下载，删除临时文件，记录 warn 日志 |
| 文件发送失败 | 保留文件（等待 6h 清理），记录 error 日志 |
| 充电专属视频 | Python 返回 403 错误，发送"充电专属，无法下载"提示 |
| 多 P 且下载失败 | 不发提示，静默失败，记录日志 |

## 实现步骤

1. **Python 端点**：`bili_server.py` 新增 `/video_download` 端点
2. **配置系统**：`config.js` 新增 META 项和 helper 函数
3. **下载服务**：新建 `src/services/videoDownloadService.js`
4. **linkHandler 集成**：视频链接识别后触发下载
5. **订阅系统集成**：`updateChecker.js` 推送新视频时触发下载
6. **命令实现**：新建 `src/commands/download.js` 并注册
7. **Dashboard API**：`api.js` 新增下载配置端点
8. **WebUI**：`Settings.jsx` 和 `Groups.jsx` 新增配置 UI
9. **Dockerfile**：添加 FFmpeg 依赖
10. **测试**：写 `test/unit/videoDownload.test.js`

## 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| 大文件超出 QQ 发送限制 | 实测 QQ 视频发送上限，必要时在提示中告知 |
| 磁盘空间耗尽 | 6h 定时清理 + 下载前检查剩余空间（< 500MB 则跳过） |
| 并发下载过多 | 限制每群同时最多 1 个下载任务，新任务排队 |
| B站 DASH 流 URL 有时效性 | 下载超时设 5 分钟，不缓存流 URL |
| Cookie 失效导致下载 403 | 复用现有全局 Cookie，错误时提示"登录状态已失效" |
