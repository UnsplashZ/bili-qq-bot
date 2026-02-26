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
            const maxAgeMs = config.videoDownloadCleanTimeout * 60 * 60 * 1000
            const now = Date.now()
            const files = fs.readdirSync(DOWNLOADS_DIR)
            for (const file of files) {
                if (!file.endsWith('.mp4')) continue
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
     * 主入口：检查配置 → 下载 → 发送
     * @param {WebSocket} ws
     * @param {string} groupId
     * @param {string} bvid
     * @param {object} videoInfo - 已有的视频信息（来自 getVideoInfo，含 data.duration 等）
     * @param {number} pageIndex - 分P索引（0-based），默认 0
     */
    async downloadAndSend(ws, groupId, bvid, videoInfo, pageIndex = 0) {
        if (!isVideoDownloadEnabledForGroup(groupId)) return

        // 并发限制
        if (this._activeDownloads >= MAX_CONCURRENT_DOWNLOADS) {
            logger.warn(`[VideoDownload] Max concurrent downloads (${MAX_CONCURRENT_DOWNLOADS}) reached, skipping ${bvid}`)
            return
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
            return
        }

        // 磁盘空间预检（目录超过 5GB 时跳过）
        if (!this._hasDiskSpace()) {
            logger.warn(`[VideoDownload] Insufficient disk space, skipping download of ${bvid}`)
            return
        }

        const resolution = getVideoDownloadResolutionForGroup(groupId)

        logger.info(`[VideoDownload] Starting download: ${bvid} P${pageIndex + 1} @ ${resolution} for group ${groupId}`)

        this._activeDownloads++
        let result
        try {
            result = await biliApi.downloadVideo(bvid, pageIndex, resolution, DOWNLOADS_DIR, groupId)
        } catch (e) {
            logger.error(`[VideoDownload] Download failed for ${bvid}:`, e)
            return
        } finally {
            this._activeDownloads--
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

        // 无论发送是否成功，autoClean 时都清理文件（避免文件积压）
        if (config.videoDownloadAutoClean && result.file_path) {
            this.cleanupFile(result.file_path)
        }

        // 多P提示（仅首P触发时发送）
        if (sent && result.total_pages > 1 && pageIndex === 0) {
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
        if (!ws || ws.readyState !== 1 /* WebSocket.OPEN */) {
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
                group_id: groupId,
                messages: nodes
            }
        }

        try {
            ws.send(JSON.stringify(payload))
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
                if (!f.endsWith('.mp4')) continue  // 只统计 .mp4，忽略下载中的 .tmp 文件
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
     * 清空下载目录（供 /清理下载 命令使用）
     * @returns {number} 删除的文件数量
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
