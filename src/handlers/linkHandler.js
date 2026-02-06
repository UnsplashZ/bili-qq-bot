const biliApi = require('../services/biliApi');
const imageGenerator = require('../services/imageGenerator');
const logger = require('../utils/logger');
const config = require('../config');
const cacheManager = require('../utils/cacheManager');
const notificationService = require('../services/notificationService');
const https = require('https');
const { monitorRegex } = require('../utils/regexMonitor');

class LinkHandler {
    constructor() {
        // Regex for Bilibili Video (BV/av)
        this.bvRegex = /(BV[a-zA-Z0-9]{10})|(av[0-9]+)/;
        // Regex for Bangumi (ss/ep)
        this.ssRegex = /play\/ss([0-9]+)/;
        // Regex for Dynamic (t.bilibili.com/xxxx)
        this.dynamicRegex = /t.bilibili.com\/([0-9]+)/;
        // Regex for Article (read/cv)
        // Ensure we stop capturing at non-digit characters (like ? or /)
        this.articleRegex = /read\/cv([0-9]+)/;
        // Regex for Live (live.bilibili.com/xxxx)
        this.liveRegex = /live.bilibili.com\/([0-9]+)/;
        // Regex for Opus (opus/xxxx)
        this.opusRegex = /opus\/([0-9]+)/;
        // Regex for EP (ep/xxxx)
        this.epRegex = /bangumi\/play\/ep([0-9]+)/;
        // Regex for Media (mdxxxx)
        this.mediaRegex = /bangumi\/media\/md([0-9]+)/;
        // Regex for User (space.bilibili.com/xxxx)
        this.userRegex = /(?:space\.bilibili\.com\/|(?:https?:\/\/)?[^/]*bilibili\.com\/space\/)([0-9]+)/;

        // Regex for Short Links (b23.tv/xxxx)
        this.shortLinkRegex = /https?:\/\/b23\.tv\/[a-zA-Z0-9]+/;

        // Link processing cache
        this.linkCache = new Map();

        // 🆕 Request ID counter for error tracking
        this.requestIdCounter = 0;
    }

    // 🆕 生成唯一的请求ID用于错误追踪
    generateRequestId() {
        return `LH-${Date.now()}-${++this.requestIdCounter}`;
    }

