# 视频下载功能 Review 修复计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复 code review 发现的 16 个问题（1 Critical + 9 Important + 6 Minor），确保视频下载功能在生产环境可靠运行。

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
| A | `bili_server.py` | Python 流下载无整体超时，Node 侧断开后协程和 FFmpeg 成为孤儿 | Important |
| B | `videoDownloadService.js` | `/清理下载` 无条件删除所有文件，包括正在下载中的 `.tmp` 和待上传的 `.mp4` | Important |
| C | `videoDownloadService.js` | 磁盘空间不足时 `downloadAndSend` 静默 return，无用户反馈 | Important |
| D | `updateChecker.js` | 订阅扇出：N 个群订阅同一 UP 主时触发 N 次重复下载，超并发上限的群无通知 | Important |
| E | `videoDownloadService.js` | `_hasDiskSpace()` 只统计 `.mp4`，忽略大量 `.tmp` 文件，空间计算不准确 | Minor |
| F | `videoDownloadService.js` | 60 秒清理延迟对大文件可能不够，NapCat 上传未完成文件即被删除 | Minor |
| G | `download.js` | 下载被去重/并发上限/磁盘满跳过时仍发送"正在下载..."，用户无法感知实际未开始 | Minor |
| H | `download.js` | `/下载` 无参数或参数无效时无用法提示，静默返回 false | Minor |
| I | `videoDownloadService.js` | `videoDownloadCleanTimeout=0` 使 `maxAgeMs=0`，定时清理将删除所有文件 | Minor |
| J | `linkHandler.js` | `addUrlToCache` 存储 `Date.now() + timeout` 而非 `Date.now()`，缓存持续约 2 倍配置值 | Minor |

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

## Task 7：Python 流下载增加整体超时（#A）

**文件：**
- Modify: `src/services/bili_server.py:1598-1614`（`_download_stream_to_file`）
- Modify: `src/services/bili_server.py:1617-1708`（`download_video_file`）

**问题：**

`_download_stream_to_file` 虽然设置了 `aiohttp.ClientTimeout(total=600, connect=30, sock_read=120)`，但这只控制单次 HTTP 响应层的超时。真正的风险场景是：

1. Node 侧 `biliApi.downloadVideo` 的 axios 超时为 5 分钟（300s），Node 断开 HTTP 连接后，Python 端 `handle_video_download` 的协程仍在运行
2. `download_video_file` 中 `asyncio.gather` 并发下载视频流+音频流（第 1675 行），以及后续 FFmpeg 子进程（第 1679 行），都不受 Node 侧断开的影响
3. 多次触发后，Python 事件循环中积累大量孤儿协程和 FFmpeg 进程，消耗 CPU、内存和磁盘空间

**Step 1：为 `download_video_file` 整体加上 `asyncio.wait_for` 超时**

在 `handle_video_download` 中给 `download_video_file` 调用加超时包裹，超时设为 270 秒（略低于 Node 侧 300 秒，确保 Python 侧先超时返回错误而非 Node 侧先断开留下孤儿）：

```python
async def handle_video_download(request):
    try:
        data = await request.json()
        # ... 参数解析 ...

        try:
            result = await asyncio.wait_for(
                download_video_file(bvid, page_index, resolution, output_dir, group_id),
                timeout=270  # 略低于 Node 侧 300s 超时
            )
        except asyncio.TimeoutError:
            logger.error(f'[download_video_file] Timeout after 270s for {bvid}')
            return web.json_response({
                'status': 'error',
                'message': 'download_timeout'
            })

        return web.json_response(result)
    except Exception as e:
        # ...
```

**Step 2：确保 `asyncio.wait_for` 取消后资源正确清理**

`asyncio.wait_for` 超时后会 cancel 协程。`download_video_file` 内部的 `finally` 块（第 1692-1698 行）已负责清理 `.tmp` 文件，cancel 时 `finally` 仍会执行，所以 `.tmp` 清理是安全的。

但 FFmpeg 子进程（`proc`）不一定被终止。在 `finally` 块中增加对 FFmpeg 进程的 kill：

