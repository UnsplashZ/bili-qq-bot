import WebSocket from 'ws';
import config from './config.js';
import MessageHandler from './handlers/messageHandler.js';
import Logger from './utils/logger.js';
import fs from 'fs';
import path from 'path';

class NapCatBot {
  constructor() {
    this.ws = null;
    this.messageHandler = new MessageHandler();
    this.logger = new Logger();
    this.reconnectTimer = null;
    this.isConnected = false;
    
    // 确保必要的目录存在
    this.ensureDirectories();
  }

  ensureDirectories() {
    const dirs = [
      config.image.output.path,
      config.logging.logPath
    ];
    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  connect() {
    const wsUrl = `ws://${config.napcat.host}:${config.napcat.port}`;
    this.logger.info(`正在连接到 NapCat: ${wsUrl}`);

    try {
      this.ws = new WebSocket(wsUrl);
      this.setupEventHandlers();
    } catch (error) {
      this.logger.error('WebSocket 连接失败:', error);
      this.scheduleReconnect();
    }
  }

  setupEventHandlers() {
    this.ws.on('open', () => {
      this.isConnected = true;
      this.logger.info('✅ 成功连接到 NapCat');
      
      // 清除重连定时器
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
    });

    this.ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        await this.handleMessage(message);
      } catch (error) {
        this.logger.error('消息处理错误:', error);
      }
    });

    this.ws.on('close', () => {
      this.isConnected = false;
      this.logger.warn('❌ NapCat 连接已断开');
      this.scheduleReconnect();
    });

    this.ws.on('error', (error) => {
      this.logger.error('WebSocket 错误:', error);
    });
  }

  async handleMessage(message) {
    // 过滤心跳消息
    if (message.meta_event_type === 'heartbeat') {
      return;
    }

    // 只处理群消息
    if (message.post_type === 'message' && message.message_type === 'group') {
      this.logger.debug('收到群消息:', {
        group_id: message.group_id,
        user_id: message.user_id,
        message: message.raw_message
      });

      // 交给消息处理器处理
      await this.messageHandler.handle(message, this);
    }
  }

  // 发送群消息
  async sendGroupMessage(groupId, message, autoEscape = false) {
    if (!this.isConnected) {
      this.logger.error('发送消息失败: 未连接到 NapCat');
      return false;
    }

    const payload = {
      action: 'send_group_msg',
      params: {
        group_id: groupId,
        message: message,
        auto_escape: autoEscape
      },
      echo: Date.now()
    };

    try {
      this.ws.send(JSON.stringify(payload));
      this.logger.info(`发送群消息到 ${groupId}`);
      return true;
    } catch (error) {
      this.logger.error('发送消息失败:', error);
      return false;
    }
  }

  // 发送图片消息
  async sendGroupImage(groupId, imagePath) {
    const imageUrl = `file:///${path.resolve(imagePath)}`;
    const message = [
      {
        type: 'image',
        data: {
          file: imageUrl
        }
      }
    ];
    return await this.sendGroupMessage(groupId, message);
  }

  // 发送混合消息(文字+图片)
  async sendGroupMixedMessage(groupId, text, imagePath) {
    const imageUrl = `file:///${path.resolve(imagePath)}`;
    const message = [
      {
        type: 'text',
        data: {
          text: text
        }
      },
      {
        type: 'image',
        data: {
          file: imageUrl
        }
      }
    ];
    return await this.sendGroupMessage(groupId, message);
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;

    this.logger.info(`${config.napcat.reconnectInterval / 1000} 秒后尝试重连...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, config.napcat.reconnectInterval);
  }

  start() {
    this.logger.info('🚀 NapCat Bot 启动中...');
    this.logger.info(`配置信息:
      - NapCat: ${config.napcat.host}:${config.napcat.port}
      - 机器人QQ: ${config.bot.qq}
      - AI随机触发概率: ${config.bot.ai.randomTriggerProbability * 100}%
    `);
    
    this.connect();

    // 处理退出信号
    process.on('SIGINT', () => {
      this.logger.info('正在关闭机器人...');
      if (this.ws) {
        this.ws.close();
      }
      process.exit(0);
    });
  }
}

// 启动机器人
const bot = new NapCatBot();
bot.start();