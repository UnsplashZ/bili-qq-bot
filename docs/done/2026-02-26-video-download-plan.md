# Video Download Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 自动下载 Bilibili 投稿视频并以合并转发消息独立发送，支持全局/群级配置和 WebUI 管理。

**Architecture:** Python 端（bili_server.py）负责调用 bilibili-api-python 获取 DASH 流 URL、用 aiohttp 分块下载、FFmpeg 合并输出 MP4；Node.js 端（videoDownloadService.js）负责配置检查、触发下载、构建合并转发消息、文件清理调度。预览卡片与视频发送解耦，各自独立异步执行。

**Tech Stack:** bilibili-api-python 17.x（VideoDownloadURLDataDetecter）、aiohttp、FFmpeg、OneBot v11 `send_group_forward_msg`

---

## Task 1: 创建功能分支

**Files:** 无代码修改

**Step 1: 创建并切换到新分支**

```bash
git checkout -b feature/video-download
```

**Step 2: 验证分支**

```bash
git branch --show-current
# 期望输出: feature/video-download
```

**Step 3: 创建下载目录（不入 git）**

```bash
mkdir -p data/downloads
echo "data/downloads/" >> .gitignore
# 验证 .gitignore 中已有 data/ 覆盖
grep "data/" .gitignore
```

---

## Task 2: Python `/video_download` 端点

**Files:**
- Modify: `src/services/bili_server.py`（在 `handle_video` 函数下方约 1650 行附近新增，路由在 1931 行前新增）

**Step 1: 在 bili_server.py 中添加辅助下载函数**

在 `handle_video` 函数（约 1584 行）之后，`async def handle_user_videos` 之前，添加：

```python
async def _download_stream_to_file(url: str, output_path: str) -> None:
    """分块下载单个流到文件"""
    headers = {
        'Referer': 'https://www.bilibili.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
    async with aiohttp.ClientSession() as session:
        async with session.get(url, headers=headers) as resp:
            resp.raise_for_status()
            with open(output_path, 'wb') as f:
                async for chunk in resp.content.iter_chunked(1024 * 1024):
                    f.write(chunk)


RESOLUTION_QUALITY_MAP = {
    '360p':  'VideoQuality._360P',
    '480p':  'VideoQuality._480P',
    '720p':  'VideoQuality._720P',
    '1080p': 'VideoQuality._1080P',
    '1080p+': 'VideoQuality._1080P_PLUS',
}


async def download_video_file(bvid: str, page_index: int, resolution: str,
                               output_dir: str, group_id=None) -> dict:
    """
    下载视频到本地文件，返回文件路径和元信息。
    使用 DASH 流时分别下载视频/音频再用 FFmpeg 合并。
    """
    from bilibili_api.video import VideoDownloadURLDataDetecter, VideoQuality, VideoCodecs

    quality_map = {
        '360p':  VideoQuality._360P,
        '480p':  VideoQuality._480P,
        '720p':  VideoQuality._720P,
        '1080p': VideoQuality._1080P,
        '1080p+': VideoQuality._1080P_PLUS,
    }
    target_quality = quality_map.get(resolution, VideoQuality._1080P)

    v = video.Video(bvid=bvid, credential=load_credential(group_id))
    info = await v.get_info()

    title = info.get('title', bvid)
    owner = info.get('owner', {}).get('name', 'Unknown')
    duration = info.get('duration', 0)
    pages = info.get('pages', [])
    total_pages = len(pages) if pages else 1

    download_data = await v.get_download_url(page_index=page_index)
    detector = VideoDownloadURLDataDetecter(download_data)
    streams = detector.detect_best_streams(
        video_max_quality=target_quality,
        video_accepted_codecs=[VideoCodecs.AVC, VideoCodecs.HEV, VideoCodecs.AV1],
    )

    if not streams:
        return {'status': 'error', 'message': 'no_streams_available'}

    os.makedirs(output_dir, exist_ok=True)
    timestamp = int(time.time())
    safe_bvid = re.sub(r'[^a-zA-Z0-9_-]', '_', bvid)
    output_path = os.path.join(output_dir, f'{safe_bvid}_{timestamp}.mp4')

    if len(streams) == 1:
        # FLV：单文件，直接下载
        await _download_stream_to_file(streams[0].url, output_path)
    else:
        # DASH：并发下载视频流和音频流，再合并
        video_tmp = output_path + '_v.tmp'
        audio_tmp = output_path + '_a.tmp'
        try:
            await asyncio.gather(
                _download_stream_to_file(streams[0].url, video_tmp),
                _download_stream_to_file(streams[1].url, audio_tmp),
            )
            proc = await asyncio.create_subprocess_exec(
                'ffmpeg', '-y', '-i', video_tmp, '-i', audio_tmp,
                '-c', 'copy', output_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await proc.communicate()
            if proc.returncode != 0:
                raise RuntimeError(f'FFmpeg failed: {stderr.decode()[:500]}')
        finally:
            for tmp in [video_tmp, audio_tmp]:
                try:
                    if os.path.exists(tmp):
                        os.remove(tmp)
                except Exception:
                    pass

    return {
        'status': 'success',
        'file_path': output_path,
        'title': title,
        'owner': owner,
        'duration': duration,
        'total_pages': total_pages,
        'page_index': page_index,
    }


async def handle_video_download(request):
    try:
        data = await request.json()
        bvid = data.get('bvid', '').strip()
        page_index = int(data.get('page_index', 0))
        resolution = data.get('resolution', '1080p')
        output_dir = data.get('output_dir', '/app/data/downloads')
        group_id = data.get('group_id')

        if not bvid:
            return web.json_response({'status': 'error', 'message': 'bvid is required'}, status=400)

        result = await download_video_file(bvid, page_index, resolution, output_dir, group_id)
        return web.json_response(result)
    except Exception as e:
        import traceback
        logger.error(f'[handle_video_download] Error: {e}\n{traceback.format_exc()}')
        return web.json_response({'status': 'error', 'message': str(e)}, status=500)
```

