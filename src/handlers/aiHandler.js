const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const mcpManager = require('../services/mcpManager');
const vectorMemory = require('../services/vectorMemoryService');
const aiContextService = require('../services/aiContextService');
const userProfileService = require('../services/userProfileService');
const { toolExecutionGuard } = require('../services/ai/toolExecutionGuard');
const {
    sanitizeMessage,
    markUserMessage,
    sanitizeName,
    escapeTagValue,
    normalizeId
} = require('../services/ai/messageSanitizerService');
const {
    detectIdentityIntent,
    getSpeakerId,
    getSpeakerName,
    getMentionIds,
    buildSpeakerTag,
    buildTurnFacts,
    buildAdminNoToolReply,
    applyAdminActionGuard
} = require('../services/ai/identityPolicyService');
const { getRagSearchOptions } = require('../services/ai/retrievalAugmentService');
const { buildReplyRuntime } = require('../services/ai/replyRuntimeService');
const { generateReply } = require('../services/ai/replyOrchestratorService');

class AiHandler {
    logAiEvent(level, traceId, message, fields = {}) {
        logger.logEvent(level, 'AI', traceId || '', message, fields);
    }

    // Clean CQ codes for AI consumption
    sanitizeMessage(content) {
        return sanitizeMessage(content);
    }

    // Datamarking for user-provided text only (idempotent)
    markUserMessage(content) {
        return markUserMessage(content);
    }

    formatRelativeTime(timestamp) {
        if (!timestamp) return '未知时间';
        const diff = Date.now() - timestamp;
        const minutes = Math.floor(diff / 60000);
        if (minutes < 1) return '刚刚';
        if (minutes < 60) return `${minutes}分钟前`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}小时前`;
        const days = Math.floor(hours / 24);
        if (days < 7) return `${days}天前`;
        if (days < 30) return `${Math.floor(days / 7)}周前`;
        return `${Math.floor(days / 30)}个月前`;
    }

    sanitizeName(userId) {
        return sanitizeName(userId);
    }

    _escapeTagValue(value, maxLen = 64) {
        return escapeTagValue(value, maxLen);
    }

    _normalizeId(value, fallback = 'unknown') {
        return normalizeId(value, fallback);
    }

    detectIdentityIntent(text) {
        return detectIdentityIntent(text);
    }

    _getSpeakerId(msg, fallbackUserId = null) {
        return getSpeakerId(msg, fallbackUserId);
    }

    _getSpeakerName(msg, fallbackName = '用户') {
        return getSpeakerName(msg, fallbackName);
    }

    _getMentionIds(msg) {
        return getMentionIds(msg);
    }

    _buildSpeakerTag(msg, fallbackUserId = null, fallbackName = '用户') {
        return buildSpeakerTag(msg, fallbackUserId, fallbackName);
    }

    _buildTurnFacts({ currentMsg, userId, groupId, intentType }) {
        return buildTurnFacts({
            currentMsg,
            userId,
            groupId,
            intentType,
            botId: global.bot?.selfId,
            ownerId: config.getRootAdminQQ()
        });
    }

    _buildAdminNoToolReply() {
        return buildAdminNoToolReply();
    }

    _applyAdminActionGuard(reply, intentType, hasToolResult, adminClaimRequiresTool) {
        return applyAdminActionGuard(reply, intentType, hasToolResult, adminClaimRequiresTool);
    }

    _buildCurrentUserMessage(currentMsg, message, userId) {
        const speakerId = this._getSpeakerId(currentMsg, userId);
        const speakerName = this._getSpeakerName(currentMsg, '用户');
        const msgObj = {
            role: 'user',
            content: currentMsg
                ? `${this._buildSpeakerTag(currentMsg, speakerId, speakerName)} ${this.markUserMessage(currentMsg.content)}`
                : `${this._buildSpeakerTag(null, userId, '用户')} ${this.markUserMessage(message)}`
        };
        const name = this.sanitizeName(speakerId || userId);
        if (name) msgObj.name = name;
        return msgObj;
    }

    _getRagSearchOptions(intentType, currentUserId, ragMode) {
        return getRagSearchOptions(intentType, currentUserId, ragMode);
    }

    async getReply(message, userId, groupId, traceId = null, pipelineInput = null) {
        try {
            const runtime = buildReplyRuntime({
                groupId,
                traceId,
                config,
                globalBot: global.bot,
                mcpManager,
                aiContextService,
                vectorMemory,
                userProfileService,
                axios,
                toolExecutionGuard,
                addMessageToContext: this.addMessageToContext.bind(this),
                logger: (level, msg, fields) => this.logAiEvent(level, traceId, msg, fields)
            });

            return await generateReply({
                message,
                userId,
                groupId,
                traceId,
                pipelineInput,
                runtime
            });
        } catch (error) {
            const errorMessage = String(error?.message || '');
            if (error?.code === 'ECONNABORTED' || errorMessage.includes('timeout')) {
                this.logAiEvent('error', traceId, 'api-timeout', {
                    error: errorMessage
                });
                return '抱歉，AI响应超时。请稍后重试。';
            }
            if (error?.response) {
                this.logAiEvent('error', traceId, 'api-error', {
                    status: error.response.status
                });
            } else {
                this.logAiEvent('error', traceId, 'api-request-failed', {
                    error: errorMessage
                });
            }
            return null;
        }
    }

    shouldReply(message, isAt, groupId) {
        // Check if AI is enabled for this group
        if (!config.isAiEnabledForGroup(groupId)) {
            this.logAiEvent('debug', null, 'reply-skipped', {
                groupId,
                reason: 'ai_disabled'
            });
            return false;
        }

        if (isAt) return true;
        // Check probability (support group override)
        const probability = config.getGroupConfig(groupId, 'aiProbability');
        return Math.random() < probability;
    }

    // Proxy to AiContextService
    addMessageToContext(groupId, role, content, userId = null, userName = null, meta = null) {
        aiContextService.addMessageToContext(groupId, role, content, userId, userName, meta);
    }

    // Proxy to AiContextService
    resetContext(groupId) {
        aiContextService.resetContext(groupId);
    }
}

module.exports = new AiHandler();
