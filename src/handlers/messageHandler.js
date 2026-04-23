const aiHandler = require('./aiHandler');
const vectorMemoryService = require('../services/vectorMemoryService');
const userProfileService = require('../services/userProfileService');
const aiContextService = require('../services/aiContextService');
const logger = require('../utils/logger');
const notificationService = require('../services/notificationService');
const config = require('../config');
const linkService = require('../services/link');
const commandManager = require('../commands');
const imageGenerator = require('../services/imageGenerator'); // Used in handleGroupIncrease
const requestApprovalService = require('../services/requestApprovalService');
const aiIdempotency = require('../services/ai/idempotency');
const { replyGateService } = require('../services/ai/replyGateService');
const { selectContext } = require('../services/ai/contextSelectorService');
const { classifyResponseModeHint } = require('../services/ai/agent/responseModeClassifier');
const { resolveBotControlActionInput } = require('../services/ai/botControlActionResolutionService');

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

    buildAgentInput({ ws, rawMessage, groupId, userId, userName, messageId, messageMeta, traceContext, pipelineInput = null }) {
        return {
            traceId: traceContext.scope,
            rawMessage,
            groupId,
            userId,
            userName,
            messageId,
            messageMeta,
            source: (typeof groupId === 'string' && groupId.startsWith('private_')) ? 'private' : 'group',
            contextKey: groupId || userId,
            pipelineInput,
            ws
        }
    }

    resolveBotControlIngress({ ws, rawMessage, groupId, userId, userName, messageId, messageMeta, traceContext, pipelineInput = null }) {
        const agentInput = this.buildAgentInput({
            ws,
            rawMessage,
            groupId,
            userId,
            userName,
            messageId,
            messageMeta,
            traceContext,
            pipelineInput
        })
        const runtime = aiHandler._buildRuntime(groupId, traceContext.scope)
        const resolution = resolveBotControlActionInput({
            agentInput,
            runtime
        })

        return {
            agentInput,
            runtime,
            resolution,
            isBotControl: resolution.candidate != null
        }
    }

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
            const scopeId = groupId || `private_${userId || 'unknown'}`;
            const dedupKey = `${scopeId}:${userId || 'unknown'}:${messageId}`;
            if (!aiIdempotency.markIfNew(dedupKey)) {
                logger.logEvent('info', 'BOT', traceContext.scope, 'duplicate-ignored', {
                    dedupKey
                });
                return;
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

        // Record message for AI context
        const sender = messageData.sender || {};
        const userName = sender.card || sender.nickname || `用户${userId}`;
        const messageMeta = this.extractMessageMeta(messageData, groupId, userId, userName);
        const shouldTrackAsChatMessage = rawMessage && !rawMessage.trim().startsWith('/')
        const botControlIngress = shouldTrackAsChatMessage
            ? this.resolveBotControlIngress({
                ws,
                rawMessage,
                groupId,
                userId,
                userName,
                messageId,
                messageMeta,
                traceContext
            })
            : { agentInput: null, runtime: null, resolution: { candidate: null, source: 'absent' }, isBotControl: false }
        if (!botControlIngress.isBotControl && shouldTrackAsChatMessage) {
            // 与向量记忆保持一致：存储前保留 @QQ 信息并清洗其他 CQ 码
            const cleanForContext = this.normalizeMessageForStorage(rawMessage);
            if (cleanForContext) {
                aiHandler.addMessageToContext(groupId || userId, 'user', cleanForContext, userId, userName, messageMeta);
            }
        }

        // 3. Vector Memory Storage (Store all non-command user messages)
        // Store after URL expansion to include full links
        if (!botControlIngress.isBotControl && groupId && shouldTrackAsChatMessage) {
             const cleanMsg = this.normalizeMessageForStorage(rawMessage);
             if (cleanMsg) {
                 vectorMemoryService.addMemory(groupId, cleanMsg, 'user', userId, userName).catch(e => {
                     logger.logEvent('error', 'BOT', traceContext.scope, 'vector-memory-save-failed', {
                        groupId,
                        userId,
                        error: logger.getErrorMessage(e)
                     });
                 });
                 // Record metadata and independently trigger profile refresh without depending on bot reply.
                 Promise.resolve()
                     .then(async () => {
                         await userProfileService.recordMessage(groupId, userId, userName)
                         await userProfileService.maybeScheduleProfileUpdate(groupId, userId, userName, aiContextService, vectorMemoryService)
                     })
                     .catch(e => {
                         logger.logEvent('error', 'BOT', traceContext.scope, 'profile-record-failed', {
                            groupId,
                            userId,
                            error: logger.getErrorMessage(e)
                         });
                     });
             }
        }

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

        // Check for AI Reply
        const isAt = messageMeta.isAtBot;

        let shouldReply = false
        let aiPipelineInput = null

        if (config.getGroupConfig(groupId, 'aiReplyGateEnabled') !== false) {
            const gateDecision = replyGateService.evaluateAdmission({
                groupId,
                userId,
                rawMessage,
                messageMeta
            })
            logger.logEvent('info', 'AI', traceContext.scope, 'AI gate decision', {
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
                logger.logEvent('info', 'AI', traceContext.scope, 'AI context selected', {
                    selectedCount: selectedContext.threadMessages.length,
                    hasSummary: !!selectedContext.backgroundSummary,
                    stats: selectedContext.stats
                })
                const responseMode = config.getGroupConfig(groupId, 'aiResponseModeEnabled') !== false
                    ? classifyResponseModeHint({
                        rawMessage,
                        messageMeta,
                        triggerLevel: gateDecision.triggerLevel
                    })
                    : { mode: 'answer_only', reasons: ['feature_disabled'] }
                logger.logEvent('info', 'AI', traceContext.scope, 'AI response mode', responseMode)

                aiPipelineInput = {
                    gateDecision,
                    selectedContext,
                    responseMode
                }
            }
        } else {
            shouldReply = aiHandler.shouldReply(rawMessage, isAt, groupId)
        }

        if (!shouldReply && botControlIngress.isBotControl) {
            shouldReply = true
            aiPipelineInput = {
                ...(aiPipelineInput || {}),
                botControlAction: botControlIngress.resolution.candidate,
                gateDecision: {
                    shouldReply: true,
                    triggerLevel: 'structured_action',
                    reasons: [`bot_control_${botControlIngress.resolution.source}`]
                },
                responseMode: {
                    mode: 'answer_only',
                    reasons: [`bot_control_${botControlIngress.resolution.source}`]
                }
            }
            logger.logEvent('info', 'AI', traceContext.scope, 'AI ingress admitted bot-control trigger', {
                source: botControlIngress.resolution.source,
                action: botControlIngress.resolution.candidate.action
            })
        }

        if (shouldReply) {
            const agentInput = this.buildAgentInput({
                ws,
                rawMessage,
                groupId,
                userId,
                userName,
                messageId,
                messageMeta,
                traceContext,
                pipelineInput: aiPipelineInput
            })
            const agentResult = await aiHandler.runAgent(agentInput)
            const reply = agentResult.finalReply
            if (reply) {
                let sentMessageId = null
                try {
                    const sendResponse = await this.sendGroupMessageWithResponse(ws, groupId, [
                        { type: 'text', data: { text: reply } }
                    ], userId)
                    if (sendResponse?.data?.message_id != null) {
                        sentMessageId = String(sendResponse.data.message_id)
                    }
                } catch (error) {
                    logger.logEvent('warn', 'BOT', traceContext.scope, 'ai-reply-send-with-response-failed', {
                        groupId,
                        userId,
                        error: logger.getErrorMessage(error)
                    })
                    this.sendGroupMessage(ws, groupId, [
                        { type: 'text', data: { text: reply } }
                    ], userId)
                }

                const latestLocalAction = Array.isArray(agentResult?.localActions)
                    ? agentResult.localActions[agentResult.localActions.length - 1] || null
                    : null
                if (sentMessageId
                    && latestLocalAction?.action === 'subscription.read'
                    && latestLocalAction?.result?.data?.operation === 'search_user') {
                    const runtime = aiHandler._buildRuntime(groupId, traceContext.scope)
                    if (runtime?.botControl && typeof runtime.botControl.setCandidateSelectionSnapshotBotMessageId === 'function') {
                        runtime.botControl.setCandidateSelectionSnapshotBotMessageId(sentMessageId, {
                            actorUserId: userId,
                            userId
                        })
                    }
                }
                if (config.getGroupConfig(groupId, 'aiReplyGateEnabled') !== false) {
                    replyGateService.recordBotReply(groupId, userId)
                }
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
