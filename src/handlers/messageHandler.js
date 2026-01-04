import config from '../config.js';
import BiliHandler from './biliHandler.js';
import AIHandler from './aiHandler.js';
import URLParser from '../utils/urlParser.js';
import Logger from '../utils/logger.js';

export default class MessageHandler {
  constructor() {
    this.biliHandler = new BiliHandler();
    this.aiHandler = new AIHandler();
    this.urlParser = new URLParser();
    this.logger = new Logger();
  }

  async handle(message, bot) {
    const { group_id, user_id, raw_message, message: msgArray } = message;
    
    // 1. 检查是否包含 B站 链接/小程序
    const biliContent = this.extractBiliContent(raw_message, msgArray);
    if (biliContent) {
      await this.handleBiliContent(biliContent, group_id, bot);
      return;
    }

    // 2. 检查是否触发 AI 回复
    const shouldTriggerAI = this.shouldTriggerAI(message);
    if (shouldTriggerAI) {
      await this.handleAIReply(message, bot);
      return;
    }
  }

  // 提取B站内容
  extractBiliContent(rawMessage, msgArray) {
    // 检查普通链接
    const urlMatch = this.urlParser.extractBiliUrl(rawMessage);
    if (urlMatch) {
      return {
        type: 'url',
        data: urlMatch
      };
    }

    // 检查小程序 (QQ小程序的JSON格式)
    for (const msg of msgArray) {
      if (msg.type === 'json') {
        try {
          const jsonData = JSON.parse(msg.data.data);
          if (jsonData.meta?.detail_1?.qqdocurl?.includes('bilibili.com')) {
            return {
              type: 'miniapp',
              data: this.urlParser.extractBiliUrlFromMiniApp(jsonData)
            };
          }
        } catch (e) {
          this.logger.debug('解析小程序JSON失败:', e);
        }
      }
    }

    return null;
  }

  // 处理B站内容
  async handleBiliContent(biliContent, groupId, bot) {
    try {
      this.logger.info(`检测到B站内容: ${biliContent.data.type} - ${biliContent.data.id}`);
      
      // 生成图片
      const result = await this.biliHandler.process(biliContent.data);
      
      if (result.success) {
        // 发送图片和原始链接
        const text = `检测到B站内容:\n${result.url}`;
        await bot.sendGroupMixedMessage(groupId, text, result.imagePath);
        
        this.logger.info(`成功发送B站内容卡片到群 ${groupId}`);
      } else {
        await bot.sendGroupMessage(groupId, `解析B站内容失败: ${result.error}`);
      }
    } catch (error) {
      this.logger.error('处理B站内容失败:', error);
      await bot.sendGroupMessage(groupId, '处理B站内容时出现错误');
    }
  }

  // 判断是否触发AI回复
  shouldTriggerAI(message) {
    const { raw_message, message: msgArray } = message;
    const aiConfig = config.bot.ai;

    // 检查是否被@
    if (aiConfig.atTrigger) {
      const hasAt = msgArray.some(msg => 
        msg.type === 'at' && msg.data.qq === config.bot.qq
      );
      if (hasAt) {
        return true;
      }
    }

    // 随机触发
    if (aiConfig.randomTriggerProbability > 0) {
      const random = Math.random();
      if (random < aiConfig.randomTriggerProbability) {
        this.logger.debug(`随机触发AI (概率: ${random.toFixed(3)})`);
        return true;
      }
    }

    return false;
  }

  // 处理AI回复
  async handleAIReply(message, bot) {
    const { group_id, user_id, raw_message } = message;
    
    try {
      // 清理消息(移除@等)
      const cleanMessage = this.cleanMessage(raw_message);
      
      this.logger.info(`触发AI回复 - 群: ${group_id}, 用户: ${user_id}, 消息: ${cleanMessage}`);
      
      // 调用AI API
      const aiResponse = await this.aiHandler.getResponse(cleanMessage, {
        userId: user_id,
        groupId: group_id
      });

      if (aiResponse) {
        await bot.sendGroupMessage(group_id, aiResponse);
        this.logger.info(`AI回复成功`);
      }
    } catch (error) {
      this.logger.error('AI回复失败:', error);
    }
  }

  // 清理消息内容
  cleanMessage(rawMessage) {
    // 移除@信息
    return rawMessage
      .replace(/\[CQ:at,qq=\d+\]/g, '')
      .replace(/@\S+/g, '')
      .trim();
  }
}