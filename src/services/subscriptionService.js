const fs = require('fs');
const path = require('path');
const biliApi = require('./biliApi');
const imageGenerator = require('./imageGenerator');
const logger = require('../utils/logger');
const https = require('https');
const config = require('../config');

const SUBS_FILE = path.join(__dirname, '../../data/subscriptions.json');

class SubscriptionService {
    constructor() {
        // Backward-compat storage (legacy)
        this.subscriptions = []; // legacy: { uid, type: 'live'|'dynamic', groupIds, lastId, lastTime }
        // New architecture
        this.userSubs = [];      // { uid, groupIds: string[], lastDynamicId?: string, lastDynamicTime?: number, lastLiveStatus?: '0'|'1' }
        this.bangumiSubs = [];   // { seasonId: string, groupIds: string[], lastEpId?: string|number, lastEpTime?: number }
        this.ws = null;
        this.checkInterval = config.subscriptionCheckInterval * 1000; // 从配置读取并转换为毫秒
        this.loadSubscriptions();
    }

    setWs(ws) {
        this.ws = ws;
    }

    loadSubscriptions() {
        try {
            if (fs.existsSync(SUBS_FILE)) {
                const json = JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8'));
                if (Array.isArray(json)) {
                    // legacy format, migrate to userSubs
                    this.subscriptions = json;
                    const map = new Map();
                    for (const s of this.subscriptions) {
                        const key = s.uid;
                        if (!map.has(key)) {
                            map.set(key, { uid: key, groupIds: [], lastDynamicId: null, lastDynamicTime: 0, lastLiveStatus: '0' });
                        }
                        const entry = map.get(key);
                        s.groupIds.forEach(g => { if (!entry.groupIds.includes(g)) entry.groupIds.push(g); });
                        if (s.type === 'dynamic') {
                            if (s.lastId) entry.lastDynamicId = s.lastId;
                            if (s.lastTime) entry.lastDynamicTime = s.lastTime;
                        }
                        if (s.type === 'live') {
                            if (s.lastId) entry.lastLiveStatus = s.lastId;
                        }
                    }
                    this.userSubs = Array.from(map.values());
                    this.bangumiSubs = [];
                } else {
                    // new format
                    this.userSubs = json.userSubs || [];
                    this.bangumiSubs = json.bangumiSubs || [];
                }
            }
        } catch (e) {
            logger.error('Failed to load subscriptions:', e);
        }
    }

    saveSubscriptions() {
        try {
            const dir = path.dirname(SUBS_FILE);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            const data = {
                userSubs: this.userSubs,
                bangumiSubs: this.bangumiSubs
            };
            fs.writeFileSync(SUBS_FILE, JSON.stringify(data, null, 2));
        } catch (e) {
            logger.error('Failed to save subscriptions:', e);
        }
    }

    // New API: 用户订阅
    async addUserSubscription(uid, groupId) {
        let sub = this.userSubs.find(s => s.uid === uid);
        let name = '';
        
        // Fetch user info to get name if it's a new subscription or name is missing
        try {
            const info = await biliApi.getUserInfo(uid);
            if (info && info.status === 'success' && info.data) {
                name = info.data.name;
            }
        } catch (e) {
            logger.error(`Failed to fetch user info for ${uid}:`, e);
        }

        if (!sub) {
            sub = { 
                uid, 
                groupIds: [groupId], 
                lastDynamicId: null, 
                lastDynamicTime: 0, 
                lastLiveStatus: '0',
                name: name || `用户${uid}` 
            };
            this.userSubs.push(sub);
        } else {
            if (!sub.groupIds.includes(groupId)) {
                sub.groupIds.push(groupId);
            }
            // Update name if we fetched it
            if (name) sub.name = name;
        }
        this.saveSubscriptions();
        return sub.name;
    }

    removeUserSubscription(uid, groupId) {
        const sub = this.userSubs.find(s => s.uid === uid);
        if (!sub) return false;
        sub.groupIds = sub.groupIds.filter(id => id !== groupId);
        if (sub.groupIds.length === 0) {
            this.userSubs = this.userSubs.filter(s => s.uid !== uid);
        }
        this.saveSubscriptions();
        return true;
    }

