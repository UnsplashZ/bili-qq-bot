const path = require('path')
const fs = require('fs')
const fsPromises = require('fs').promises
const biliApi = require('./biliApi')
const notificationService = require('./notificationService')
const logger = require('../utils/logger')
const config = require('../config')
const {
    isVideoDownloadEnabledForGroup,
    getVideoDownloadResolutionForGroup,
    getVideoDownloadMaxDurationForGroup,
} = require('../config')

// 下载目录必须与 NapCat 共享目录对齐，否则 NapCat 无法读取本地视频文件
const DOWNLOADS_DIR = path.join(config.napcatTempPath, 'downloads')
const NAPCAT_READ_BASE = path.resolve(config.napcatReadPath)
const BOT_WRITE_BASE = path.resolve(config.napcatTempPath)

function toNapcatReadablePath(filePath) {
    if (!filePath) return filePath
    const absFilePath = path.resolve(filePath)
    if (absFilePath === BOT_WRITE_BASE || absFilePath.startsWith(BOT_WRITE_BASE + path.sep)) {
        const relative = path.relative(BOT_WRITE_BASE, absFilePath)
        return path.join(NAPCAT_READ_BASE, relative)
    }
    logger.warn(`[VideoDownload] File path is outside NapCat shared base: ${filePath}`)
    return filePath
}

function toFileUrlPath(filePath) {
    return String(filePath).replace(/\\/g, '/')
}

// 每群最近下载的视频信息，用于支持 /下载 P2 命令
// Map<groupId, { bvid, title, owner, totalPages, pageIndex }>
const lastDownloadInfo = new Map()

const MAX_CONCURRENT_DOWNLOADS = 3

// 正在下载中的任务 key 集合，防止同一视频被 linkHandler 和 updateChecker 重复触发
const _inProgressDownloads = new Set()

// 下载分辨率排序（从低到高），用于订阅扇出时取最高分辨率
const RESOLUTION_ORDER = ['360p', '480p', '720p', '1080p', '1080p+']

// 单次下载兜底超时：330s（高于 axios 300s，确保 _activeDownloads 配额最终释放）
const DOWNLOAD_TIMEOUT_MS = 330 * 1000

class VideoDownloadService {
    constructor() {
        this._cleanupTimer = null
        this._activeDownloads = 0
    }

    _notifyTarget(ws, groupId, messageChain, enableFallback = false) {
        if (typeof groupId === 'string' && groupId.startsWith('private_')) {
            const realUserId = groupId.replace('private_', '')
            if (!realUserId) {
                logger.warn(`[VideoDownload] Invalid private groupId for notify: ${groupId}`)
                return
            }
            notificationService.sendPrivateMessage(ws, realUserId, messageChain, 'VideoDownload', enableFallback)
            return
        }
        notificationService.sendGroupMessage(ws, groupId, messageChain, 'VideoDownload', enableFallback)
    }

    /**
     * 启动定时清理任务（每小时检查一次）
     */
    startCleanupScheduler() {
        if (this._cleanupTimer) return
        this._cleanupTimer = setInterval(() => {
            this._cleanupOldFiles().catch(e => {
                logger.error('[VideoDownload] Error in scheduled cleanup:', e)
            })
        }, 60 * 60 * 1000)
        logger.info('[VideoDownload] Cleanup scheduler started')
    }

    /**
     * 清理超过 videoDownloadCleanTimeout 小时的下载文件
     */
    async _cleanupOldFiles() {
        try {
            await fsPromises.access(DOWNLOADS_DIR)
        } catch {
            return // 目录不存在，无需清理
        }
        try {
            // 最小 1 小时，防止 cleanTimeout=0 导致所有文件被立即删除
            const cleanTimeout = Math.max(config.videoDownloadCleanTimeout || 24, 1)
            const maxAgeMs = cleanTimeout * 60 * 60 * 1000
            const now = Date.now()
            const files = await fsPromises.readdir(DOWNLOADS_DIR)
            for (const file of files) {
                if (!file.endsWith('.mp4') && !file.endsWith('.tmp')) continue
                const filePath = path.join(DOWNLOADS_DIR, file)
                try {
                    const stat = await fsPromises.stat(filePath)
                    if (now - stat.mtimeMs > maxAgeMs) {
                        await fsPromises.unlink(filePath)
                        logger.info(`[VideoDownload] Cleaned up old file: ${file}`)
                    }
                } catch (e) {
                    logger.warn(`[VideoDownload] Cannot stat/delete file ${file}:`, e.message)
                }
            }
        } catch (e) {
            logger.error('[VideoDownload] Error during cleanup:', e)
        }
    }

