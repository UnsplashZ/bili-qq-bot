# 视频下载功能 Review 修复计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复 code review 发现的 6 个 Critical/Important 问题，确保视频下载功能在生产环境可靠运行。

**Architecture:** 涉及 Python 端（bili_server.py）、Node 服务层（videoDownloadService.js、biliApi.js）、Dashboard API（api.js）及命令层（download.js）的多处改动，各任务相互独立，可按序执行。

**Tech Stack:** Python 3 / aiohttp / bilibili-api-python，Node.js 18+ / WebSocket，React / Vite Dashboard

---

## 背景

在 `feature/video-download` 分支实现完成后，经 code review 发现以下问题（按优先级排序）：

| # | 文件 | 问题描述 | 严重度 |
|---|------|---------|--------|
| 20 | `api.js` + `Settings.jsx` | 全局视频下载配置无法保存（键未加入白名单） | **Critical** |
| 15 | `bili_server.py` | 文件名秒级时间戳碰撞，多群同时下载同一视频互相覆盖 | Important |
| 17 | `videoDownloadService.js` | `lastDownloadInfo` 在下载完成后才写，竞态导致 `/下载 P2` 操作错误视频 | Important |
| 18 | `videoDownloadService.js` + `bot.js` | stale ws 引用：下载期间断线重连后发送到已关闭连接 | Important |
| 16 | `bili_server.py` + `biliApi.js` | Python 端重复调用 `v.get_info()`，Node 侧已有元信息未复用 | Important |
| 22 | `download.js` + `videoDownloadService.js` | 命令触发的下载失败无用户反馈 | Important |

---

## Task 1：修复全局视频下载配置无法保存（#20）

**文件：**
- Modify: `src/dashboard/routes/api.js:183-188`
- Modify: `dashboard/src/pages/Settings.jsx:364-370`（可选，验证保存逻辑）

**问题：**
`ALLOWED_GLOBAL_CONFIG_KEYS` 数组不包含任何 `videoDownload*` 键，Settings.jsx 提交后全部被过滤，返回 400，全局视频下载配置完全无法持久化。

**Step 1：在 api.js 中将 videoDownload 配置键加入白名单**

在 `ALLOWED_GLOBAL_CONFIG_KEYS` 数组中添加 5 个键：

```javascript
const ALLOWED_GLOBAL_CONFIG_KEYS = [
    'subscriptionCheckInterval',
    'linkCacheTimeout',
    'aiEnabled',
    'aiRagEnabled',
    'videoDownloadEnabled',
    'videoDownloadResolution',
    'videoDownloadMaxDuration',
    'videoDownloadAutoClean',
    'videoDownloadCleanTimeout',
];
```

**Step 2：在 POST /api/config 的过滤逻辑后添加 videoDownloadResolution 校验**

在 `Object.assign(sysConfig, filtered)` 之前，检查 `videoDownloadResolution` 值合法性：

```javascript
const VALID_RESOLUTIONS = ['360p', '480p', '720p', '1080p', '1080p+']
if (filtered.videoDownloadResolution !== undefined &&
    !VALID_RESOLUTIONS.includes(filtered.videoDownloadResolution)) {
    return res.status(400).json({ error: 'invalid videoDownloadResolution' })
}
```

**Step 3：验证**

启动服务，在 Settings 页面修改视频下载配置并保存，检查 `config/config.json` 中对应键是否持久化。

**Step 4：提交**

```bash
git add src/dashboard/routes/api.js
git commit -m "fix: 将 videoDownload 配置键加入全局白名单，修复设置无法保存问题"
```

---

## Task 2：修复文件名秒级时间戳碰撞（#15）

**文件：**
- Modify: `src/services/bili_server.py:1663-1665`

**问题：**
`f'{safe_bvid}_{timestamp}.mp4'` 以秒为单位，两个群同时下载同一视频生成相同文件名，FFmpeg `-y` 静默覆盖导致文件损坏。

**Step 1：在文件名中加入 group_id 和随机后缀**

替换原 `output_path` 生成逻辑：

