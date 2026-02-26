const videoDownloadService = require('../services/videoDownloadService')
const biliApi = require('../services/biliApi')
const notificationService = require('../services/notificationService')
const { isVideoDownloadEnabledForGroup } = require('../config')
const logger = require('../utils/logger')

class DownloadCommand {
    async handle(context) {
        const { ws, groupId, userId, rawMessage, isAdmin, isRoot } = context
        const text = rawMessage.trim()

        // 快速前缀检查，避免对非下载命令执行正则
        if (!text.startsWith('/下载') && text !== '/清理下载') return false

        // /下载 P{n}
        const partMatch = text.match(/^\/下载\s+[Pp](\d+)$/)
        if (partMatch) {
            if (!isVideoDownloadEnabledForGroup(groupId)) {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '当前群未开启视频下载功能' } }])
                return true
            }
            const pageIndex = parseInt(partMatch[1], 10) - 1
            if (pageIndex < 0) {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '分P编号无效，请从 P1 开始' } }])
                return true
            }

            const lastInfo = videoDownloadService.getLastDownloadInfo(groupId)
            if (!lastInfo) {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '未找到最近的视频记录，请先发送视频链接' } }])
                return true
            }
            if (pageIndex >= lastInfo.totalPages) {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `该视频只有 ${lastInfo.totalPages}P，无法下载 P${pageIndex + 1}` } }])
                return true
            }

            const info = await biliApi.getVideoInfo(lastInfo.bvid, groupId)
            if (!info || info.status !== 'success') {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '获取视频信息失败，请稍后重试' } }])
                return true
            }
            videoDownloadService.downloadAndSend(ws, groupId, lastInfo.bvid, info, pageIndex).catch(e => {
                logger.error(`[DownloadCommand] downloadAndSend failed:`, e)
            })
            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `正在下载 P${pageIndex + 1}，请稍候...` } }])
            return true
        }

        // /下载状态
        if (text === '/下载状态') {
            if (!isAdmin && !isRoot) {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足' } }])
                return true
            }
            const stats = videoDownloadService.getDownloadStats()
            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `下载目录：${stats.count} 个文件，共 ${stats.totalSizeMB} MB` } }])
            return true
        }

        // /清理下载
        if (text === '/清理下载') {
            if (!isAdmin && !isRoot) {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足' } }])
                return true
            }
            const count = videoDownloadService.cleanAll()
            if (count === -1) {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '当前有下载任务进行中，请稍后再清理' } }])
            } else {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `已清理 ${count} 个视频文件` } }])
            }
            return true
        }

        return false
    }

    sendGroupMessage(ws, groupId, messageChain) {
        if (typeof groupId === 'string' && groupId.startsWith('private_')) {
            const realUserId = groupId.replace('private_', '')
            notificationService.sendPrivateMessage(ws, realUserId, messageChain, 'DownloadCommand', true)
            return
        }
        if (groupId) {
            notificationService.sendGroupMessage(ws, groupId, messageChain, 'DownloadCommand', true)
        } else {
            logger.warn('[DownloadCommand] Cannot send message: no groupId provided')
        }
    }
}

module.exports = new DownloadCommand()