    /**
     * 删除单个文件（发送后清理）
     */
    async cleanupFile(filePath) {
        try {
            await fsPromises.access(filePath)
            await fsPromises.unlink(filePath)
            logger.info(`[VideoDownload] Deleted file: ${filePath}`)
        } catch (e) {
            if (e.code !== 'ENOENT') {
                logger.error(`[VideoDownload] Failed to delete file ${filePath}:`, e)
            }
        }
    }

    /**
     * 根据文件大小和群数量动态延迟清理：基础 60s + 每 100MB 额外 60s，上限 10 分钟
     * groupCount 为扇出群数量，延迟按群数量系数放大（上限 30 分钟）
     */
    _scheduleCleanup(filePath, groupCount = 1) {
        if (!config.videoDownloadAutoClean || !filePath) return
        let delayMs = 60 * 1000
        // 异步读取文件大小，不阻塞当前调用
        fsPromises.stat(filePath).then(stat => {
            const extraDelay = Math.floor(stat.size / (100 * 1024 * 1024)) * 60 * 1000
            delayMs = Math.min(delayMs + extraDelay, 10 * 60 * 1000)
            const groupFactor = Math.max(1, Math.ceil(groupCount / 2))
            const adjustedDelay = Math.min(delayMs * groupFactor, 30 * 60 * 1000)
            setTimeout(() => this.cleanupFile(filePath), adjustedDelay)
        }).catch(() => {
            // 无法获取大小时使用默认值（含群数量系数）
            const groupFactor = Math.max(1, Math.ceil(groupCount / 2))
            const adjustedDelay = Math.min(delayMs * groupFactor, 30 * 60 * 1000)
            setTimeout(() => this.cleanupFile(filePath), adjustedDelay)
        })
    }