```python
import secrets  # 文件顶部添加（如未导入）

# 原代码
timestamp = int(time.time())
safe_bvid = re.sub(r'[^a-zA-Z0-9_-]', '_', bvid)
output_path = os.path.join(resolved_dir, f'{safe_bvid}_{timestamp}.mp4')

# 修改为
timestamp = int(time.time())
safe_bvid = re.sub(r'[^a-zA-Z0-9_-]', '_', bvid)
safe_group = re.sub(r'[^a-zA-Z0-9_-]', '_', str(group_id or 'default'))
rand_suffix = secrets.token_hex(4)  # 8位随机十六进制，冲突概率约 1/4G
output_path = os.path.join(resolved_dir, f'{safe_bvid}_{safe_group}_{timestamp}_{rand_suffix}.mp4')
```

注意：`.tmp` 文件名由 `output_path + '_v.tmp'` / `+ '_a.tmp'` 自动派生，不需单独修改。

**Step 2：检查 import secrets 是否已存在**

```bash
grep -n "^import secrets" src/services/bili_server.py
```

若无则在文件顶部 import 块中添加。

**Step 3：验证 Python 语法**

```bash
python3 -c "import ast; ast.parse(open('src/services/bili_server.py').read()); print('OK')"
```

**Step 4：提交**

```bash
git add src/services/bili_server.py
git commit -m "fix: 文件名加入 group_id 和随机后缀，消除秒级时间戳碰撞"
```

---

## Task 3：修复 lastDownloadInfo 竞态（#17）

**文件：**
- Modify: `src/services/videoDownloadService.js:87-160`

**问题：**
`lastDownloadInfo` 在 `biliApi.downloadVideo()` 返回后才写入（下载完成时）。下载期间若另一视频先完成，`/下载 P2` 会操作错误的视频。

**Step 1：将 lastDownloadInfo 写入时机移至下载开始前**

找到 `downloadAndSend` 方法中去重检查通过、开始下载之前的位置，提前写入：

```javascript
// 在 this._activeDownloads++ 之前写入"最近请求"记录
// 注意：此时 result.title/owner 未知，从 videoInfo 参数读取
const gid = String(groupId)
lastDownloadInfo.set(gid, {
    bvid,
    title: videoInfo?.data?.title ?? bvid,
    owner: videoInfo?.data?.owner?.name ?? 'Unknown',
    totalPages: videoInfo?.data?.pages?.length ?? 1,
    pageIndex,
})

this._activeDownloads++
_inProgressDownloads.add(downloadKey)
```

**Step 2：删除原 download 成功后的 lastDownloadInfo.set 调用**

找到并删除：

```javascript
// 删除此块（原约 150-158 行）
lastDownloadInfo.set(String(groupId), {
    bvid,
    title: result.title,
    owner: result.owner,
    totalPages: result.total_pages,
    pageIndex: result.page_index,
})
```

**Step 3：确认 getLastDownloadInfo 逻辑不变**

`getLastDownloadInfo` 直接返回 map 值，无需修改。

**Step 4：写测试**

在 `test/unit/videoDownloadConfig.test.js` 或新文件中，验证在 `downloadAndSend` 开始时 `getLastDownloadInfo` 就能返回当前视频信息（需 mock biliApi）。

**Step 5：提交**

```bash
git add src/services/videoDownloadService.js
git commit -m "fix: lastDownloadInfo 改在下载开始前写入，消除竞态"
```

---

## Task 4：修复 stale ws 引用（#18）

**文件：**
- Modify: `src/bot.js`
- Modify: `src/services/videoDownloadService.js:163-207`

**问题：**
`downloadAndSend(ws, ...)` 捕获调用时的 ws 对象。下载耗时数分钟，期间若 WebSocket 断线重连，ws 指向已关闭连接，`_sendForwardMessage` 检测到 `readyState !== 1` 后静默失败，视频白下了。

**Step 1：在 bot.js 中将当前活跃 ws 暴露到 global.bot**

在 `connectWebSocket` 函数中，`ws = new WebSocket(...)` 之后立即更新：

```javascript
ws = new WebSocket(`${config.wsUrl}?access_token=${config.wsToken}`)
global.bot.ws = ws  // 暴露当前活跃连接
```