    // New API: 番剧订阅
    async addBangumiSubscription(seasonId, groupId) {
        let sub = this.bangumiSubs.find(s => s.seasonId === seasonId);
        let title = '';

        // Fetch bangumi info to get title
        try {
            const info = await biliApi.getBangumiInfo(seasonId);
            if (info && info.status === 'success' && info.data) {
                title = info.data.title;
            }
        } catch (e) {
            logger.error(`Failed to fetch bangumi info for ${seasonId}:`, e);
        }

        if (!sub) {
            sub = { 
                seasonId, 
                groupIds: [groupId], 
                lastEpId: null, 
                lastEpTime: 0,
                title: title || `番剧${seasonId}`
            };
            this.bangumiSubs.push(sub);
        } else {
            if (!sub.groupIds.includes(groupId)) {
                sub.groupIds.push(groupId);
            }
            // Update title if we fetched it
            if (title) sub.title = title;
        }
        this.saveSubscriptions();
        return sub.title;
    }

    removeBangumiSubscription(seasonId, groupId) {
        const sub = this.bangumiSubs.find(s => s.seasonId === seasonId);
        if (!sub) return false;
        sub.groupIds = sub.groupIds.filter(id => id !== groupId);
        if (sub.groupIds.length === 0) {
            this.bangumiSubs = this.bangumiSubs.filter(s => s.seasonId !== seasonId);
        }
        this.saveSubscriptions();
        return true;
    }

    getSubscriptionsByGroup(groupId) {
        const users = this.userSubs.filter(s => s.groupIds.includes(groupId)).map(s => ({ type: 'user', uid: s.uid, name: s.name || s.uid }));
        const bangumis = this.bangumiSubs.filter(s => s.groupIds.includes(groupId)).map(s => ({ type: 'bangumi', seasonId: s.seasonId, title: s.title || s.seasonId }));
        return [...users, ...bangumis];
    }

    // legacy remove for backward compatibility
    removeSubscription(uid, groupId, type) {
        if (type === 'dynamic' || type === 'live') {
            return this.removeUserSubscription(uid, groupId);
        }
        return false;
    }

    getTypeName(type) {
        const typeNames = { dynamic: '动态', live: '直播', user: '用户', bangumi: '番剧' };
        return typeNames[type] || type;
    }

    start() {
        if (this.intervalId) clearInterval(this.intervalId);
        this.intervalId = setInterval(() => this.checkAll(), this.checkInterval);
        logger.info('Subscription service started.');
        
        // Background task: refresh missing names for legacy data
        this.refreshMissingNames().catch(e => logger.error('Error in refreshMissingNames:', e));
    }

    async refreshMissingNames() {
        logger.info('Starting background refresh of missing subscription names...');
        let updated = false;

        // 1. Refresh User Names
        for (const sub of this.userSubs) {
            if (!sub.name) {
                try {
                    const info = await biliApi.getUserInfo(sub.uid);
                    if (info && info.status === 'success' && info.data) {
                        sub.name = info.data.name;
                        updated = true;
                        logger.info(`Refreshed name for UID ${sub.uid}: ${sub.name}`);
                        // Small delay to be nice to API
                        await new Promise(r => setTimeout(r, 1000));
                    }
                } catch (e) {
                    logger.error(`Failed to refresh name for UID ${sub.uid}:`, e);
                }
            }
        }

        // 2. Refresh Bangumi Titles
        for (const sub of this.bangumiSubs) {
            if (!sub.title) {
                try {
                    const info = await biliApi.getBangumiInfo(sub.seasonId);
                    if (info && info.status === 'success' && info.data) {
                        sub.title = info.data.title;
                        updated = true;
                        logger.info(`Refreshed title for Season ${sub.seasonId}: ${sub.title}`);
                        // Small delay to be nice to API
                        await new Promise(r => setTimeout(r, 1000));
                    }
                } catch (e) {
                    logger.error(`Failed to refresh title for Season ${sub.seasonId}:`, e);
                }
            }
        }

        if (updated) {
            this.saveSubscriptions();
            logger.info('Finished refreshing missing subscription names. Data saved.');
        } else {
            logger.info('No missing names found or no updates needed.');
        }
    }