    /**
     * 主入口：检查配置 → 下载 → 发送
     * @param {WebSocket} ws
     * @param {string} groupId
     * @param {string} bvid
     * @param {object} videoInfo - 已有的视频信息（来自 getVideoInfo，含 data.duration 等）
     * @param {number} pageIndex - 分P索引（0-based），默认 0
     */
    async downloadAndSend(ws, groupId, bvid, videoInfo, pageIndex = 0) {
        if (!isVideoDownloadEnabledForGroup(groupId)) return { ok: false, reason: 'disabled', silent: true }

        // 去重：避免 linkHandler 和 updateChecker 同时触发相同视频的重复下载
        const downloadKey = `${String(groupId)}:${bvid}:${pageIndex}`
        if (_inProgressDownloads.has(downloadKey)) {
            logger.info(`[VideoDownload] Already downloading ${bvid} P${pageIndex + 1} for group ${groupId}, skipping duplicate`)
            return { ok: false, reason: 'duplicate', silent: true }
        }

        // 并发限制
        if (this._activeDownloads >= MAX_CONCURRENT_DOWNLOADS) {
            logger.warn(`[VideoDownload] Max concurrent downloads (${MAX_CONCURRENT_DOWNLOADS}) reached, skipping ${bvid}`)
            this._notifyTarget(ws, groupId, [
                { type: 'text', data: { text: `⏳ 当前下载任务已满（最多 ${MAX_CONCURRENT_DOWNLOADS} 个），${bvid} 跳过下载` } }
            ], false)
            return { ok: false, reason: 'max_concurrent', silent: true }
        }

        const duration = videoInfo?.data?.duration ?? 0
        const maxDuration = getVideoDownloadMaxDurationForGroup(groupId)

        // 时长超限：发送独立提示消息，不下载
        if (maxDuration > 0 && duration > maxDuration) {
            const durationMin = Math.round(duration / 60)
            const limitMin = Math.round(maxDuration / 60)
            this._notifyTarget(ws, groupId, [
                { type: 'text', data: { text: `⚠️ 视频时长 ${durationMin} 分钟，超出当前限制（${limitMin} 分钟），已跳过下载` } }
            ], false)
            return { ok: false, reason: 'duration_exceeded', silent: true }
        }

        // 磁盘空间预检（目录超过 5GB 时跳过）
        if (!await this._hasDiskSpace()) {
            logger.warn(`[VideoDownload] Insufficient disk space, skipping download of ${bvid}`)
            this._notifyTarget(ws, groupId, [
                { type: 'text', data: { text: '⚠️ 下载目录空间不足（超过 5GB），已跳过下载。可使用 /清理下载 释放空间' } }
            ], false)
            return { ok: false, reason: 'disk_space_full', silent: true }
        }

        const resolution = getVideoDownloadResolutionForGroup(groupId)

        logger.info(`[VideoDownload] Starting download: ${bvid} P${pageIndex + 1} @ ${resolution} for group ${groupId}`)

        // 提前写入最近下载记录（供 /下载 P2 使用），避免下载期间竞态
        const gid = String(groupId)
        lastDownloadInfo.set(gid, {
            bvid,
            title: videoInfo?.data?.title ?? bvid,
            owner: videoInfo?.data?.owner?.name ?? 'Unknown',
            totalPages: videoInfo?.data?.pages?.length ?? 1,
            pageIndex,
        })

        // 构建元信息传递给 Python，避免重复调用 v.get_info()
        const meta = videoInfo?.data ? {
            title: videoInfo.data.title,
            owner: videoInfo.data.owner?.name ?? 'Unknown',
            duration: videoInfo.data.duration ?? 0,
            total_pages: videoInfo.data.pages?.length ?? 1,
        } : null

        this._activeDownloads++
        _inProgressDownloads.add(downloadKey)
        let result
        try {
            // 兜底超时：防止 Python/axios 超时失效导致配额永久占用
            result = await Promise.race([
                biliApi.downloadVideo(bvid, pageIndex, resolution, groupId, meta),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('download_overall_timeout')), DOWNLOAD_TIMEOUT_MS)
                )
            ])
        } catch (e) {
            logger.error(`[VideoDownload] Download failed for ${bvid}:`, e)
            return { ok: false, reason: e.message }
        } finally {
            this._activeDownloads--
            _inProgressDownloads.delete(downloadKey)
        }

        if (result.status !== 'success') {
            logger.warn(`[VideoDownload] Download error for ${bvid}: ${result.message}`)
            return { ok: false, reason: result.message }
        }

        const sent = await this._sendForwardMessage(ws, groupId, result)

        // ws.send() 只是将 JSON 指令推入 WebSocket 缓冲区，NapCat 收到后才异步读取文件上传。
        // 必须延迟删除，给 NapCat 足够时间读取本地文件，而不是立即删除。
        this._scheduleCleanup(result.file_path)

        // 多P提示（仅首P触发时发送）
        if (sent && result.total_pages > 1 && pageIndex === 0) {
            this._notifyTarget(ws, groupId, [
                { type: 'text', data: { text: `📺 当前视频共 ${result.total_pages}P，已下载第 1P\n回复 /下载 P2 可继续下载其他分集` } }
            ], false)
        }

        return { ok: sent }
    }

    /**
     * 发送视频消息（群聊/私聊均使用普通消息）
     * @returns {boolean} 是否发送成功
     */
    async _sendForwardMessage(ws, groupId, result) {
        // 优先使用全局当前活跃连接，fallback 到传入参数（防止 stale ws）
        const activeWs = global.bot?.ws || ws
        if (!activeWs || activeWs.readyState !== 1 /* WebSocket.OPEN */) {
            logger.warn(`[VideoDownload] WebSocket not open, cannot send video message for ${result.title}`)
            return false
        }

        const videoFile = `file://${toFileUrlPath(toNapcatReadablePath(result.file_path))}`

        // 私聊虚拟群场景
        if (typeof groupId === 'string' && groupId.startsWith('private_')) {
            const realUserId = groupId.replace('private_', '')
            if (!realUserId) {
                logger.warn(`[VideoDownload] Invalid private groupId: ${groupId}`)
                return false
            }
            const payload = {
                action: 'send_private_msg',
                params: {
                    user_id: realUserId,
                    message: [
                        { type: 'text', data: { text: `「${result.title}」- ${result.owner}` } },
                        { type: 'video', data: { file: videoFile } }
                    ]
                }
            }
            try {
                activeWs.send(JSON.stringify(payload))
                logger.info(`[VideoDownload] Private video message sent to user ${realUserId}: ${result.title}`)
                return true
            } catch (e) {
                logger.error(`[VideoDownload] Failed to send private video message:`, e)
                return false
            }
        }

        const numericGroupId = Number(groupId)
        if (!Number.isFinite(numericGroupId)) {
            logger.warn(`[VideoDownload] Invalid groupId for video message: ${groupId}`)
            return false
        }

        const payload = {
            action: 'send_group_msg',
            params: {
                group_id: numericGroupId,
                message: [
                    { type: 'text', data: { text: `「${result.title}」- ${result.owner}` } },
                    { type: 'video', data: { file: videoFile } }
                ]
            }
        }

        try {
            activeWs.send(JSON.stringify(payload))
            logger.info(`[VideoDownload] Group video message sent to group ${groupId}: ${result.title}`)
            return true
        } catch (e) {
            logger.error(`[VideoDownload] Failed to send group video message:`, e)
            return false
        }
    }

    /**
     * 检查下载目录大小是否超过 5GB 上限
     */
    async _hasDiskSpace() {
        try {
            await fsPromises.access(DOWNLOADS_DIR)
        } catch {
            return true // 目录不存在，视为有空间
        }
        try {
            let totalSize = 0
            const files = await fsPromises.readdir(DOWNLOADS_DIR)
            for (const f of files) {
                if (!f.endsWith('.mp4') && !f.endsWith('.tmp')) continue
                try {
                    const stat = await fsPromises.stat(path.join(DOWNLOADS_DIR, f))
                    totalSize += stat.size
                } catch { /* skip */ }
            }
            return totalSize < 5 * 1024 * 1024 * 1024 // 5GB
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
    async getDownloadStats() {
        try {
            await fsPromises.access(DOWNLOADS_DIR)
        } catch {
            return { count: 0, totalSizeMB: 0 }
        }
        try {
            const allFiles = await fsPromises.readdir(DOWNLOADS_DIR)
            const files = allFiles.filter(f => f.endsWith('.mp4'))
            let totalSize = 0
            for (const f of files) {
                try {
                    const stat = await fsPromises.stat(path.join(DOWNLOADS_DIR, f))
                    totalSize += stat.size
                } catch { /* skip */ }
            }
            return { count: files.length, totalSizeMB: Math.round(totalSize / 1024 / 1024) }
        } catch {
            return { count: 0, totalSizeMB: 0 }
        }
    }

    /**
     * 下载视频一次，发送到多个群（用于订阅扇出场景）
     * 按群独立过滤时长限制，取所有目标群中最高的分辨率下载
     */
    async downloadAndSendToGroups(ws, groupIds, bvid, videoInfo, pageIndex = 0) {
        const enabledGroups = groupIds.filter(gid => isVideoDownloadEnabledForGroup(gid))
        if (enabledGroups.length === 0) return

        const downloadKey = `subscription:${bvid}:${pageIndex}`

        if (_inProgressDownloads.has(downloadKey)) {
            logger.info(`[VideoDownload] Already downloading ${bvid} P${pageIndex + 1} (subscription), skipping`)
            return
        }

        if (this._activeDownloads >= MAX_CONCURRENT_DOWNLOADS) {
            logger.warn(`[VideoDownload] Max concurrent downloads reached, skipping subscription download for ${bvid}`)
            return
        }

        // 按群独立过滤：只向时长限制内的群发送
        const duration = videoInfo?.data?.duration ?? 0
        const filteredGroups = enabledGroups.filter(gid => {
            const maxDur = getVideoDownloadMaxDurationForGroup(gid)
            return maxDur === 0 || duration <= maxDur
        })
        if (filteredGroups.length === 0) {
            logger.info(`[VideoDownload] All groups exceed duration limit for ${bvid} (${Math.round(duration / 60)}min), skipping`)
            return
        }

        if (!await this._hasDiskSpace()) {
            logger.warn(`[VideoDownload] Insufficient disk space, skipping subscription download of ${bvid}`)
            const adminQQ = config.adminQQ
            if (adminQQ && ws && ws.readyState === 1) {
                notificationService.sendPrivateMessage(ws, adminQQ, [
                    { type: 'text', data: { text: `⚠️ 下载目录空间不足（超过 5GB），已跳过订阅视频 ${bvid} 的下载。可使用 /清理下载 释放空间` } }
                ], 'VideoDownload', false)
            }
            return
        }

        // 取所有目标群中最高的分辨率，以满足要求最高的群
        const resolution = filteredGroups.reduce((best, gid) => {
            const res = getVideoDownloadResolutionForGroup(gid)
            return RESOLUTION_ORDER.indexOf(res) > RESOLUTION_ORDER.indexOf(best) ? res : best
        }, '360p')

        logger.info(`[VideoDownload] Subscription download: ${bvid} P${pageIndex + 1} @ ${resolution} for ${filteredGroups.length} groups`)

        const meta = videoInfo?.data ? {
            title: videoInfo.data.title,
            owner: videoInfo.data.owner?.name ?? 'Unknown',
            duration: videoInfo.data.duration ?? 0,
            total_pages: videoInfo.data.pages?.length ?? 1,
        } : null

        this._activeDownloads++
        _inProgressDownloads.add(downloadKey)
        let result
        try {
            result = await Promise.race([
                biliApi.downloadVideo(bvid, pageIndex, resolution, filteredGroups[0], meta),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('download_overall_timeout')), DOWNLOAD_TIMEOUT_MS)
                )
            ])
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
        for (const gid of filteredGroups) {
            try {
                const sent = await this._sendForwardMessage(ws, gid, result)
                if (sent) sentCount++
            } catch (e) {
                logger.error(`[VideoDownload] Failed to send to group ${gid}:`, e)
            }
        }
        logger.info(`[VideoDownload] Subscription video ${bvid} sent to ${sentCount}/${filteredGroups.length} groups`)

        // 所有群都发完后再清理文件，延迟按群数量系数放大
        this._scheduleCleanup(result.file_path, filteredGroups.length)
    }

    /**
     * 清空下载目录（供 /清理下载 命令使用）
     * @returns {Promise<number>} 删除的文件数量，-1 表示有活跃下载被拒绝
     */
    async cleanAll() {
        try {
            await fsPromises.access(DOWNLOADS_DIR)
        } catch {
            return 0 // 目录不存在
        }
        try {
            // 有活跃下载时拒绝清理，防止删除正在使用的文件
            if (this._activeDownloads > 0) {
                logger.warn(`[VideoDownload] cleanAll skipped: ${this._activeDownloads} downloads in progress`)
                return -1
            }
            // 同时清理 .mp4 和中途中断留下的 .tmp 临时文件
            const allFiles = await fsPromises.readdir(DOWNLOADS_DIR)
            const files = allFiles.filter(f => f.endsWith('.mp4') || f.endsWith('.tmp'))
            for (const f of files) {
                try { await fsPromises.unlink(path.join(DOWNLOADS_DIR, f)) } catch { /* skip */ }
            }
            return files.length
        } catch {
            return 0
        }
    }
}

module.exports = new VideoDownloadService()