```python
        finally:
            # 清理 .tmp 文件
            for tmp in [video_tmp, audio_tmp]:
                try:
                    if os.path.exists(tmp):
                        os.remove(tmp)
                except Exception:
                    pass
            # 确保 FFmpeg 进程被终止（防止 cancel 导致孤儿进程）
            if 'proc' in dir() and proc.returncode is None:
                try:
                    proc.kill()
                except Exception:
                    pass
```

**Step 3：验证 Python 语法**

```bash
python3 -c "import ast; ast.parse(open('src/services/bili_server.py').read()); print('OK')"
```

**Step 4：提交**

```bash
git add src/services/bili_server.py
git commit -m "fix: download_video_file 增加 270s 整体超时，防止孤儿协程和 FFmpeg 进程"
```

---

## Task 8：`/清理下载` 保护正在下载的文件（#B）

**文件：**
- Modify: `src/services/videoDownloadService.js:273-285`（`cleanAll` 方法）

**问题：**

`cleanAll()` 方法无条件删除所有 `.mp4` 和 `.tmp` 文件：

```javascript
// videoDownloadService.js:273-285
cleanAll() {
    // ...
    const files = fs.readdirSync(DOWNLOADS_DIR).filter(f => f.endsWith('.mp4') || f.endsWith('.tmp'))
    for (const f of files) {
        try { fs.unlinkSync(path.join(DOWNLOADS_DIR, f)) } catch { /* skip */ }
    }
    return files.length
}
```

如果此时有活跃下载（`_activeDownloads > 0`），会导致：
- FFmpeg 的输入 `_v.tmp` / `_a.tmp` 文件被删除，FFmpeg 报错
- 刚下载完等待 NapCat 上传的 `.mp4` 被删除，视频发送失败
- 60 秒延迟清理的 `setTimeout` 回调执行时文件已不存在（虽然有 `existsSync` 保护，但用户体验是视频白下了）

**Step 1：在 `cleanAll` 中检查活跃下载数**

```javascript
cleanAll() {
    try {
        if (!fs.existsSync(DOWNLOADS_DIR)) return 0

        // 有活跃下载时拒绝清理，防止删除正在使用的文件
        if (this._activeDownloads > 0) {
            logger.warn(`[VideoDownload] cleanAll skipped: ${this._activeDownloads} downloads in progress`)
            return -1  // -1 表示被拒绝
        }

        const files = fs.readdirSync(DOWNLOADS_DIR).filter(f => f.endsWith('.mp4') || f.endsWith('.tmp'))
        for (const f of files) {
            try { fs.unlinkSync(path.join(DOWNLOADS_DIR, f)) } catch { /* skip */ }
        }
        return files.length
    } catch {
        return 0
    }
}
```

**Step 2：修改 `download.js` 处理拒绝情况**

```javascript
// download.js:67-68
const count = videoDownloadService.cleanAll()
if (count === -1) {
    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '当前有下载任务进行中，请稍后再清理' } }])
} else {
    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `已清理 ${count} 个视频文件` } }])
}
```

**Step 3：提交**

```bash
git add src/services/videoDownloadService.js src/commands/download.js
git commit -m "fix: cleanAll 拒绝在有活跃下载时执行，保护进行中的文件"
```

---

## Task 9：磁盘空间不足时发送用户通知（#C）

**文件：**
- Modify: `src/services/videoDownloadService.js:122-126`

**问题：**

磁盘空间预检失败时静默 `return`，无任何返回值和通知：

```javascript
// videoDownloadService.js:122-126
if (!this._hasDiskSpace()) {
    logger.warn(`[VideoDownload] Insufficient disk space, skipping download of ${bvid}`)
    return
}
```

对比同函数中的并发上限检查（第 100-107 行）和时长超限检查（第 112-120 行），这两者都向群发送了提示消息。磁盘空间不足是唯一遗漏了用户通知的早期退出路径。

如果是通过 `/下载 Pn` 命令触发，用户已收到"正在下载..."提示但永远等不到结果。

**Step 1：在 `_hasDiskSpace` 失败处增加群消息通知和返回值**