    updateCheckInterval(newIntervalSeconds) {
        this.checkInterval = newIntervalSeconds * 1000;
        config.subscriptionCheckInterval = newIntervalSeconds;
        config.save();
        
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = setInterval(() => this.checkAll(), this.checkInterval);
            logger.info(`Subscription check interval updated to ${newIntervalSeconds} seconds.`);
        }
    }

    async checkAll() {
        if (!this.ws) return;

        // 用户订阅：同时检查动态与直播
        for (const sub of this.userSubs) {
            try {
                await this.checkUserDynamic(sub);
                await this.checkUserLive(sub);
            } catch (e) {
                logger.error(`Error checking user subscription for ${sub.uid}:`, e);
            }
        }
        // 番剧订阅：检查更新剧集
        for (const sub of this.bangumiSubs) {
            try {
                await this.checkBangumi(sub);
            } catch (e) {
                logger.error(`Error checking bangumi subscription for ${sub.seasonId}:`, e);
            }
        }
        this.saveSubscriptions();
    }

    async checkUserDynamic(sub, force = false) {
        logger.info(`[CheckDynamic] Checking dynamic for UID: ${sub.uid}, Force: ${force}`);
        try {
            const res = await biliApi.getUserDynamic(sub.uid);
            logger.info(`[CheckDynamic] API response status: ${res.status}`);

            if (res.status === 'success' && res.data) {
                const dynamicId = res.data.id;
                const dynamicType = res.data.type; // 获取动态类型
                const dynamicTime = res.data.pub_ts || 0; // 获取动态发布时间戳
                logger.info(`[CheckDynamic] Got dynamic ID: ${dynamicId}, Type: ${dynamicType}, Time: ${dynamicTime}, LastID: ${sub.lastId}, LastTime: ${sub.lastTime}`);

                // 过滤掉自动发布的直播推荐动态 (DYNAMIC_TYPE_LIVE_RCMD 或 MAJOR_TYPE_LIVE_RCMD)
                // 这种动态通常在开始直播时自动发送，我们使用 checkUserLive 单独处理直播通知，避免重复
                const isLiveDynamic = dynamicType === 'DYNAMIC_TYPE_LIVE_RCMD' || 
                    (res.data.modules && res.data.modules.module_dynamic && 
                     res.data.modules.module_dynamic.major && 
                     res.data.modules.module_dynamic.major.type === 'MAJOR_TYPE_LIVE_RCMD');

                if (isLiveDynamic) {
                    logger.info(`[CheckDynamic] Skipping LIVE_RCMD dynamic ${dynamicId} to avoid duplicate notification.`);
                    // 仍然更新状态，以免下次检查时被视为新动态（虽然 checkUserLive 会处理，但为了状态一致性）
                    if (!force && dynamicTime > (sub.lastDynamicTime || 0)) {
                        sub.lastDynamicId = dynamicId;
                        sub.lastDynamicTime = dynamicTime;
                        this.saveSubscriptions(); // Save state
                    }
                    return; // Skip processing this dynamic
                }

                // 确保 sub.lastDynamicTime 存在
                if (!sub.lastDynamicTime) sub.lastDynamicTime = 0;

                // 核心逻辑：ID 变化 且 时间比上次更新
                // 如果 lastId 为空（首次），直接更新状态不推送，或者根据需求推送
                // 这里逻辑：首次运行只记录状态，不推送（避免刷屏）
                if (sub.lastDynamicId || force) {
                    if (sub.lastDynamicId !== dynamicId || force) {
                        // 只有当新动态的时间 晚于 记录的时间时，才推送
                        // 这样可以防止：UP主删了最新动态，获取到的是旧动态（时间较早），从而避免重复推送旧动态
                        // force 模式下忽略时间检查
                        if (dynamicTime > sub.lastDynamicTime || force) {
                            logger.info(`[CheckDynamic] New dynamic detected, generating image...`);
                             // New dynamic found - get dynamic details and generate image
                            try {
                                // Optimization: Use the data directly from getUserDynamic since it now contains full modules
                                const dynamicDetail = {
                                    status: 'success',
                                    data: res.data
                                };

                                if (dynamicDetail.status === 'success') {
                                    logger.info(`[CheckDynamic] Generating preview card for dynamic ${dynamicId}...`);
                                    await this.notifyGroupsWithImage(sub.groupIds, dynamicDetail, 'dynamic', `https://t.bilibili.com/${dynamicId}`);
                                    logger.info(`[CheckDynamic] Notification sent successfully for dynamic ${dynamicId}`);
                                } else {
                                    logger.warn(`[CheckDynamic] Dynamic detail status not success, falling back to text`);
                                    // Fallback to text notification if image generation fails
                                    this.notifyGroups(sub.groupIds, `动态预览生成失败，已降级为文本链接：\nhttps://t.bilibili.com/${dynamicId}`);
                                }
                            } catch (e) {
                                logger.error(`[CheckDynamic] Error generating/sending image for dynamic ${dynamicId}:`, e);
                                logger.error(`[CheckDynamic] Error stack:`, e.stack);
                                // Fallback to text notification
                                this.notifyGroups(sub.groupIds, `动态预览生成失败，已降级为文本链接：\nhttps://t.bilibili.com/${dynamicId}`);
                            }
                        } else {
                            logger.info(`[CheckDynamic] Ignored old dynamic for ${sub.uid}: ID=${dynamicId}, Time=${dynamicTime} <= LastTime=${sub.lastDynamicTime}`);
                        }
                    } else {
                        logger.info(`[CheckDynamic] No new dynamic, ID unchanged: ${dynamicId}`);
                    }
                } else {
                    logger.info(`[CheckDynamic] First check for UID ${sub.uid}, recording state without notification`);
                }

                // 无论是否推送，只要获取到了最新的数据，就更新状态
                // 注意：如果是因为删动态导致回退到了旧动态，这里更新状态后：
                // lastId 变成了旧 ID，lastTime 变成了旧时间。
                // 下次如果 UP 主发了新动态，时间肯定比旧时间晚，能正常推送。
                if (!force) {
                    sub.lastDynamicId = dynamicId;
                    sub.lastDynamicTime = dynamicTime;
                    logger.info(`[CheckDynamic] Updated state: LastDynamicID=${sub.lastDynamicId}, LastDynamicTime=${sub.lastDynamicTime}`);
                }
            } else {
                logger.error(`[CheckDynamic] Failed to get dynamic for UID ${sub.uid}: status=${res.status}, message=${res.message || 'N/A'}`);
            }
        } catch (e) {
            logger.error(`[CheckDynamic] Exception while checking dynamic for UID ${sub.uid}:`, e);
            logger.error(`[CheckDynamic] Exception stack:`, e.stack);
        }
    }

    async checkSubscriptionNow(uid, groupId) {
        logger.info(`[CheckSubscriptionNow] Received request for UID/DynamicID: ${uid}, GroupID: ${groupId}`);

        // 首先尝试作为UID查找订阅
        let sub = this.userSubs.find(s => s.uid === uid);

        if (sub) {
            logger.info(`[CheckSubscriptionNow] Found subscription for UID ${uid}`);
            // 创建一个临时的 sub 对象，只包含当前请求的 groupId
            const tempSub = { ...sub, groupIds: [groupId] };
            await this.checkUserDynamic(tempSub, true); // force = true
            return true;
        } else {
            // 如果没找到订阅,可能传入的是动态ID而不是UID
            // 尝试直接获取动态详情
            logger.info(`[CheckSubscriptionNow] No subscription found for UID ${uid}, trying as dynamic ID...`);
            try {
                const biliApi = require('./biliApi');
                const res = await biliApi.getDynamicInfo(uid);
                logger.info(`[CheckSubscriptionNow] Dynamic detail API response status: ${res.status}`);

                if (res.status === 'success' && res.data) {
                    logger.info(`[CheckSubscriptionNow] Successfully fetched dynamic ${uid}, generating image...`);
                    
                    await this.notifyGroupsWithImage([groupId], res, 'dynamic', `动态详情: https://t.bilibili.com/${uid}`);
                    
                    logger.info(`[CheckSubscriptionNow] Successfully sent dynamic ${uid} to group`);
                    return true;
                } else {
                    logger.error(`[CheckSubscriptionNow] Failed to fetch dynamic ${uid}: status=${res.status}, message=${res.message || 'N/A'}`);
                    this.notifyGroups([groupId], `获取动态 ${uid} 失败: ${res.message || '未知错误'}`);
                    return false;
                }
            } catch (e) {
                logger.error(`[CheckSubscriptionNow] Exception while fetching dynamic ${uid}:`, e);
                logger.error(`[CheckSubscriptionNow] Exception stack:`, e.stack);
                this.notifyGroups([groupId], `获取动态 ${uid} 时出现错误: ${e.message}`);
                return false;
            }
        }
    }

    async checkUserLive(sub) {
        const res = await biliApi.getUserLive(sub.uid);
        if (res.status === 'success' && res.data) {
            const isLive = res.data.live_room?.live_status === 1;
            const roomId = res.data.live_room?.room_id;

            // Simple logic: if liveStatus is 1 and we haven't notified for this session...
            // But checking "session" is hard without storing start_time.
            // We can store 'lastStatus' instead of 'lastId' for live.
            // For now, let's treat lastId as 'isLive' boolean stored as string? Or just store state.

            const wasLive = sub.lastLiveStatus === '1';

            if (isLive && !wasLive && roomId) {
                try {
                    // Get live room details and generate image
                    const liveDetail = await biliApi.getLiveRoomInfo(roomId);
                    if (liveDetail.status === 'success') {
                        await this.notifyGroupsWithImage(sub.groupIds, liveDetail, 'live', `https://live.bilibili.com/${roomId}`);
                    } else {
                        // Fallback to text notification if image generation fails
                        this.notifyGroups(sub.groupIds, `直播预览生成失败，已降级为文本链接：\nhttps://live.bilibili.com/${roomId}`);
                    }
                } catch (e) {
                    logger.error(`Error generating image for live room ${roomId}:`, e);
                    // Fallback to text notification
                    this.notifyGroups(sub.groupIds, `直播预览生成失败，已降级为文本链接：\nhttps://live.bilibili.com/${roomId}`);
                }
            }

            sub.lastLiveStatus = isLive ? '1' : '0';
        }
    }

    async checkBangumi(sub) {
        const res = await biliApi.getBangumiInfo(sub.seasonId);
        if (res.status === 'success' && res.data) {
            const info = res.data;
            const newEp = info.new_ep || {};
            const epId = newEp.id;
            const epTitle = newEp.index_show || newEp.title || '';
            const isNew = newEp.is_new === 1;
            if (epId && (sub.lastEpId === null || sub.lastEpId !== epId)) {
                let updateEpoch = Date.now();
                try {
                    const epUrl = `https://www.bilibili.com/bangumi/play/ep${epId}`;
                    const updateTimeRaw = newEp.pub_time || newEp.release_time || info.publish?.pub_time || '';
                    let updateTimeStr = '';
                    if (updateTimeRaw) {
                        const safeStr = (updateTimeRaw + '').replace(' ', 'T');
                        const dt = new Date(safeStr);
                        if (!isNaN(dt.getTime())) {
                            updateTimeStr = dt.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
                            updateEpoch = dt.getTime();
                        }
                    }
                    if (!updateTimeStr) {
                        updateTimeStr = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
                    }
                    
                    // Use notifyGroupsWithImage to handle group-specific configs (dark mode, labels)
                    await this.notifyGroupsWithImage(sub.groupIds, { status: 'success', type: 'bangumi', data: info }, 'bangumi', epUrl);
                    
                } catch (e) {
                    logger.error(`[CheckBangumi] Error generating image for season ${sub.seasonId}:`, e);
                    this.notifyGroups(sub.groupIds, `番剧预览生成失败，已降级为文本链接：\nhttps://www.bilibili.com/bangumi/play/ep${epId}`);
                }
                sub.lastEpId = epId;
                sub.lastEpTime = updateEpoch;
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
                logger.info(`[SubscriptionService] Created temp directory: ${hostTempDir}`);
            }

            // 生成唯一的文件名
            const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 10)}.jpg`;
            const hostFilePath = path.join(hostTempDir, fileName); // 宿主机上的完整路径
            const containerFilePath = path.join(containerTempDir, fileName); // 容器内的路径

            // 将base64数据写入宿主机文件
            const imageBuffer = Buffer.from(base64Data, 'base64');

            // 检查图片大小（以MB为单位）
            const imageSizeMB = imageBuffer.length / (1024 * 1024);
            logger.info(`[SubscriptionService] Image size: ${imageSizeMB.toFixed(2)} MB`);

            // 如果图片超过10MB，记录警告
            if (imageSizeMB > 10) {
                logger.warn(`[SubscriptionService] Large image detected (${imageSizeMB.toFixed(2)} MB), may fail to send`);
            }

            fs.writeFileSync(hostFilePath, imageBuffer);
            logger.info(`[SubscriptionService] Saved image to: ${hostFilePath} (size: ${imageSizeMB.toFixed(2)} MB)`);

            // 返回容器内的路径，这样napcat可以访问
            return containerFilePath;
        } catch (e) {
            logger.error('[SubscriptionService] Error saving image file:', e);
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
            Buffer.from(cleaned, 'utf8');

            return cleaned;
        } catch (e) {
            logger.warn('[SubscriptionService] Text cleaning failed, using original:', e);
            return text;
        }
    }

    // 辅助函数：根据群组配置分组生成图片并发送
    async notifyGroupsWithImage(groupIds, data, type, textUrl) {
        if (!groupIds || groupIds.length === 0) return;

        // Group by config signature
        const groupsByConfig = new Map(); // Key: "night:T|F_label:T|F" -> [groupIds]

        for (const groupId of groupIds) {
            const isNight = imageGenerator.isNightMode(groupId);
            
            // Access label config logic (replicating logic from imageGenerator to key correctly)
            const labelConfig = config.getGroupConfig(groupId, 'labelConfig');
            
            // Replicate subtype logic from imageGenerator
            let subtype = type;
            if (type === 'bangumi' && data.data) {
                const st = data.data.season_type;
                if (st === 2) subtype = 'movie';
                else if (st === 3) subtype = 'doc';
                else if (st === 4) subtype = 'guocha';
                else if (st === 5) subtype = 'tv';
                else if (st === 7) subtype = 'variety';
            }
            
            const showLabel = (labelConfig && labelConfig[subtype] !== undefined) 
                ? labelConfig[subtype] 
                : (labelConfig && labelConfig[type] !== false);
            
            const showId = config.getGroupConfig(groupId, 'showId');
            
            const key = `night:${isNight}_label:${showLabel}_showId:${showId}`;
            
            if (!groupsByConfig.has(key)) {
                groupsByConfig.set(key, []);
            }
            groupsByConfig.get(key).push(groupId);
        }

        // Process each group
        for (const [key, targetGroupIds] of groupsByConfig) {
            try {
                // Use the first group as representative for generation
                const representativeGroupId = targetGroupIds[0];
                const showId = config.getGroupConfig(representativeGroupId, 'showId');
                
                // Generate image
                const base64Image = await imageGenerator.generatePreviewCard(data, type, representativeGroupId, showId);
                
                // Send
                this.notifyGroups(targetGroupIds, [
                    { type: 'image', data: { file: `base64://${base64Image}` } },
                    { type: 'text', data: { text: textUrl } }
                ]);
                
            } catch (e) {
                logger.error(`[SubscriptionService] Error generating image for groups [${targetGroupIds.join(', ')}]:`, e);
                // Fallback to text
                this.notifyGroups(targetGroupIds, `预览生成失败，已降级为文本链接：\n${textUrl}`);
            }
        }
    }

    notifyGroups(groupIds, message) {
        if (!this.ws) return;

        groupIds.forEach(gid => {
            try {
                let messageChain;

                // Check if message is an array (for mixed content like text + image)
                if (Array.isArray(message)) {
                    // 处理图片消息，将base64图片转换为文件路径
                    messageChain = message.map(item => {
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
                } else {
                    // If it's a string, wrap it in a text message object and clean it
                    messageChain = [{ type: 'text', data: { text: this.cleanText(message) } }];
                }

                const payload = {
                    action: 'send_group_msg',
                    params: {
                        group_id: gid,
                        message: messageChain
                    }
                };

                logger.info(`[SubscriptionService] Sending notification to group ${gid}`);
                this.ws.send(JSON.stringify(payload));
                logger.info(`[SubscriptionService] Notification sent successfully to group ${gid}`);
            } catch (e) {
                logger.error(`[SubscriptionService] Error sending notification to group ${gid}:`, e);
                logger.error(`[SubscriptionService] Error stack:`, e.stack);
            }
        });
    }
}

module.exports = new SubscriptionService();
