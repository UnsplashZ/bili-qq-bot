const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const config = require('../config');

/**
 * NotificationService - 统一的消息发送服务
 * 提供共享的消息发送逻辑，支持文本、图片等多种消息类型
 */
class NotificationService {
    /**
     * 保存Base64图片为文件
     * @param {string} base64Data - Base64编码的图片数据
     * @param {string} logPrefix - 日志前缀，用于标识调用来源
     * @returns {string} - 返回容器内的文件路径
     */
    static saveImageAsFile(base64Data, logPrefix = 'NotificationService') {
        try {
            // 使用共享目录，确保npm运行的bot和docker运行的napcat都能访问
            const hostTempDir = config.napcatTempPath; // Bot 写入的路径 (容器内或宿主机)
            const containerTempDir = config.napcatReadPath; // NapCat 读取的路径 (NapCat 容器内)

            // 确保目录存在
            if (!fs.existsSync(hostTempDir)) {
                fs.mkdirSync(hostTempDir, { recursive: true });
                logger.info(`[${logPrefix}] Created temp directory: ${hostTempDir}`);
            }

            // 生成唯一的文件名
            const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 10)}.png`;
            const hostFilePath = path.join(hostTempDir, fileName); // 宿主机上的完整路径
            const containerFilePath = path.join(containerTempDir, fileName); // 容器内的路径

            // 将base64数据写入宿主机文件
            const imageBuffer = Buffer.from(base64Data, 'base64');

            // 检查图片大小（以MB为单位）
            const imageSizeMB = imageBuffer.length / (1024 * 1024);
            logger.info(`[${logPrefix}] Image size: ${imageSizeMB.toFixed(2)} MB`);

            // 如果图片超过10MB，记录警告
            if (imageSizeMB > 10) {
                logger.warn(`[${logPrefix}] Large image detected (${imageSizeMB.toFixed(2)} MB), may fail to send`);
            }

            fs.writeFileSync(hostFilePath, imageBuffer);
            logger.info(`[${logPrefix}] Saved image to: ${hostFilePath} (size: ${imageSizeMB.toFixed(2)} MB)`);

            // 返回容器内的路径，这样napcat可以访问
            return containerFilePath;
        } catch (e) {
            logger.error(`[${logPrefix}] Error saving image file:`, e);
            throw e;
        }
    }

    /**
     * 清理文本，移除可能导致编码问题的字符
     * @param {string} text - 待清理的文本
     * @returns {string} - 清理后的文本
     */
    static cleanText(text) {
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
            logger.warn('[NotificationService] Text cleaning failed, using original:', e);
            return text;
        }
    }

    /**
     * 处理消息链，处理图片等资源
     * @param {Array|string} message - 消息内容
     * @param {string} logPrefix - 日志前缀
     * @returns {Array} - 处理后的消息链
     */
    static processMessageChain(message, logPrefix) {
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
                    const imagePath = this.saveImageAsFile(base64Data, logPrefix);
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
        return messageChain;
    }

    /**
     * 发送群组消息
     * @param {WebSocket} ws - WebSocket连接实例
     * @param {string|number} groupId - 群组ID
     * @param {Array|string} message - 消息内容，可以是消息链数组或纯文本字符串
     * @param {string} logPrefix - 日志前缀，用于标识调用来源
     * @param {boolean} enableFallback - 是否启用失败回退（发送错误通知），默认为true
     */
    static sendGroupMessage(ws, groupId, message, logPrefix = 'NotificationService', enableFallback = true) {
        if (!ws) {
            logger.warn(`[${logPrefix}] WebSocket is not available, cannot send message`);
            return;
        }

        try {
            const messageChain = this.processMessageChain(message, logPrefix);

            const payload = {
                action: 'send_group_msg',
                params: {
                    group_id: groupId,
                    message: messageChain
                }
            };

            logger.info(`[${logPrefix}] Sending message to group ${groupId}, chain length: ${messageChain.length}`);
            logger.debug(`[${logPrefix}] Sending payload:`, JSON.stringify(payload, null, 2).substring(0, 500));

            ws.send(JSON.stringify(payload));
            logger.info(`[${logPrefix}] Message sent successfully to group ${groupId}`);
        } catch (e) {
            logger.error(`[${logPrefix}] Error sending group message:`, e);
            logger.error(`[${logPrefix}] Error stack:`, e.stack);
            logger.error(`[${logPrefix}] Failed message:`, JSON.stringify(message, null, 2).substring(0, 500));

            // 尝试发送简化的错误通知（仅在启用fallback时）
            if (enableFallback) {
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
                    logger.error(`[${logPrefix}] Failed to send fallback error message:`, fallbackError);
                }
            }
        }
    }

    /**
     * 发送私聊消息
     * @param {WebSocket} ws - WebSocket连接实例
     * @param {string|number} userId - 用户ID
     * @param {Array|string} message - 消息内容
     * @param {string} logPrefix - 日志前缀
     * @param {boolean} enableFallback - 是否启用失败回退
     */
    static sendPrivateMessage(ws, userId, message, logPrefix = 'NotificationService', enableFallback = true) {
        if (!ws) {
            logger.warn(`[${logPrefix}] WebSocket is not available, cannot send message`);
            return;
        }

        try {
            const messageChain = this.processMessageChain(message, logPrefix);

            const payload = {
                action: 'send_private_msg',
                params: {
                    user_id: userId,
                    message: messageChain
                }
            };

            logger.info(`[${logPrefix}] Sending private message to user ${userId}, chain length: ${messageChain.length}`);
            logger.debug(`[${logPrefix}] Sending payload:`, JSON.stringify(payload, null, 2).substring(0, 500));

            ws.send(JSON.stringify(payload));
            logger.info(`[${logPrefix}] Private message sent successfully to user ${userId}`);
        } catch (e) {
            logger.error(`[${logPrefix}] Error sending private message:`, e);
            logger.error(`[${logPrefix}] Error stack:`, e.stack);
            
            if (enableFallback) {
                try {
                    const fallbackPayload = {
                        action: 'send_private_msg',
                        params: {
                            user_id: userId,
                            message: [{ type: 'text', data: { text: '消息发送失败，请查看日志' } }]
                        }
                    };
                    ws.send(JSON.stringify(fallbackPayload));
                } catch (fallbackError) {
                    logger.error(`[${logPrefix}] Failed to send fallback error message:`, fallbackError);
                }
            }
        }
    }

    /**
     * 批量发送群组消息
     * @param {WebSocket} ws - WebSocket连接实例
     * @param {Array<string|number>} groupIds - 群组ID数组
     * @param {Array|string} message - 消息内容，可以是消息链数组或纯文本字符串
     * @param {string} logPrefix - 日志前缀，用于标识调用来源
     */
    static notifyGroups(ws, groupIds, message, logPrefix = 'NotificationService') {
        if (!ws) {
            logger.warn(`[${logPrefix}] WebSocket is not available, cannot send messages`);
            return;
        }

        if (!Array.isArray(groupIds) || groupIds.length === 0) {
            logger.warn(`[${logPrefix}] No group IDs provided for notification`);
            return;
        }

        groupIds.forEach(gid => {
            // 调用单个消息发送方法，禁用fallback以避免在批量通知时发送过多错误消息
            this.sendGroupMessage(ws, gid, message, logPrefix, false);
        });
    }
}

module.exports = NotificationService;
