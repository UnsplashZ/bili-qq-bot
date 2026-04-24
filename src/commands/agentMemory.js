const config = require('../config')
const longTermStore = require('../agent/memory/longTermStore')
const notificationService = require('../services/notificationService')
const logger = require('../utils/logger')

function commandLog(level, message, fields = {}) {
    logger.logEvent(level, 'BOT', 'cmd:agent-memory', message, fields)
}

function formatMemory(memory) {
    const sourceIds = Array.isArray(memory.sourceMessageIds) && memory.sourceMessageIds.length > 0
        ? memory.sourceMessageIds.slice(0, 3).join(',')
        : '-'
    return [
        `ID: ${memory.id}`,
        `类型: ${memory.scope}/${memory.type}`,
        `置信度: ${memory.confidence}`,
        `来源: ${sourceIds}`,
        `内容: ${memory.content}`
    ].join('\n')
}

class AgentMemoryCommand {
    async handle(context) {
        const { ws, groupId, userId, rawMessage } = context
        const trimmedMessage = String(rawMessage || '').trim()

        if (trimmedMessage !== '/记忆' && !trimmedMessage.startsWith('/记忆 ')) {
            return false
        }

        if (!config.isRootAdmin(userId)) {
            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足：Agent 记忆管理仅限全局管理员 (Root) 使用。' } }])
            return true
        }

        const parts = trimmedMessage.split(/\s+/)
        const subCommand = parts[1] || '帮助'

        if (subCommand === '帮助' || subCommand === 'help') {
            this.sendGroupMessage(ws, groupId, [{
                type: 'text',
                data: { text: 'Agent 记忆命令：\n/记忆 列表 [群号]\n/记忆 删除 <记忆ID>\n/记忆 清理 [群号]' }
            }])
            return true
        }

        if (subCommand === '列表' || subCommand === 'list') {
            const targetGroupId = parts[2] || (String(groupId || '').startsWith('private_') ? '' : String(groupId || ''))
            const memories = await longTermStore.listMemories({ groupId: targetGroupId, limit: 10 })
            const title = targetGroupId ? `【Agent长期记忆｜群 ${targetGroupId}】` : '【Agent长期记忆】'
            const body = memories.length > 0 ? memories.map(formatMemory).join('\n\n') : '暂无记忆。'
            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `${title}\n${body}` } }])
            return true
        }

        if (subCommand === '删除' || subCommand === 'delete') {
            const memoryId = parts[2]
            if (!memoryId) {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '请指定记忆ID：/记忆 删除 <记忆ID>' } }])
                return true
            }
            const deleted = await longTermStore.deleteMemory(memoryId)
            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: deleted ? `已删除记忆：${memoryId}` : `未找到记忆：${memoryId}` } }])
            return true
        }

        if (subCommand === '清理' || subCommand === 'clear') {
            const targetGroupId = parts[2] || (String(groupId || '').startsWith('private_') ? '' : String(groupId || ''))
            if (!targetGroupId) {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '请指定群号：/记忆 清理 <群号>' } }])
                return true
            }
            const removed = await longTermStore.clearMemories({ groupId: targetGroupId })
            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `已清理群 ${targetGroupId} 的 Agent 记忆：${removed} 条。` } }])
            return true
        }

        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '未知指令。发送 /记忆 帮助 查看用法。' } }])
        return true
    }

    sendGroupMessage(ws, groupId, messageChain, userId = null) {
        if (typeof groupId === 'string' && groupId.startsWith('private_')) {
            const realUserId = groupId.replace('private_', '')
            notificationService.sendPrivateMessage(ws, realUserId, messageChain, 'AgentMemoryCommand', true)
            return
        }

        if (groupId) {
            notificationService.sendGroupMessage(ws, groupId, messageChain, 'AgentMemoryCommand', true)
        } else if (userId) {
            notificationService.sendPrivateMessage(ws, userId, messageChain, 'AgentMemoryCommand', true)
        } else {
            commandLog('warn', 'send-skipped', {
                reason: 'missing_target'
            })
        }
    }
}

module.exports = new AgentMemoryCommand()
