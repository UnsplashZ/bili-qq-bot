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
        this.cacheTimeout = config.linkCacheTimeout * 1000; // Convert to milliseconds
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
            if (Date.now() - cachedTime < this.cacheTimeout) {
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
        for (const [link, time] of this.linkCache.entries()) {
            if (now - time >= this.cacheTimeout) {
                this.linkCache.delete(link);
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
                            base64Image = await imageGenerator.generatePreviewCard(info, 'video');
                            url = `https://www.bilibili.com/video/${id}`;
                            await this.sendGroupMessageWithFallback(ws, groupId, base64Image, url);
                            this.addLinkToCache(cacheKey);
                        } catch (imgError) {
                            logger.error(`[MessageHandler] Image generation failed for video ${id}, sending text only:`, imgError);
                            this.sendGroupMessage(ws, groupId, [
                                { type: 'text', data: { text: `https://www.bilibili.com/video/${id}` } }
                            ]);
                        }
                    } else {
                        const errorMsg = info.message || '无法获取视频信息';
                        logger.warn(`[MessageHandler] Failed to get video info for ${id}: ${errorMsg}`);
                        this.sendGroupMessage(ws, groupId, [
                            { type: 'text', data: { text: `获取视频失败: ${errorMsg}\nhttps://www.bilibili.com/video/${id}` } }
                        ]);
                    }
                    break;

                case 'bangumi':
                    logger.info(`[MessageHandler] Processing Bilibili Bangumi: ${id}`);
                    info = await biliApi.getBangumiInfo(id);
                    if (info.status === 'success') {
                        try {
                            base64Image = await imageGenerator.generatePreviewCard(info, 'bangumi');
                            url = `https://www.bilibili.com/bangumi/play/ss${id}`;
                            await this.sendGroupMessageWithFallback(ws, groupId, base64Image, url);
                            this.addLinkToCache(cacheKey);
                        } catch (imgError) {
                            logger.error(`[MessageHandler] Image generation failed for bangumi ${id}, sending text only:`, imgError);
                            this.sendGroupMessage(ws, groupId, [
                                { type: 'text', data: { text: `https://www.bilibili.com/bangumi/play/ss${id}` } }
                            ]);
                        }
                    } else {
                        const errorMsg = info.message || '无法获取番剧信息';
                        logger.warn(`[MessageHandler] Failed to get bangumi info for ${id}: ${errorMsg}`);
                        this.sendGroupMessage(ws, groupId, [
                            { type: 'text', data: { text: `获取番剧失败: ${errorMsg}\nhttps://www.bilibili.com/bangumi/play/ss${id}` } }
                        ]);
                    }
                    break;

                case 'dynamic':
                    logger.info(`[MessageHandler] Processing Bilibili Dynamic: ${id}`);
                    info = await biliApi.getDynamicInfo(id);
                    if (info.status === 'success') {
                        try {
                            base64Image = await imageGenerator.generatePreviewCard(info, 'dynamic');
                            url = `https://t.bilibili.com/${id}`;
                            await this.sendGroupMessageWithFallback(ws, groupId, base64Image, url);
                            this.addLinkToCache(cacheKey);
                        } catch (imgError) {
                            logger.error(`[MessageHandler] Image generation failed for dynamic ${id}, sending text only:`, imgError);
                            this.sendGroupMessage(ws, groupId, [
                                { type: 'text', data: { text: `https://t.bilibili.com/${id}` } }
                            ]);
                        }
                    } else {
                        const errorMsg = info.message || '无法获取动态信息';
                        this.sendGroupMessage(ws, groupId, [
                            { type: 'text', data: { text: `获取动态失败: ${errorMsg}\nhttps://t.bilibili.com/${id}` } }
                        ]);
                    }
                    break;

                case 'article':
                    logger.info(`[MessageHandler] Processing Bilibili Article: ${id}`);
                    info = await biliApi.getArticleInfo(id);
                    if (info.status === 'success') {
                        try {
                            base64Image = await imageGenerator.generatePreviewCard(info, 'article');
                            url = `https://www.bilibili.com/read/cv${id}`;
                            await this.sendGroupMessageWithFallback(ws, groupId, base64Image, url);
                            this.addLinkToCache(cacheKey);
                        } catch (imgError) {
                            logger.error(`[MessageHandler] Image generation failed for article ${id}, sending text only:`, imgError);
                            this.sendGroupMessage(ws, groupId, [
                                { type: 'text', data: { text: `https://www.bilibili.com/read/cv${id}` } }
                            ]);
                        }
                    } else {
                        const errorMsg = info.message || '无法获取专栏信息';
                        logger.warn(`[MessageHandler] Failed to get article info for ${id}: ${errorMsg}`);
                        this.sendGroupMessage(ws, groupId, [
                            { type: 'text', data: { text: `获取专栏失败: ${errorMsg}\nhttps://www.bilibili.com/read/cv${id}` } }
                        ]);
                    }
                    break;

                case 'live':
                    logger.info(`[MessageHandler] Processing Bilibili Live: ${id}`);
                    info = await biliApi.getLiveRoomInfo(id);
                    if (info.status === 'success') {
                        try {
                            base64Image = await imageGenerator.generatePreviewCard(info, 'live');
                            url = `https://live.bilibili.com/${id}`;
                            await this.sendGroupMessageWithFallback(ws, groupId, base64Image, url);
                            this.addLinkToCache(cacheKey);
                        } catch (imgError) {
                            logger.error(`[MessageHandler] Image generation failed for live ${id}, sending text only:`, imgError);
                            this.sendGroupMessage(ws, groupId, [
                                { type: 'text', data: { text: `https://live.bilibili.com/${id}` } }
                            ]);
                        }
                    } else {
                        const errorMsg = info.message || '无法获取直播间信息';
                        logger.warn(`[MessageHandler] Failed to get live room info for ${id}: ${errorMsg}`);
                        this.sendGroupMessage(ws, groupId, [
                            { type: 'text', data: { text: `获取直播间失败: ${errorMsg}\nhttps://live.bilibili.com/${id}` } }
                        ]);
                    }
                    break;

                case 'opus':
                    logger.info(`[MessageHandler] Processing Bilibili Opus: ${id}`);
                    info = await biliApi.getOpusInfo(id);
                    if (info.status === 'success') {
                        try {
                            base64Image = await imageGenerator.generatePreviewCard(info, 'dynamic');
                            url = `https://www.bilibili.com/opus/${id}`;
                            await this.sendGroupMessageWithFallback(ws, groupId, base64Image, url);
                            this.addLinkToCache(cacheKey);
                        } catch (imgError) {
                            logger.error(`[MessageHandler] Image generation failed for opus ${id}, sending text only:`, imgError);
                            this.sendGroupMessage(ws, groupId, [
                                { type: 'text', data: { text: `https://www.bilibili.com/opus/${id}` } }
                            ]);
                        }
                    } else {
                        const errorMsg = info.message || '无法获取 Opus 信息';
                        this.sendGroupMessage(ws, groupId, [
                            { type: 'text', data: { text: `获取 Opus 失败: ${errorMsg}\nhttps://www.bilibili.com/opus/${id}` } }
                        ]);
                    }
                    break;

                case 'ep':
                    logger.info(`[MessageHandler] Processing Bilibili EP: ${id}`);
                    info = await biliApi.getEpInfo(id);
                    if (info.status === 'success') {
                        try {
                            base64Image = await imageGenerator.generatePreviewCard(info, 'bangumi');
                            url = `https://www.bilibili.com/bangumi/play/ep${id}`;
                            await this.sendGroupMessageWithFallback(ws, groupId, base64Image, url);
                            this.addLinkToCache(cacheKey);
                        } catch (imgError) {
                            logger.error(`[MessageHandler] Image generation failed for ep ${id}, sending text only:`, imgError);
                            this.sendGroupMessage(ws, groupId, [
                                { type: 'text', data: { text: `https://www.bilibili.com/bangumi/play/ep${id}` } }
                            ]);
                        }
                    } else {
                        const errorMsg = info.message || '无法获取 EP 信息';
                        logger.warn(`[MessageHandler] Failed to get ep info for ${id}: ${errorMsg}`);
                        this.sendGroupMessage(ws, groupId, [
                            { type: 'text', data: { text: `获取 EP 失败: ${errorMsg}\nhttps://www.bilibili.com/bangumi/play/ep${id}` } }
                        ]);
                    }
                    break;

                case 'media':
                    logger.info(`[MessageHandler] Processing Bilibili Media: ${id}`);
                    info = await biliApi.getMediaInfo(id);
                    if (info.status === 'success') {
                        try {
                            base64Image = await imageGenerator.generatePreviewCard(info, 'bangumi');
                            url = `https://www.bilibili.com/bangumi/media/md${id}`;
                            await this.sendGroupMessageWithFallback(ws, groupId, base64Image, url);
                            this.addLinkToCache(cacheKey);
                        } catch (imgError) {
                            logger.error(`[MessageHandler] Image generation failed for media ${id}, sending text only:`, imgError);
                            this.sendGroupMessage(ws, groupId, [
                                { type: 'text', data: { text: `https://www.bilibili.com/bangumi/media/md${id}` } }
                            ]);
                        }
                    } else {
                        const errorMsg = info.message || '无法获取媒体信息';
                        logger.warn(`[MessageHandler] Failed to get media info for ${id}: ${errorMsg}`);
                        this.sendGroupMessage(ws, groupId, [
                            { type: 'text', data: { text: `获取媒体失败: ${errorMsg}\nhttps://www.bilibili.com/bangumi/media/md${id}` } }
                        ]);
                    }
                    break;

                case 'user':
                    logger.info(`[MessageHandler] Processing Bilibili User: ${id}`);
                    info = await biliApi.getUserInfo(id);
                    if (info.status === 'success') {
                        try {
                            base64Image = await imageGenerator.generatePreviewCard(info, 'user');
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
                { type: 'text', data: { text: `\n${url}` } }
            ]);
            logger.info(`[MessageHandler] Message with image sent successfully for ${url}`);
        } catch (e) {
            // 如果发送失败，降级为纯文本
            logger.error(`[MessageHandler] Failed to send message with image for ${url}, falling back to text only:`, e);
            this.sendGroupMessage(ws, groupId, [
                { type: 'text', data: { text: url } }
            ]);
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

        // 检查用户是否在黑名单中
        if (config.blacklistedQQs && config.blacklistedQQs.includes(userId.toString())) {
            logger.info(`[MessageHandler] User ${userId} is blacklisted, ignoring message`);
            return; // 不处理黑名单中的用户消息
        }

        // 检查群组是否启用 (如果 enabledGroups 为空，则允许所有群)
        if (groupId && config.enabledGroups && config.enabledGroups.length > 0 && !config.enabledGroups.includes(groupId.toString())) {
            logger.info(`[MessageHandler] Group ${groupId} is not in enabled list, ignoring message`);
            return;
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

        // Command: /订阅列表
        if (rawMessage.trim() === '/订阅列表' || rawMessage.trim() === '/listsub') {
            const subs = subscriptionService.getSubscriptionsByGroup(groupId);
            if (subs.length === 0) {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '本群暂无订阅。' } }]);
            } else {
                let message = '本群订阅列表：\n';
                subs.forEach((sub, index) => {
                    message += `${index + 1}. UP主ID: ${sub.uid}, 订阅类型: ${sub.type === 'dynamic' ? '动态' : '直播'}\n`;
                });
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: message } }]);
            }
            return;
        }

        // Command: /取消订阅 <uid> <type>
        if (rawMessage.startsWith('/取消订阅 ') || rawMessage.startsWith('/unsub ')) {
            const parts = rawMessage.split(' ');
            if (parts.length === 3) {
                const uid = parts[1];
                let type = parts[2];
                
                if (type === '动态') type = 'dynamic';
                if (type === '直播') type = 'live';

                if (type !== 'dynamic' && type !== 'live') {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '使用方法: /取消订阅 <uid> <动态|直播>' } }]);
                    return;
                }

                const result = subscriptionService.removeSubscription(uid, groupId, type);
                const typeName = type === 'dynamic' ? '动态' : '直播';
                if (result) {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `已取消订阅用户 ${uid} 的 ${typeName} 更新。` } }]);
                } else {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `未找到用户 ${uid} 的 ${typeName} 订阅。` } }]);
                }
            } else {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '使用方法: /取消订阅 <uid> <动态|直播>' } }]);
            }
            return;
        }

        // Command: /订阅 <uid> <type>
        if (rawMessage.startsWith('/订阅 ') || rawMessage.startsWith('/sub ')) {
            const parts = rawMessage.split(' ');
            if (parts.length === 3) {
                const uid = parts[1];
                let type = parts[2];

                if (type === '动态') type = 'dynamic';
                if (type === '直播') type = 'live';

                if (type !== 'dynamic' && type !== 'live') {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '使用方法: /订阅 <uid> <动态|直播>' } }]);
                    return;
                }

                subscriptionService.addSubscription(uid, groupId, type);
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `成功订阅用户 ${uid} 的 ${type === 'dynamic' ? '动态' : '直播'} 更新。` } }]);
            } else {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '使用方法: /订阅 <uid> <动态|直播>' } }]);
            }
            return;
        }

        // Command: /查询订阅 <uid>
        if (rawMessage.startsWith('/查询订阅 ') || rawMessage.startsWith('/checksub ')) {
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

        // Command: /登录
        if (rawMessage.trim() === '/登录' || rawMessage.trim() === '/login') {
            // 检查管理员权限
            if (config.adminQQ && userId != config.adminQQ) {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足。只有管理员可以使用登录命令。' } }]);
                return;
            }

            try {
                const res = await biliApi.getLoginUrl();
                if (res.status === 'success') {
                    const url = res.data.url;
                    const key = res.data.key;

                    // Generate QR Code Image Base64
                    const qrDataUrl = await QRCode.toDataURL(url);
                    const base64Image = qrDataUrl.replace(/^data:image\/png;base64,/, '');

                    this.sendGroupMessage(ws, groupId, [
                        { type: 'text', data: { text: `请扫描二维码登录。\n密钥: ${key}\n扫描后，请输入: /验证 ${key}` } },
                        { type: 'image', data: { file: `base64://${base64Image}` } }
                    ]);
                } else {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '获取登录URL失败。' } }]);
                }
            } catch (e) {
                logger.error('登录错误:', e);
            }
            return;
        }

        // Command: /菜单
        if (rawMessage.trim() === '/菜单' || rawMessage.trim() === '/帮助' || rawMessage.trim() === '/help') {
            try {
                const base64Image = await imageGenerator.generateHelpCard();
                this.sendGroupMessage(ws, groupId, [{ type: 'image', data: { file: `base64://${base64Image}` } }]);
            } catch (e) {
                logger.error('Error generating help card:', e);
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: 'Help menu generation failed.' } }]);
            }
            return;
        }

        // Command: /验证 <key>
        if (rawMessage.startsWith('/验证 ') || rawMessage.startsWith('/check ')) {
            // 检查管理员权限
            if (config.adminQQ && userId != config.adminQQ) {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足。只有管理员可以使用验证命令。' } }]);
                return;
            }

            const key = rawMessage.split(' ')[1];
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
            }
            return;
        }

        // Command: /黑名单 <add|remove|list> [qq]
        if (rawMessage.startsWith('/黑名单 ')) {
             if (config.adminQQ && userId != config.adminQQ) {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足。' } }]);
                return;
            }
            const parts = rawMessage.split(' ');
            const action = parts[1];
            const targetQQ = parts[2];

            if (action === 'add' && targetQQ) {
                if (!config.blacklistedQQs.includes(targetQQ)) {
                    config.blacklistedQQs.push(targetQQ);
                    config.save();
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `已将 ${targetQQ} 添加到黑名单。` } }]);
                } else {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `${targetQQ} 已经在黑名单中。` } }]);
                }
            } else if (action === 'remove' && targetQQ) {
                const index = config.blacklistedQQs.indexOf(targetQQ);
                if (index > -1) {
                    config.blacklistedQQs.splice(index, 1);
                    config.save();
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `已将 ${targetQQ} 移出黑名单。` } }]);
                } else {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `${targetQQ} 不在黑名单中。` } }]);
                }
            } else if (action === 'list') {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `黑名单列表: ${config.blacklistedQQs.join(', ') || '无'}` } }]);
            } else {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '使用方法: /黑名单 <add|remove|list> [qq]' } }]);
            }
            return;
        }

        // Command: /设置 <缓存|轮询> <value>
        if (rawMessage.startsWith('/设置 ')) {
             if (config.adminQQ && userId != config.adminQQ) {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足。' } }]);
                return;
            }
            const parts = rawMessage.split(' ');
            const type = parts[1];
            const value = parseInt(parts[2]);

            if (type === '缓存' && !isNaN(value)) {
                config.linkCacheTimeout = value;
                config.save();
                this.cacheTimeout = value * 1000;
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `链接缓存时间已设置为 ${value} 秒。` } }]);
            } else if (type === '轮询' && !isNaN(value)) {
                subscriptionService.updateCheckInterval(value);
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `订阅轮询间隔已设置为 ${value} 秒。` } }]);
            } else {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '使用方法: /设置 <缓存|轮询> <秒数>' } }]);
            }
            return;
        }

        // Command: /清理上下文
        if (rawMessage.trim() === '/清理上下文') {
            aiHandler.clearContext(groupId || userId);
            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: 'AI 上下文已清理。' } }]);
            return;
        }

        // Extract all bilibili links from the message and process them
        const links = this.extractLinks(rawMessage, groupId);

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

        if (aiHandler.shouldReply(rawMessage, isAt)) {
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
            const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 10)}.jpg`;
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
}

module.exports = new MessageHandler();
