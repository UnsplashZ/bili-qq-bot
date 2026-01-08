const biliApi = require('../services/biliApi');
const imageGenerator = require('../services/imageGenerator');
const aiHandler = require('./aiHandler');
const logger = require('../utils/logger');
const QRCode = require('qrcode');
const subscriptionService = require('../services/subscriptionService');
const https = require('https');
const fs = require('fs');
const path = require('path');
const config = require('../config');

class MessageHandler {
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
        // Regex for short links
        this.shortLinkRegex = /b23.tv\/([a-zA-Z0-9]+)/;

        // Link processing cache
        this.linkCache = new Map();
        // this.cacheTimeout is now dynamic per group
    }

    // 提取消息中的所有链接及其类型
    extractLinks(rawMessage, groupId) {
        const links = [];

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
            const matches = rawMessage.matchAll(new RegExp(linkType.regex, 'g'));
            for (const match of matches) {
                const id = linkType.extractId(match);
                // Cache key includes groupId to allow same link in different groups
                const cacheKey = groupId ? `${linkType.type}_${id}_${groupId}` : `${linkType.type}_${id}`;
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
            
            // Parse groupId from cacheKey: type_id_groupId
            // Note: id might contain underscores? Regex used in extractLinks ensures id is captured.
            // But cacheKey construction: `${linkType.type}_${id}_${groupId}`
            // Let's split by _. type is safe. id is usually safe. groupId is safe.
            // But id might have special chars? Bilibili IDs are alphanumeric.
            const parts = cacheKey.split('_');
            const groupId = parts.length >= 3 ? parts[parts.length - 1] : null;

            // Get timeout for this group
            const timeoutSeconds = config.getGroupConfig(groupId, 'linkCacheTimeout');
            const timeout = (timeoutSeconds || 300) * 1000;

            if (Date.now() - cachedTime < timeout) {
                logger.info(`链接 ${cacheKey} 在缓存期内，跳过处理`);
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
            const parts = key.split('_');
            const groupId = parts.length >= 3 ? parts[parts.length - 1] : null;
            
            const timeoutSeconds = config.getGroupConfig(groupId, 'linkCacheTimeout');
            const timeout = (timeoutSeconds || 300) * 1000;

            if (now - time >= timeout) {
                this.linkCache.delete(key);
            }
        }
    }

    // 处理单个链接
    async processSingleLink(link, ws, groupId) {
        const { type, id, cacheKey } = link;

        try {
            let info, base64Image, url;

            switch (type) {
                case 'video':
                    logger.info(`[MessageHandler] Processing Bilibili Video: ${id}`);
                    info = await biliApi.getVideoInfo(id);
                    if (info.status === 'success') {
                        try {
                            base64Image = await imageGenerator.generatePreviewCard(info, 'video', groupId);
                            url = `https://www.bilibili.com/video/${id}`;
                            await this.sendGroupMessageWithFallback(ws, groupId, base64Image, url);
                            this.addLinkToCache(cacheKey);
                        } catch (imgError) {
                            logger.error(`[MessageHandler] Image generation failed for video ${id}, sending text only:`, imgError);
                            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `预览生成失败，已降级为文本链接：\nhttps://www.bilibili.com/video/${id}` } }]);
                        }
                    } else {
                        logger.warn(`[MessageHandler] Failed to get video info for ${id}`);
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `获取信息失败，已降级为文本链接：\nhttps://www.bilibili.com/video/${id}` } }]);
                    }
                    break;

                case 'bangumi':
                    logger.info(`[MessageHandler] Processing Bilibili Bangumi: ${id}`);
                    info = await biliApi.getBangumiInfo(id);
                    if (info.status === 'success') {
                        try {
                            base64Image = await imageGenerator.generatePreviewCard(info, 'bangumi', groupId);
                            url = `https://www.bilibili.com/bangumi/play/ss${id}`;
                            await this.sendGroupMessageWithFallback(ws, groupId, base64Image, url);
                            this.addLinkToCache(cacheKey);
                        } catch (imgError) {
                            logger.error(`[MessageHandler] Image generation failed for bangumi ${id}, sending text only:`, imgError);
                            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `预览生成失败，已降级为文本链接：\nhttps://www.bilibili.com/bangumi/play/ss${id}` } }]);
                        }
                    } else {
                        logger.warn(`[MessageHandler] Failed to get bangumi info for ${id}`);
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `获取信息失败，已降级为文本链接：\nhttps://www.bilibili.com/bangumi/play/ss${id}` } }]);
                    }
                    break;

                case 'dynamic':
                    logger.info(`[MessageHandler] Processing Bilibili Dynamic: ${id}`);
                    info = await biliApi.getDynamicInfo(id);
                    if (info.status === 'success') {
                        try {
                            // Use returned type if available (e.g., 'article' for Opus redirects), fallback to 'dynamic'
                            const cardType = info.type || 'dynamic';
                            base64Image = await imageGenerator.generatePreviewCard(info, cardType, groupId);
                            url = `https://t.bilibili.com/${id}`;
                            await this.sendGroupMessageWithFallback(ws, groupId, base64Image, url);
                            this.addLinkToCache(cacheKey);
                        } catch (imgError) {
                            logger.error(`[MessageHandler] Image generation failed for dynamic ${id}, sending text only:`, imgError);
                            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `预览生成失败，已降级为文本链接：\nhttps://t.bilibili.com/${id}` } }]);
                        }
                    } else {
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `获取信息失败，已降级为文本链接：\nhttps://t.bilibili.com/${id}` } }]);
                    }
                    break;

                case 'article':
                    logger.info(`[MessageHandler] Processing Bilibili Article: ${id}`);
                    info = await biliApi.getArticleInfo(id);
                    if (info.status === 'success') {
                        try {
                            base64Image = await imageGenerator.generatePreviewCard(info, 'article', groupId);
                            url = `https://www.bilibili.com/read/cv${id}`;
                            await this.sendGroupMessageWithFallback(ws, groupId, base64Image, url);
                            this.addLinkToCache(cacheKey);
                        } catch (imgError) {
                            logger.error(`[MessageHandler] Image generation failed for article ${id}, sending text only:`, imgError);
                            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `预览生成失败，已降级为文本链接：\nhttps://www.bilibili.com/read/cv${id}` } }]);
                        }
                    } else {
                        logger.warn(`[MessageHandler] Failed to get article info for ${id}`);
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `获取信息失败，已降级为文本链接：\nhttps://www.bilibili.com/read/cv${id}` } }]);
                    }
                    break;

                case 'live':
                    logger.info(`[MessageHandler] Processing Bilibili Live: ${id}`);
                    info = await biliApi.getLiveRoomInfo(id);
                    if (info.status === 'success') {
                        try {
                            base64Image = await imageGenerator.generatePreviewCard(info, 'live', groupId);
                            url = `https://live.bilibili.com/${id}`;
                            await this.sendGroupMessageWithFallback(ws, groupId, base64Image, url);
                            this.addLinkToCache(cacheKey);
                        } catch (imgError) {
                            logger.error(`[MessageHandler] Image generation failed for live ${id}, sending text only:`, imgError);
                            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `预览生成失败，已降级为文本链接：\nhttps://live.bilibili.com/${id}` } }]);
                        }
                    } else {
                        logger.warn(`[MessageHandler] Failed to get live room info for ${id}`);
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `获取信息失败，已降级为文本链接：\nhttps://live.bilibili.com/${id}` } }]);
                    }
                    break;

                case 'opus':
                    logger.info(`[MessageHandler] Processing Bilibili Opus: ${id}`);
                    info = await biliApi.getOpusInfo(id);
                    if (info.status === 'success') {
                        try {
                            base64Image = await imageGenerator.generatePreviewCard(info, 'article', groupId);
                            url = `https://www.bilibili.com/opus/${id}`;
                            await this.sendGroupMessageWithFallback(ws, groupId, base64Image, url);
                            this.addLinkToCache(cacheKey);
                        } catch (imgError) {
                            logger.error(`[MessageHandler] Image generation failed for opus ${id}, sending text only:`, imgError);
                            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `预览生成失败，已降级为文本链接：\nhttps://www.bilibili.com/opus/${id}` } }]);
                        }
                    } else {
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `获取信息失败，已降级为文本链接：\nhttps://www.bilibili.com/opus/${id}` } }]);
                    }
                    break;

                case 'ep':
                    logger.info(`[MessageHandler] Processing Bilibili EP: ${id}`);
                    info = await biliApi.getEpInfo(id);
                    if (info.status === 'success') {
                        try {
                            base64Image = await imageGenerator.generatePreviewCard(info, 'bangumi', groupId);
                            url = `https://www.bilibili.com/bangumi/play/ep${id}`;
                            await this.sendGroupMessageWithFallback(ws, groupId, base64Image, url);
                            this.addLinkToCache(cacheKey);
                        } catch (imgError) {
                            logger.error(`[MessageHandler] Image generation failed for ep ${id}, sending text only:`, imgError);
                            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `预览生成失败，已降级为文本链接：\nhttps://www.bilibili.com/bangumi/play/ep${id}` } }]);
                        }
                    } else {
                        logger.warn(`[MessageHandler] Failed to get ep info for ${id}`);
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `获取信息失败，已降级为文本链接：\nhttps://www.bilibili.com/bangumi/play/ep${id}` } }]);
                    }
                    break;

                case 'media':
                    logger.info(`[MessageHandler] Processing Bilibili Media: ${id}`);
                    info = await biliApi.getMediaInfo(id);
                    if (info.status === 'success') {
                        try {
                            base64Image = await imageGenerator.generatePreviewCard(info, 'bangumi', groupId);
                            url = `https://www.bilibili.com/bangumi/media/md${id}`;
                            await this.sendGroupMessageWithFallback(ws, groupId, base64Image, url);
                            this.addLinkToCache(cacheKey);
                        } catch (imgError) {
                            logger.error(`[MessageHandler] Image generation failed for media ${id}, sending text only:`, imgError);
                            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `预览生成失败，已降级为文本链接：\nhttps://www.bilibili.com/bangumi/media/md${id}` } }]);
                        }
                    } else {
                        logger.warn(`[MessageHandler] Failed to get media info for ${id}`);
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `获取信息失败，已降级为文本链接：\nhttps://www.bilibili.com/bangumi/media/md${id}` } }]);
                    }
                    break;

                case 'user':
                    logger.info(`[MessageHandler] Processing Bilibili User: ${id}`);
                    info = await biliApi.getUserInfo(id);
                    if (info.status === 'success') {
                        try {
                            const showId = config.getGroupConfig(groupId, 'showId');
                            base64Image = await imageGenerator.generatePreviewCard(info, 'user', groupId, showId);
                            url = `https://space.bilibili.com/${id}`;
                            await this.sendGroupMessageWithFallback(ws, groupId, base64Image, url);
                            this.addLinkToCache(cacheKey);
                        } catch (imgError) {
                            logger.error(`[MessageHandler] Image generation failed for user ${id}, sending text only:`, imgError);
                            this.sendGroupMessage(ws, groupId, [
                                { type: 'text', data: { text: `https://space.bilibili.com/${id}` } }
                            ]);
                        }
                    } else {
                        const errorMsg = info.message || '无法获取用户信息';
                        logger.warn(`[MessageHandler] Failed to get user info for ${id}: ${errorMsg}`);
                        this.sendGroupMessage(ws, groupId, [
                            { type: 'text', data: { text: `获取用户失败: ${errorMsg}\nhttps://space.bilibili.com/${id}` } }
                        ]);
                    }
                    break;
            } // switch end
        } catch (e) {
            logger.error(`[MessageHandler] Error processing ${type} link ${id}:`, e);
            this.sendGroupMessage(ws, groupId, [
                { type: 'text', data: { text: `处理链接 ${link.match} 时发生错误: ${e.message || '未知错误'}` } }
            ]);
        }
    }

    // 发送消息带降级处理 - 如果图片发送失败则发送纯文本
    async sendGroupMessageWithFallback(ws, groupId, base64Image, url) {
        try {
            // 先尝试发送图片+文本
            this.sendGroupMessage(ws, groupId, [
                { type: 'image', data: { file: `base64://${base64Image}` } },
                { type: 'text', data: { text: `${url}` } }
            ]);
            logger.info(`[MessageHandler] Message with image sent successfully for ${url}`);
        } catch (e) {
            // 如果发送失败，降级为纯文本
            logger.error(`[MessageHandler] Failed to send message with image for ${url}, falling back to text only:`, e);
            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `图片发送失败，已降级为文本链接：\n${url}` } }]);
        }
    }

    async expandUrl(shortUrl) {
        return new Promise((resolve) => {
            // Ensure protocol
            if (!shortUrl.startsWith('http')) shortUrl = 'https://' + shortUrl;

            logger.info(`[MessageHandler] Expanding URL: ${shortUrl}`);

            const options = {
                method: 'HEAD',
                timeout: 5000,  // 5秒超时
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            };

            const req = https.request(shortUrl, options, (res) => {
                logger.info(`[MessageHandler] Expand response status: ${res.statusCode}`);
                logger.info(`[MessageHandler] Response headers:`, JSON.stringify(res.headers));
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    logger.info(`[MessageHandler] Redirected to: ${res.headers.location}`);
                    resolve(res.headers.location);
                } else {
                    logger.info(`[MessageHandler] No redirect, using original URL: ${shortUrl}`);
                    resolve(shortUrl);
                }
            });

            req.on('timeout', () => {
                logger.warn(`[MessageHandler] URL expansion timeout for: ${shortUrl}`);
                req.destroy();
                resolve(shortUrl);  // 超时时返回原URL
            });

            req.on('error', (e) => {
                logger.error('[MessageHandler] Error expanding URL:', e);
                resolve(shortUrl);  // 出错时返回原URL
            });

            req.end();
        });
    }

    async handleMessage(ws, messageData) {
        const message = messageData.message;
        let rawMessage = messageData.raw_message;
        const userId = messageData.user_id;
        const groupId = messageData.group_id;

        // Prevent self-trigger
        if (userId === messageData.self_id) {
            return;
        }

        logger.info(`[MessageHandler] Received message from User ${userId} in Group ${groupId}: ${rawMessage.substring(0, 100)}...`);

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
        if (groupId && !config.isGroupEnabled(groupId)) {
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
                logger.warn('[MessageHandler] JSON raw data:', jsonMsg.data.data.substring(0, 500));
            }
        }

        // Expand short links if present (before cache check)
        if (this.shortLinkRegex.test(rawMessage)) {
            const match = rawMessage.match(this.shortLinkRegex);
            if (match) {
                const shortUrl = match[0];
                logger.info(`[MessageHandler] Found short link: ${shortUrl}, expanding...`);
                try {
                    const expanded = await this.expandUrl(shortUrl);
                    logger.info(`[MessageHandler] Expanded ${shortUrl} to ${expanded}`);
                    rawMessage += " " + expanded;
                    logger.info(`[MessageHandler] Updated rawMessage with expanded URL`);
                } catch (e) {
                    logger.error(`[MessageHandler] Failed to expand short link ${shortUrl}:`, e);
                }
            }
        }

        // Command: /订阅列表
        if (rawMessage.trim() === '/订阅列表' || rawMessage.trim() === '/listsub') {
            const subs = subscriptionService.getSubscriptionsByGroup(groupId);
            if (subs.length === 0) {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '本群暂无订阅。' } }]);
            } else {
                // Notify processing
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '正在获取订阅信息并生成图片，请稍候...' } }]);

                const userSubs = subs.filter(s => s.type === 'user');
                const bangumiSubs = subs.filter(s => s.type === 'bangumi');

                (async () => {
                    try {
                        // Fetch user details
                        const userDetailsPromises = userSubs.map(async (sub) => {
                            try {
                                const info = await biliApi.getUserInfo(sub.uid);
                                if (info && info.status === 'success' && info.data) {
                                    return {
                                        ...sub,
                                        name: info.data.name || sub.name, // Update name if available
                                        face: info.data.face || 'https://i0.hdslb.com/bfs/face/member/noface.jpg',
                                        level: info.data.level || 0,
                                        pendant: info.data.pendant || {},
                                        fans_medal: info.data.fans_medal || {}
                                    };
                                }
                            } catch (e) {
                                logger.error(`Failed to fetch info for user ${sub.uid}`, e);
                            }
                            // Fallback if fetch fails
                            return {
                                ...sub,
                                face: 'https://i0.hdslb.com/bfs/face/member/noface.jpg',
                                level: 0,
                                pendant: {},
                                fans_medal: {}
                            };
                        });

                        const detailedUserSubs = await Promise.all(userDetailsPromises);

                        const data = {
                            users: detailedUserSubs,
                            bangumis: bangumiSubs
                        };

                        const showId = config.getGroupConfig(groupId, 'showId');
                        const base64Image = await imageGenerator.generateSubscriptionList(data, groupId, showId);
                        this.sendGroupMessage(ws, groupId, [{ type: 'image', data: { file: `base64://${base64Image}` } }]);

                    } catch (e) {
                        logger.error('Error generating subscription list image:', e);
                        // Fallback to text
                        let message = '生成图片失败，显示文本列表：\n';
                        if (userSubs.length) {
                            message += '\n【用户订阅】\n';
                            userSubs.forEach((sub, index) => {
                                message += `${index + 1}. ${sub.name} (UID: ${sub.uid})\n`;
                            });
                        }
                        if (bangumiSubs.length) {
                            message += '\n【番剧订阅】\n';
                            bangumiSubs.forEach((sub, index) => {
                                message += `${index + 1}. ${sub.title} (SID: ${sub.seasonId})\n`;
                            });
                        }
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: message } }]);
                    }
                })();
            }
            return;
        }

        // Command: /取消订阅 <uid> <type>
        if (rawMessage.startsWith('/取消订阅用户 ')) {
            if (!config.isGroupAdmin(groupId, userId)) {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足：此命令仅限群管理员使用。' } }]);
                return;
            }
            const parts = rawMessage.split(' ');
            if (parts.length === 2) {
                const uid = parts[1];
                const result = subscriptionService.removeUserSubscription(uid, groupId);
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: result ? `已取消订阅用户 ${uid}。` : `未找到用户 ${uid} 的订阅。` } }]);
            } else {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '使用方法: /取消订阅用户 <uid>' } }]);
            }
            return;
        }

        // Command: /订阅 <uid> <type>
        if (rawMessage.startsWith('/订阅用户 ')) {
            if (!config.isGroupAdmin(groupId, userId)) {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足：此命令仅限群管理员使用。' } }]);
                return;
            }
            const parts = rawMessage.split(' ');
            if (parts.length === 2) {
                const uid = parts[1];
                (async () => {
                    try {
                        const name = await subscriptionService.addUserSubscription(uid, groupId);
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `成功订阅用户 ${name}（动态+直播）。` } }]);
                    } catch (e) {
                         logger.error('Error adding user subscription:', e);
                         this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `订阅失败，请稍后重试。` } }]);
                    }
                })();
            } else {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '使用方法: /订阅用户 <uid>' } }]);
            }
            return;
        }

        if (rawMessage.startsWith('/订阅番剧 ')) {
            if (!config.isGroupAdmin(groupId, userId)) {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足：此命令仅限群管理员使用。' } }]);
                return;
            }
            const parts = rawMessage.split(' ');
            if (parts.length === 2) {
                const arg = parts[1].trim();
                (async () => {
                    try {
                        let seasonId = null;
                        if (/^https?:\/\//i.test(arg)) {
                            const ssMatch = arg.match(/play\/ss(\d+)/);
                            const mdMatch = arg.match(/media\/md(\d+)/);
                            const epMatch = arg.match(/play\/ep(\d+)/);
                            if (ssMatch) {
                                seasonId = ssMatch[1];
                            } else if (mdMatch) {
                                const res = await biliApi.getMediaInfo(mdMatch[1]);
                                if (res.status === 'success') seasonId = res.data?.season_id;
                            } else if (epMatch) {
                                const res = await biliApi.getEpInfo(epMatch[1]);
                                if (res.status === 'success') seasonId = res.data?.season_id;
                            }
                        } else if (/^md\d+$/i.test(arg)) {
                            const mdId = arg.replace(/md/i, '');
                            const res = await biliApi.getMediaInfo(mdId);
                            if (res.status === 'success') seasonId = res.data?.season_id;
                        } else if (/^ep\d+$/i.test(arg)) {
                            const epId = arg.replace(/ep/i, '');
                            const res = await biliApi.getEpInfo(epId);
                            if (res.status === 'success') seasonId = res.data?.season_id;
                        } else if (/^\d+$/.test(arg)) {
                            seasonId = arg;
                        }
                        if (seasonId) {
                            const title = await subscriptionService.addBangumiSubscription(seasonId, groupId);
                            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `成功订阅番剧 ${title} 更新。` } }]);
                        } else {
                            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '使用方法: /订阅番剧 <season_id | md链接 | ep链接 | md123 | ep123>' } }]);
                        }
                    } catch (e) {
                        logger.error('订阅番剧解析失败:', e);
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '订阅失败：无法解析参数，请使用 season_id、md 或 ep 链接。' } }]);
                    }
                })();
            } else {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '使用方法: /订阅番剧 <season_id | md链接 | ep链接 | md123 | ep123>' } }]);
            }
            return;
        }

        if (rawMessage.startsWith('/取消订阅番剧 ')) {
            if (!config.isGroupAdmin(groupId, userId)) {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足：此命令仅限群管理员使用。' } }]);
                return;
            }
            const parts = rawMessage.split(' ');
            if (parts.length === 2) {
                const seasonId = parts[1];
                const result = subscriptionService.removeBangumiSubscription(seasonId, groupId);
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: result ? `已取消订阅番剧 ${seasonId}。` : `未找到番剧 ${seasonId} 的订阅。` } }]);
            } else {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '使用方法: /取消订阅番剧 <season_id>' } }]);
            }
            return;
        }

        // Command: /查询订阅 <uid>
        if (rawMessage.startsWith('/查询订阅 ') || rawMessage.startsWith('/checksub ')) {
            if (!config.isGroupAdmin(groupId, userId)) {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足：此命令仅限群管理员使用。' } }]);
                return;
            }
            const parts = rawMessage.split(' ');
            if (parts.length === 2) {
                const uid = parts[1];
                const result = await subscriptionService.checkSubscriptionNow(uid, groupId);
                if (!result) {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `未找到用户 ${uid} 的动态订阅，或获取失败。` } }]);
                }
            } else {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '使用方法: /查询订阅 <uid>' } }]);
            }
            return;
        }



        // Command: /菜单
        if (rawMessage.trim() === '/菜单' || rawMessage.trim() === '/帮助' || rawMessage.trim() === '/help') {
            try {
                const base64Image = await imageGenerator.generateHelpCard('user', groupId);
                this.sendGroupMessage(ws, groupId, [{ type: 'image', data: { file: `base64://${base64Image}` } }]);
            } catch (e) {
                logger.error('Error generating help card:', e);
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: 'Help menu generation failed.' } }]);
            }
            return;
        }





        // 统一指令入口：/设置
        if (rawMessage.startsWith('/设置 ')) {
             if (!config.isGroupAdmin(groupId, userId)) {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足：此命令仅限群管理员或全局管理员使用。' } }]);
                return;
            }

            const parts = rawMessage.trim().split(/\s+/);
            const subCommand = parts[1]; // 帮助, 登录, 验证, 功能, 黑名单, 缓存, 轮询, 标签, 深色模式, etc.

            if (!subCommand) {
                 this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '请指定设置指令。发送 /设置 帮助 查看列表。' } }]);
                 return;
            }

            // 1. 帮助菜单 (/设置 帮助)
            if (subCommand === '帮助') {
                try {
                    const base64Image = await imageGenerator.generateHelpCard('admin', groupId);
                    this.sendGroupMessage(ws, groupId, [{ type: 'image', data: { file: `base64://${base64Image}` } }]);
                } catch (e) {
                    logger.error('Error generating admin help card:', e);
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: 'Admin menu generation failed.' } }]);
                }
                return;
            }

            // New: 管理员 (/设置 管理员 <add|remove> <qq>)
            if (subCommand === '管理员') {
                if (!config.isRootAdmin(userId)) {
                     this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足：此命令仅限全局管理员 (Root) 使用。' } }]);
                     return;
                }
                let action = parts[2];
                const targetQQ = parts[3];

                if (action === '添加') action = 'add';
                if (action === '移除') action = 'remove';

                if (action === 'add' && targetQQ) {
                    if (config.addGroupAdmin(groupId, targetQQ)) {
                         this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `已将 ${targetQQ} 添加为本群管理员。` } }]);
                    } else {
                         this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `添加失败。可能已存在。` } }]);
                    }
                } else if (action === 'remove' && targetQQ) {
                    if (config.removeGroupAdmin(groupId, targetQQ)) {
                         this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `已移除 ${targetQQ} 的本群管理员权限。` } }]);
                    } else {
                         this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `移除失败。可能不存在。` } }]);
                    }
                } else {
                     this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '使用方法: /设置 管理员 <add|remove> <qq>' } }]);
                }
                return;
            }

            // 2. 登录 (/设置 登录)
            if (subCommand === '登录') {
                if (!config.isRootAdmin(userId)) {
                     this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足：此命令仅限全局管理员 (Root) 使用。' } }]);
                     return;
                }
                 try {
                    const res = await biliApi.getLoginUrl();
                    if (res.status === 'success') {
                        const url = res.data.url;
                        const key = res.data.key;
                        const qrDataUrl = await QRCode.toDataURL(url);
                        const base64Image = qrDataUrl.replace(/^data:image\/png;base64,/, '');
                        this.sendGroupMessage(ws, groupId, [
                            { type: 'text', data: { text: `请扫描二维码登录。\n密钥: ${key}\n扫描后，请输入: /设置 验证 ${key}` } },
                            { type: 'image', data: { file: `base64://${base64Image}` } }
                        ]);
                    } else {
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '获取登录URL失败。' } }]);
                    }
                } catch (e) {
                    logger.error('登录错误:', e);
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '登录错误，请检查日志。' } }]);
                }
                return;
            }

            // 3. 验证 (/设置 验证 <key>)
            if (subCommand === '验证') {
                if (!config.isRootAdmin(userId)) {
                     this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足：此命令仅限全局管理员 (Root) 使用。' } }]);
                     return;
                }
                const key = parts[2];
                if (key) {
                    try {
                        const res = await biliApi.checkLogin(key);
                        if (res.status === 'success') {
                             this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '登录成功！凭据已保存。' } }]);
                        } else {
                             this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `登录状态: ${res.message}` } }]);
                        }
                    } catch (e) {
                         this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '检查登录状态时出错。' } }]);
                    }
                } else {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '请提供密钥: /设置 验证 <key>' } }]);
                }
                return;
            }

            // 4. 功能开关 (/设置 功能 <开|关> [群号])
            if (subCommand === '功能') {
                const action = parts[2];
                let targetGroupId = parts[3];

                if (!targetGroupId) {
                    targetGroupId = groupId;
                }
                if (!targetGroupId) {
                     this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '请指定群号或在群聊中使用。' } }]);
                     return;
                }
                
                // Only Root can change other groups' config? 
                // Spec: "Root Admin... manage all group configs". "Group Admin... adjust this group config".
                if (targetGroupId !== groupId && !config.isRootAdmin(userId)) {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足：您只能管理当前群组的配置。' } }]);
                    return;
                }

                if (action === '开') {
                    config.enableGroup(targetGroupId);
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `已开启群 ${targetGroupId} 的Bot权限。` } }]);
                } else if (action === '关') {
                    config.disableGroup(targetGroupId);
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `已关闭群 ${targetGroupId} 的Bot权限。` } }]);
                } else {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '指令格式错误。请使用：/设置 功能 <开|关> [群号]' } }]);
                }
                return;
            }

            // 5. 黑名单 (/设置 黑名单 <add|remove|list> [qq])
            if (subCommand === '黑名单') {
                let action = parts[2];
                const targetQQ = parts[3];
                
                // Map Chinese actions to English
                if (action === '添加') action = 'add';
                if (action === '移除') action = 'remove';
                if (action === '列表') action = 'list';
                
                // Root -> Global, Group Admin -> Group
                const isRoot = config.isRootAdmin(userId);
                
                if (action === 'add' && targetQQ) {
                    if (isRoot) {
                        if (!config.blacklistedQQs.includes(targetQQ)) {
                            config.blacklistedQQs.push(targetQQ);
                            config.save();
                            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `已将 ${targetQQ} 添加到全局黑名单。` } }]);
                        } else {
                            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `${targetQQ} 已经在全局黑名单中。` } }]);
                        }
                    } else {
                        // Group Admin
                        if (groupId) {
                            if (!config.groupConfigs[groupId]) config.groupConfigs[groupId] = {};
                            if (!config.groupConfigs[groupId].blacklistedQQs) config.groupConfigs[groupId].blacklistedQQs = [];
                            
                            if (!config.groupConfigs[groupId].blacklistedQQs.includes(targetQQ)) {
                                config.groupConfigs[groupId].blacklistedQQs.push(targetQQ);
                                config.save();
                                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `已将 ${targetQQ} 添加到本群黑名单。` } }]);
                            } else {
                                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `${targetQQ} 已经在本群黑名单中。` } }]);
                            }
                        }
                    }
                } else if (action === 'remove' && targetQQ) {
                    if (isRoot) {
                        const index = config.blacklistedQQs.indexOf(targetQQ);
                        if (index > -1) {
                            config.blacklistedQQs.splice(index, 1);
                            config.save();
                            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `已将 ${targetQQ} 移出全局黑名单。` } }]);
                        } else {
                            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `${targetQQ} 不在全局黑名单中。` } }]);
                        }
                    } else {
                        // Group Admin
                        if (groupId && config.groupConfigs[groupId] && config.groupConfigs[groupId].blacklistedQQs) {
                             const index = config.groupConfigs[groupId].blacklistedQQs.indexOf(targetQQ);
                             if (index > -1) {
                                config.groupConfigs[groupId].blacklistedQQs.splice(index, 1);
                                config.save();
                                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `已将 ${targetQQ} 移出本群黑名单。` } }]);
                             } else {
                                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `${targetQQ} 不在本群黑名单中。` } }]);
                             }
                        } else {
                            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `${targetQQ} 不在本群黑名单中。` } }]);
                        }
                    }
                } else if (action === 'list') {
                    if (isRoot) {
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `全局黑名单列表: ${config.blacklistedQQs.join(', ') || '无'}` } }]);
                    } else {
                         const list = (config.groupConfigs[groupId] && config.groupConfigs[groupId].blacklistedQQs) ? config.groupConfigs[groupId].blacklistedQQs.join(', ') : '无';
                         this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `本群黑名单列表: ${list}` } }]);
                    }
                } else {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '使用方法: /设置 黑名单 <add|remove|list> [qq]' } }]);
                }
                return;
            }

            // 6. 缓存 (/设置 缓存 <秒数>)
            if (subCommand === '缓存') {
                 const value = parseInt(parts[2]);
                 if (!isNaN(value)) {
                    if (groupId) {
                        if (!config.groupConfigs[groupId]) config.groupConfigs[groupId] = {};
                        config.groupConfigs[groupId].linkCacheTimeout = value;
                        config.save();
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `本群链接缓存时间已设置为 ${value} 秒。` } }]);
                    } else {
                        // Only Root can set Global
                        if (config.isRootAdmin(userId)) {
                            config.linkCacheTimeout = value;
                            config.save();
                            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `全局链接缓存时间已设置为 ${value} 秒。` } }]);
                        } else {
                             this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `权限不足：全局配置仅限全局管理员 (Root) 使用。` } }]);
                        }
                    }
                 } else {
                      this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '请输入有效的秒数。' } }]);
                 }
                 return;
            }

            // 7. 轮询 (/设置 轮询 <秒数>)
            if (subCommand === '轮询') {
                if (!config.isRootAdmin(userId)) {
                     this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足：此命令仅限全局管理员 (Root) 使用。' } }]);
                     return;
                }
                const value = parseInt(parts[2]);
                if (!isNaN(value)) {
                    subscriptionService.updateCheckInterval(value);
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `全局订阅轮询间隔已设置为 ${value} 秒。` } }]);
                } else {
                     this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '请输入有效的秒数。' } }]);
                }
                return;
            }

            // 8. 标签 (/设置 标签 <类型> <开|关>)
            if (subCommand === '标签') {
                 const category = parts[2]; 
                 const switchState = parts[3]; 

                 const categoryMap = {
                     '视频': 'video', 'video': 'video',
                     '番剧': 'bangumi', 'bangumi': 'bangumi',
                     '专栏': 'article', 'article': 'article',
                     '直播': 'live', 'live': 'live',
                     '动态': 'dynamic', 'dynamic': 'dynamic',
                     '用户': 'user', 'user': 'user',
                     '电影': 'movie', 'movie': 'movie',
                     '电视剧': 'tv', 'tv': 'tv',
                     '国创': 'guocha', 'guocha': 'guocha',
                     '纪录片': 'doc', 'doc': 'doc',
                     '综艺': 'variety', 'variety': 'variety'
                 };
                 const key = categoryMap[category];
                 
                 if (key && (switchState === '开' || switchState === '关')) {
                     const isEnabled = (switchState === '开');
                     if (groupId) {
                        if (!config.groupConfigs[groupId]) config.groupConfigs[groupId] = {};
                        if (!config.groupConfigs[groupId].labelConfig) {
                             config.groupConfigs[groupId].labelConfig = { ...config.labelConfig };
                        }
                        config.groupConfigs[groupId].labelConfig[key] = isEnabled;
                        config.save();
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `本群 ${category} 标签显示已${switchState}。` } }]);
                     } else {
                        if (!config.labelConfig) config.labelConfig = {};
                        config.labelConfig[key] = isEnabled;
                        config.save();
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `全局 ${category} 标签显示已${switchState}。` } }]);
                     }
                 } else {
                      this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '使用方法: /设置 标签 <视频|番剧|专栏|直播|动态|用户> <开|关>' } }]);
                 }
                 return;
            }

            // 9. AI上下文 (/设置 AI上下文 <条数>)
            if (subCommand === 'AI上下文') {
                 const value = parseInt(parts[2]);
                 if (!isNaN(value)) {
                     if (groupId) {
                        if (!config.groupConfigs[groupId]) config.groupConfigs[groupId] = {};
                        config.groupConfigs[groupId].aiContextLimit = value;
                        config.save();
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `本群 AI 上下文限制已设置为 ${value} 条。` } }]);
                     } else {
                        config.aiContextLimit = value;
                        config.save();
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `全局 AI 上下文限制已设置为 ${value} 条。` } }]);
                     }
                 } else {
                      this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '请输入有效的条数。' } }]);
                 }
                 return;
            }
            
            // 10. 深色模式 (/设置 深色模式 <开|关|定时>)
            if (subCommand === '深色模式') {
                const mode = parts[2];
                if (['开', '关', '定时'].includes(mode)) {
                     if (mode === '开') {
                        if (groupId) {
                            if (!config.groupConfigs[groupId]) config.groupConfigs[groupId] = {};
                            if (!config.groupConfigs[groupId].nightMode) config.groupConfigs[groupId].nightMode = { ...config.nightMode };
                            config.groupConfigs[groupId].nightMode.mode = 'on';
                            config.save();
                            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '本群深色模式已强制开启。' } }]);
                        } else {
                            config.nightMode.mode = 'on';
                            config.save();
                            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '全局深色模式已强制开启。' } }]);
                        }
                    } else if (mode === '关') {
                        if (groupId) {
                            if (!config.groupConfigs[groupId]) config.groupConfigs[groupId] = {};
                            if (!config.groupConfigs[groupId].nightMode) config.groupConfigs[groupId].nightMode = { ...config.nightMode };
                            config.groupConfigs[groupId].nightMode.mode = 'off';
                            config.save();
                            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '本群深色模式已强制关闭。' } }]);
                        } else {
                            config.nightMode.mode = 'off';
                            config.save();
                            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '全局深色模式已强制关闭。' } }]);
                        }
                    } else if (mode === '定时') {
                        const timeRange = parts[3];
                        if (timeRange && /^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(timeRange)) {
                            const [start, end] = timeRange.split('-');
                            if (groupId) {
                                if (!config.groupConfigs[groupId]) config.groupConfigs[groupId] = {};
                                if (!config.groupConfigs[groupId].nightMode) config.groupConfigs[groupId].nightMode = { ...config.nightMode };
                                config.groupConfigs[groupId].nightMode.mode = 'timed';
                                config.groupConfigs[groupId].nightMode.startTime = start;
                                config.groupConfigs[groupId].nightMode.endTime = end;
                                config.save();
                                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `本群深色模式已设置为定时开启：${start} 至 ${end}。` } }]);
                            } else {
                                config.nightMode.mode = 'timed';
                                config.nightMode.startTime = start;
                                config.nightMode.endTime = end;
                                config.save();
                                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `全局深色模式已设置为定时开启：${start} 至 ${end}。` } }]);
                            }
                        } else {
                             this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '格式错误。请使用: /设置 深色模式 定时 21:30-07:30' } }]);
                        }
                    }
                } else {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '使用方法: /设置 深色模式 <开|关|定时> [开始时间-结束时间]' } }]);
                }
                return;
            }

            // 11. 显示UID (/设置 显示UID <开|关>)
            if (subCommand === '显示UID' || subCommand === 'UID') {
                 if (!config.isGroupAdmin(groupId, userId)) {
                     this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足：此命令仅限群管理员使用。' } }]);
                     return;
                 }
                 const switchState = parts[2];
                 if (switchState === '开' || switchState === '关') {
                     const isEnabled = (switchState === '开');
                     if (groupId) {
                        if (!config.groupConfigs[groupId]) config.groupConfigs[groupId] = {};
                        config.groupConfigs[groupId].showId = isEnabled;
                        config.save();
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `本群 UID 显示已${switchState}。` } }]);
                     } else {
                        config.showId = isEnabled;
                        config.save();
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `全局 UID 显示已${switchState}。` } }]);
                     }
                 } else {
                      this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '使用方法: /设置 显示UID <开|关>' } }]);
                 }
                 return;
            }

            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '未知设置指令。请发送 /设置 帮助 查看可用指令。' } }]);
            return;
        }



        // Command: /清理上下文
        if (rawMessage.trim() === '/清理上下文') {
            aiHandler.clearContext(groupId || userId);
            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: 'AI 上下文已清理。' } }]);
            return;
        }

        const safeRawMessage = rawMessage.replace(/\[CQ:[^\]]+\]/g, '');
        const links = this.extractLinks(safeRawMessage, groupId);

        // Process each link that's not in cache
        let hasProcessedLinks = false;
        for (const link of links) {
            if (!this.isLinkCached(link.cacheKey)) {
                await this.processSingleLink(link, ws, groupId);
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
        const isAt = messageData.message.some(m => m.type === 'at' && m.data.qq == messageData.self_id);

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
        try {
            // 使用共享目录，确保npm运行的bot和docker运行的napcat都能访问
            const hostTempDir = '/root/napcat-data/QQ/NapCat/temp/'; // 宿主机上的目录
            const containerTempDir = '/app/.config/QQ/NapCat/temp/'; // 容器内的目录（映射到宿主机）

            // 确保目录存在
            if (!fs.existsSync(hostTempDir)) {
                fs.mkdirSync(hostTempDir, { recursive: true });
                logger.info(`[MessageHandler] Created temp directory: ${hostTempDir}`);
            }

            // 生成唯一的文件名
            const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 10)}.png`;
            const hostFilePath = path.join(hostTempDir, fileName); // 宿主机上的完整路径
            const containerFilePath = path.join(containerTempDir, fileName); // 容器内的路径

            // 将base64数据写入宿主机文件
            const imageBuffer = Buffer.from(base64Data, 'base64');

            // 检查图片大小（以MB为单位）
            const imageSizeMB = imageBuffer.length / (1024 * 1024);
            logger.info(`[MessageHandler] Image size: ${imageSizeMB.toFixed(2)} MB`);

            // 如果图片超过10MB，记录警告
            if (imageSizeMB > 10) {
                logger.warn(`[MessageHandler] Large image detected (${imageSizeMB.toFixed(2)} MB), may fail to send`);
            }

            fs.writeFileSync(hostFilePath, imageBuffer);
            logger.info(`[MessageHandler] Saved image to: ${hostFilePath} (size: ${imageSizeMB.toFixed(2)} MB)`);

            // 返回容器内的路径，这样napcat可以访问
            return containerFilePath;
        } catch (e) {
            logger.error('[MessageHandler] Error saving image file:', e);
            throw e;
        }
    }

    // 清理文本,移除可能导致编码问题的字符
    cleanText(text) {
        if (typeof text !== 'string') return text;

        try {
            // 移除零宽字符和其他可能导致问题的Unicode字符
            let cleaned = text
                .replace(/[\u200B-\u200D\uFEFF]/g, '') // 零宽字符
                .replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F]/g, '') // 控制字符
                .replace(/\uFFFD/g, ''); // 替换字符

            // 确保文本是有效的UTF-8
            // 尝试编码和解码来验证
            Buffer.from(cleaned, 'utf8');

            return cleaned;
        } catch (e) {
            logger.warn('[MessageHandler] Text cleaning failed, using original:', e);
            return text;
        }
    }

    sendGroupMessage(ws, groupId, messageChain) {
        try {
            // 处理图片消息，将base64图片转换为文件路径
            // 同时清理文本消息
            const processedMessageChain = messageChain.map(item => {
                if (item.type === 'image' && item.data.file && item.data.file.startsWith('base64://')) {
                    // 如果配置了直接发送 Base64，则不做转换
                    if (config.useBase64Send) {
                        return item;
                    }

                    const base64Data = item.data.file.substring(9); // 移除 'base64://' 前缀
                    const imagePath = this.saveImageAsFile(base64Data);
                    // 返回文件路径格式，让NapCat直接发送原图
                    return {
                        type: 'image',
                        data: {
                            file: `file://${imagePath}`
                        }
                    };
                } else if (item.type === 'text' && item.data.text) {
                    // 清理文本
                    return {
                        type: 'text',
                        data: {
                            text: this.cleanText(item.data.text)
                        }
                    };
                }
                return item;
            });

            const payload = {
                action: 'send_group_msg',
                params: {
                    group_id: groupId,
                    message: processedMessageChain
                }
            };

            logger.info(`[MessageHandler] Sending message to group ${groupId}, chain length: ${processedMessageChain.length}`);
            logger.debug('[MessageHandler] Sending payload:', JSON.stringify(payload, null, 2).substring(0, 500)); // Debug log

            ws.send(JSON.stringify(payload));
            logger.info(`[MessageHandler] Message sent successfully to group ${groupId}`);
        } catch (e) {
            logger.error('[MessageHandler] Error sending group message:', e);
            logger.error('[MessageHandler] Error stack:', e.stack);
            logger.error('[MessageHandler] Failed message chain:', JSON.stringify(messageChain, null, 2).substring(0, 500));

            // 尝试发送简化的错误通知
            try {
                const fallbackPayload = {
                    action: 'send_group_msg',
                    params: {
                        group_id: groupId,
                        message: [{ type: 'text', data: { text: '消息发送失败，请查看日志' } }]
                    }
                };
                ws.send(JSON.stringify(fallbackPayload));
            } catch (fallbackError) {
                logger.error('[MessageHandler] Fallback message also failed:', fallbackError);
            }
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