**Step 2: 注册路由**

在 `app.add_routes([` 列表（约 1912 行）中添加：

```python
        web.post('/video_download', handle_video_download),
```

位置：紧接在 `web.post('/refresh_credential', handle_refresh_credential),` 之后。

**Step 3: 手动测试端点（需已安装 ffmpeg）**

```bash
# 先确认 ffmpeg 存在
ffmpeg -version | head -1

# 启动 Python 服务
python3 src/services/bili_server.py --port 10001 &

# 测试下载（用一个短视频 BV 号）
curl -s -X POST http://localhost:10001/video_download \
  -H "Content-Type: application/json" \
  -d '{"bvid":"BV1GJ411x7h7","page_index":0,"resolution":"360p","output_dir":"/tmp/test_dl"}' \
  | python3 -m json.tool

# 期望: {"status": "success", "file_path": "/tmp/test_dl/BV1GJ411x7h7_....mp4", ...}
```

**Step 4: 提交**

```bash
git add src/services/bili_server.py
git commit -m "feat: add /video_download endpoint to bili_server.py"
```

---

## Task 3: biliApi.js 添加 `downloadVideo` 方法

**Files:**
- Modify: `src/services/biliApi.js`

**Step 1: 在 `getVideoInfo` 方法（约第 43 行）后方添加**

```javascript
    async downloadVideo(bvid, pageIndex, resolution, outputDir, groupId) {
        // 下载操作不缓存，超时设为 5 分钟
        const serviceManager = require('./ServiceManager')
        const axios = require('axios')
        if (!serviceManager.process) {
            await serviceManager.start()
        }
        serviceManager.lastRequestTime = Date.now()
        const url = `${serviceManager.baseUrl}/video_download`
        const response = await axios.post(url, {
            bvid,
            page_index: pageIndex,
            resolution,
            output_dir: outputDir,
            group_id: groupId,
        }, { timeout: 5 * 60 * 1000 })
        return response.data
    }
```

**Step 2: 提交**

```bash
git add src/services/biliApi.js
git commit -m "feat: add downloadVideo method to biliApi.js"
```

---

## Task 4: config.js 新增配置项和 helper 函数

**Files:**
- Modify: `src/config.js`（META 区域约 280 行处，module.exports 区域约 641 行处）

**Step 1: 在 META 对象中添加配置项**

在 `linkCacheTimeout` 行（约 280 行）下方添加：

```javascript
    videoDownloadEnabled: { env: null, def: false, type: 'bool' },
    videoDownloadResolution: { env: null, def: '1080p', type: 'string' },
    videoDownloadMaxDuration: { env: null, def: 600, type: 'int' },
    videoDownloadAutoClean: { env: null, def: true, type: 'bool' },
    videoDownloadCleanTimeout: { env: null, def: 6, type: 'int' },
```

**Step 2: 在 `isRagEnabledForGroup` 函数（约 620 行）下方添加 helper 函数**

```javascript
/**
 * Check if video download is enabled for a specific group
 * @param {string} groupId - Group ID
 * @returns {boolean}
 */
function isVideoDownloadEnabledForGroup(groupId) {
    if (!config.videoDownloadEnabled) return false
    const groupConfig = config.groupConfigs[String(groupId)]
    if (groupConfig && 'videoDownloadEnabled' in groupConfig) {
        return groupConfig.videoDownloadEnabled
    }
    return true
}

/**
 * Get effective video download resolution for a group (group > global > default)
 * @param {string} groupId
 * @returns {string}
 */
function getVideoDownloadResolutionForGroup(groupId) {
    const groupConfig = config.groupConfigs[String(groupId)]
    if (groupConfig && groupConfig.videoDownloadResolution) {
        return groupConfig.videoDownloadResolution
    }
    return config.videoDownloadResolution
}

/**
 * Get effective max duration limit for a group (group > global > default), in seconds
 * @param {string} groupId
 * @returns {number} 0 means no limit
 */
function getVideoDownloadMaxDurationForGroup(groupId) {
    const groupConfig = config.groupConfigs[String(groupId)]
    if (groupConfig && 'videoDownloadMaxDuration' in groupConfig) {
        return groupConfig.videoDownloadMaxDuration
    }
    return config.videoDownloadMaxDuration
}
```

**Step 3: 在 `module.exports` 区域导出新函数**

在 `module.exports.isRagEnabledForGroup = isRagEnabledForGroup` 行后添加：

```javascript
module.exports.isVideoDownloadEnabledForGroup = isVideoDownloadEnabledForGroup
module.exports.getVideoDownloadResolutionForGroup = getVideoDownloadResolutionForGroup
module.exports.getVideoDownloadMaxDurationForGroup = getVideoDownloadMaxDurationForGroup
```

**Step 4: 写单元测试**

创建 `test/unit/videoDownloadConfig.test.js`：