    // 提取消息中的所有链接及其类型
    extractLinks(rawMessage, groupId) {
        // 🆕 输入验证
        if (!rawMessage || typeof rawMessage !== 'string') {
            logger.warn('[LinkHandler] Invalid message type:', typeof rawMessage);
            return [];
        }

        const MAX_MESSAGE_LENGTH = 10000; // 10KB

        // 🆕 快速预检：消息中是否包含bilibili域名（在截断前检查，优化性能）
        // 对于超长消息，只检查前10KB是否包含关键词
        const checkLength = Math.min(rawMessage.length, MAX_MESSAGE_LENGTH);
        const checkStr = rawMessage.substring(0, checkLength);
        const hasBilibiliDomain = checkStr.includes('bilibili.com') ||
                                 checkStr.includes('b23.tv') ||
                                 checkStr.includes('bilibili');

        if (!hasBilibiliDomain) {
            logger.debug('[LinkHandler] No bilibili links found in message (quick check)');
            return [];
        }

        // 🆕 长度限制（只在确认有bilibili链接后才执行截断）
        const originalLength = rawMessage.length;
        if (originalLength > MAX_MESSAGE_LENGTH) {
            logger.warn(`[LinkHandler] Message too long (${originalLength} chars), truncating to ${MAX_MESSAGE_LENGTH}`, {
                groupId,
                originalLength,
                truncatedLength: MAX_MESSAGE_LENGTH
            });
            rawMessage = rawMessage.substring(0, MAX_MESSAGE_LENGTH);
        }

        const links = [];

        // Split URLs by '?' to extract only the path part and avoid matching IDs in query parameters
        // This prevents false matches like 'av0' from 'mid=xzzRgOEjRaNav0HoyyGo3A%3D%3D'
        const urlParts = rawMessage.split(/\s+/).map(part => {
            const questionMarkIndex = part.indexOf('?');
            return questionMarkIndex !== -1 ? part.substring(0, questionMarkIndex) : part;
        });
        const cleanedMessage = urlParts.join(' ');

        // 检查各种类型的链接
        const linkTypes = [
            { regex: this.bvRegex, type: 'video', extractId: (match) => match[0] },
            { regex: this.ssRegex, type: 'bangumi', extractId: (match) => match[1] },
            { regex: this.dynamicRegex, type: 'dynamic', extractId: (match) => match[1] },
            { regex: this.articleRegex, type: 'article', extractId: (match) => match[1] },
            { regex: this.liveRegex, type: 'live', extractId: (match) => match[1] },
            { regex: this.opusRegex, type: 'opus', extractId: (match) => match[1] },
            { regex: this.epRegex, type: 'ep', extractId: (match) => match[1] },
            { regex: this.mediaRegex, type: 'media', extractId: (match) => match[1] },
            { regex: this.userRegex, type: 'user', extractId: (match) => match[1] }
        ];

        for (const linkType of linkTypes) {
            // 🆕 使用正则监控包装 matchAll 调用
            const globalRegex = new RegExp(linkType.regex, 'g');
            const matches = monitorRegex(
                `${linkType.type}Regex`,
                globalRegex,
                cleanedMessage,
                (regex, input) => Array.from(input.matchAll(regex))
            );

            for (const match of matches) {
                const id = linkType.extractId(match);
                // Cache key includes groupId to allow same link in different groups
                // Use | as separator to avoid conflict with underscores in IDs or GroupIDs (e.g. private_xxxx)
                const cacheKey = groupId ? `${linkType.type}|${id}|${groupId}` : `${linkType.type}|${id}`;
                links.push({
                    type: linkType.type,
                    id: id,
                    cacheKey: cacheKey,
                    match: match[0]
                });
            }
        }

        return links;
    }

    // 检查单个链接是否在缓存中
    isLinkCached(cacheKey) {
        if (this.linkCache.has(cacheKey)) {
            const cachedTime = this.linkCache.get(cacheKey);

            // Parse groupId from cacheKey: type|id|groupId
            // Use lastIndexOf to safely extract groupId
            const lastSeparatorIndex = cacheKey.lastIndexOf('|');
            // If separator not found (index -1), check if it might be old format (underscore)
            // But for simplicity and correctness with new format, we strictly look for |
            // If no | found, it might be a key without groupId, or old key. 
            // For backward compatibility with running memory, we could check _, but since it's just cache, letting it expire is fine.
            
            let groupId = null;
            if (lastSeparatorIndex !== -1) {
                groupId = cacheKey.substring(lastSeparatorIndex + 1);
            } else {
                 // Fallback for global cache keys without groupId (type|id) -> groupId remains null
            }

            // Get timeout for this group
            const timeoutSeconds = config.getGroupConfig(groupId, 'linkCacheTimeout');
            const timeout = (timeoutSeconds || 300) * 1000;

            if (Date.now() - cachedTime < timeout) {
                logger.info(`[LinkHandler] 链接 ${cacheKey} 在缓存期内，跳过处理`);
                return true;
            } else {
                // 缓存已过期，删除它
                this.linkCache.delete(cacheKey);
            }
        }
        return false;
    }

    // 将链接添加到缓存
    addLinkToCache(cacheKey) {
        this.linkCache.set(cacheKey, Date.now());
        this.cleanupExpiredCache();
    }

    // 清理过期的缓存项
    cleanupExpiredCache() {
        const now = Date.now();
        for (const [key, time] of this.linkCache.entries()) {
            // Use lastIndexOf to safely extract groupId
            const lastSeparatorIndex = key.lastIndexOf('|');
            const groupId = lastSeparatorIndex !== -1 ? key.substring(lastSeparatorIndex + 1) : null;

            const timeoutSeconds = config.getGroupConfig(groupId, 'linkCacheTimeout');
            const timeout = (timeoutSeconds || 300) * 1000;

            if (now - time >= timeout) {
                this.linkCache.delete(key);
            }
        }
    }