```javascript
if (!this._hasDiskSpace()) {
    logger.warn(`[VideoDownload] Insufficient disk space, skipping download of ${bvid}`)
    notificationService.sendGroupMessage(ws, groupId, [
        { type: 'text', data: { text: '⚠️ 下载目录空间不足（超过 5GB），已跳过下载。可使用 /清理下载 释放空间' } }
    ], 'VideoDownload', false)
    return { ok: false, reason: 'disk_space_full' }
}
```

**注意：** 此修改与 Task 6 的 `downloadAndSend` 返回值约定一致，需在 Task 6 之后或同时完成。

**Step 2：提交**

```bash
git add src/services/videoDownloadService.js
git commit -m "fix: 磁盘空间不足时向群发送提示消息"
```

---

## Task 10：订阅扇出去重——同一视频只下载一次（#D）

**文件：**
- Modify: `src/services/subscription/updateChecker.js:1099-1105`
- Modify: `src/services/videoDownloadService.js`（新增 `downloadAndSendMultiGroup` 方法）

**问题：**

当 N 个群订阅了同一 UP 主时，UP 主发布视频后 `updateChecker.js:1101-1104` 对每个目标群独立触发下载：

```javascript
// updateChecker.js:1099-1105
const videoDownloadService = require('../../services/videoDownloadService')
for (const gid of targetGroups) {
    videoDownloadService.downloadAndSend(this.ws, gid, bvid, info).catch(e => {
        logger.error(`[UpdateChecker] downloadAndSend failed for ${bvid} in group ${gid}:`, e)
    })
}
```

由于 dedup key 是 `${groupId}:${bvid}:${pageIndex}`（含 groupId），每个群会创建独立的下载任务。并发上限 `MAX_CONCURRENT_DOWNLOADS = 3`，超出的群直接跳过并仅写 log——用户无感知、无视频。

**影响：**
1. **资源浪费**：同一视频文件被下载 N 次，N 倍带宽和磁盘占用
2. **功能缺失**：超并发上限的群收不到视频也收不到通知
3. **API 风控风险**：短时间内对 B 站发起 N 次相同视频的流下载请求

**Step 1：在 `videoDownloadService.js` 中新增 `downloadAndSendToGroups` 方法**

```javascript
/**
 * 下载视频一次，发送到多个群（用于订阅扇出场景）
 * @param {WebSocket} ws
 * @param {string[]} groupIds - 目标群列表
 * @param {string} bvid
 * @param {object} videoInfo
 * @param {number} pageIndex
 */
async downloadAndSendToGroups(ws, groupIds, bvid, videoInfo, pageIndex = 0) {
    // 过滤出开启了视频下载的群
    const enabledGroups = groupIds.filter(gid => isVideoDownloadEnabledForGroup(gid))
    if (enabledGroups.length === 0) return

    // 用第一个群的配置触发下载（分辨率取最高需求）
    const firstGroup = enabledGroups[0]
    const downloadKey = `subscription:${bvid}:${pageIndex}`

    if (_inProgressDownloads.has(downloadKey)) {
        logger.info(`[VideoDownload] Already downloading ${bvid} P${pageIndex + 1} (subscription), skipping`)
        return
    }

    if (this._activeDownloads >= MAX_CONCURRENT_DOWNLOADS) {
        logger.warn(`[VideoDownload] Max concurrent downloads reached, skipping subscription download for ${bvid}`)
        return
    }

    const duration = videoInfo?.data?.duration ?? 0
    const maxDuration = getVideoDownloadMaxDurationForGroup(firstGroup)
    if (maxDuration > 0 && duration > maxDuration) return

    if (!this._hasDiskSpace()) {
        logger.warn(`[VideoDownload] Insufficient disk space, skipping subscription download of ${bvid}`)
        return
    }

    const resolution = getVideoDownloadResolutionForGroup(firstGroup)
    logger.info(`[VideoDownload] Subscription download: ${bvid} P${pageIndex + 1} @ ${resolution} for ${enabledGroups.length} groups`)

    this._activeDownloads++
    _inProgressDownloads.add(downloadKey)
    let result
    try {
        result = await biliApi.downloadVideo(bvid, pageIndex, resolution, DOWNLOADS_DIR, firstGroup)
    } catch (e) {
        logger.error(`[VideoDownload] Subscription download failed for ${bvid}:`, e)
        return
    } finally {
        this._activeDownloads--
        _inProgressDownloads.delete(downloadKey)
    }

    if (result.status !== 'success') {
        logger.warn(`[VideoDownload] Subscription download error for ${bvid}: ${result.message}`)
        return
    }

    // 向所有目标群发送同一文件
    let sentCount = 0
    for (const gid of enabledGroups) {
        try {
            const sent = await this._sendForwardMessage(ws, gid, result)
            if (sent) sentCount++
        } catch (e) {
            logger.error(`[VideoDownload] Failed to send to group ${gid}:`, e)
        }
    }
    logger.info(`[VideoDownload] Subscription video ${bvid} sent to ${sentCount}/${enabledGroups.length} groups`)

    // 所有群都发完后再清理文件
    if (config.videoDownloadAutoClean && result.file_path) {
        const filePath = result.file_path
        setTimeout(() => this.cleanupFile(filePath), 60 * 1000)
    }
}
```

