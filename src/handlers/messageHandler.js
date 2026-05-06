const logger = require('../utils/logger');
const notificationService = require('../services/notificationService');
const config = require('../config');
const linkService = require('../services/link');
const commandManager = require('../commands');
const { agentIngress } = require('../agent');
const imageGenerator = require('../services/imageGenerator'); // Used in handleGroupIncrease
const requestApprovalService = require('../services/requestApprovalService');

// 表情 ID 常量（NapCat set_msg_emoji_like）
// NapCat 规则：emoji_id.length > 3 自动使用 emoji_type=2（Unicode 表情），否则为 QQ 系统表情
// Unicode 表情传十进制码点字符串即可
const LINK_EMOJI = {
    THINKING: '128074',  // 👊 拳头 —— 链接处理开始
    OK:       '128076',  // 👌 好的 —— 全部链接处理成功
    CRYING:   '10060',   // ❌ 错误 —— 至少一个链接处理失败
    SHUSH:    '128164',  // 💤 睡觉 —— 全部链接在冷却期，跳过
}

function parsePositiveInteger(value, fallback) {
    const parsed = parseInt(value, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const MESSAGE_DEDUP_TTL_MS = parsePositiveInteger(
    process.env.MESSAGE_DEDUP_TTL_MS || process.env.AI_MESSAGE_DEDUP_TTL_MS,
    120000
)
const MESSAGE_DEDUP_MAX_SIZE = parsePositiveInteger(
    process.env.MESSAGE_DEDUP_MAX_ENTRIES || process.env.AI_MESSAGE_DEDUP_MAX_ENTRIES,
    50000
)
const processedMessageIds = new Map()

function markMessageIfNew(dedupKey, now = Date.now()) {
    for (const [key, timestamp] of processedMessageIds) {
        if (now - timestamp <= MESSAGE_DEDUP_TTL_MS) break
        processedMessageIds.delete(key)
    }

    if (processedMessageIds.has(dedupKey)) {
        return false
    }

    processedMessageIds.set(dedupKey, now)
    if (processedMessageIds.size > MESSAGE_DEDUP_MAX_SIZE) {
        const oldestKey = processedMessageIds.keys().next().value
        if (oldestKey !== undefined) {
            processedMessageIds.delete(oldestKey)
        }
    }
    return true
}

class MessageHandler {
    /**
     * Send a private message to a user
     * @param {WebSocket} ws - WebSocket connection
     * @param {string} userId - User ID
     * @param {string} message - Message text
     */
    sendPrivateMessage(ws, userId, message) {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            logger.logEvent('warn', 'BOT', '', 'send-private-skipped', {
                userId,
                reason: 'ws_not_open'
            });
            return;
        }

        ws.send(JSON.stringify({
            action: 'send_private_msg',
            params: {
                user_id: userId,
                message: [{ type: 'text', data: { text: message } }]
            }
        }));
    }

    sendEmojiReaction(ws, messageId, emojiId, set = true) {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            logger.logEvent('warn', 'BOT', '', 'emoji-reaction-skipped', {
                messageId,
                emojiId,
                reason: 'ws_not_open'
            })
            return
        }
        if (!messageId) {
            logger.logEvent('debug', 'BOT', '', 'emoji-reaction-skipped', {
                emojiId,
                reason: 'missing_message_id'
            })
            return
        }
        try {
            ws.send(JSON.stringify({
                action: 'set_msg_emoji_like',
                params: {
                    message_id: messageId,
                    emoji_id: String(emojiId),
                    set: set
                }
            }))
        } catch (e) {
            logger.logEvent('warn', 'BOT', '', 'emoji-reaction-failed', {
                messageId,
                emojiId,
                error: logger.getErrorMessage(e)
            })
        }
    }

    async handleMessage(ws, messageData) {
        const message = messageData.message;
        const messageSegments = Array.isArray(message) ? message : [];
        let rawMessage = messageData.raw_message;
        const userId = messageData.user_id ? String(messageData.user_id) : null;
        let groupId = messageData.group_id ? String(messageData.group_id) : null;
        const messageId = messageData.message_id != null ? String(messageData.message_id) : '';

        // Prevent self-trigger
        if (userId === String(messageData.self_id)) {
            return;
        }

        // Private chat permission check
        if (messageData.message_type === 'private') {
            const isRootAdmin = config.isRootAdmin(userId);

            if (!isRootAdmin) {
                // Non-root admin: reject with message
                this.sendPrivateMessage(ws, userId, '此功能仅限管理员使用');
                logger.logEvent('info', 'BOT', logger.createMessageScope(`private_${userId || 'unknown'}`, userId || 'unknown', messageId || Date.now()), 'private-rejected', {
                    userId,
                    reason: 'non_root_admin'
                });
                return;
            }

            // Root admin: allow and use virtual groupId
            groupId = `private_${userId}`;
            logger.logEvent('info', 'BOT', logger.createMessageScope(groupId, userId || 'unknown', messageId || Date.now()), 'private-routed', {
                userId,
                virtualGroupId: groupId
            });

            // 审批拦截：Root Admin 私聊回复“是/否”优先处理好友/群申请
            const consumedByApproval = await requestApprovalService.tryHandleAdminDecision(ws, messageData);
            if (consumedByApproval) {
                return;
            }
        }

        const traceContext = {
            scope: messageData.traceContext?.scope || logger.createMessageScope(groupId || 'unknown', userId || 'unknown', messageId || Date.now()),
            receivedLogged: Boolean(messageData.traceContext?.receivedLogged)
        };

        if (messageId) {
            const scopeId = groupId || `private_${userId || 'unknown'}`
            const dedupKey = `${scopeId}:${userId || 'unknown'}:${messageId}`
            if (!markMessageIfNew(dedupKey)) {
                logger.logEvent('info', 'BOT', traceContext.scope, 'duplicate-ignored', {
                    dedupKey
                })
                return
            }
        }

        if (!traceContext.receivedLogged) {
            logger.logEvent('info', 'BOT', traceContext.scope, 'recv', {
                groupId,
                userId,
                messageType: messageData.message_type,
                preview: rawMessage.substring(0, 100)
            });
        }

        // Auto-create group configuration if not exists (skip for private messages)
        const isPrivateMsg = typeof groupId === 'string' && groupId.startsWith('private_');
        if (groupId && !isPrivateMsg) {
            config.ensureGroupConfig(groupId);
        }

        // 检查用户是否在黑名单中 (Global + Group Isolation)
        // 1. Check Global Blacklist (System Ban)
        const userIdStr = String(userId);
        const globalBlacklist = Array.isArray(config.blacklistedQQs) ? config.blacklistedQQs : [];
        if (globalBlacklist.some(qq => String(qq) === userIdStr)) {
            logger.logEvent('info', 'BOT', traceContext.scope, 'ignored', {
                userId,
                reason: 'global_blacklist'
            });
            return;
        }
        // 2. Check Group Blacklist (Group Ban)
        if (groupId) {
             const groupConfig = config.groupConfigs[groupId];
             const groupBlacklist = Array.isArray(groupConfig?.blacklistedQQs) ? groupConfig.blacklistedQQs : [];
             if (groupBlacklist.some(qq => String(qq) === userIdStr)) {
                 logger.logEvent('info', 'BOT', traceContext.scope, 'ignored', {
                    groupId,
                    userId,
                    reason: 'group_blacklist'
                 });
                 return;
             }
        }

        // 检查群组是否启用
        // Skip check for private messages (virtual groups)
        const isPrivate = typeof groupId === 'string' && groupId.startsWith('private_');
        if (groupId && !isPrivate && !config.isGroupEnabled(groupId)) {
            // 特例：允许管理员重新开启功能
            const isEnableCmd = rawMessage.trim().replace(/\s+/g, ' ').startsWith('/设置 功能 开');
            
            if (isEnableCmd && (config.isGroupAdmin(groupId, userId) || config.isRootAdmin(userId))) {
                logger.logEvent('info', 'BOT', traceContext.scope, 'enable-request', {
                    groupId,
                    userId
                });
                // Continue to process the message
            } else {
                logger.logEvent('info', 'BOT', traceContext.scope, 'ignored', {
                    groupId,
                    userId,
                    reason: 'group_disabled'
                });
                return;
            }
        }

        const preparedLinks = await linkService.prepareIncomingMessageLinks({
            rawMessage,
            messageSegments,
            groupId,
            traceContext
        })
        rawMessage = preparedLinks.rawMessage

        // ========== Command Dispatch ==========
        const commandContext = {
            ws,
            groupId,
            userId,
            rawMessage,
            messageData,
            traceContext
        };

        if (await commandManager.dispatch(commandContext)) {
            return;
        }

        // ========== Link Processing ==========
        if (preparedLinks.descriptors.length > 0) {
            const allDescriptorsCached = preparedLinks.descriptors.every((descriptor) => linkService.isCached(descriptor.cacheKey))
            if (allDescriptorsCached) {
                this.sendEmojiReaction(ws, messageId, LINK_EMOJI.SHUSH)
                return
            }

            this.sendEmojiReaction(ws, messageId, LINK_EMOJI.THINKING)

            const linkResult = await linkService.handleIncomingMessageLinks({
                ws,
                groupId,
                userId,
                descriptors: preparedLinks.descriptors,
                traceContext,
                messageId
            })

            this.sendEmojiReaction(ws, messageId, LINK_EMOJI.THINKING, false)

            if (linkResult.failureCount > 0) {
                this.sendEmojiReaction(ws, messageId, LINK_EMOJI.CRYING)
            } else {
                this.sendEmojiReaction(ws, messageId, LINK_EMOJI.OK)
            }

            return
        }

        try {
            await agentIngress.observe({
                ws,
                groupId,
                userId,
                rawMessage,
                messageData,
                traceContext
            })
        } catch (error) {
            logger.logEvent('warn', 'AGENT', traceContext.scope, 'observe-failed', {
                groupId,
                userId,
                error: logger.getErrorMessage(error)
            })
        }
    }

    // 将base64图片保存为临时文件并返回文件路径
    saveImageAsFile(base64Data) {
        return notificationService.saveImageAsFile(base64Data, 'MessageHandler');
    }

    // 清理文本,移除可能导致编码问题的字符
    cleanText(text) {
        return notificationService.cleanText(text);
    }

    sendGroupMessage(ws, groupId, messageChain, userId = null) {
        if (typeof groupId === 'string' && groupId.startsWith('private_')) {
            const realUserId = groupId.replace('private_', '');
            notificationService.sendPrivateMessage(ws, realUserId, messageChain, 'MessageHandler', true);
            return;
        }

        if (groupId) {
            notificationService.sendGroupMessage(ws, groupId, messageChain, 'MessageHandler', true);
        } else if (userId) {
            notificationService.sendPrivateMessage(ws, userId, messageChain, 'MessageHandler', true);
        } else {
            logger.logEvent('warn', 'BOT', '', 'send-message-skipped', {
                reason: 'missing_target'
            });
        }
    }

    async sendGroupMessageWithResponse(ws, groupId, messageChain, userId = null) {
        const safeMessageChain = notificationService.processMessageChain(messageChain, 'MessageHandler');

        if (typeof groupId === 'string' && groupId.startsWith('private_')) {
            const realUserId = groupId.replace('private_', '');
            if (!realUserId) {
                return null;
            }
            return notificationService.callAction(ws, 'send_private_msg', {
                user_id: realUserId,
                message: safeMessageChain
            }, 'MessageHandler', 10000);
        }

        if (groupId) {
            return notificationService.callAction(ws, 'send_group_msg', {
                group_id: groupId,
                message: safeMessageChain
            }, 'MessageHandler', 10000);
        }

        if (userId) {
            return notificationService.callAction(ws, 'send_private_msg', {
                user_id: userId,
                message: safeMessageChain
            }, 'MessageHandler', 10000);
        }

        return null;
    }

    async handleGroupIncrease(ws, payload) {
        const { group_id, user_id, self_id } = payload;
        
        // Only respond if the bot itself joined
        if (user_id === self_id) {
            logger.logEvent('info', 'BOT', logger.createScope('svc', 'lifecycle'), 'group-greeting-start', {
                groupId: group_id
            });
            
            // 1. Send text greeting
            const greeting = "大家好！我是 Bilibili 助手 Bot。发送 B 站链接即可自动解析预览，发送 /菜单 查看更多功能。";
            this.sendGroupMessage(ws, group_id, [{ type: 'text', data: { text: greeting } }]);
            
            // 2. Send help menu
            try {
                const base64Image = await imageGenerator.generateHelpCard('user', group_id);
                this.sendGroupMessage(ws, group_id, [
                    { type: 'image', data: { file: `base64://${base64Image}` } }
                ]);
            } catch (e) {
                logger.logEvent('error', 'BOT', logger.createScope('svc', 'lifecycle'), 'group-greeting-card-failed', {
                    groupId: group_id,
                    error: logger.getErrorMessage(e)
                });
            }
        }
    }
}

module.exports = new MessageHandler();
module.exports._markMessageIfNew = markMessageIfNew
module.exports._processedMessageIds = processedMessageIds