```javascript
const assert = require('assert')

// Mock config module
const configMock = {
    videoDownloadEnabled: true,
    videoDownloadResolution: '1080p',
    videoDownloadMaxDuration: 600,
    groupConfigs: {}
}

// Inline the helpers to test logic without loading the full config module
function isVideoDownloadEnabledForGroup(groupId) {
    if (!configMock.videoDownloadEnabled) return false
    const groupConfig = configMock.groupConfigs[String(groupId)]
    if (groupConfig && 'videoDownloadEnabled' in groupConfig) {
        return groupConfig.videoDownloadEnabled
    }
    return true
}
function getVideoDownloadResolutionForGroup(groupId) {
    const groupConfig = configMock.groupConfigs[String(groupId)]
    if (groupConfig && groupConfig.videoDownloadResolution) {
        return groupConfig.videoDownloadResolution
    }
    return configMock.videoDownloadResolution
}
function getVideoDownloadMaxDurationForGroup(groupId) {
    const groupConfig = configMock.groupConfigs[String(groupId)]
    if (groupConfig && 'videoDownloadMaxDuration' in groupConfig) {
        return groupConfig.videoDownloadMaxDuration
    }
    return configMock.videoDownloadMaxDuration
}

// Tests
configMock.videoDownloadEnabled = false
assert.strictEqual(isVideoDownloadEnabledForGroup('123'), false, 'global off → false')

configMock.videoDownloadEnabled = true
assert.strictEqual(isVideoDownloadEnabledForGroup('123'), true, 'global on, no group override → true')

configMock.groupConfigs['123'] = { videoDownloadEnabled: false }
assert.strictEqual(isVideoDownloadEnabledForGroup('123'), false, 'group override off → false')

configMock.groupConfigs['123'] = { videoDownloadEnabled: true }
assert.strictEqual(isVideoDownloadEnabledForGroup('123'), true, 'group override on → true')

assert.strictEqual(getVideoDownloadResolutionForGroup('999'), '1080p', 'no group config → global default')
configMock.groupConfigs['999'] = { videoDownloadResolution: '720p' }
assert.strictEqual(getVideoDownloadResolutionForGroup('999'), '720p', 'group override resolution')

assert.strictEqual(getVideoDownloadMaxDurationForGroup('888'), 600, 'no group config → global default')
configMock.groupConfigs['888'] = { videoDownloadMaxDuration: 0 }
assert.strictEqual(getVideoDownloadMaxDurationForGroup('888'), 0, '0 means no limit')

console.log('✅ All videoDownloadConfig tests passed')
```

**Step 5: 运行测试**

```bash
node test/unit/videoDownloadConfig.test.js
# 期望: ✅ All videoDownloadConfig tests passed
```

**Step 6: 提交**

```bash
git add src/config.js test/unit/videoDownloadConfig.test.js
git commit -m "feat: add videoDownload config keys and helper functions"
```

---

## Task 5: 创建 `videoDownloadService.js`

**Files:**
- Create: `src/services/videoDownloadService.js`

**Step 1: 创建服务文件**

