const biliApi = require('../services/biliApi');
const imageGenerator = require('../services/imageGenerator');
const logger = require('../utils/logger');
const config = require('../config');
const cacheManager = require('../utils/cacheManager');
const notificationService = require('../services/notificationService');
const https = require('https');
const { monitorRegex } = require('../utils/regexMonitor');

const LINK_CACHE_SCOPE = logger.createScope('svc', 'link-cache');

class LinkHandler {
    constructor() {
        // Regex for Bilibili Video (BV/av)
        this.bvRegex = /(BV[a-zA-Z0-9]{10})|(av[0-9]+)/;
        // Regex for Bangumi (ss/ep)
        this.ssRegex = /play\/ss([0-9]+)/;
        // Regex for Dynamic (t.bilibili.com/xxxx, m.bilibili.com/dynamic/xxxx)
        this.dynamicRegex = /(?:t\.bilibili\.com\/|m\.bilibili\.com\/dynamic\/)([0-9]+)/;
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

    getScope(traceContext = null) {
        return traceContext?.scope || '';
    }

    log(level, scope, message, fields = {}) {
        logger.logEvent(level, 'LINK', scope, message, fields);
    }

    // 提取消息中的所有链接及其类型
    extractLinks(rawMessage, groupId, traceContext = null) {
        const scope = this.getScope(traceContext);
        // 🆕 输入验证
        if (!rawMessage || typeof rawMessage !== 'string') {
            this.log('warn', scope, 'extract-skipped', {
                groupId,
                reason: 'invalid_message_type',
                valueType: typeof rawMessage
            });
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
            this.log('debug', scope, 'extract-skipped', {
                groupId,
                reason: 'domain_not_found'
            });
            return [];
        }

        // 🆕 长度限制（只在确认有bilibili链接后才执行截断）
        const originalLength = rawMessage.length;
        if (originalLength > MAX_MESSAGE_LENGTH) {
            this.log('warn', scope, 'message-truncated', {
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

        this.log('info', scope, 'extract', {
            groupId,
            count: links.length
        });
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
                this.log('info', LINK_CACHE_SCOPE, 'cache-hit', {
                    cacheKey
                });
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
            this.log('info', LINK_CACHE_SCOPE, 'data-cache-hit', {
                cacheKey
            });
            return info;
        }

        info = await apiCall();
        if (info && info.status === 'success') {
            await cacheManager.set(cacheKey, info);
        }
        return info;
    }

    // 发送消息带降级处理 - 如果图片发送失败则发送纯文本
    async sendGroupMessageWithFallback(ws, groupId, base64Image, url, userId = null, logContext = null) {
        const scope = logContext?.scope || '';
        try {
            // 先尝试发送图片+文本
            this.sendGroupMessage(ws, groupId, [
                { type: 'image', data: { file: `base64://${base64Image}` } },
                { type: 'text', data: { text: `${url}` } }
            ], userId);
            this.log('info', scope, 'message-sent', {
                url,
                requestId: logContext?.requestId || '',
                linkType: logContext?.linkType || '',
                linkId: logContext?.linkId || ''
            });
        } catch (e) {
            // 如果发送失败，降级为纯文本
            this.log('warn', scope, 'fallback-text', {
                url,
                requestId: logContext?.requestId || '',
                linkType: logContext?.linkType || '',
                linkId: logContext?.linkId || '',
                reason: 'message_send_failed',
                error: logger.getErrorMessage(e)
            });
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
            this.log('warn', '', 'send-skipped', {
                reason: 'missing_target'
            });
        }
    }

    // 处理单个链接
    async processSingleLink(link, ws, groupId, userId = null, traceContext = null) {
        const { type, id, cacheKey } = link;
        const scope = this.getScope(traceContext);

        // 🆕 生成唯一请求ID用于错误追踪
        const requestId = this.generateRequestId();
        this.log('info', scope, 'fetch-start', {
            requestId,
            linkType: type,
            linkId: id,
            groupId,
            userId
        });

        const sendFallbackText = (targetUrl, reason, extraFields = {}, textOverride = null) => {
            this.log('warn', scope, 'fallback-text', {
                requestId,
                linkType: type,
                linkId: id,
                reason,
                ...extraFields
            });
            this.sendGroupMessage(ws, groupId, [{
                type: 'text',
                data: {
                    text: textOverride || `获取信息失败，已降级为文本链接：\n${targetUrl}`
                }
            }], userId);
        };

        const sendCard = async (cardInfo, cardType, targetUrl, previewBase64 = null) => {
            const base64Payload = previewBase64 || await imageGenerator.generatePreviewCard(cardInfo, cardType, groupId);
            await this.sendGroupMessageWithFallback(ws, groupId, base64Payload, targetUrl, userId, {
                scope,
                requestId,
                linkType: type,
                linkId: id
            });
            this.log('info', scope, 'card-ready', {
                requestId,
                linkType: type,
                linkId: id,
                url: targetUrl
            });
        };

        try {
            let info, base64Image, url;

            switch (type) {
                case 'video':
                    info = await this.getDataWithCache('video', id, () => biliApi.getVideoInfo(id, groupId));
                    if (info.status === 'success') {
                        try {
                            url = `https://www.bilibili.com/video/${id}`;
                            await sendCard(info, 'video', url);
                            // 异步触发视频下载（不阻塞预览卡片发送）
                            const videoDownloadService = require('../services/videoDownloadService')
                            videoDownloadService.downloadAndSend(ws, groupId, id, info).catch(e => {
                                this.log('error', scope, 'download-dispatch-failed', {
                                    requestId,
                                    linkType: type,
                                    linkId: id,
                                    error: logger.getErrorMessage(e)
                                })
                            })
                        } catch (imgError) {
                            sendFallbackText(`https://www.bilibili.com/video/${id}`, 'preview_generation_failed', {
                                error: logger.getErrorMessage(imgError)
                            }, `预览生成失败，已降级为文本链接：\nhttps://www.bilibili.com/video/${id}`);
                        }
                    } else {
                        sendFallbackText(`https://www.bilibili.com/video/${id}`, 'fetch_failed', {
                            status: info.status,
                            error: info.message || ''
                        });
                    }
                    break;

                case 'bangumi':
                    info = await this.getDataWithCache('bangumi', id, () => biliApi.getBangumiInfo(id, groupId));
                    if (info.status === 'success') {
                        try {
                            url = `https://www.bilibili.com/bangumi/play/ss${id}`;
                            await sendCard(info, 'bangumi', url);
                        } catch (imgError) {
                            sendFallbackText(`https://www.bilibili.com/bangumi/play/ss${id}`, 'preview_generation_failed', {
                                error: logger.getErrorMessage(imgError)
                            }, `预览生成失败，已降级为文本链接：\nhttps://www.bilibili.com/bangumi/play/ss${id}`);
                        }
                    } else {
                        sendFallbackText(`https://www.bilibili.com/bangumi/play/ss${id}`, 'fetch_failed', {
                            status: info.status,
                            error: info.message || ''
                        });
                    }
                    break;

                case 'dynamic':
                    info = await this.getDataWithCache('dynamic', id, () => biliApi.getDynamicInfo(id, groupId));
                    if (info.status === 'success') {
                        try {
                            // Use returned type if available (e.g., 'article' for Opus redirects), fallback to 'dynamic'
                            const cardType = info.type || 'dynamic';
                            url = `https://t.bilibili.com/${id}`;
                            await sendCard(info, cardType, url);
                        } catch (imgError) {
                            sendFallbackText(`https://t.bilibili.com/${id}`, 'preview_generation_failed', {
                                error: logger.getErrorMessage(imgError)
                            }, `预览生成失败，已降级为文本链接：\nhttps://t.bilibili.com/${id}`);
                        }
                    } else {
                        sendFallbackText(`https://t.bilibili.com/${id}`, 'fetch_failed', {
                            status: info.status,
                            error: info.message || ''
                        });
                    }
                    break;

                case 'article':
                    info = await this.getDataWithCache('article', id, () => biliApi.getArticleInfo(id, groupId));
                    if (info.status === 'success') {
                        try {
                            url = `https://www.bilibili.com/read/cv${id}`;
                            await sendCard(info, info.type, url);
                        } catch (imgError) {
                            sendFallbackText(`https://www.bilibili.com/read/cv${id}`, 'preview_generation_failed', {
                                error: logger.getErrorMessage(imgError)
                            }, `预览生成失败，已降级为文本链接：\nhttps://www.bilibili.com/read/cv${id}`);
                        }
                    } else {
                        sendFallbackText(`https://www.bilibili.com/read/cv${id}`, 'fetch_failed', {
                            status: info.status,
                            error: info.message || ''
                        });
                    }
                    break;

                case 'live':
                    info = await this.getDataWithCache('live', id, () => biliApi.getLiveRoomInfo(id, groupId));
                    if (info.status === 'success') {
                        try {
                            url = `https://live.bilibili.com/${id}`;
                            await sendCard(info, 'live', url);
                        } catch (imgError) {
                            sendFallbackText(`https://live.bilibili.com/${id}`, 'preview_generation_failed', {
                                error: logger.getErrorMessage(imgError)
                            }, `预览生成失败，已降级为文本链接：\nhttps://live.bilibili.com/${id}`);
                        }
                    } else {
                        sendFallbackText(`https://live.bilibili.com/${id}`, 'fetch_failed', {
                            status: info.status,
                            error: info.message || ''
                        });
                    }
                    break;

                case 'opus':
                    info = await this.getDataWithCache('opus', id, () => biliApi.getOpusInfo(id, groupId));
                    if (info.status === 'success') {
                        try {
                            url = `https://www.bilibili.com/opus/${id}`;
                            await sendCard(info, info.type, url);
                        } catch (imgError) {
                            sendFallbackText(`https://www.bilibili.com/opus/${id}`, 'preview_generation_failed', {
                                error: logger.getErrorMessage(imgError)
                            }, `预览生成失败，已降级为文本链接：\nhttps://www.bilibili.com/opus/${id}`);
                        }
                    } else {
                        sendFallbackText(`https://www.bilibili.com/opus/${id}`, 'fetch_failed', {
                            status: info.status,
                            error: info.message || ''
                        });
                    }
                    break;

                case 'ep':
                    info = await this.getDataWithCache('ep', id, () => biliApi.getEpInfo(id, groupId));
                    if (info.status === 'success') {
                        try {
                            url = `https://www.bilibili.com/bangumi/play/ep${id}`;
                            await sendCard(info, 'bangumi', url);
                        } catch (imgError) {
                            sendFallbackText(`https://www.bilibili.com/bangumi/play/ep${id}`, 'preview_generation_failed', {
                                error: logger.getErrorMessage(imgError)
                            }, `预览生成失败，已降级为文本链接：\nhttps://www.bilibili.com/bangumi/play/ep${id}`);
                        }
                    } else {
                        sendFallbackText(`https://www.bilibili.com/bangumi/play/ep${id}`, 'fetch_failed', {
                            status: info.status,
                            error: info.message || ''
                        });
                    }
                    break;

                case 'media':
                    info = await this.getDataWithCache('media', id, () => biliApi.getMediaInfo(id, groupId));
                    if (info.status === 'success') {
                        try {
                            url = `https://www.bilibili.com/bangumi/media/md${id}`;
                            await sendCard(info, 'bangumi', url);
                        } catch (imgError) {
                            sendFallbackText(`https://www.bilibili.com/bangumi/media/md${id}`, 'preview_generation_failed', {
                                error: logger.getErrorMessage(imgError)
                            }, `预览生成失败，已降级为文本链接：\nhttps://www.bilibili.com/bangumi/media/md${id}`);
                        }
                    } else {
                        sendFallbackText(`https://www.bilibili.com/bangumi/media/md${id}`, 'fetch_failed', {
                            status: info.status,
                            error: info.message || ''
                        });
                    }
                    break;

                case 'user':
                    info = await this.getDataWithCache('user', id, () => biliApi.getUserInfo(id, groupId));
                    if (info.status === 'success') {
                        try {
                            const showId = config.getGroupConfig(groupId, 'showId');
                            url = `https://space.bilibili.com/${id}`;
                            base64Image = await imageGenerator.generatePreviewCard(info, 'user', groupId, showId);
                            await sendCard(info, 'user', url, base64Image);
                        } catch (imgError) {
                            sendFallbackText(`https://space.bilibili.com/${id}`, 'preview_generation_failed', {
                                error: logger.getErrorMessage(imgError)
                            }, `https://space.bilibili.com/${id}`);
                        }
                    } else {
                        const errorMsg = info.message || '无法获取用户信息';
                        sendFallbackText(`https://space.bilibili.com/${id}`, 'fetch_failed', {
                            status: info.status,
                            error: errorMsg
                        }, `获取用户失败: ${errorMsg}\nhttps://space.bilibili.com/${id}`);
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

            this.log('error', scope, 'item-failed', {
                ...errorContext,
                stack: e.stack
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

            this.log('info', '', 'short-link-expand-start', {
                shortUrl
            });

            const options = {
                method: 'HEAD',
                timeout: 5000,  // 5秒超时
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            };

            const req = https.request(shortUrl, options, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    this.log('info', '', 'short-link-expanded', {
                        shortUrl,
                        expandedUrl: res.headers.location,
                        statusCode: res.statusCode
                    });
                    resolve(res.headers.location);
                } else {
                    this.log('info', '', 'short-link-expand-noop', {
                        shortUrl,
                        statusCode: res.statusCode
                    });
                    resolve(shortUrl);
                }
            });

            req.on('timeout', () => {
                this.log('warn', '', 'short-link-expand-timeout', {
                    shortUrl
                });
                req.destroy();
                resolve(shortUrl);  // 超时时返回原URL
            });

            req.on('error', (e) => {
                this.log('error', '', 'short-link-expand-failed', {
                    shortUrl,
                    error: logger.getErrorMessage(e)
                });
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
            this.log('warn', LINK_CACHE_SCOPE, 'cache-add-skipped', {
                reason: 'missing_url_or_group',
                groupId
            });
            return;
        }

        // 提取链接信息
        const links = this.extractLinks(url, groupId);
        if (links.length === 0) {
            this.log('debug', LINK_CACHE_SCOPE, 'cache-add-skipped', {
                reason: 'no_valid_links',
                groupId
            });
            return;
        }

        // 获取群组的缓存超时配置
        const groupConfig = config.groupConfigs[groupId] || {};
        const timeout = (groupConfig.linkCacheTimeout ?? config.linkCacheTimeout ?? 600) * 1000;

        // 添加所有提取到的链接到缓存
        for (const link of links) {
            const { cacheKey } = link;
            this.linkCache.set(cacheKey, Date.now());
            this.log('debug', LINK_CACHE_SCOPE, 'cache-added', {
                cacheKey,
                timeoutMs: timeout
            });
        }
    }
}

module.exports = new LinkHandler();