**Step 2：修改 `updateChecker.js` 使用新方法**

```javascript
// 原代码（N 次独立下载）
const videoDownloadService = require('../../services/videoDownloadService')
for (const gid of targetGroups) {
    videoDownloadService.downloadAndSend(this.ws, gid, bvid, info).catch(e => {
        logger.error(`[UpdateChecker] downloadAndSend failed for ${bvid} in group ${gid}:`, e)
    })
}

// 改为（下载一次，多群发送）
const videoDownloadService = require('../../services/videoDownloadService')
videoDownloadService.downloadAndSendToGroups(this.ws, targetGroups, bvid, info).catch(e => {
    logger.error(`[UpdateChecker] downloadAndSendToGroups failed for ${bvid}:`, e)
})
```

**Step 3：提交**

```bash
git add src/services/videoDownloadService.js src/services/subscription/updateChecker.js
git commit -m "fix: 订阅扇出时同一视频只下载一次，多群共享发送"
```

---

## Task 11：`_hasDiskSpace` 纳入 `.tmp` 文件统计（#E）

**文件：**
- Modify: `src/services/videoDownloadService.js:229-243`

**问题：**

`_hasDiskSpace()` 只统计 `.mp4` 文件的大小，忽略下载中的 `.tmp` 文件：

```javascript
// videoDownloadService.js:233-234
for (const f of fs.readdirSync(DOWNLOADS_DIR)) {
    if (!f.endsWith('.mp4')) continue  // 只统计 .mp4，忽略下载中的 .tmp 文件
```

每个 DASH 下载产生 `_v.tmp`（视频流）+ `_a.tmp`（音频流），一个 1080p 视频的两个 `.tmp` 文件总计可达数百 MB 甚至数 GB。3 个并发下载意味着最多 6 个 `.tmp` 文件，实际磁盘占用可能远超 `.mp4` 统计结果。极端情况下 `.mp4` 总计 4.5GB（检查通过），加上 6 个 `.tmp` 实际占用 8GB+。

**Step 1：修改 `_hasDiskSpace` 同时统计 `.mp4` 和 `.tmp`**

```javascript
_hasDiskSpace() {
    try {
        if (!fs.existsSync(DOWNLOADS_DIR)) return true
        let totalSize = 0
        for (const f of fs.readdirSync(DOWNLOADS_DIR)) {
            if (!f.endsWith('.mp4') && !f.endsWith('.tmp')) continue
            try {
                totalSize += fs.statSync(path.join(DOWNLOADS_DIR, f)).size
            } catch { /* skip */ }
        }
        return totalSize < 5 * 1024 * 1024 * 1024 // 5GB
    } catch {
        return true
    }
}
```

**Step 2：提交**

```bash
git add src/services/videoDownloadService.js
git commit -m "fix: _hasDiskSpace 统计范围纳入 .tmp 文件"
```

---

## Task 12：清理延迟按文件大小动态调整（#F）

**文件：**
- Modify: `src/services/videoDownloadService.js:163-166`

**问题：**

下载完成后固定 60 秒延迟删除文件：

```javascript
// videoDownloadService.js:163-166
if (config.videoDownloadAutoClean && result.file_path) {
    const filePath = result.file_path
    setTimeout(() => this.cleanupFile(filePath), 60 * 1000)
}
```

