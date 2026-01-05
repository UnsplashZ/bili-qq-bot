const biliApi = require('../services/biliApi');
const imageGenerator = require('../services/imageGenerator');
const aiHandler = require('./aiHandler');
const logger = require('../utils/logger');
const QRCode = require('qrcode');
const subscriptionService = require('../services/subscriptionService');
const https = require('https');

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
        // Regex for short links
        this.shortLinkRegex = /b23.tv\/([a-zA-Z0-9]+)/;
    }

    async expandUrl(shortUrl) {
        return new Promise((resolve) => {
            // Ensure protocol
            if (!shortUrl.startsWith('http')) shortUrl = 'https://' + shortUrl;
            
            const req = https.request(shortUrl, { method: 'HEAD' }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    resolve(res.headers.location);
                } else {
                    resolve(shortUrl);
                }
            });
            
            req.on('error', (e) => {
                logger.error('Error expanding URL:', e);
                resolve(shortUrl);
            });
            
            req.end();
        });
    }

    async handleMessage(ws, messageData) {
        const message = messageData.message; 
        let rawMessage = messageData.raw_message; 
        const userId = messageData.user_id;
        const groupId = messageData.group_id;

        // Check for JSON message (Mini Program) and extract URL
        const jsonMsg = message.find(m => m.type === 'json');
        if (jsonMsg) {
            try {
                const jsonData = JSON.parse(jsonMsg.data.data);
                // Common paths for URL in Bilibili Mini Program
                const url = jsonData.meta?.detail_1?.qqdocurl || jsonData.meta?.detail_1?.url || jsonData.meta?.news?.jumpUrl;
                if (url) {
                    logger.info(`Extracted URL from JSON: ${url}`);
                    rawMessage += " " + url; // Append to rawMessage for regex matching
                }
            } catch (e) {
                logger.warn('Failed to parse JSON message:', e);
            }
        }

        // Expand short links if present
        if (this.shortLinkRegex.test(rawMessage)) {
            const match = rawMessage.match(this.shortLinkRegex);
            if (match) {
                const shortUrl = match[0];
                const expanded = await this.expandUrl(shortUrl);
                logger.info(`Expanded ${shortUrl} to ${expanded}`);
                rawMessage += " " + expanded;
            }
        }
        
        // Command: /sub <uid> <type>
        if (rawMessage.startsWith('/sub ')) {
            const parts = rawMessage.split(' ');
            if (parts.length === 3) {
                const uid = parts[1];
                const type = parts[2]; // 'dynamic' or 'live' 
                
                if (type !== 'dynamic' && type !== 'live') {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: 'Usage: /sub <uid> <dynamic|live>' } }]);
                    return;
                }

                subscriptionService.addSubscription(uid, groupId, type);
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `Successfully subscribed to user ${uid} for ${type} updates.` } }]);
            } else {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: 'Usage: /sub <uid> <dynamic|live>' } }]);
            }
            return;
        }

        // Command: /login
        if (rawMessage.trim() === '/login') {
            try {
                const res = await biliApi.getLoginUrl();
                if (res.status === 'success') {
                    const url = res.data.url;
                    const key = res.data.key;
                    
                    // Generate QR Code Image Base64
                    const qrDataUrl = await QRCode.toDataURL(url);
                    const base64Image = qrDataUrl.replace(/^data:image\/png;base64,/, '');

                    this.sendGroupMessage(ws, groupId, [
                        { type: 'text', data: { text: `Please scan the QR code to login.\nKey: ${key}\nAfter scanning, type: /check ${key}` } },
                        { type: 'image', data: { file: `base64://${base64Image}` } }
                    ]);
                } else {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: 'Failed to get login URL.' } }]);
                }
            } catch (e) {
                logger.error('Login Error:', e);
            }
            return;
        }

        // Command: /help
        if (rawMessage.trim() === '/help') {
            try {
                const base64Image = await imageGenerator.generateHelpCard();
                this.sendGroupMessage(ws, groupId, [{ type: 'image', data: { file: `base64://${base64Image}` } }]);
            } catch (e) {
                logger.error('Error generating help card:', e);
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: 'Help menu generation failed.' } }]);
            }
            return;
        }

        // Command: /check <key>
        if (rawMessage.startsWith('/check ')) {
            const key = rawMessage.split(' ')[1];
            if (key) {
                try {
                    const res = await biliApi.checkLogin(key);
                    if (res.status === 'success') {
                         this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: 'Login Successful! Credentials saved.' } }]);
                    } else {
                         this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `Login Status: ${res.message}` } }]);
                    }
                } catch (e) {
                     this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: 'Error checking login status.' } }]);
                }
            }
            return;
        }

        // 1. Check for Bilibili Links
        if (this.bvRegex.test(rawMessage)) {
            const match = rawMessage.match(this.bvRegex);
            const bvid = match[0];
            logger.info(`Detected Bilibili Video: ${bvid}`);
            
            try {
                const info = await biliApi.getVideoInfo(bvid);
                if (info.status === 'success') {
                    const base64Image = await imageGenerator.generatePreviewCard(info, 'video');
                    
                    this.sendGroupMessage(ws, groupId, [
                        { type: 'image', data: { file: `base64://${base64Image}` } },
                        { type: 'text', data: { text: `\n${info.data.title}\nhttps://www.bilibili.com/video/${bvid}` } }
                    ]);
                }
            } catch (e) {
                logger.error('Error processing Bilibili video:', e);
            }
            return; 
        }

        if (this.ssRegex.test(rawMessage)) {
            const match = rawMessage.match(this.ssRegex);
            const seasonId = match[1];
            logger.info(`Detected Bilibili Bangumi Season: ${seasonId}`);

            try {
                const info = await biliApi.getBangumiInfo(seasonId);
                 if (info.status === 'success') {
                    const base64Image = await imageGenerator.generatePreviewCard(info, 'bangumi');
                    this.sendGroupMessage(ws, groupId, [
                        { type: 'image', data: { file: `base64://${base64Image}` } },
                         { type: 'text', data: { text: `\n${info.data.title}\nhttps://www.bilibili.com/bangumi/play/ss${seasonId}` } }
                    ]);
                 }
            } catch (e) {
                logger.error('Error processing Bangumi:', e);
            }
            return;
        }

        if (this.dynamicRegex.test(rawMessage)) {
            const match = rawMessage.match(this.dynamicRegex);
            const dynamicId = match[1];
            logger.info(`Detected Bilibili Dynamic: ${dynamicId}`);

            try {
                const info = await biliApi.getDynamicInfo(dynamicId);
                if (info.status === 'success') {
                    const base64Image = await imageGenerator.generatePreviewCard(info, 'dynamic');
                    this.sendGroupMessage(ws, groupId, [
                         { type: 'image', data: { file: `base64://${base64Image}` } },
                         { type: 'text', data: { text: `\nhttps://t.bilibili.com/${dynamicId}` } }
                    ]);
                }
            } catch (e) {
                logger.error('Error processing Dynamic:', e);
            }
            return;
        }

        if (this.articleRegex.test(rawMessage)) {
            const match = rawMessage.match(this.articleRegex);
            const cvid = match[1];
            logger.info(`Detected Bilibili Article: cv${cvid}`);

            try {
                const info = await biliApi.getArticleInfo(cvid);
                if (info.status === 'success') {
                    const base64Image = await imageGenerator.generatePreviewCard(info, 'article');
                    this.sendGroupMessage(ws, groupId, [
                        { type: 'image', data: { file: `base64://${base64Image}` } },
                        { type: 'text', data: { text: `\n${info.data.title}\nhttps://www.bilibili.com/read/cv${cvid}` } }
                    ]);
                }
            } catch (e) {
                logger.error('Error processing Article:', e);
            }
            return;
        }

        if (this.liveRegex.test(rawMessage)) {
            const match = rawMessage.match(this.liveRegex);
            const roomId = match[1];
            logger.info(`Detected Bilibili Live Room: ${roomId}`);

            try {
                const info = await biliApi.getLiveRoomInfo(roomId);
                if (info.status === 'success') {
                    const base64Image = await imageGenerator.generatePreviewCard(info, 'live');
                    this.sendGroupMessage(ws, groupId, [
                        { type: 'image', data: { file: `base64://${base64Image}` } },
                        { type: 'text', data: { text: `\n${info.data.room_info?.title}\nhttps://live.bilibili.com/${roomId}` } }
                    ]);
                }
            } catch (e) {
                logger.error('Error processing Live Room:', e);
            }
            return;
        }

        if (this.opusRegex.test(rawMessage)) {
            const match = rawMessage.match(this.opusRegex);
            const opusId = match[1];
            logger.info(`Detected Bilibili Opus: ${opusId}`);

            try {
                // Opus uses dynamic info
                const info = await biliApi.getOpusInfo(opusId);
                if (info.status === 'success') {
                    const base64Image = await imageGenerator.generatePreviewCard(info, 'dynamic'); // Reuse dynamic card
                    this.sendGroupMessage(ws, groupId, [
                        { type: 'image', data: { file: `base64://${base64Image}` } },
                        { type: 'text', data: { text: `\nhttps://www.bilibili.com/opus/${opusId}` } }
                    ]);
                }
            } catch (e) {
                logger.error('Error processing Opus:', e);
            }
            return;
        }

        // 2. Check for AI Reply
        const isAt = messageData.message.some(m => m.type === 'at' && m.data.qq == messageData.self_id);
        
        if (aiHandler.shouldReply(rawMessage, isAt)) {
            const reply = await aiHandler.getReply(rawMessage, userId);
            if (reply) {
                this.sendGroupMessage(ws, groupId, [
                    { type: 'text', data: { text: reply } }
                ]);
            }
        }
    }

    sendGroupMessage(ws, groupId, messageChain) {
        const payload = {
            action: 'send_group_msg',
            params: {
                group_id: groupId,
                message: messageChain
            }
        };
        ws.send(JSON.stringify(payload));
    }
}

module.exports = new MessageHandler();