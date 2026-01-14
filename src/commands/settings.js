const config = require('../config');
const biliApi = require('../services/biliApi');
const QRCode = require('qrcode');
const logger = require('../utils/logger');
const notificationService = require('../services/notificationService');
const subscriptionService = require('../services/subscriptionService');
const imageGenerator = require('../services/imageGenerator');

class SettingsCommand {
    constructor() {
        // Login pending map: key -> groupId
        this.loginPending = new Map();
    }

    async pollLoginStatus(key, targetGroupId, ws, groupId) {
        const POLL_INTERVAL = 5000; // 5 seconds
        const MAX_DURATION = 30000; // 30 seconds
        const startTime = Date.now();

        const timer = setInterval(async () => {
            // Check if key is still pending (might be manually verified or cancelled)
            if (!this.loginPending.has(key)) {
                clearInterval(timer);
                return;
            }

            // Check timeout
            if (Date.now() - startTime > MAX_DURATION) {
                clearInterval(timer);
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `自动登录检测超时。如果您已扫码，请手动输入: /设置 验证 ${key}` } }]);
                return;
            }

            try {
                const res = await biliApi.checkLogin(key, targetGroupId);
                if (res.status === 'success') {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `登录成功！凭据已保存 (群: ${targetGroupId})。` } }]);
                    this.loginPending.delete(key);
                    clearInterval(timer);
                } else if (res.code === 86038) { // QRCode Expired
                     this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '二维码已过期，请重新获取。' } }]);
                     this.loginPending.delete(key);
                     clearInterval(timer);
                }
                // Other statuses (waiting for scan/confirm) -> continue polling
            } catch (e) {
                logger.error('[SettingsCommand] Polling error:', e);
            }
        }, POLL_INTERVAL);
    }

    async handle(context) {
        const { ws, groupId, userId, rawMessage } = context;

        // 统一指令入口：/设置
        if (rawMessage.startsWith('/设置 ')) {
             if (!config.isGroupAdmin(groupId, userId)) {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足：此命令仅限群管理员或全局管理员使用。' } }]);
                return true;
            }

            const parts = rawMessage.trim().split(/\s+/);
            const subCommand = parts[1]; // 帮助, 登录, 验证, 功能, 黑名单, 缓存, 轮询, 标签, 深色模式, etc.

            if (!subCommand) {
                 this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '请指定设置指令。发送 /设置 帮助 查看列表。' } }]);
                 return true;
            }

            // 1. 帮助菜单 (/设置 帮助)
            if (subCommand === '帮助') {
                try {
                    const base64Image = await imageGenerator.generateHelpCard('admin', groupId);
                    this.sendGroupMessage(ws, groupId, [{ type: 'image', data: { file: `base64://${base64Image}` } }]);
                } catch (e) {
                    logger.error('[SettingsCommand] Error generating admin help card:', e);
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: 'Admin menu generation failed.' } }]);
                }
                return true;
            }

            // New: 管理员 (/设置 管理员 <add|remove> <qq>)
            if (subCommand === '管理员') {
                if (!config.isRootAdmin(userId)) {
                     this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足：此命令仅限全局管理员 (Root) 使用。' } }]);
                     return true;
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
                return true;
            }

            // 2. 登录 (/设置 登录 [群号])
            if (subCommand === '登录') {
                let targetGroupId = parts[2];
                if (!targetGroupId) {
                    targetGroupId = groupId;
                }

                if (!targetGroupId) {
                     this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '请在群组中使用此命令或指定群号。' } }]);
                     return true;
                }

                // Permission check
                let allowed = false;
                if (config.isRootAdmin(userId)) {
                    allowed = true;
                } else if (config.isGroupAdmin(groupId, userId)) {
                    // Group Admin can only login for their current group
                    if (targetGroupId.toString() === groupId.toString()) {
                        allowed = true;
                    }
                }

                if (!allowed) {
                     this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足：群管理员只能登录当前群，Root可登录指定群。' } }]);
                     return true;
                }

                 try {
                    const res = await biliApi.getLoginUrl();
                    if (res.status === 'success') {
                        const url = res.data.url;
                        const key = res.data.key;
                        
                        // Store pending login
                        this.loginPending.set(key, targetGroupId);

                        const qrDataUrl = await QRCode.toDataURL(url);
                        const base64Image = qrDataUrl.replace(/^data:image\/png;base64,/, '');
                        this.sendGroupMessage(ws, groupId, [
                            { type: 'text', data: { text: `请在30秒内使用B站APP扫描登录 (目标群: ${targetGroupId})。\n机器人将自动检测登录状态，如超时请手动输入: /设置 验证 ${key}` } },
                            { type: 'image', data: { file: `base64://${base64Image}` } }
                        ]);

                        // Start polling
                        this.pollLoginStatus(key, targetGroupId, ws, groupId);
                    } else {
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '获取登录URL失败。' } }]);
                    }
                } catch (e) {
                    logger.error('[SettingsCommand] 登录错误:', e);
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '登录错误，请检查日志。' } }]);
                }
                return true;
            }

            // 3. 验证 (/设置 验证 <key>)
            if (subCommand === '验证') {
                const key = parts[2];
                if (!key) {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '请提供密钥: /设置 验证 <key>' } }]);
                    return true;
                }

                let targetGroupId = this.loginPending.get(key);
                if (!targetGroupId) {
                     // Try to infer from current context if user is admin, but safer to ask user to login again if key lost from memory (e.g. restart)
                     // However, if user just types it, let's assume current group if not found?
                     // No, "key" is tied to a session. If key is not in map, maybe it's invalid or bot restarted.
                     // But biliApi checkLogin relies on Bilibili side session, key is just an identifier.
                     // So if we lost map, we default to current groupId.
                     targetGroupId = groupId;
                }
                
                if (!targetGroupId) {
                     this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '无法确定目标群组，请重新获取登录二维码。' } }]);
                     return true;
                }

                // Permission check
                let allowed = false;
                if (config.isRootAdmin(userId)) {
                    allowed = true;
                } else if (config.isGroupAdmin(groupId, userId)) {
                    if (targetGroupId.toString() === groupId.toString()) {
                        allowed = true;
                    }
                }

                if (!allowed) {
                     this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足：您无法验证其他群组的登录。' } }]);
                     return true;
                }

                try {
                    const res = await biliApi.checkLogin(key, targetGroupId);
                    if (res.status === 'success') {
                         this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `登录成功！凭据已保存 (群: ${targetGroupId})。` } }]);
                         this.loginPending.delete(key);
                    } else {
                         this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `登录状态: ${res.message}` } }]);
                    }
                } catch (e) {
                     this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '检查登录状态时出错。' } }]);
                }
                return true;
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
                     return true;
                }
                
                // Only Root can change other groups' config? 
                // Spec: "Root Admin... manage all group configs". "Group Admin... adjust this group config".
                // Ensure type safety when comparing IDs
                if (targetGroupId.toString() !== groupId.toString() && !config.isRootAdmin(userId)) {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足：您只能管理当前群组的配置。' } }]);
                    return true;
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
                return true;
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
                    let msg = '【黑名单列表】\n';
                    
                    // Group Blacklist
                    if (groupId) {
                        const groupConfig = config.groupConfigs[groupId];
                        const groupBlacklist = (groupConfig && groupConfig.blacklistedQQs) ? groupConfig.blacklistedQQs : [];
                        msg += `\n[本群黑名单]\n${groupBlacklist.length > 0 ? groupBlacklist.join('\n') : '(空)'}\n`;
                    }

                    // Global Blacklist (Root only)
                    if (isRoot) {
                        const globalBlacklist = config.blacklistedQQs || [];
                        msg += `\n[全局黑名单]\n${globalBlacklist.length > 0 ? globalBlacklist.join('\n') : '(空)'}\n`;
                    }

                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: msg } }]);
                } else {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '使用方法: /设置 黑名单 <add|remove|list> [qq]' } }]);
                }
                return true;
            }

            // 6. 冷却 (/设置 冷却 <秒数>)
            if (subCommand === '冷却') {
                 const value = parseInt(parts[2]);
                 if (!isNaN(value)) {
                    if (groupId) {
                        if (!config.groupConfigs[groupId]) config.groupConfigs[groupId] = {};
                        config.groupConfigs[groupId].linkCacheTimeout = value;
                        config.save();
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `本群相同链接解析冷却时间已设置为 ${value} 秒。` } }]);
                    } else {
                        // Only Root can set Global
                        if (config.isRootAdmin(userId)) {
                            config.linkCacheTimeout = value;
                            config.save();
                            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `全局相同链接解析冷却时间已设置为 ${value} 秒。` } }]);
                        } else {
                             this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `权限不足：全局配置仅限全局管理员 (Root) 使用。` } }]);
                        }
                    }
                 } else {
                      this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '请输入有效的秒数。' } }]);
                 }
                 return true;
            }

            // 7. 轮询 (/设置 轮询 <秒数>)
            if (subCommand === '轮询') {
                if (!config.isRootAdmin(userId)) {
                     this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足：此命令仅限全局管理员 (Root) 使用。' } }]);
                     return true;
                }
                const value = parseInt(parts[2]);
                if (!isNaN(value)) {
                    subscriptionService.updateCheckInterval(value);
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `全局订阅轮询间隔已设置为 ${value} 秒。` } }]);
                } else {
                     this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '请输入有效的秒数。' } }]);
                }
                return true;
            }

            // 8. 关注同步 (/设置 关注同步 <开|关> 或 /设置 关注同步 <添加|删除> <B站分组名>)
            if (subCommand === '关注同步') {
                const action = parts[2];
                const groupName = parts[3]; 

                if (action === '开') {
                    config.setGroupConfig(groupId, 'enableCookieSync', true);
                    const currentGroups = config.getGroupConfig(groupId, 'cookieSyncGroupNames') || [];
                    
                    if (currentGroups.length === 0) {
                         this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '已开启关注同步功能。注意：当前未设置任何同步分组，请使用 /设置 关注同步 添加 <分组名> 来添加需要同步的分组。' } }]);
                    } else {
                         this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `已开启关注同步功能。当前生效分组：${currentGroups.join(', ')}。` } }]);
                    }
                    // Trigger refresh
                    subscriptionService.refreshCookieFollowings();

                } else if (action === '关') {
                    config.setGroupConfig(groupId, 'enableCookieSync', false);
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '已关闭关注同步功能。' } }]);

                } else if (action === '添加') {
                    if (!groupName) {
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '请指定要添加的分组名。' } }]);
                        return true;
                    }
                    const added = config.appendGroupConfigArray(groupId, 'cookieSyncGroupNames', groupName);
                    if (added) {
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `已添加同步分组：${groupName}。` } }]);
                        // Refresh if enabled
                        if (config.getGroupConfig(groupId, 'enableCookieSync')) {
                            subscriptionService.refreshCookieFollowings();
                        }
                    } else {
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `分组 ${groupName} 已存在。` } }]);
                    }

                } else if (action === '删除') {
                    if (!groupName) {
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '请指定要删除的分组名。' } }]);
                        return true;
                    }
                    const removed = config.removeGroupConfigArray(groupId, 'cookieSyncGroupNames', groupName);
                    if (removed) {
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `已移除同步分组：${groupName}。` } }]);
                         // Refresh if enabled
                        if (config.getGroupConfig(groupId, 'enableCookieSync')) {
                            subscriptionService.refreshCookieFollowings();
                        }
                    } else {
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `未找到分组 ${groupName}。` } }]);
                    }

                } else {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '使用方法:\n/设置 关注同步 <开|关>\n/设置 关注同步 <添加|删除> <B站分组名>' } }]);
                }
                return true;
            }

            // 9. 标签 (/设置 标签 <类型> <开|关>)
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
                 return true;
            }

            // 9. AI上下文 (/设置 AI上下文 <条数>)
            if (subCommand === 'AI上下文') {
                 if (!config.isRootAdmin(userId)) {
                     this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足：此命令仅限全局管理员 (Root) 使用。' } }]);
                     return true;
                }
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
                 return true;
            }
            
            // 10. AI概率 (/设置 AI概率 <数值>)
            if (subCommand === 'AI概率') {
                 if (!config.isRootAdmin(userId)) {
                     this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足：此命令仅限全局管理员 (Root) 使用。' } }]);
                     return true;
                 }
                 const value = parseFloat(parts[2]);
                 if (!isNaN(value) && value >= 0 && value <= 1) {
                     if (groupId) {
                        if (!config.groupConfigs[groupId]) config.groupConfigs[groupId] = {};
                        config.groupConfigs[groupId].aiProbability = value;
                        config.save();
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `本群 AI 随机回复概率已设置为 ${value} (${(value*100).toFixed(0)}%)。` } }]);
                     } else {
                        config.aiProbability = value;
                        config.save();
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `全局 AI 随机回复概率已设置为 ${value} (${(value*100).toFixed(0)}%)。` } }]);
                     }
                 } else {
                      this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '请输入有效的概率 (0.0 - 1.0)。' } }]);
                 }
                 return true;
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
                return true;
            }

            // 11. 显示UID (/设置 显示UID <开|关>)
            if (subCommand === '显示UID' || subCommand === 'UID') {
                 if (!config.isGroupAdmin(groupId, userId)) {
                     this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足：此命令仅限群管理员使用。' } }]);
                     return true;
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
                 return true;
            }

            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '未知设置指令。请发送 /设置 帮助 查看可用指令。' } }]);
            return true;
        }

        return false;
    }

    sendGroupMessage(ws, groupId, messageChain, userId = null) {
        if (typeof groupId === 'string' && groupId.startsWith('private_')) {
            const realUserId = groupId.replace('private_', '');
            notificationService.sendPrivateMessage(ws, realUserId, messageChain, 'SettingsCommand', true);
            return;
        }

        if (groupId) {
            notificationService.sendGroupMessage(ws, groupId, messageChain, 'SettingsCommand', true);
        } else if (userId) {
            notificationService.sendPrivateMessage(ws, userId, messageChain, 'SettingsCommand', true);
        } else {
            logger.warn('[SettingsCommand] Cannot send message: no groupId or userId provided');
        }
    }
}

module.exports = new SettingsCommand();