    // Helper to get data with cache
    async getDataWithCache(type, id, apiCall) {
        const cacheKey = `${type}_${id}`;
        let info = await cacheManager.get(cacheKey);
        
        if (info) {
            logger.info(`[LinkHandler] Data cache hit for ${cacheKey}`);
            return info;
        }

        info = await apiCall();
        if (info && info.status === 'success') {
            await cacheManager.set(cacheKey, info);
        }
        return info;
    }

    // 发送消息带降级处理 - 如果图片发送失败则发送纯文本
    async sendGroupMessageWithFallback(ws, groupId, base64Image, url, userId = null) {
        try {
            // 先尝试发送图片+文本
            this.sendGroupMessage(ws, groupId, [
                { type: 'image', data: { file: `base64://${base64Image}` } },
                { type: 'text', data: { text: `${url}` } }
            ], userId);
            logger.info(`[LinkHandler] Message with image sent successfully for ${url}`);
        } catch (e) {
            // 如果发送失败，降级为纯文本
            logger.error(`[LinkHandler] Failed to send message with image for ${url}, falling back to text only:`, e);
            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `图片发送失败，已降级为文本链接：\n${url}` } }], userId);
        }
    }

    sendGroupMessage(ws, groupId, messageChain, userId = null) {
        if (typeof groupId === 'string' && groupId.startsWith('private_')) {
            const realUserId = groupId.replace('private_', '');
            notificationService.sendPrivateMessage(ws, realUserId, messageChain, 'LinkHandler', true);
            return;
        }

        if (groupId) {
            notificationService.sendGroupMessage(ws, groupId, messageChain, 'LinkHandler', true);
        } else if (userId) {
            notificationService.sendPrivateMessage(ws, userId, messageChain, 'LinkHandler', true);
        } else {
            logger.warn('[LinkHandler] Cannot send message: no groupId or userId provided');
        }
    }

    // 处理单个链接
    async processSingleLink(link, ws, groupId, userId = null) {
        const { type, id, cacheKey } = link;

        // 🆕 生成唯一请求ID用于错误追踪
        const requestId = this.generateRequestId();
        logger.debug(`[LinkHandler] [${requestId}] Starting to process ${type} link: ${id}`);

        try {
            let info, base64Image, url;

            switch (type) {
                case 'video':
                    logger.info(`[LinkHandler] Processing Bilibili Video: ${id}`);
                    info = await this.getDataWithCache('video', id, () => biliApi.getVideoInfo(id, groupId));
                    if (info.status === 'success') {
                        try {
                            base64Image = await imageGenerator.generatePreviewCard(info, 'video', groupId);
                            url = `https://www.bilibili.com/video/${id}`;
                            await this.sendGroupMessageWithFallback(ws, groupId, base64Image, url, userId);
                        } catch (imgError) {
                            logger.error(`[LinkHandler] Image generation failed for video ${id}, sending text only:`, imgError);
                            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `预览生成失败，已降级为文本链接：\nhttps://www.bilibili.com/video/${id}` } }], userId);
                        }
                    } else {
                        logger.warn(`[LinkHandler] Failed to get video info for ${id}`);
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `获取信息失败，已降级为文本链接：\nhttps://www.bilibili.com/video/${id}` } }], userId);
                    }
                    break;

                case 'bangumi':
                    logger.info(`[LinkHandler] Processing Bilibili Bangumi: ${id}`);
                    info = await this.getDataWithCache('bangumi', id, () => biliApi.getBangumiInfo(id, groupId));
                    if (info.status === 'success') {
                        try {
                            base64Image = await imageGenerator.generatePreviewCard(info, 'bangumi', groupId);
                            url = `https://www.bilibili.com/bangumi/play/ss${id}`;
                            await this.sendGroupMessageWithFallback(ws, groupId, base64Image, url, userId);
                        } catch (imgError) {
                            logger.error(`[LinkHandler] Image generation failed for bangumi ${id}, sending text only:`, imgError);
                            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `预览生成失败，已降级为文本链接：\nhttps://www.bilibili.com/bangumi/play/ss${id}` } }], userId);
                        }
                    } else {
                        logger.warn(`[LinkHandler] Failed to get bangumi info for ${id}`);
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `获取信息失败，已降级为文本链接：\nhttps://www.bilibili.com/bangumi/play/ss${id}` } }], userId);
                    }
                    break;

                case 'dynamic':
                    logger.info(`[LinkHandler] Processing Bilibili Dynamic: ${id}`);
                    info = await this.getDataWithCache('dynamic', id, () => biliApi.getDynamicInfo(id, groupId));
                    if (info.status === 'success') {
                        try {
                            // Use returned type if available (e.g., 'article' for Opus redirects), fallback to 'dynamic'
                            const cardType = info.type || 'dynamic';
                            base64Image = await imageGenerator.generatePreviewCard(info, cardType, groupId);
                            url = `https://t.bilibili.com/${id}`;
                            await this.sendGroupMessageWithFallback(ws, groupId, base64Image, url, userId);
                        } catch (imgError) {
                            logger.error(`[LinkHandler] Image generation failed for dynamic ${id}, sending text only:`, imgError);
                            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `预览生成失败，已降级为文本链接：\nhttps://t.bilibili.com/${id}` } }], userId);
                        }
                    } else {
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `获取信息失败，已降级为文本链接：\nhttps://t.bilibili.com/${id}` } }], userId);
                    }
                    break;

                case 'article':
                    logger.info(`[LinkHandler] Processing Bilibili Article: ${id}`);
                    info = await this.getDataWithCache('article', id, () => biliApi.getArticleInfo(id, groupId));
                    if (info.status === 'success') {
                        try {
                            base64Image = await imageGenerator.generatePreviewCard(info, info.type, groupId);
                            url = `https://www.bilibili.com/read/cv${id}`;
                            await this.sendGroupMessageWithFallback(ws, groupId, base64Image, url, userId);
                        } catch (imgError) {
                            logger.error(`[LinkHandler] Image generation failed for article ${id}, sending text only:`, imgError);
                            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `预览生成失败，已降级为文本链接：\nhttps://www.bilibili.com/read/cv${id}` } }], userId);
                        }
                    } else {
                        logger.warn(`[LinkHandler] Failed to get article info for ${id}`);
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `获取信息失败，已降级为文本链接：\nhttps://www.bilibili.com/read/cv${id}` } }], userId);
                    }
                    break;

                case 'live':
                    logger.info(`[LinkHandler] Processing Bilibili Live: ${id}`);
                    info = await this.getDataWithCache('live', id, () => biliApi.getLiveRoomInfo(id, groupId));
                    if (info.status === 'success') {
                        try {
                            base64Image = await imageGenerator.generatePreviewCard(info, 'live', groupId);
                            url = `https://live.bilibili.com/${id}`;
                            await this.sendGroupMessageWithFallback(ws, groupId, base64Image, url, userId);
                        } catch (imgError) {
                            logger.error(`[LinkHandler] Image generation failed for live ${id}, sending text only:`, imgError);
                            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `预览生成失败，已降级为文本链接：\nhttps://live.bilibili.com/${id}` } }], userId);
                        }
                    } else {
                        logger.warn(`[LinkHandler] Failed to get live room info for ${id}`);
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `获取信息失败，已降级为文本链接：\nhttps://live.bilibili.com/${id}` } }], userId);
                    }
                    break;

                case 'opus':
                    logger.info(`[LinkHandler] Processing Bilibili Opus: ${id}`);
                    info = await this.getDataWithCache('opus', id, () => biliApi.getOpusInfo(id, groupId));
                    if (info.status === 'success') {
                        try {
                            base64Image = await imageGenerator.generatePreviewCard(info, info.type, groupId);
                            url = `https://www.bilibili.com/opus/${id}`;
                            await this.sendGroupMessageWithFallback(ws, groupId, base64Image, url, userId);
                        } catch (imgError) {
                            logger.error(`[LinkHandler] Image generation failed for opus ${id}, sending text only:`, imgError);
                            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `预览生成失败，已降级为文本链接：\nhttps://www.bilibili.com/opus/${id}` } }], userId);
                        }
                    } else {
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `获取信息失败，已降级为文本链接：\nhttps://www.bilibili.com/opus/${id}` } }], userId);
                    }
                    break;

                case 'ep':
                    logger.info(`[LinkHandler] Processing Bilibili EP: ${id}`);
                    info = await this.getDataWithCache('ep', id, () => biliApi.getEpInfo(id, groupId));
                    if (info.status === 'success') {
                        try {
                            base64Image = await imageGenerator.generatePreviewCard(info, 'bangumi', groupId);
                            url = `https://www.bilibili.com/bangumi/play/ep${id}`;
                            await this.sendGroupMessageWithFallback(ws, groupId, base64Image, url, userId);
                        } catch (imgError) {
                            logger.error(`[LinkHandler] Image generation failed for ep ${id}, sending text only:`, imgError);
                            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `预览生成失败，已降级为文本链接：\nhttps://www.bilibili.com/bangumi/play/ep${id}` } }], userId);
                        }
                    } else {
                        logger.warn(`[LinkHandler] Failed to get ep info for ${id}`);
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `获取信息失败，已降级为文本链接：\nhttps://www.bilibili.com/bangumi/play/ep${id}` } }], userId);
                    }
                    break;

                case 'media':
                    logger.info(`[LinkHandler] Processing Bilibili Media: ${id}`);
                    info = await this.getDataWithCache('media', id, () => biliApi.getMediaInfo(id, groupId));
                    if (info.status === 'success') {
                        try {
                            base64Image = await imageGenerator.generatePreviewCard(info, 'bangumi', groupId);
                            url = `https://www.bilibili.com/bangumi/media/md${id}`;
                            await this.sendGroupMessageWithFallback(ws, groupId, base64Image, url, userId);
                        } catch (imgError) {
                            logger.error(`[LinkHandler] Image generation failed for media ${id}, sending text only:`, imgError);
                            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `预览生成失败，已降级为文本链接：\nhttps://www.bilibili.com/bangumi/media/md${id}` } }], userId);
                        }
                    } else {
                        logger.warn(`[LinkHandler] Failed to get media info for ${id}`);
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `获取信息失败，已降级为文本链接：\nhttps://www.bilibili.com/bangumi/media/md${id}` } }], userId);
                    }
                    break;

                case 'user':
                    logger.info(`[LinkHandler] Processing Bilibili User: ${id}`);
                    info = await this.getDataWithCache('user', id, () => biliApi.getUserInfo(id, groupId));
                    if (info.status === 'success') {
                        try {
                            const showId = config.getGroupConfig(groupId, 'showId');
                            base64Image = await imageGenerator.generatePreviewCard(info, 'user', groupId, showId);
                            url = `https://space.bilibili.com/${id}`;
                            await this.sendGroupMessageWithFallback(ws, groupId, base64Image, url, userId);
                        } catch (imgError) {
                            logger.error(`[LinkHandler] Image generation failed for user ${id}, sending text only:`, imgError);
                            this.sendGroupMessage(ws, groupId, [
                                { type: 'text', data: { text: `https://space.bilibili.com/${id}` } }
                            ], userId);
                        }
                    } else {
                        const errorMsg = info.message || '无法获取用户信息';
                        logger.warn(`[LinkHandler] Failed to get user info for ${id}: ${errorMsg}`);
                        this.sendGroupMessage(ws, groupId, [
                            { type: 'text', data: { text: `获取用户失败: ${errorMsg}\nhttps://space.bilibili.com/${id}` } }
                        ], userId);
                    }
                    break;
            } // switch end
        } catch (e) {
            // 🆕 增强错误上下文和日志记录
            const errorContext = {
                requestId,
                type,
                id,
                cacheKey,
                groupId,
                userId,
                matchedUrl: link.match,
                errorMessage: e.message,
                errorCode: e.code,
                errorName: e.name,
                stack: e.stack
            };

            logger.error(`[LinkHandler] [${requestId}] Error processing ${type} link ${id}:`, {
                ...errorContext,
                stack: e.stack // 完整堆栈跟踪
            });

            // 🆕 根据错误类型提供更友好的用户消息
            let userMessage = `处理链接 ${link.match} 时发生错误`;

            if (e.code === 'ECONNREFUSED' || e.code === 'ETIMEDOUT') {
                userMessage += '：网络连接失败，请稍后重试';
            } else if (e.response && e.response.status === 412) {
                userMessage += '：B站风控，请更新Cookie';
            } else if (e.response && e.response.status === 404) {
                userMessage += '：内容不存在或已被删除';
            } else {
                userMessage += `：${e.message || '未知错误'}`;
            }

            userMessage += `\n错误ID: ${requestId}`;

            this.sendGroupMessage(ws, groupId, [
                { type: 'text', data: { text: userMessage } }
            ], userId);

            // 重新抛出错误，让调用者知道处理失败
            // 这样失败的链接不会被缓存，允许用户重试
            throw e;
        }
    }

    async expandUrl(shortUrl) {
        return new Promise((resolve) => {
            // Ensure protocol
            if (!shortUrl.startsWith('http')) shortUrl = 'https://' + shortUrl;

            logger.info(`[LinkHandler] Expanding URL: ${shortUrl}`);

            const options = {
                method: 'HEAD',
                timeout: 5000,  // 5秒超时
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            };

            const req = https.request(shortUrl, options, (res) => {
                logger.info(`[LinkHandler] Expand response status: ${res.statusCode}`);
                logger.info(`[LinkHandler] Response headers:`, JSON.stringify(res.headers));
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    logger.info(`[LinkHandler] Redirected to: ${res.headers.location}`);
                    resolve(res.headers.location);
                } else {
                    logger.info(`[LinkHandler] No redirect, using original URL: ${shortUrl}`);
                    resolve(shortUrl);
                }
            });

            req.on('timeout', () => {
                logger.warn(`[LinkHandler] URL expansion timeout for: ${shortUrl}`);
                req.destroy();
                resolve(shortUrl);  // 超时时返回原URL
            });

            req.on('error', (e) => {
                logger.error('[LinkHandler] Error expanding URL:', e);
                resolve(shortUrl);  // 出错时返回原URL
            });

            req.end();
        });
    }

    /**
     * 🆕 添加链接到缓存（供外部调用）
     * 用于订阅推送后，将链接加入缓存避免重复解析
     *
     * @param {string} url - B站链接
     * @param {string} groupId - 群组ID
     */
    addUrlToCache(url, groupId) {
        if (!url || !groupId) {
            logger.warn('[LinkHandler] Invalid url or groupId for cache');
            return;
        }

        // 提取链接信息
        const links = this.extractLinks(url, groupId);
        if (links.length === 0) {
            logger.debug('[LinkHandler] No valid bili links found in url:', url);
            return;
        }

        // 获取群组的缓存超时配置
        const groupConfig = config.groupConfigs[groupId] || {};
        const timeout = (groupConfig.linkCacheTimeout ?? config.linkCacheTimeout ?? 600) * 1000;

        // 添加所有提取到的链接到缓存
        for (const link of links) {
            const { cacheKey } = link;
            this.linkCache.set(cacheKey, Date.now() + timeout);
            logger.debug(`[LinkHandler] Added to cache: ${cacheKey} (timeout: ${timeout}ms)`);
        }
    }
}

module.exports = new LinkHandler();