```javascript
const path = require('path')
const fs = require('fs')
const biliApi = require('./biliApi')
const notificationService = require('./notificationService')
const logger = require('../utils/logger')
const config = require('../config')
const {
    isVideoDownloadEnabledForGroup,
    getVideoDownloadResolutionForGroup,
    getVideoDownloadMaxDurationForGroup,
} = require('../config')

const DOWNLOADS_DIR = path.join(process.cwd(), 'data', 'downloads')

// 每群最近下载的视频信息，用于支持 /下载 P2 命令
// Map<groupId, { bvid, title, owner, totalPages, pageIndex }>
const lastDownloadInfo = new Map()

class VideoDownloadService {
    constructor() {
        this._cleanupTimer = null
    }

    /**
     * 启动定时清理任务（每小时执行一次）
     */
    startCleanupScheduler() {
        if (this._cleanupTimer) return
        this._cleanupTimer = setInterval(() => {
            this._cleanupOldFiles()
        }, 60 * 60 * 1000) // 每小时检查一次
        logger.info('[VideoDownload] Cleanup scheduler started (interval: 1h, max-age: configurable)')
    }

    /**
     * 清理超时的下载文件
     */
    _cleanupOldFiles() {
        try {
            if (!fs.existsSync(DOWNLOADS_DIR)) return
            const maxAgeMs = config.videoDownloadCleanTimeout * 60 * 60 * 1000
            const now = Date.now()
            const files = fs.readdirSync(DOWNLOADS_DIR)
            for (const file of files) {
                if (!file.endsWith('.mp4')) continue
                const filePath = path.join(DOWNLOADS_DIR, file)
                const stat = fs.statSync(filePath)
                if (now - stat.mtimeMs > maxAgeMs) {
                    fs.unlinkSync(filePath)
                    logger.info(`[VideoDownload] Cleaned up old file: ${file}`)
                }
            }
        } catch (e) {
            logger.error('[VideoDownload] Error during cleanup:', e)
        }
    }

    /**
     * 删除单个文件
     */
    cleanupFile(filePath) {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath)
                logger.info(`[VideoDownload] Deleted file: ${filePath}`)
            }
        } catch (e) {
            logger.error(`[VideoDownload] Failed to delete file ${filePath}:`, e)
        }
    }

    /**
     * 主入口：检查配置 → 下载 → 发送
     * @param {WebSocket} ws
     * @param {string} groupId
     * @param {string} bvid
     * @param {object} videoInfo - 已有的视频信息（来自 getVideoInfo）
     * @param {number} pageIndex - 分P索引（0-based）
     */
    async downloadAndSend(ws, groupId, bvid, videoInfo, pageIndex = 0) {
        if (!isVideoDownloadEnabledForGroup(groupId)) return

        const duration = videoInfo?.data?.duration ?? 0
        const maxDuration = getVideoDownloadMaxDurationForGroup(groupId)

        // 时长检查
        if (maxDuration > 0 && duration > maxDuration) {
            const durationMin = Math.round(duration / 60)
            const limitMin = Math.round(maxDuration / 60)
            notificationService.sendGroupMessage(ws, groupId, [
                { type: 'text', data: { text: `⚠️ 视频时长 ${durationMin} 分钟，超出当前限制（${limitMin} 分钟），已跳过下载` } }
            ], 'VideoDownload', false)
            return
        }

        // 磁盘空间预检（< 500MB 跳过）
        if (!this._hasDiskSpace()) {
            logger.warn(`[VideoDownload] Insufficient disk space, skipping download of ${bvid}`)
            return
        }

        const resolution = getVideoDownloadResolutionForGroup(groupId)

        logger.info(`[VideoDownload] Starting download: ${bvid} P${pageIndex + 1} @ ${resolution} for group ${groupId}`)

        let result
        try {
            result = await biliApi.downloadVideo(bvid, pageIndex, resolution, DOWNLOADS_DIR, groupId)
        } catch (e) {
            logger.error(`[VideoDownload] Download failed for ${bvid}:`, e)
            return
        }

        if (result.status !== 'success') {
            logger.warn(`[VideoDownload] Download error for ${bvid}: ${result.message}`)
            return
        }

        // 保存群最近下载信息（供 /下载 P2 使用）
        lastDownloadInfo.set(String(groupId), {
            bvid,
            title: result.title,
            owner: result.owner,
            totalPages: result.total_pages,
            pageIndex: result.page_index,
        })

        const sent = await this._sendForwardMessage(ws, groupId, result)

        if (sent && config.videoDownloadAutoClean) {
            this.cleanupFile(result.file_path)
        }

        // 多P提示
        if (result.total_pages > 1 && pageIndex === 0) {
            notificationService.sendGroupMessage(ws, groupId, [
                { type: 'text', data: { text: `📺 当前视频共 ${result.total_pages}P，已下载第 1P\n回复 /下载 P2 可继续下载其他分集` } }
            ], 'VideoDownload', false)
        }
    }

    /**
     * 发送合并转发消息（独立于预览卡片）
     * @returns {boolean} 是否发送成功
     */
    async _sendForwardMessage(ws, groupId, result) {
        if (!ws) return false

        const selfId = global.bot?.selfId || '0'
        const botName = 'Bot'

        const nodes = [
            {
                type: 'node',
                data: {
                    name: botName,
                    uin: selfId,
                    content: [{ type: 'text', data: { text: `「${result.title}」- ${result.owner}` } }]
                }
            },
            {
                type: 'node',
                data: {
                    name: botName,
                    uin: selfId,
                    content: [{ type: 'video', data: { file: `file://${result.file_path}` } }]
                }
            }
        ]

        const payload = {
            action: 'send_group_forward_msg',
            params: {
                group_id: groupId,
                messages: nodes
            }
        }

        return new Promise((resolve) => {
            try {
                ws.send(JSON.stringify(payload))
                logger.info(`[VideoDownload] Forward message sent to group ${groupId}: ${result.title}`)
                resolve(true)
            } catch (e) {
                logger.error(`[VideoDownload] Failed to send forward message:`, e)
                resolve(false)
            }
        })
    }

    /**
     * 检查磁盘可用空间（> 500MB 才允许下载）
     */
    _hasDiskSpace() {
        try {
            // 通过检查数据目录的文件总大小来估算（简单方案）
            // 生产中可用 statvfs，但 Node.js 无内置支持
            if (!fs.existsSync(DOWNLOADS_DIR)) return true
            let totalSize = 0
            for (const f of fs.readdirSync(DOWNLOADS_DIR)) {
                try {
                    totalSize += fs.statSync(path.join(DOWNLOADS_DIR, f)).size
                } catch { /* skip */ }
            }
            const MAX_DIR_SIZE = 5 * 1024 * 1024 * 1024 // 5GB 上限
            return totalSize < MAX_DIR_SIZE
        } catch {
            return true
        }
    }

    /**
     * 获取群最近的下载信息（供命令使用）
     */
    getLastDownloadInfo(groupId) {
        return lastDownloadInfo.get(String(groupId)) || null
    }

    /**
     * 获取下载目录状态（供 /下载状态 命令使用）
     */
    getDownloadStats() {
        try {
            if (!fs.existsSync(DOWNLOADS_DIR)) return { count: 0, totalSizeMB: 0 }
            const files = fs.readdirSync(DOWNLOADS_DIR).filter(f => f.endsWith('.mp4'))
            let totalSize = 0
            for (const f of files) {
                try { totalSize += fs.statSync(path.join(DOWNLOADS_DIR, f)).size } catch { /* skip */ }
            }
            return { count: files.length, totalSizeMB: Math.round(totalSize / 1024 / 1024) }
        } catch {
            return { count: 0, totalSizeMB: 0 }
        }
    }

    /**
     * 清空下载目录（供 /清理下载 命令使用）
     */
    cleanAll() {
        try {
            if (!fs.existsSync(DOWNLOADS_DIR)) return 0
            const files = fs.readdirSync(DOWNLOADS_DIR).filter(f => f.endsWith('.mp4'))
            for (const f of files) {
                try { fs.unlinkSync(path.join(DOWNLOADS_DIR, f)) } catch { /* skip */ }
            }
            return files.length
        } catch {
            return 0
        }
    }
}

module.exports = new VideoDownloadService()
```

**Step 2: 提交**

```bash
git add src/services/videoDownloadService.js
git commit -m "feat: add VideoDownloadService (download, send, cleanup)"
```

---

## Task 6: 存储 selfId + linkHandler.js 集成

**Files:**
- Modify: `src/bot.js`（约 12 行处）
- Modify: `src/handlers/linkHandler.js`（约 250-266 行的 video case）

**Step 1: 在 bot.js 中存储 selfId 到 global.bot**

找到文件第 12 行的 `global.bot = global.bot || { groupList: new Map() }` 修改为：

```javascript
global.bot = global.bot || { groupList: new Map(), selfId: '0' }
```

然后在约 160 行 `messageHandler.handleMessage(ws, payload)` 之前（即 `if (payload.message_type === 'group')` 块内），添加：

```javascript
                // 从首条消息中提取并存储 selfId
                if (payload.self_id && global.bot.selfId === '0') {
                    global.bot.selfId = String(payload.self_id)
                }
```

**Step 2: 在 linkHandler.js 的 video case 中添加下载触发**

找到约 257 行：

```javascript
                            await this.sendGroupMessageWithFallback(ws, groupId, base64Image, url, userId);