在断线处理（`ws.on('close')` 或 `ws.on('error')`）中清空：

```javascript
ws.on('close', function() {
    if (global.bot.ws === ws) global.bot.ws = null  // 仅清空当前实例
    // ... 现有重连逻辑
})
```

**Step 2：修改 _sendForwardMessage 从全局取 ws**

```javascript
async _sendForwardMessage(ws, groupId, result) {
    // 优先使用全局当前活跃连接，fallback 到传入参数
    const activeWs = global.bot?.ws || ws
    if (!activeWs || activeWs.readyState !== 1) {
        logger.warn(`[VideoDownload] WebSocket not open, cannot send forward message for ${result.title}`)
        return false
    }
    // 后续代码中 ws → activeWs
    activeWs.send(JSON.stringify(payload))
    // ...
}
```

**Step 3：验证现有 readyState 检查逻辑不受影响**

检查 `_sendForwardMessage` 其余逻辑引用 `ws` 变量的地方，全部改为 `activeWs`。

**Step 4：提交**

```bash
git add src/bot.js src/services/videoDownloadService.js
git commit -m "fix: _sendForwardMessage 从 global.bot.ws 取当前活跃连接，防止 stale ws 引用"
```

---

## Task 5：消除 Python 端重复调用 v.get_info()（#16）

**文件：**
- Modify: `src/services/biliApi.js:50-71`（新增传参）
- Modify: `src/services/bili_server.py:1618-1644`（接收元信息）
- Modify: `src/services/videoDownloadService.js:125`（传递元信息）

**问题：**
Node.js 调用 `downloadAndSend` 时已持有 `videoInfo`（含 title/owner/duration/pages），但 Python `download_video_file` 再次调用 `v.get_info()`，浪费 API 配额，在 B 站风控严格时可能触发 412。

**Step 1：修改 biliApi.downloadVideo 传递元信息**

```javascript
async downloadVideo(bvid, pageIndex, resolution, outputDir, groupId, videoMeta = null) {
    // videoMeta: { title, owner, duration, total_pages } — 已知时传入，跳过 Python 重复拉取
    const response = await axios.post(url, {
        bvid,
        page_index: pageIndex,
        resolution,
        output_dir: outputDir,
        group_id: groupId,
        video_meta: videoMeta,  // 新增字段
    }, { timeout: 5 * 60 * 1000 })
}
```

**Step 2：修改 videoDownloadService 传递元信息**

```javascript
const meta = videoInfo?.data ? {
    title: videoInfo.data.title,
    owner: videoInfo.data.owner?.name ?? 'Unknown',
    duration: videoInfo.data.duration ?? 0,
    total_pages: videoInfo.data.pages?.length ?? 1,
} : null

result = await biliApi.downloadVideo(bvid, pageIndex, resolution, DOWNLOADS_DIR, groupId, meta)
```

**Step 3：修改 Python handle_video_download 接收 video_meta**

```python
async def handle_video_download(request):
    data = await request.json()
    # ...
    video_meta = data.get('video_meta')  # 新增
    result = await download_video_file(bvid, page_index, resolution, output_dir, group_id, video_meta)
```

**Step 4：修改 download_video_file 跳过 get_info 当 meta 已知**

```python
async def download_video_file(bvid, page_index, resolution, output_dir, group_id=None, video_meta=None):
    # ...
    v = video.Video(bvid=bvid, credential=load_credential(group_id))

    if video_meta:
        # 使用 Node 侧传入的元信息，跳过 API 调用
        title = video_meta.get('title', bvid)
        owner = video_meta.get('owner', 'Unknown')
        duration = video_meta.get('duration', 0)
        total_pages = video_meta.get('total_pages', 1)
    else:
        # fallback：自行拉取（兼容其他调用方）
        info = await v.get_info()
        title = info.get('title', bvid)
        owner = info.get('owner', {}).get('name', 'Unknown')
        duration = info.get('duration', 0)
        pages = info.get('pages', [])
        total_pages = len(pages) if pages else 1
```

**Step 5：验证 Python 语法**

