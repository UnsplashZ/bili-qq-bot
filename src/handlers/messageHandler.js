const aiHandler = require('./aiHandler');
const vectorMemoryService = require('../services/vectorMemoryService');
const userProfileService = require('../services/userProfileService');
const aiContextService = require('../services/aiContextService');
const logger = require('../utils/logger');
const notificationService = require('../services/notificationService');
const config = require('../config');
const linkHandler = require('./linkHandler');
const commandManager = require('../commands');
const imageGenerator = require('../services/imageGenerator'); // Used in handleGroupIncrease
const requestApprovalService = require('../services/requestApprovalService');
const aiIdempotency = require('../services/ai/idempotency');
const { replyGateService } = require('../services/ai/replyGateService');
const { selectContext } = require('../services/ai/contextSelectorService');
const { classifyResponseMode } = require('../services/ai/responseModeService');

// 表情 ID 常量（NapCat set_msg_emoji_like）
// NapCat 规则：emoji_id.length > 3 自动使用 emoji_type=2（Unicode 表情），否则为 QQ 系统表情
// Unicode 表情传十进制码点字符串即可
const LINK_EMOJI = {
    THINKING: '128074',  // 👊 拳头 —— 链接处理开始
    OK:       '128076',  // 👌 好的 —— 全部链接处理成功
    CRYING:   '10060',   // ❌ 错误 —— 至少一个链接处理失败
    SHUSH:    '128164',  // 💤 睡觉 —— 全部链接在冷却期，跳过
}