`ws.send()` 只是将 JSON 指令推入 WebSocket 缓冲区，NapCat 收到后需要异步读取本地文件并上传到 QQ 服务器。对于大文件（1080p+ 视频可达数百 MB 到 1GB+），在上传带宽有限的环境下（如家用上行 10Mbps），100MB 文件上传需约 80 秒，60 秒的固定延迟可能不够。

**Step 1：根据文件大小动态计算延迟**

```javascript
if (config.videoDownloadAutoClean && result.file_path) {
    const filePath = result.file_path
    // 基于文件大小动态延迟：基础 60s + 每 100MB 额外 60s，上限 10 分钟
    let delayMs = 60 * 1000
    try {
        const fileSize = fs.statSync(filePath).size
        const extraDelay = Math.floor(fileSize / (100 * 1024 * 1024)) * 60 * 1000
        delayMs = Math.min(delayMs + extraDelay, 10 * 60 * 1000)
    } catch { /* 无法获取大小时使用默认值 */ }
    setTimeout(() => this.cleanupFile(filePath), delayMs)
}
```

**Step 2：提交**

```bash
git add src/services/videoDownloadService.js
git commit -m "fix: 清理延迟按文件大小动态调整，大文件给予更多上传时间"
```

---

## Task 13：`downloadAndSend` 所有早期退出统一返回状态码（#G）

**文件：**
- Modify: `src/services/videoDownloadService.js:90-126`
- Modify: `src/commands/download.js:43-47`

**问题：**

`downloadAndSend` 函数有 4 个早期退出路径，但返回值不一致：

| 退出原因 | 当前行为 | 用户是否收到通知 |
|---------|---------|---------------|
| 功能未开启（第 91 行） | `return`（undefined） | 否（不应通知，正常行为） |
| 去重跳过（第 95-98 行） | `return`（undefined） | 否 |
| 并发上限（第 100-107 行） | 发通知 + `return`（undefined） | 是 ✅ |
| 时长超限（第 112-120 行） | 发通知 + `return`（undefined） | 是 ✅ |
| 磁盘空间不足（第 122-126 行） | `return`（undefined） | 否 ❌ （Task 9 修复） |

通过 `/下载 Pn` 命令触发时（`download.js:43-46`），"正在下载..."消息在调用 `downloadAndSend` 之后立即发送。如果 `downloadAndSend` 因去重或磁盘满而静默返回，用户已收到"正在下载..."但永远等不到结果。

**Step 1：所有早期退出返回状态对象**

与 Task 6 的返回值约定配合，为所有早期退出路径添加返回值：

```javascript
// 去重跳过
if (_inProgressDownloads.has(downloadKey)) {
    logger.info(`[VideoDownload] Already downloading ${bvid} P${pageIndex + 1} for group ${groupId}, skipping duplicate`)
    return { ok: false, reason: 'duplicate', silent: true }
}

// 并发上限（已有通知，标记 silent）
if (this._activeDownloads >= MAX_CONCURRENT_DOWNLOADS) {
    // ... 发通知 ...
    return { ok: false, reason: 'max_concurrent', silent: true }
}

// 时长超限（已有通知，标记 silent）
if (maxDuration > 0 && duration > maxDuration) {
    // ... 发通知 ...
    return { ok: false, reason: 'duration_exceeded', silent: true }
}

// 磁盘空间不足（Task 9 会加通知）
if (!this._hasDiskSpace()) {
    // ... 发通知（Task 9）...
    return { ok: false, reason: 'disk_space_full', silent: true }
}
```

**Step 2：`download.js` 中将"正在下载..."移到返回状态判断之后**

由于 `downloadAndSend` 是异步的且可能耗时很长，不能 await 它再决定是否发"正在下载..."。改为让命令层先做同步的前置检查：

```javascript
// download.js — 先检查前置条件，再发"正在下载..."
if (!isVideoDownloadEnabledForGroup(groupId)) {
    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '当前群未开启视频下载功能' } }])
    return true
}

this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `正在下载 P${pageIndex + 1}，请稍候...` } }])
videoDownloadService.downloadAndSend(ws, groupId, lastInfo.bvid, info, pageIndex)
    .then(res => {
        if (res && !res.ok && !res.silent) {
            // silent=true 表示 downloadAndSend 内部已发通知，不重复发
            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '❌ 下载失败，请稍后重试' } }])
        }
    })
    .catch(e => {
        logger.error(`[DownloadCommand] downloadAndSend failed:`, e)
        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '❌ 下载失败，请稍后重试' } }])
    })
```