```bash
python3 -c "import ast; ast.parse(open('src/services/bili_server.py').read()); print('OK')"
```

**Step 6：提交**

```bash
git add src/services/bili_server.py src/services/biliApi.js src/services/videoDownloadService.js
git commit -m "fix: Node 侧传递 video_meta 给 Python，避免重复调用 v.get_info()"
```

---

## Task 6：命令触发下载失败时发送用户反馈（#22）

**文件：**
- Modify: `src/services/videoDownloadService.js:87-175`
- Modify: `src/commands/download.js:40-45`

**问题：**
`/下载 Pn` 命令：用户收到"正在下载…"提示后，若下载失败（网络/API错误）只写 log，用户永远等不到结果也没有错误反馈。

**方案：** `downloadAndSend` 增加返回值，命令层根据结果决定是否发送失败提示。

**Step 1：修改 downloadAndSend 返回操作结果**

将 `downloadAndSend` 改为有意义的返回值：

```javascript
async downloadAndSend(ws, groupId, bvid, videoInfo, pageIndex = 0) {
    // ... 现有逻辑 ...

    // 下载失败
    if (result.status !== 'success') {
        logger.warn(`[VideoDownload] Download error for ${bvid}: ${result.message}`)
        return { ok: false, reason: result.message }
    }

    // 发送
    const sent = await this._sendForwardMessage(ws, groupId, result)
    // ...

    return { ok: sent }
}
```

注意：现有的 linkHandler / updateChecker 使用 `.catch()` 忽略返回值，不需要修改；只有 download.js 需要处理返回值。

**Step 2：修改 download.js 中 /下载 Pn 的错误处理**

```javascript
// 原代码（fire-and-forget）
videoDownloadService.downloadAndSend(ws, groupId, lastInfo.bvid, info, pageIndex).catch(e => {
    logger.error(`[DownloadCommand] downloadAndSend failed:`, e)
})
this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `正在下载 P${pageIndex + 1}，请稍候...` } }])

// 修改为
this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `正在下载 P${pageIndex + 1}，请稍候...` } }])
videoDownloadService.downloadAndSend(ws, groupId, lastInfo.bvid, info, pageIndex)
    .then(res => {
        if (res && !res.ok) {
            const reason = res.reason === 'duration_exceeded' ? '视频时长超出限制' :
                           res.reason === 'no_streams_available' ? '无可用流（可能为充电专属）' :
                           '下载失败，请稍后重试'
            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `❌ ${reason}` } }])
        }
    })
    .catch(e => {
        logger.error(`[DownloadCommand] downloadAndSend failed:`, e)
        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '❌ 下载失败，请稍后重试' } }])
    })
```

**Step 3：确认 linkHandler / updateChecker 不受影响**

两处均使用 `.catch(e => logger.error(...))` 忽略返回值，无需修改。

**Step 4：提交**

```bash
git add src/services/videoDownloadService.js src/commands/download.js
git commit -m "fix: 命令触发下载失败时向用户发送错误提示"
```

---

## 执行顺序建议

按依赖关系排序：

1. **Task 1**（Critical，独立，改动最小，优先执行）
2. **Task 2**（独立，5 分钟）
3. **Task 3**（独立，涉及竞态逻辑，需仔细测试）
4. **Task 4**（依赖 bot.js global.bot，独立）
5. **Task 5**（改动面最大，需同时改 3 个文件）
6. **Task 6**（依赖 downloadAndSend 返回值约定，需先确认 Task 3/5 完成）

---

## 测试验证要点

- [ ] Settings 页面保存视频下载配置 → `config/config.json` 中出现对应键
- [ ] 两群同时下载同一视频 → 生成两个不同文件名的 MP4
- [ ] 用户连续发两个视频链接 → `/下载 P2` 操作最近发送的视频
- [ ] 模拟 WebSocket 断线重连后下载完成 → 能正常发送（使用全局 ws）
- [ ] 下载一个视频 → Python 日志中无 `get_info` 调用（有 meta 传入时）
- [ ] `/下载 P2` 失败场景（无效 bvid）→ 群内出现 ❌ 错误提示