class MessageHandler {
    // 入库前统一清洗：保留 @QQ 可追踪信息，移除其他 CQ 码
    normalizeMessageForStorage(rawMessage) {
        if (!rawMessage || typeof rawMessage !== 'string') return '';
        return rawMessage
            .replace(/\[CQ:at,qq=(\d+)\]/g, '<AT:$1>')
            .replace(/\[CQ:at,qq=all\]/g, '<AT:all>')
            .replace(/\[CQ:[^\]]+\]/g, '')
            .trim();
    }

    extractMessageMeta(messageData, groupId, userId, userName) {
        const segments = Array.isArray(messageData?.message) ? messageData.message : [];
        const mentionIds = [];
        let replyToMessageId = null;
        let replyToSpeakerId = null;

        for (const seg of segments) {
            if (seg?.type === 'at' && seg.data?.qq != null) {
                mentionIds.push(String(seg.data.qq));
            }
            if (!replyToMessageId && seg?.type === 'reply' && seg.data?.id != null) {
                replyToMessageId = String(seg.data.id);
                const replySpeaker = seg.data.qq ?? seg.data.user_id ?? seg.data.sender_id ?? seg.data.uid;
                if (replySpeaker != null) {
                    replyToSpeakerId = String(replySpeaker);
                }
            }
        }

        const uniqueMentions = [...new Set(mentionIds)];
        const selfId = messageData?.self_id != null ? String(messageData.self_id) : null;
        const currentMentionsBot = !!(selfId && uniqueMentions.includes(selfId));
        const rawMessage = typeof messageData?.raw_message === 'string' ? messageData.raw_message : '';
        const botNames = [];
        const configuredBotName = String(config.getGroupConfig(groupId, 'aiBotName') || '').trim();
        if (configuredBotName) botNames.push(configuredBotName);
        const configuredBotAliases = config.getGroupConfig(groupId, 'aiBotAliases');
        if (Array.isArray(configuredBotAliases)) {
            for (const alias of configuredBotAliases) {
                if (typeof alias !== 'string') continue;
                const trimmed = alias.trim();
                if (trimmed) botNames.push(trimmed);
            }
        }

        const normalizedBotNames = [...new Set(botNames)];
        const botNameHit = normalizedBotNames.find(name => rawMessage.includes(name)) || null;

        return {
            speakerId: userId ? String(userId) : null,
            speakerName: userName || null,
            mentionIds: uniqueMentions,
            isAtBot: currentMentionsBot,
            currentMentionsBot,
            replyToMessageId,
            replyToSpeakerId,
            isReplyToBot: !!(selfId && replyToSpeakerId && replyToSpeakerId === selfId),
            botNameHit,
            source: (typeof groupId === 'string' && groupId.startsWith('private_')) ? 'private' : 'group'
        };
    }

    /**
     * Send a private message to a user
     * @param {WebSocket} ws - WebSocket connection
     * @param {string} userId - User ID
     * @param {string} message - Message text
     */
    sendPrivateMessage(ws, userId, message) {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            logger.warn(`[MessageHandler] Cannot send private message: WebSocket not open`);
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
            logger.warn('[MessageHandler] Cannot send emoji reaction: WebSocket not open')
            return
        }
        if (!messageId) {
            logger.debug(`[MessageHandler] Cannot send emoji reaction: no messageId (emojiId=${emojiId})`)
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
            logger.warn(`[MessageHandler] Failed to send emoji reaction: ${e.message}`)
        }
    }

    async handleMessage(ws, messageData) {
        const message = messageData.message;
        const messageSegments = Array.isArray(message) ? message : [];
        let rawMessage = messageData.raw_message;
        const userId = messageData.user_id ? String(messageData.user_id) : null;
        let groupId = messageData.group_id ? String(messageData.group_id) : null;

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
                logger.info(`[MessageHandler] Rejected private message from non-admin user ${userId}`);
                return;
            }

            // Root admin: allow and use virtual groupId
            groupId = `private_${userId}`;
            logger.info(`[MessageHandler] Processing private message from Root Admin ${userId} as virtual group ${groupId}`);

            // 审批拦截：Root Admin 私聊回复“是/否”优先处理好友/群申请
            const consumedByApproval = await requestApprovalService.tryHandleAdminDecision(ws, messageData);
            if (consumedByApproval) {
                return;
            }
        }

        const messageId = messageData.message_id != null ? String(messageData.message_id) : '';
        const traceId = `${groupId || 'unknown'}:${userId || 'unknown'}:${messageId || Date.now()}`;
        if (messageId) {
            const scopeId = groupId || `private_${userId || 'unknown'}`;
            const dedupKey = `${scopeId}:${userId || 'unknown'}:${messageId}`;
            if (!aiIdempotency.markIfNew(dedupKey)) {
                logger.info(`[MessageHandler] Duplicate message ignored: ${dedupKey}, trace=${traceId}`);
                return;
            }
        }

        logger.info(`[MessageHandler] Received message from User ${userId} in Group ${groupId}, trace=${traceId}: ${rawMessage.substring(0, 100)}...`);

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
            logger.info(`[MessageHandler] User ${userId} is globally blacklisted, ignoring message`);
            return;
        }
        // 2. Check Group Blacklist (Group Ban)
        if (groupId) {
             const groupConfig = config.groupConfigs[groupId];
             const groupBlacklist = Array.isArray(groupConfig?.blacklistedQQs) ? groupConfig.blacklistedQQs : [];
             if (groupBlacklist.some(qq => String(qq) === userIdStr)) {
                 logger.info(`[MessageHandler] User ${userId} is blacklisted in group ${groupId}, ignoring message`);
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
                logger.info(`[MessageHandler] Admin ${userId} attempting to re-enable group ${groupId}`);
                // Continue to process the message
            } else {
                logger.info(`[MessageHandler] Group ${groupId} is not enabled, ignoring message from ${userId}`);
                return;
            }
        }

        // Record message for AI context
        const sender = messageData.sender || {};
        const userName = sender.card || sender.nickname || `用户${userId}`;
        const messageMeta = this.extractMessageMeta(messageData, groupId, userId, userName);
        if (rawMessage && !rawMessage.trim().startsWith('/')) {
            // 与向量记忆保持一致：存储前保留 @QQ 信息并清洗其他 CQ 码
            const cleanForContext = this.normalizeMessageForStorage(rawMessage);
            if (cleanForContext) {
                aiHandler.addMessageToContext(groupId || userId, 'user', cleanForContext, userId, userName, messageMeta);
            }
        }

        // Check for JSON message (Mini Program) and extract URL (before cache check)
        const jsonMsg = messageSegments.find(m => m.type === 'json');
        if (jsonMsg) {
            try {
                logger.info(`[MessageHandler] Found JSON message, attempting to extract URL...`);
                const jsonData = JSON.parse(jsonMsg.data.data);
                logger.info(`[MessageHandler] JSON data keys: ${Object.keys(jsonData).join(', ')}`);

                // Common paths for URL in Bilibili Mini Program
                // Including paths for standard app, HD app, and other variations
                const url = jsonData.meta?.detail_1?.qqdocurl
                    || jsonData.meta?.detail_1?.url
                    || jsonData.meta?.news?.jumpUrl
                    || jsonData.meta?.detail?.qqdocurl
                    || jsonData.meta?.detail?.url
                    || jsonData.prompt
                    || jsonData.meta?.detail_1?.preview
                    || jsonData.url;

                if (url) {
                    logger.info(`[MessageHandler] Extracted URL from JSON: ${url}`);
                    rawMessage += " " + url; // Append to rawMessage for regex matching
                } else {
                    // Log the full JSON structure to help debug HD app format
                    logger.info(`[MessageHandler] Could not extract URL. JSON structure: ${JSON.stringify(jsonData, null, 2).substring(0, 500)}`);
                }
            } catch (e) {
                logger.warn('[MessageHandler] Failed to parse JSON message:', e);
                // Safely log raw data with error handling
                try {
                    if (jsonMsg && jsonMsg.data && jsonMsg.data.data) {
                        logger.warn('[MessageHandler] JSON raw data:', jsonMsg.data.data.substring(0, 500));
                    }
                } catch (logErr) {
                    logger.warn('[MessageHandler] Could not log JSON raw data:', logErr.message);
                }
            }
        }

        // Expand short links if present (before cache check)
        // Access shortLinkRegex from LinkHandler
        if (linkHandler.shortLinkRegex && linkHandler.shortLinkRegex.test(rawMessage)) {
            const match = rawMessage.match(linkHandler.shortLinkRegex);
            if (match) {
                const shortUrl = match[0];
                logger.info(`[MessageHandler] Found short link: ${shortUrl}, expanding...`);
                try {
                    const expanded = await linkHandler.expandUrl(shortUrl);
                    logger.info(`[MessageHandler] Expanded ${shortUrl} to ${expanded}`);
                    rawMessage += " " + expanded;
                    logger.info(`[MessageHandler] Updated rawMessage with expanded URL`);
                } catch (e) {
                    logger.error(`[MessageHandler] Failed to expand short link ${shortUrl}:`, e);
                }
            }
        }

        // 3. Vector Memory Storage (Store all non-command user messages)
        // Store after URL expansion to include full links
        if (groupId && rawMessage && !rawMessage.trim().startsWith('/')) {
             const cleanMsg = this.normalizeMessageForStorage(rawMessage);
             if (cleanMsg) {
                 vectorMemoryService.addMemory(groupId, cleanMsg, 'user', userId, userName).catch(e => {
                     logger.error('[MessageHandler] Failed to save vector memory:', e);
                 });
                 // Record message for user profile metadata (no LLM call, always fast)
                 userProfileService.recordMessage(groupId, userId, userName).catch(e => {
                     logger.error('[MessageHandler] Failed to record message for user profile:', e);
                 });
             }
        }

        // ========== Command Dispatch ==========
        const commandContext = {
            ws,
            groupId,
            userId,
            rawMessage,
            messageData
        };

        if (await commandManager.dispatch(commandContext)) {
            return;
        }

        // ========== Link Processing ==========
        const safeRawMessage = rawMessage.replace(/\[CQ:[^\]]+\]/g, '');
        const links = linkHandler.extractLinks(safeRawMessage, groupId);

        if (links.length > 0) {
            const messageId = messageData.message_id;
            const seenKeys = new Set();
            const uncachedLinks = links.filter(l => {
                if (linkHandler.isLinkCached(l.cacheKey) || seenKeys.has(l.cacheKey)) return false;
                seenKeys.add(l.cacheKey);
                return true;
            });

            if (uncachedLinks.length === 0) {
                // 全部链接在冷却期内
                this.sendEmojiReaction(ws, messageId, LINK_EMOJI.SHUSH);
                return;
            }

            // 有未缓存链接，开始处理
            this.sendEmojiReaction(ws, messageId, LINK_EMOJI.THINKING);

            let hasErrors = false;

            for (let i = 0; i < uncachedLinks.length; i++) {
                const link = uncachedLinks[i];
                let processSuccess = false;

                try {
                    await linkHandler.processSingleLink(link, ws, groupId, userId);
                    processSuccess = true;
                    logger.debug(`[MessageHandler] Successfully processed link: ${link.match}`);
                } catch (error) {
                    logger.error(`[MessageHandler] Failed to process link ${link.match}:`, {
                        error: error.message,
                        stack: error.stack,
                        groupId,
                        userId,
                        linkType: link.type,
                        linkId: link.id
                    });
                    hasErrors = true;

                    // 不添加到缓存，允许用户重试
                    // 向用户发送错误提示
                    try {
                        await linkHandler.sendGroupMessage(ws, groupId, [
                            {
                                type: 'text',
                                data: {
                                    text: `处理链接失败: ${error.message || '未知错误'}\n您可以稍后重新发送链接重试`
                                }
                            }
                        ], userId);
                    } catch (sendError) {
                        logger.error('[MessageHandler] Failed to send error message:', sendError);
                    }
                }

                // 只在成功处理后添加到缓存
                if (processSuccess) {
                    linkHandler.addLinkToCache(link.cacheKey);
                    logger.debug(`[MessageHandler] Added link to cache: ${link.cacheKey}`);
                }

                // 处理完成后延迟，避免并发冲突
                if (i < uncachedLinks.length - 1) {
                    logger.debug(`[MessageHandler] Waiting 1000ms before processing next link to avoid conflicts...`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            // 撤销思考表情，发送结果表情。
            // 注：hasErrors 为 true 表示"至少一个链接失败"，并非全部失败。
            // 失败链接的具体 URL 已在上方错误提示文字中说明。
            this.sendEmojiReaction(ws, messageId, LINK_EMOJI.THINKING, false);
            if (hasErrors) {
                this.sendEmojiReaction(ws, messageId, LINK_EMOJI.CRYING);
            } else {
                this.sendEmojiReaction(ws, messageId, LINK_EMOJI.OK);
            }

            return;
        }

        // Check for AI Reply
        const isAt = messageMeta.isAtBot;

        let shouldReply = false
        let aiPipelineInput = null

        if (config.getGroupConfig(groupId, 'aiReplyGateEnabled') !== false) {
            const gateDecision = replyGateService.evaluate({
                groupId,
                userId,
                rawMessage,
                messageMeta
            })
            logger.info(`[MessageHandler] AI gate decision trace=${traceId}`, {
                shouldReply: gateDecision.shouldReply,
                score: gateDecision.score,
                busyMode: gateDecision.busyMode,
                triggerLevel: gateDecision.triggerLevel,
                reasons: gateDecision.reasons
            })
            shouldReply = gateDecision.shouldReply

            if (shouldReply) {
                const contextKey = groupId || userId
                const fullContext = aiContextService.getContext(contextKey)
                const currentTurn = fullContext[fullContext.length - 1] || null
                const selectedContext = config.getGroupConfig(groupId, 'aiContextSelectorEnabled') !== false
                    ? selectContext({
                        context: fullContext.slice(0, -1),
                        currentTurn,
                        messageMeta
                    })
                    : { currentTurn, threadMessages: [], backgroundSummary: '', stats: {} }
                logger.info(`[MessageHandler] AI context selected trace=${traceId}`, {
                    selectedCount: selectedContext.threadMessages.length,
                    hasSummary: !!selectedContext.backgroundSummary,
                    stats: selectedContext.stats
                })
                const responseMode = config.getGroupConfig(groupId, 'aiResponseModeEnabled') !== false
                    ? classifyResponseMode({
                        rawMessage,
                        messageMeta,
                        triggerLevel: gateDecision.triggerLevel
                    })
                    : { mode: 'answer_only', reasons: ['feature_disabled'] }
                logger.info(`[MessageHandler] AI response mode trace=${traceId}`, responseMode)

                aiPipelineInput = {
                    gateDecision,
                    selectedContext,
                    responseMode
                }
            }
        } else {
            shouldReply = aiHandler.shouldReply(rawMessage, isAt, groupId)
        }

        if (shouldReply) {
            const reply = await aiHandler.getReply(rawMessage, userId, groupId, traceId, aiPipelineInput);
            if (reply) {
                this.sendGroupMessage(ws, groupId, [
                    { type: 'text', data: { text: reply } }
                ]);
                if (config.getGroupConfig(groupId, 'aiReplyGateEnabled') !== false) {
                    replyGateService.recordBotReply(groupId, userId)
                }
                // Async profile update check (fire-and-forget, only triggers if conditions met)
                userProfileService.maybeUpdateProfile(groupId, userId, userName, aiContextService, vectorMemoryService).catch(e => {
                    logger.error('[MessageHandler] Failed to maybe update user profile:', e);
                });
            }
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
            logger.warn('[MessageHandler] Cannot send message: no groupId or userId provided');
        }
    }

    async handleGroupIncrease(ws, payload) {
        const { group_id, user_id, self_id } = payload;
        
        // Only respond if the bot itself joined
        if (user_id === self_id) {
            logger.info(`[MessageHandler] Bot joined new group ${group_id}, sending greeting...`);
            
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
                logger.error(`[MessageHandler] Failed to generate help card for greeting in group ${group_id}:`, e);
            }
        }
    }
}

module.exports = new MessageHandler();
