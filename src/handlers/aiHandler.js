import axios from 'axios';
import config from '../config.js';
import Logger from '../utils/logger.js';

export default class AIHandler {
  constructor() {
    this.logger = new Logger();
    this.conversationHistory = new Map(); // 存储会话历史
  }

  async getResponse(message, context) {
    const { userId, groupId } = context;
    const aiConfig = config.bot.ai;

    try {
      // 构建请求数据 - 根据你的API格式调整
      const requestData = {
        model: aiConfig.model,
        messages: [
          {
            role: 'user',
            content: message
          }
        ],
        // 如果需要会话历史
        // messages: this.getConversationHistory(groupId, message),
        max_tokens: 1000,
        temperature: 0.7
      };

      // 添加API Key (如果需要)
      const headers = {
        'Content-Type': 'application/json'
      };
      if (aiConfig.apiKey) {
        headers['Authorization'] = `Bearer ${aiConfig.apiKey}`;
      }

      this.logger.debug('调用AI API:', {
        url: aiConfig.apiUrl,
        message: message.substring(0, 50) + '...'
      });

      // 调用AI API
      const response = await axios.post(aiConfig.apiUrl, requestData, {
        headers,
        timeout: aiConfig.timeout
      });

      // 解析响应 - 根据你的API响应格式调整
      let aiResponse;
      
      // OpenAI 格式
      if (response.data.choices && response.data.choices.length > 0) {
        aiResponse = response.data.choices[0].message.content;
      }
      // 其他常见格式
      else if (response.data.response) {
        aiResponse = response.data.response;
      } else if (response.data.reply) {
        aiResponse = response.data.reply;
      } else if (response.data.content) {
        aiResponse = response.data.content;
      } else {
        throw new Error('无法解析AI响应格式');
      }

      // 保存会话历史(可选)
      // this.saveConversationHistory(groupId, message, aiResponse);

      return aiResponse;
    } catch (error) {
      this.logger.error('AI API调用失败:', error.message);
      
      // 根据错误类型返回不同提示
      if (error.code === 'ECONNABORTED') {
        return '抱歉,AI响应超时了,请稍后再试~';
      } else if (error.response?.status === 429) {
        return '请求过于频繁,请稍后再试~';
      } else if (error.response?.status === 401) {
        this.logger.error('API Key 无效或已过期');
        return null;
      } else {
        return '抱歉,我现在有点累了,等会再聊吧~';
      }
    }
  }

  // 获取会话历史(可选功能)
  getConversationHistory(groupId, newMessage) {
    const history = this.conversationHistory.get(groupId) || [];
    
    // 添加新消息
    const messages = [
      ...history,
      {
        role: 'user',
        content: newMessage
      }
    ];

    // 限制历史长度(例如最多保留10条)
    if (messages.length > 10) {
      return messages.slice(-10);
    }

    return messages;
  }

  // 保存会话历史(可选功能)
  saveConversationHistory(groupId, userMessage, aiResponse) {
    const history = this.conversationHistory.get(groupId) || [];
    
    history.push(
      {
        role: 'user',
        content: userMessage
      },
      {
        role: 'assistant',
        content: aiResponse
      }
    );

    // 限制历史长度
    if (history.length > 20) {
      history.splice(0, history.length - 20);
    }

    this.conversationHistory.set(groupId, history);
  }

  // 清除会话历史
  clearConversationHistory(groupId) {
    this.conversationHistory.delete(groupId);
  }
}