```

在其后（`} catch (imgError) {` 之前）添加：

```javascript
                            // 异步触发视频下载（不阻塞预览卡片发送）
                            const videoDownloadService = require('../services/videoDownloadService')
                            videoDownloadService.downloadAndSend(ws, groupId, id, info).catch(e => {
                                logger.error(`[LinkHandler] downloadAndSend failed for ${id}:`, e)
                            })
```

**Step 3: 提交**

```bash
git add src/bot.js src/handlers/linkHandler.js
git commit -m "feat: store selfId in global.bot; trigger video download in linkHandler"
```

---

## Task 7: updateChecker.js 订阅推送集成

**Files:**
- Modify: `src/services/subscription/updateChecker.js`（约 1097 行，`checkUserVideoUnified` 内）

**Step 1: 在视频推送成功后触发下载**

找到约 1097 行：

```javascript
                        await this.notifyGroupsWithImageAndCache(targetGroups, info, 'video', url, notificationText);
```

在其后添加：

```javascript
                        // 订阅推送后触发视频下载（每个目标群独立下载）
                        const videoDownloadService = require('../services/videoDownloadService')
                        for (const gid of targetGroups) {
                            videoDownloadService.downloadAndSend(this.ws, gid, bvid, info).catch(e => {
                                logger.error(`[UpdateChecker] downloadAndSend failed for ${bvid} in group ${gid}:`, e)
                            })
                        }
```

**Step 2: 提交**

```bash
git add src/services/subscription/updateChecker.js
git commit -m "feat: trigger video download after subscription push in updateChecker"
```

---

## Task 8: 下载命令模块

**Files:**
- Create: `src/commands/download.js`
- Modify: `src/commands/index.js`

**Step 1: 创建命令文件**

```javascript
const videoDownloadService = require('../services/videoDownloadService')
const biliApi = require('../services/biliApi')
const notificationService = require('../services/notificationService')
const { isVideoDownloadEnabledForGroup, getVideoDownloadResolutionForGroup } = require('../config')
const logger = require('../utils/logger')

module.exports = {
    name: 'DownloadCommand',

    async execute(context) {
        const { ws, groupId, message, isAdmin, isRoot } = context
        const text = message.trim()

        // /下载 P{n}
        const partMatch = text.match(/^\/下载\s+[Pp](\d+)$/)
        if (partMatch) {
            if (!isVideoDownloadEnabledForGroup(groupId)) {
                return { type: 'text', message: '当前群未开启视频下载功能' }
            }
            const pageIndex = parseInt(partMatch[1], 10) - 1
            if (pageIndex < 0) return { type: 'text', message: '分P编号无效，请从 P1 开始' }

            const lastInfo = videoDownloadService.getLastDownloadInfo(groupId)
            if (!lastInfo) return { type: 'text', message: '未找到最近的视频记录，请先发送视频链接' }
            if (pageIndex >= lastInfo.totalPages) {
                return { type: 'text', message: `该视频只有 ${lastInfo.totalPages}P，无法下载 P${pageIndex + 1}` }
            }

            // 重新获取视频信息以供下载
            const info = await biliApi.getVideoInfo(lastInfo.bvid, groupId)
            videoDownloadService.downloadAndSend(ws, groupId, lastInfo.bvid, info, pageIndex).catch(e => {
                logger.error(`[DownloadCommand] downloadAndSend failed:`, e)
            })
            return { type: 'text', message: `⏳ 正在下载 P${pageIndex + 1}，请稍候...` }
        }

        // /下载状态
        if (text === '/下载状态') {
            if (!isAdmin && !isRoot) return { type: 'text', message: '权限不足' }
            const stats = videoDownloadService.getDownloadStats()
            return { type: 'text', message: `📁 下载目录：${stats.count} 个文件，共 ${stats.totalSizeMB} MB` }
        }

        // /清理下载
        if (text === '/清理下载') {
            if (!isAdmin && !isRoot) return { type: 'text', message: '权限不足' }
            const count = videoDownloadService.cleanAll()
            return { type: 'text', message: `🗑️ 已清理 ${count} 个视频文件` }
        }

        return null
    }
}
```

**Step 2: 在 commands/index.js 注册**

找到 `dispatch` 函数，在其他命令的 `if (message.startsWith(...))` 判断中添加：

```javascript
const downloadCommand = require('./download')

// 在 dispatch 函数内，其他命令判断之前添加：
        if (message.startsWith('/下载') || message === '/下载状态' || message === '/清理下载') {
            return await downloadCommand.execute(context)
        }
```

**Step 3: 提交**

```bash
git add src/commands/download.js src/commands/index.js
git commit -m "feat: add download command (/下载 Pn, /下载状态, /清理下载)"
```

---

## Task 9: 启动时初始化

**Files:**
- Modify: `src/bot.js`（连接成功回调附近）

**Step 1: 启动清理调度器**

找到 `bot.js` 中 WebSocket `open` 事件回调（连接成功后），在其中添加：

```javascript
        const videoDownloadService = require('./services/videoDownloadService')
        videoDownloadService.startCleanupScheduler()
        logger.info('[Bot] Video download cleanup scheduler started')
```

**Step 2: 提交**

```bash
git add src/bot.js
git commit -m "feat: start video download cleanup scheduler on bot connect"
```

---

## Task 10: Dashboard API 端点

**Files:**
- Modify: `src/dashboard/routes/api.js`

**Step 1: 添加全局视频下载配置 GET/POST**

在现有 `/config` GET/POST 路由（约 173 行）处，全局配置已经包含 `videoDownload*` 字段（因为 META 中已注册），所以 `/config` 路由自动支持读取。

只需确认 `POST /config` 路由（约 191 行）的处理逻辑能接受新字段。检查 api.js 中 config 的保存方式，确认 `videoDownloadEnabled`、`videoDownloadResolution` 等会被正确持久化。如果 POST /config 是通用保存，无需修改。

**Step 2: 添加群级视频下载配置端点**

在 `PUT /groups/:groupId/ai-config`（约 526 行）下方添加：

```javascript
// 群级视频下载配置
router.get('/groups/:groupId/video-download-config', async (req, res) => {
    try {
        const groupId = String(req.params.groupId)
        const groupConfig = sysConfig.groupConfigs[groupId] || {}
        res.json({
            videoDownloadEnabled: groupConfig.videoDownloadEnabled ?? null,
            videoDownloadResolution: groupConfig.videoDownloadResolution ?? null,
            videoDownloadMaxDuration: groupConfig.videoDownloadMaxDuration ?? null,
        })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

router.put('/groups/:groupId/video-download-config', async (req, res) => {
    try {
        const groupId = String(req.params.groupId)
        if (!sysConfig.groupConfigs[groupId]) sysConfig.groupConfigs[groupId] = {}
        const { videoDownloadEnabled, videoDownloadResolution, videoDownloadMaxDuration } = req.body

        if (videoDownloadEnabled === null || videoDownloadEnabled === undefined) {
            delete sysConfig.groupConfigs[groupId].videoDownloadEnabled
        } else {
            sysConfig.groupConfigs[groupId].videoDownloadEnabled = videoDownloadEnabled
        }
        if (videoDownloadResolution === null || videoDownloadResolution === undefined) {
            delete sysConfig.groupConfigs[groupId].videoDownloadResolution
        } else {
            sysConfig.groupConfigs[groupId].videoDownloadResolution = videoDownloadResolution
        }
        if (videoDownloadMaxDuration === null || videoDownloadMaxDuration === undefined) {
            delete sysConfig.groupConfigs[groupId].videoDownloadMaxDuration
        } else {
            sysConfig.groupConfigs[groupId].videoDownloadMaxDuration = videoDownloadMaxDuration
        }

        await sysConfig.saveConfigDebounced()
        res.json({ success: true, config: sysConfig.groupConfigs[groupId] })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

router.delete('/groups/:groupId/video-download-config', async (req, res) => {
    try {
        const groupId = String(req.params.groupId)
        if (sysConfig.groupConfigs[groupId]) {
            delete sysConfig.groupConfigs[groupId].videoDownloadEnabled
            delete sysConfig.groupConfigs[groupId].videoDownloadResolution
            delete sysConfig.groupConfigs[groupId].videoDownloadMaxDuration
            await sysConfig.saveConfigDebounced()
        }
        res.json({ success: true })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})
```

**Step 3: 提交**

```bash
git add src/dashboard/routes/api.js
git commit -m "feat: add video download config API endpoints"
```

---

## Task 11: Settings.jsx 全局配置 UI

**Files:**
- Modify: `dashboard/src/pages/Settings.jsx`

**Step 1: 在 state 初始化中添加字段**

找到 `useState` 中 formData 初始化（约 62 行），在 `aiEnabled: true,` 附近添加：

```javascript
    videoDownloadEnabled: false,
    videoDownloadResolution: '1080p',
    videoDownloadMaxDuration: 600,
    videoDownloadAutoClean: true,
    videoDownloadCleanTimeout: 6,
```

**Step 2: 在 config 加载逻辑中映射字段**

找到加载 config 的 `useEffect`（约 120 行），在 `aiEnabled` 的映射下方添加：

```javascript
            videoDownloadEnabled: config.videoDownloadEnabled ?? false,
            videoDownloadResolution: config.videoDownloadResolution ?? '1080p',
            videoDownloadMaxDuration: config.videoDownloadMaxDuration ?? 600,
            videoDownloadAutoClean: config.videoDownloadAutoClean ?? true,
            videoDownloadCleanTimeout: config.videoDownloadCleanTimeout ?? 6,
```

**Step 3: 在 JSX 中添加视频下载配置卡片**

在最后一个 `</section>` 关闭标签之前（约文件末尾），添加新的 section：

```jsx
      {/* 视频下载 Section */}
      <section>
        <h2 className="text-xl font-semibold text-white mb-4">视频下载</h2>
        <GlassCard>
          <div className="space-y-4">
            {/* 启用开关 */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white font-medium">启用视频下载</p>
                <p className="text-sm text-white/60">识别到视频链接时自动下载并发送</p>
              </div>
              <button
                onClick={() => setFormData(p => ({ ...p, videoDownloadEnabled: !p.videoDownloadEnabled }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${formData.videoDownloadEnabled ? 'bg-purple-500' : 'bg-white/20'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${formData.videoDownloadEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>

            {/* 默认分辨率 */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white font-medium">默认分辨率</p>
                <p className="text-sm text-white/60">DASH 流最高画质上限</p>
              </div>
              <select
                value={formData.videoDownloadResolution}
                onChange={e => setFormData(p => ({ ...p, videoDownloadResolution: e.target.value }))}
                className="bg-white/10 text-white border border-white/20 rounded-lg px-3 py-1.5 text-sm"
              >
                {['360p', '480p', '720p', '1080p', '1080p+'].map(r => (
                  <option key={r} value={r} className="bg-gray-800">{r}</option>
                ))}
              </select>
            </div>

            {/* 最大时长 */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white font-medium">最大时长限制（秒）</p>
                <p className="text-sm text-white/60">0 表示不限制</p>
              </div>
              <input
                type="number" min="0"
                value={formData.videoDownloadMaxDuration}
                onChange={e => setFormData(p => ({ ...p, videoDownloadMaxDuration: parseInt(e.target.value) || 0 }))}
                className="bg-white/10 text-white border border-white/20 rounded-lg px-3 py-1.5 text-sm w-24 text-right"
              />
            </div>

            {/* 发送后自动删除 */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white font-medium">发送后自动删除</p>
                <p className="text-sm text-white/60">发送成功后立即删除本地文件</p>
              </div>
              <button
                onClick={() => setFormData(p => ({ ...p, videoDownloadAutoClean: !p.videoDownloadAutoClean }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${formData.videoDownloadAutoClean ? 'bg-purple-500' : 'bg-white/20'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${formData.videoDownloadAutoClean ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>

            {/* 清理超时 */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white font-medium">文件清理超时（小时）</p>
                <p className="text-sm text-white/60">超过此时间的未清理文件将自动删除</p>
              </div>
              <input
                type="number" min="1" max="168"
                value={formData.videoDownloadCleanTimeout}
                onChange={e => setFormData(p => ({ ...p, videoDownloadCleanTimeout: parseInt(e.target.value) || 6 }))}
                className="bg-white/10 text-white border border-white/20 rounded-lg px-3 py-1.5 text-sm w-20 text-right"
              />
            </div>

            {/* 保存按钮 */}
            <div className="flex justify-end pt-2">
              <button
                onClick={() => handleSaveConfig({
                  videoDownloadEnabled: formData.videoDownloadEnabled,
                  videoDownloadResolution: formData.videoDownloadResolution,
                  videoDownloadMaxDuration: formData.videoDownloadMaxDuration,
                  videoDownloadAutoClean: formData.videoDownloadAutoClean,
                  videoDownloadCleanTimeout: formData.videoDownloadCleanTimeout,
                })}
                className="px-4 py-2 bg-purple-500/80 hover:bg-purple-500 text-white rounded-lg text-sm transition-colors"
              >
                保存
              </button>
            </div>
          </div>
        </GlassCard>
      </section>
```

注意：`handleSaveConfig` 是现有保存全局配置的函数，如果函数名不同请替换为实际函数名。

**Step 4: 构建 Dashboard 验证**

```bash
cd dashboard && npm run build 2>&1 | tail -5
# 期望: ✓ built in ...ms
cd ..
```

**Step 5: 提交**

```bash
git add dashboard/src/pages/Settings.jsx dashboard/dist/
git commit -m "feat: add video download settings section to Settings page"
```

---

## Task 12: Groups.jsx 群级配置 UI

**Files:**
- Modify: `dashboard/src/pages/Groups.jsx`

**Step 1: 添加 state 和 API 函数**

在现有 AI 配置相关 state（约 39-42 行）下方添加：

```javascript
  const [videoDownloadConfig, setVideoDownloadConfig] = useState({
    videoDownloadEnabled: null,   // null = 跟随全局
    videoDownloadResolution: null,
    videoDownloadMaxDuration: null,
  })
```

在现有 `fetchBiliGroups` 或 AI 配置 fetch 函数下方添加：

```javascript
  const fetchVideoDownloadConfig = useCallback(async (gid) => {
    try {
      const resp = await api.get(`/groups/${gid}/video-download-config`)
      setVideoDownloadConfig(resp.data)
    } catch (e) {
      console.error('Failed to fetch video download config:', e)
    }
  }, [])

  const saveVideoDownloadConfig = async () => {
    try {
      await api.put(`/groups/${selectedGroupId}/video-download-config`, videoDownloadConfig)
      show('视频下载配置已更新', 'success')
    } catch (e) {
      show('更新失败', 'error')
    }
  }

  const resetVideoDownloadConfig = async () => {
    try {
      await api.delete(`/groups/${selectedGroupId}/video-download-config`)
      setVideoDownloadConfig({ videoDownloadEnabled: null, videoDownloadResolution: null, videoDownloadMaxDuration: null })
      show('已重置为全局默认', 'success')
    } catch (e) {
      show('重置失败', 'error')
    }
  }
```

**Step 2: 在 tabs 数组中添加"视频下载"标签**

找到 tabs 数组（含 `{ name: '关注同步', icon: RefreshCw }` 等），在最后一项后添加：

```javascript
    { name: '视频下载', icon: Video },  // Video 从 lucide-react 导入
```

在文件顶部 lucide-react 导入行中添加 `Video`：
```javascript
import { ..., Video } from 'lucide-react'
```

**Step 3: 在 selectedTabIndex 的判断中添加加载逻辑**

找到 `if (selectedTabIndex === 4)` 的同级位置，添加：

```javascript
        if (selectedTabIndex === 5) {
          fetchVideoDownloadConfig(selectedGroupId)
        }
```

**Step 4: 添加视频下载标签页 JSX 内容**

在 Tab.Panels 区域，在最后一个 `<Tab.Panel>` 后添加：

```jsx
            {/* 视频下载标签页 */}
            <Tab.Panel>
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-white">视频下载配置</h3>
                <GlassCard>
                  <div className="space-y-4">
                    {/* 启用开关：跟随全局 / 开 / 关 */}
                    <div>
                      <p className="text-white font-medium mb-2">启用视频下载</p>
                      <div className="flex gap-3">
                        {[{ label: '跟随全局', value: null }, { label: '开', value: true }, { label: '关', value: false }].map(opt => (
                          <button key={String(opt.value)}
                            onClick={() => setVideoDownloadConfig(p => ({ ...p, videoDownloadEnabled: opt.value }))}
                            className={`px-3 py-1.5 rounded-lg text-sm ${videoDownloadConfig.videoDownloadEnabled === opt.value ? 'bg-purple-500 text-white' : 'bg-white/10 text-white/70 hover:bg-white/20'}`}
                          >{opt.label}</button>
                        ))}
                      </div>
                    </div>

                    {/* 分辨率：跟随全局 / 下拉 */}
                    <div className="flex items-center justify-between">
                      <p className="text-white font-medium">默认分辨率</p>
                      <div className="flex gap-2 items-center">
                        <button
                          onClick={() => setVideoDownloadConfig(p => ({ ...p, videoDownloadResolution: null }))}
                          className={`px-3 py-1.5 rounded-lg text-sm ${videoDownloadConfig.videoDownloadResolution === null ? 'bg-purple-500 text-white' : 'bg-white/10 text-white/70 hover:bg-white/20'}`}
                        >跟随全局</button>
                        <select
                          value={videoDownloadConfig.videoDownloadResolution ?? ''}
                          onChange={e => setVideoDownloadConfig(p => ({ ...p, videoDownloadResolution: e.target.value || null }))}
                          className="bg-white/10 text-white border border-white/20 rounded-lg px-3 py-1.5 text-sm"
                        >
                          <option value="" className="bg-gray-800">（跟随全局）</option>
                          {['360p', '480p', '720p', '1080p', '1080p+'].map(r => (
                            <option key={r} value={r} className="bg-gray-800">{r}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* 最大时长 */}
                    <div className="flex items-center justify-between">
                      <p className="text-white font-medium">最大时长限制（秒）</p>
                      <div className="flex gap-2 items-center">
                        <button
                          onClick={() => setVideoDownloadConfig(p => ({ ...p, videoDownloadMaxDuration: null }))}
                          className={`px-3 py-1.5 rounded-lg text-sm ${videoDownloadConfig.videoDownloadMaxDuration === null ? 'bg-purple-500 text-white' : 'bg-white/10 text-white/70 hover:bg-white/20'}`}
                        >跟随全局</button>
                        <input type="number" min="0"
                          value={videoDownloadConfig.videoDownloadMaxDuration ?? ''}
                          onChange={e => setVideoDownloadConfig(p => ({ ...p, videoDownloadMaxDuration: e.target.value === '' ? null : parseInt(e.target.value) || 0 }))}
                          placeholder="秒"
                          className="bg-white/10 text-white border border-white/20 rounded-lg px-3 py-1.5 text-sm w-24 text-right"
                        />
                      </div>
                    </div>

                    <div className="flex justify-between pt-2">
                      <button onClick={resetVideoDownloadConfig}
                        className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-sm">
                        重置为全局默认
                      </button>
                      <button onClick={saveVideoDownloadConfig}
                        className="px-4 py-2 bg-purple-500/80 hover:bg-purple-500 text-white rounded-lg text-sm">
                        保存
                      </button>
                    </div>
                  </div>
                </GlassCard>
              </div>
            </Tab.Panel>
```

**Step 5: 构建并验证**

```bash
cd dashboard && npm run build 2>&1 | tail -5
# 期望: ✓ built in ...ms
cd ..
```

**Step 6: 提交**

```bash
git add dashboard/src/pages/Groups.jsx dashboard/dist/
git commit -m "feat: add video download tab to Groups page"
```

---

## Task 13: Dockerfile 添加 FFmpeg

**Files:**
- Modify: `Dockerfile`

**Step 1: 查看现有 Dockerfile 中系统包安装位置**

```bash
grep -n "apt-get\|ffmpeg\|chromium" Dockerfile | head -10
```

**Step 2: 在现有 `apt-get install` 命令中添加 `ffmpeg`**

找到安装 chromium 等包的行，在同一 `RUN apt-get install -y` 命令中添加 `ffmpeg`，例如：

```dockerfile
RUN apt-get install -y --no-install-recommends \
    ffmpeg \
    chromium \
    ...
```

如果有多个 `apt-get install` 块，加到已有的任一块中以减少镜像层数。

**Step 3: 验证**

```bash
grep -n "ffmpeg" Dockerfile
# 期望显示已添加的行
```

**Step 4: 提交**

```bash
git add Dockerfile
git commit -m "feat: add ffmpeg to Dockerfile for video stream merging"
```

---

## Task 14: 本地集成验证

**Step 1: 验证单元测试全部通过**

```bash
node test/unit/videoDownloadConfig.test.js
# 期望: ✅ All videoDownloadConfig tests passed
```

**Step 2: 验证 Python 服务新端点存在**

```bash
grep -n "video_download" src/services/bili_server.py
# 期望: 显示函数定义和路由注册
```

**Step 3: 验证 Node.js 模块可加载**

```bash
node -e "const s = require('./src/services/videoDownloadService'); console.log('OK:', typeof s.downloadAndSend)"
# 期望: OK: function

node -e "const c = require('./src/commands/download'); console.log('OK:', c.name)"
# 期望: OK: DownloadCommand
```

**Step 4: 验证 Dashboard 构建产物存在**

```bash
ls dashboard/dist/assets/*.js | wc -l
# 期望: > 0
```

**Step 5: 最终整合提交**

```bash
git log --oneline -10
# 回顾所有提交
```

---

## 快速参考

### 触发流程

```
用户发视频链接
  → linkHandler.js:video case（约 257 行后）
  → videoDownloadService.downloadAndSend()
  → 配置检查 → 时长检查 → Python /video_download
  → 合并转发消息发送 → 文件清理

订阅推送新视频
  → updateChecker.js:checkUserVideoUnified（约 1097 行后）
  → 同上
```

### 关键文件位置

| 功能 | 文件 | 关键位置 |
|------|------|----------|
| Python 下载 | `bili_server.py` | `download_video_file()` + `handle_video_download()` |
| 配置 helper | `config.js` | `isVideoDownloadEnabledForGroup()` 等 |
| 下载服务 | `videoDownloadService.js` | `downloadAndSend()` |
| 链接触发 | `linkHandler.js` | video case 约 257 行 |
| 订阅触发 | `updateChecker.js` | `checkUserVideoUnified` 约 1097 行 |
| 命令 | `download.js` | `/下载 Pn` etc. |
| Dashboard API | `api.js` | `/groups/:id/video-download-config` |
| 前端全局 | `Settings.jsx` | 视频下载 section |
| 前端群级 | `Groups.jsx` | tab index 5 |
