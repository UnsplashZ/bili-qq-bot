const aiHandler = require('../handlers/aiHandler');
const config = require('../config');
const logger = require('../utils/logger');
const notificationService = require('../services/notificationService');

class AiCommand {
    async handle(context) {
        const { ws, groupId, userId, rawMessage } = context;

        // ========== /AI 指令入口 (支持大小写) ==========
        const msgLower = rawMessage.trim().toLowerCase();
        if (rawMessage.startsWith('/AI ') || rawMessage.startsWith('/ai ') ||
            rawMessage.trim() === '/AI' || rawMessage.trim() === '/ai' ||
            rawMessage.trim() === '/AI帮助' || rawMessage.trim() === '/ai帮助') {
            const parts = rawMessage.trim().split(/\s+/);
            const subCommand = parts[1] || '帮助';

            // 1. AI帮助 (/AI 帮助 或 /AI帮助)
            if (subCommand === '帮助') {
                try {
                    const imageGenerator = require('../services/imageGenerator');
                    const base64Image = await imageGenerator.generateAIHelpCard(groupId);
                    this.sendGroupMessage(ws, groupId, [{ type: 'image', data: { file: `base64://${base64Image}` } }]);
                } catch (error) {
                    logger.error('[AiCommand] AI help card generation failed:', error);
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '帮助卡片生成失败，请稍后重试。' } }]);
                }
                return true;
            }

            // 2. AI上下文 (/AI 上下文 <条数>) - 群级配置
            if (subCommand === '上下文') {
                if (!config.isGroupAdmin(groupId, userId)) {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足：此命令需要群管理员或全局管理员权限。' } }]);
                    return true;
                }

                const value = parseInt(parts[2]);
                if (isNaN(value) || value < 1 || value > 50) {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '格式错误。用法: /AI 上下文 <1-50>\n示例: /AI 上下文 15' } }]);
                    return true;
                }

                config.setGroupConfig(groupId, 'aiContextLimit', value);
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `已设置本群AI上下文限制为: ${value} 条消息` } }]);
                return true;
            }

            // 3. AI概率 (/AI 概率 <0-1>) - 群级配置
            if (subCommand === '概率') {
                if (!config.isGroupAdmin(groupId, userId)) {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足：此命令需要群管理员或全局管理员权限。' } }]);
                    return true;
                }

                const value = parseFloat(parts[2]);
                if (isNaN(value) || value < 0 || value > 1) {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '格式错误。用法: /AI 概率 <0-1>\n示例: /AI 概率 0.3' } }]);
                    return true;
                }

                config.setGroupConfig(groupId, 'aiProbability', value);
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `已设置本群AI回复概率为: ${value} (${(value * 100).toFixed(0)}%)` } }]);
                return true;
            }

            // 4. AI向量阈值 (/AI 向量阈值 <0-1>) - 全局配置（Root）
            if (subCommand === '向量阈值') {
                if (!config.isRootAdmin(userId)) {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足：此命令仅限全局管理员 (Root) 使用。' } }]);
                    return true;
                }

                const value = parseFloat(parts[2]);
                if (isNaN(value) || value < 0 || value > 1) {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '格式错误。用法: /AI 向量阈值 <0-1>\n示例: /AI 向量阈值 0.5' } }]);
                    return true;
                }

                config.aiVectorSimilarityThreshold = value;
                config.save();
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `已设置向量相似度阈值为: ${value}（全局生效，阈值越高匹配越严格）` } }]);
                return true;
            }

            // 5. AI向量数量 (/AI 向量数量 <数量>) - 全局配置（Root）
            if (subCommand === '向量数量') {
                if (!config.isRootAdmin(userId)) {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足：此命令仅限全局管理员 (Root) 使用。' } }]);
                    return true;
                }

                const value = parseInt(parts[2]);
                if (isNaN(value) || value < 1 || value > 10) {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '格式错误。用法: /AI 向量数量 <1-10>\n示例: /AI 向量数量 5' } }]);
                    return true;
                }

                config.aiVectorSearchLimit = value;
                config.save();
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `已设置向量搜索返回数量为: ${value}（全局生效）` } }]);
                return true;
            }

            // 6. AI短消息过滤 (/AI 短消息过滤 <字符数>) - 全局配置（Root）
            if (subCommand === '短消息过滤') {
                if (!config.isRootAdmin(userId)) {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足：此命令仅限全局管理员 (Root) 使用。' } }]);
                    return true;
                }

                const value = parseInt(parts[2]);
                if (isNaN(value) || value < 1 || value > 50) {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '格式错误。用法: /AI 短消息过滤 <1-50>\n示例: /AI 短消息过滤 10' } }]);
                    return true;
                }

                config.aiShortMessageThreshold = value;
                config.save();
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `已设置短消息过滤阈值为: ${value} 字符（全局生效）` } }]);
                return true;
            }

            // 7. AI缓存 (/AI 缓存 <开|关>) - 全局配置（Root）
            if (subCommand === '缓存') {
                if (!config.isRootAdmin(userId)) {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足：此命令仅限全局管理员 (Root) 使用。' } }]);
                    return true;
                }

                const action = parts[2];
                if (action === '开') {
                    config.aiEnableVectorCache = true;
                    config.save();
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '已启用向量搜索缓存（全局生效，提升搜索性能）' } }]);
                } else if (action === '关') {
                    config.aiEnableVectorCache = false;
                    config.save();
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '已关闭向量搜索缓存（全局生效，降级到原始搜索）' } }]);
                } else {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '格式错误。用法: /AI 缓存 <开|关>' } }]);
                }
                return true;
            }

            // 8. AI智能保留 (/AI 智能保留 <开|关>) - 全局配置（Root）
            if (subCommand === '智能保留') {
                if (!config.isRootAdmin(userId)) {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足：此命令仅限全局管理员 (Root) 使用。' } }]);
                    return true;
                }

                const action = parts[2];
                if (action === '开') {
                    config.aiEnableSmartTrim = true;
                    config.save();
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '已启用智能记忆保留策略（全局生效，优先保留重要对话）' } }]);
                } else if (action === '关') {
                    config.aiEnableSmartTrim = false;
                    config.save();
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '已关闭智能记忆保留（全局生效，降级到FIFO删除）' } }]);
                } else {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '格式错误。用法: /AI 智能保留 <开|关>' } }]);
                }
                return true;
            }

            // 9. AI新对话 (/AI 新对话 [群号]) - 群级操作
            if (subCommand === '新对话') {
                const targetGid = parts[2] || groupId;

                // 权限检查：Root可以重置任何群，群管只能重置本群
                if (!config.isRootAdmin(userId)) {
                    if (targetGid !== groupId || !config.isGroupAdmin(groupId, userId)) {
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足：只能重置本群对话，或需要全局管理员权限。' } }]);
                        return true;
                    }
                }

                aiHandler.resetContext(targetGid);
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `已重置群 ${targetGid} 的 AI 对话记忆。` } }]);
                return true;
            }

            // 未知子命令
            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '未知的AI命令。发送 /AI 帮助 查看可用指令。' } }]);
            return true;
        }

        return false;
    }

    sendGroupMessage(ws, groupId, messageChain, userId = null) {
        if (typeof groupId === 'string' && groupId.startsWith('private_')) {
            const realUserId = groupId.replace('private_', '');
            notificationService.sendPrivateMessage(ws, realUserId, messageChain, 'AiCommand', true);
            return;
        }

        if (groupId) {
            notificationService.sendGroupMessage(ws, groupId, messageChain, 'AiCommand', true);
        } else if (userId) {
            notificationService.sendPrivateMessage(ws, userId, messageChain, 'AiCommand', true);
        } else {
            logger.warn('[AiCommand] Cannot send message: no groupId or userId provided');
        }
    }
}

module.exports = new AiCommand();