**注意：** 此 Task 与 Task 6（命令失败反馈）和 Task 9（磁盘空间通知）有交叉，建议合并实施。

**Step 3：提交**

```bash
git add src/services/videoDownloadService.js src/commands/download.js
git commit -m "fix: downloadAndSend 所有早期退出统一返回状态码，命令层合理展示"
```

---

## Task 14：`/下载` 无效参数时返回用法提示（#H）

**文件：**
- Modify: `src/commands/download.js:12-72`

**问题：**

`download.js` 的 `handle` 方法在文本匹配 `/下载` 前缀后，只处理了三个分支：
- `/下载 P{n}`（第 16 行正则）
- `/下载状态`（第 51 行）
- `/清理下载`（第 62 行）

如果用户输入 `/下载`（无参数）、`/下载 abc`、`/下载 3` 等不匹配任何正则的文本，函数在第 72 行 `return false`，命令调度器视为未处理——用户无任何反馈。

**Step 1：在 `handle` 方法末尾、`return false` 之前添加兜底提示**

```javascript
// download.js — 在最后的 return false 之前
// 兜底：匹配了 /下载 前缀但未命中任何子命令
if (text.startsWith('/下载')) {
    this.sendGroupMessage(ws, groupId, [{
        type: 'text',
        data: { text: '用法：\n/下载 P{n} — 下载指定分P\n/下载状态 — 查看下载目录状态\n/清理下载 — 清空下载目录' }
    }])
    return true
}

return false
```

**Step 2：提交**

```bash
git add src/commands/download.js
git commit -m "fix: /下载 无效参数时返回用法提示"
```

---

## Task 15：`videoDownloadCleanTimeout` 为 0 时的保护（#I）

**文件：**
- Modify: `src/services/videoDownloadService.js:44-48`

**问题：**

`_cleanupOldFiles` 方法中：

```javascript
// videoDownloadService.js:47
const maxAgeMs = config.videoDownloadCleanTimeout * 60 * 60 * 1000
```

如果 `videoDownloadCleanTimeout` 被设为 0（通过直接编辑 `config.json` 或 Dashboard 输入），`maxAgeMs` 变为 0，意味着所有文件的 age 都超过阈值。每小时定时清理将删除目录下所有 `.mp4` 和 `.tmp` 文件，包括：
- 正在被 NapCat 上传的 `.mp4`（发送失败）
- 正在下载的 `.tmp`（FFmpeg 报错）

**Step 1：增加最小值保护**

```javascript
_cleanupOldFiles() {
    try {
        if (!fs.existsSync(DOWNLOADS_DIR)) return
        // 最小 1 小时，防止 cleanTimeout=0 导致所有文件被立即删除
        const cleanTimeout = Math.max(config.videoDownloadCleanTimeout || 24, 1)
        const maxAgeMs = cleanTimeout * 60 * 60 * 1000
        const now = Date.now()
        // ... 后续逻辑不变
```

**Step 2：提交**

```bash
git add src/services/videoDownloadService.js
git commit -m "fix: videoDownloadCleanTimeout 增加最小值保护，防止为 0 时删除所有文件"
```

---

## Task 16：修复 `addUrlToCache` 时间戳不一致导致 2 倍缓存时长（#J）

**文件：**
- Modify: `src/handlers/linkHandler.js:538`

**问题：**

`linkHandler.js` 有两个将链接加入缓存的方法，存储的时间戳含义不同：

```javascript
// addLinkToCache（第 167-169 行）—— 正常路径：存储当前 timestamp
addLinkToCache(cacheKey) {
    this.linkCache.set(cacheKey, Date.now());    // ← 存 Date.now()
    this.cleanupExpiredCache();
}

// addUrlToCache（第 518-541 行）—— 订阅推送路径：存储 Date.now() + timeout
this.linkCache.set(cacheKey, Date.now() + timeout);  // ← 存 Date.now() + timeout
```

