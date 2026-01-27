const aiHandler = require('./aiHandler');
const vectorMemoryService = require('../services/vectorMemoryService');
const logger = require('../utils/logger');
const notificationService = require('../services/notificationService');
const config = require('../config');
const linkHandler = require('./linkHandler');
const commandManager = require('../commands');
const imageGenerator = require('../services/imageGenerator'); // Used in handleGroupIncrease

class MessageHandler {
    
    async handleMessage(ws, messageData) {
        const message = messageData.message;
        let rawMessage = messageData.raw_message;
        const userId = messageData.user_id;
        let groupId = messageData.group_id;

        // Prevent self-trigger
        if (userId === messageData.self_id) {
            return;
        }

        // Handle Private Messages
        if (messageData.message_type === 'private') {
            // Only respond to Root Admin
            if (!config.isRootAdmin(userId)) {
                return;
            }
            // Assign virtual group ID for private messages to reuse existing logic
            groupId = `private_${userId}`;
            logger.info(`[MessageHandler] Processing private message from Root Admin ${userId} as virtual group ${groupId}`);
        }

        logger.info(`[MessageHandler] Received message from User ${userId} in Group ${groupId}: ${rawMessage.substring(0, 100)}...`);

        // Auto-create group configuration if not exists (skip for private messages)
        const isPrivateMsg = typeof groupId === 'string' && groupId.startsWith('private_');
        if (groupId && !isPrivateMsg) {
            config.ensureGroupConfig(groupId);
        }

        // 检查用户是否在黑名单中 (Global + Group Isolation)
        // 1. Check Global Blacklist (System Ban)
        if (config.blacklistedQQs.includes(userId.toString())) {
            logger.info(`[MessageHandler] User ${userId} is globally blacklisted, ignoring message`);
            return;
        }
        // 2. Check Group Blacklist (Group Ban)
        if (groupId) {
             const groupConfig = config.groupConfigs[groupId];
             if (groupConfig && groupConfig.blacklistedQQs && groupConfig.blacklistedQQs.includes(userId.toString())) {
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
        if (rawMessage) {
            const sender = messageData.sender || {};
            const userName = sender.card || sender.nickname || `用户${userId}`;
            aiHandler.addMessageToContext(groupId || userId, 'user', rawMessage, userId, userName);
        }

        // Check for JSON message (Mini Program) and extract URL (before cache check)
        const jsonMsg = message.find(m => m.type === 'json');
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
             const cleanMsg = rawMessage.replace(/\[CQ:[^\]]+\]/g, '').trim();
             if (cleanMsg) {
                 vectorMemoryService.addMemory(groupId, cleanMsg, 'user').catch(e => {
                     logger.error('[MessageHandler] Failed to save vector memory:', e);
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

        // Process each link that's not in cache
        let hasProcessedLinks = false;
        for (const link of links) {
            if (!linkHandler.isLinkCached(link.cacheKey)) {
                await linkHandler.processSingleLink(link, ws, groupId, userId);
                hasProcessedLinks = true;

                // 添加延迟避免并发问题（如果还有更多链接要处理）
                const linkIndex = links.indexOf(link);
                if (linkIndex < links.length - 1) {
                    logger.info(`[MessageHandler] Waiting 1000ms before processing next link to avoid conflicts...`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        }

        // If we processed any links, don't continue to AI handling
        if (hasProcessedLinks) {
            return;
        }

        // Check for AI Reply
        const isAt = messageData.message.some(m => m.type === 'at' && String(m.data.qq) === String(messageData.self_id));

        if (aiHandler.shouldReply(rawMessage, isAt, groupId)) {
            const reply = await aiHandler.getReply(rawMessage, userId, groupId);
            if (reply) {
                this.sendGroupMessage(ws, groupId, [
                    { type: 'text', data: { text: reply } }
                ]);
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
