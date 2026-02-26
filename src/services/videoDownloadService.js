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

const MAX_CONCURRENT_DOWNLOADS = 3

// 正在下载中的任务 key 集合，防止同一视频被 linkHandler 和 updateChecker 重复触发
const _inProgressDownloads = new Set()

class VideoDownloadService {
    constructor() {
        this._cleanupTimer = null
        this._activeDownloads = 0
    }

    /**
     * 启动定时清理任务（每小时检查一次）
     */
    startCleanupScheduler() {
        if (this._cleanupTimer) return
        this._cleanupTimer = setInterval(() => {
            this._cleanupOldFiles()
        }, 60 * 60 * 1000)
        logger.info('[VideoDownload] Cleanup scheduler started')
    }

    /**
     * 清理超过 videoDownloadCleanTimeout 小时的下载文件
     */
    _cleanupOldFiles() {
        try {
            if (!fs.existsSync(DOWNLOADS_DIR)) return
            // 最小 1 小时，防止 cleanTimeout=0 导致所有文件被立即删除
            const cleanTimeout = Math.max(config.videoDownloadCleanTimeout || 24, 1)
            const maxAgeMs = cleanTimeout * 60 * 60 * 1000
            const now = Date.now()
            const files = fs.readdirSync(DOWNLOADS_DIR)
            for (const file of files) {
                if (!file.endsWith('.mp4') && !file.endsWith('.tmp')) continue
                const filePath = path.join(DOWNLOADS_DIR, file)
                try {
                    const stat = fs.statSync(filePath)
                    if (now - stat.mtimeMs > maxAgeMs) {
                        fs.unlinkSync(filePath)
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
     * 根据文件大小动态延迟清理：基础 60s + 每 100MB 额外 60s，上限 10 分钟
     */
    _scheduleCleanup(filePath) {
        if (!config.videoDownloadAutoClean || !filePath) return
        let delayMs = 60 * 1000
        try {
            const fileSize = fs.statSync(filePath).size
            const extraDelay = Math.floor(fileSize / (100 * 1024 * 1024)) * 60 * 1000
            delayMs = Math.min(delayMs + extraDelay, 10 * 60 * 1000)
        } catch { /* 无法获取大小时使用默认值 */ }
        setTimeout(() => this.cleanupFile(filePath), delayMs)
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
            notificationService.sendGroupMessage(ws, groupId, [
                { type: 'text', data: { text: `⏳ 当前下载任务已满（最多 ${MAX_CONCURRENT_DOWNLOADS} 个），${bvid} 跳过下载` } }
            ], 'VideoDownload', false)
            return { ok: false, reason: 'max_concurrent', silent: true }
        }

        const duration = videoInfo?.data?.duration ?? 0
        const maxDuration = getVideoDownloadMaxDurationForGroup(groupId)

        // 时长超限：发送独立提示消息，不下载
        if (maxDuration > 0 && duration > maxDuration) {
            const durationMin = Math.round(duration / 60)
            const limitMin = Math.round(maxDuration / 60)
            notificationService.sendGroupMessage(ws, groupId, [
                { type: 'text', data: { text: `⚠️ 视频时长 ${durationMin} 分钟，超出当前限制（${limitMin} 分钟），已跳过下载` } }
            ], 'VideoDownload', false)
            return { ok: false, reason: 'duration_exceeded', silent: true }
        }

        // 磁盘空间预检（目录超过 5GB 时跳过）
        if (!this._hasDiskSpace()) {
            logger.warn(`[VideoDownload] Insufficient disk space, skipping download of ${bvid}`)
            notificationService.sendGroupMessage(ws, groupId, [
                { type: 'text', data: { text: '⚠️ 下载目录空间不足（超过 5GB），已跳过下载。可使用 /清理下载 释放空间' } }
            ], 'VideoDownload', false)
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
            result = await biliApi.downloadVideo(bvid, pageIndex, resolution, DOWNLOADS_DIR, groupId, meta)
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
            notificationService.sendGroupMessage(ws, groupId, [
                { type: 'text', data: { text: `📺 当前视频共 ${result.total_pages}P，已下载第 1P\n回复 /下载 P2 可继续下载其他分集` } }
            ], 'VideoDownload', false)
        }

        return { ok: sent }
    }

    /**
     * 发送合并转发消息（独立于预览卡片）
     * @returns {boolean} 是否发送成功
     */
    async _sendForwardMessage(ws, groupId, result) {
        // 优先使用全局当前活跃连接，fallback 到传入参数（防止 stale ws）
        const activeWs = global.bot?.ws || ws
        if (!activeWs || activeWs.readyState !== 1 /* WebSocket.OPEN */) {
            logger.warn(`[VideoDownload] WebSocket not open, cannot send forward message for ${result.title}`)
            return false
        }

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
                group_id: Number(groupId),
                messages: nodes
            }
        }

        try {
            activeWs.send(JSON.stringify(payload))
            logger.info(`[VideoDownload] Forward message sent to group ${groupId}: ${result.title}`)
            return true
        } catch (e) {
            logger.error(`[VideoDownload] Failed to send forward message:`, e)
            return false
        }
    }

    /**
     * 检查下载目录大小是否超过 5GB 上限
     */
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
     * 下载视频一次，发送到多个群（用于订阅扇出场景）
     */
    async downloadAndSendToGroups(ws, groupIds, bvid, videoInfo, pageIndex = 0) {
        const enabledGroups = groupIds.filter(gid => isVideoDownloadEnabledForGroup(gid))
        if (enabledGroups.length === 0) return

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
            for (const gid of enabledGroups) {
                notificationService.sendGroupMessage(ws, gid, [
                    { type: 'text', data: { text: '⚠️ 下载目录空间不足（超过 5GB），已跳过下载。可使用 /清理下载 释放空间' } }
                ], 'VideoDownload', false)
            }
            return
        }

        const resolution = getVideoDownloadResolutionForGroup(firstGroup)
        logger.info(`[VideoDownload] Subscription download: ${bvid} P${pageIndex + 1} @ ${resolution} for ${enabledGroups.length} groups`)

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
            result = await biliApi.downloadVideo(bvid, pageIndex, resolution, DOWNLOADS_DIR, firstGroup, meta)
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
        this._scheduleCleanup(result.file_path)
    }

    /**
     * 清空下载目录（供 /清理下载 命令使用）
     * @returns {number} 删除的文件数量
     */
    cleanAll() {
        try {
            if (!fs.existsSync(DOWNLOADS_DIR)) return 0
            // 有活跃下载时拒绝清理，防止删除正在使用的文件
            if (this._activeDownloads > 0) {
                logger.warn(`[VideoDownload] cleanAll skipped: ${this._activeDownloads} downloads in progress`)
                return -1
            }
            // 同时清理 .mp4 和中途中断留下的 .tmp 临时文件
            const files = fs.readdirSync(DOWNLOADS_DIR).filter(f => f.endsWith('.mp4') || f.endsWith('.tmp'))
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