但缓存过期检查（`isLinkCached`，第 155 行）统一用 `Date.now() - cachedTime < timeout` 判断：

```javascript
if (Date.now() - cachedTime < timeout) {  // 缓存未过期
```

当 `cachedTime = Date.now() + timeout` 时，表达式变为 `Date.now() - (Date.now_at_insert + timeout) < timeout`，即 `-timeout + elapsed < timeout`，即 `elapsed < 2 * timeout`。缓存实际持续约 2 倍配置的 `linkCacheTimeout`。

**影响：** 通过订阅推送路径（`updateChecker` → `addUrlToCache`）加入缓存的链接，在 2 倍超时时间内不会被重新处理。这意味着如果用户在订阅推送后手动发送同一链接，在 2 倍缓存时间内不会生成预览卡片。

**注意：** 这是一个预存在 bug（在视频下载功能之前就存在），但因为订阅系统和视频下载的交互使该路径更加活跃，在此统一记录。

**Step 1：修复 `addUrlToCache` 存储值为 `Date.now()`**

```javascript
// linkHandler.js:538
// 原代码
this.linkCache.set(cacheKey, Date.now() + timeout);

// 修改为
this.linkCache.set(cacheKey, Date.now());
```

**Step 2：提交**

```bash
git add src/handlers/linkHandler.js
git commit -m "fix: addUrlToCache 存储 Date.now() 而非 Date.now()+timeout，修复 2 倍缓存时长"
```

---

## 执行顺序建议

按依赖关系和优先级排序：

**第一批（Critical + 独立 Important，优先执行）：**

1. **Task 1**（Critical，独立，改动最小）
2. **Task 2**（独立，改动小）
3. **Task 3**（独立，涉及竞态逻辑需仔细测试）
4. **Task 4**（独立，bot.js + videoDownloadService.js）
5. **Task 7**（独立，Python 端超时保护）
6. **Task 8**（独立，cleanAll 保护）

**第二批（有交叉的任务，建议合并实施）：**

7. **Task 5**（改动面最大，3 个文件）
8. **Task 6 + Task 9 + Task 13**（合并实施：downloadAndSend 统一返回值 + 命令层统一处理 + 磁盘空间通知）

**第三批（独立 Minor，可选）：**

9. **Task 10**（架构优化，订阅扇出去重，改动较大但价值高）
10. **Task 11**（磁盘空间统计修正，改动小）
11. **Task 12**（清理延迟优化，改动小）
12. **Task 14**（用法提示，改动小）
13. **Task 15**（cleanTimeout 保护，改动小）
14. **Task 16**（预存在 bug 修复，改动小）

---

## 测试验证要点

- [ ] Settings 页面保存视频下载配置 → `config/config.json` 中出现对应键
- [ ] 两群同时下载同一视频 → 生成两个不同文件名的 MP4
- [ ] 用户连续发两个视频链接 → `/下载 P2` 操作最近发送的视频
- [ ] 模拟 WebSocket 断线重连后下载完成 → 能正常发送（使用全局 ws）
- [ ] 下载一个视频 → Python 日志中无 `get_info` 调用（有 meta 传入时）
- [ ] `/下载 P2` 失败场景（无效 bvid）→ 群内出现 ❌ 错误提示
- [ ] Python 下载超过 270 秒 → 返回 `download_timeout` 错误而非无限挂起
- [ ] 有活跃下载时执行 `/清理下载` → 收到"请稍后再清理"提示
- [ ] 磁盘空间不足时触发下载 → 群内收到"空间不足"提示
- [ ] 3 个群订阅同一 UP 主 → 视频只下载一次，3 个群都收到视频
- [ ] 下载目录有大量 `.tmp` 文件时 → `_hasDiskSpace` 正确统计
- [ ] 下载 500MB 视频 → 清理延迟自动增加到 ~6 分钟
- [ ] 输入 `/下载` 或 `/下载 abc` → 收到用法提示
- [ ] `videoDownloadCleanTimeout` 设为 0 → 实际使用最小值 1 小时
- [ ] 订阅推送后同一链接 → 缓存过期时间为 1 倍（非 2 倍）配置值
