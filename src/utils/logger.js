import fs from 'fs';
import path from 'path';
import config from '../config.js';

export default class Logger {
  constructor() {
    this.level = config.logging.level || 'info';
    this.saveToFile = config.logging.saveToFile || false;
    this.logPath = config.logging.logPath || './logs';

    this.levels = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3
    };

    if (this.saveToFile) {
      this.ensureLogDirectory();
    }
  }

  ensureLogDirectory() {
    if (!fs.existsSync(this.logPath)) {
      fs.mkdirSync(this.logPath, { recursive: true });
    }
  }

  shouldLog(level) {
    return this.levels[level] >= this.levels[this.level];
  }

  formatMessage(level, message, data) {
    const timestamp = new Date().toLocaleString('zh-CN');
    const levelStr = level.toUpperCase().padEnd(5);
    let msg = `[${timestamp}] [${levelStr}] ${message}`;
    
    if (data) {
      if (typeof data === 'object') {
        msg += '\n' + JSON.stringify(data, null, 2);
      } else {
        msg += ' ' + data;
      }
    }
    
    return msg;
  }

  getColorCode(level) {
    const colors = {
      debug: '\x1b[36m', // 青色
      info: '\x1b[32m',  // 绿色
      warn: '\x1b[33m',  // 黄色
      error: '\x1b[31m'  // 红色
    };
    return colors[level] || '';
  }

  log(level, message, data) {
    if (!this.shouldLog(level)) return;

    const formattedMsg = this.formatMessage(level, message, data);
    const colorCode = this.getColorCode(level);
    const resetCode = '\x1b[0m';

    // 控制台输出(带颜色)
    console.log(`${colorCode}${formattedMsg}${resetCode}`);

    // 文件输出(不带颜色)
    if (this.saveToFile) {
      this.writeToFile(formattedMsg);
    }
  }

  writeToFile(message) {
    try {
      const date = new Date().toISOString().split('T')[0];
      const filename = `bot-${date}.log`;
      const filepath = path.join(this.logPath, filename);
      
      fs.appendFileSync(filepath, message + '\n', 'utf8');
    } catch (error) {
      console.error('写入日志文件失败:', error);
    }
  }

  debug(message, data) {
    this.log('debug', message, data);
  }

  info(message, data) {
    this.log('info', message, data);
  }

  warn(message, data) {
    this.log('warn', message, data);
  }

  error(message, data) {
    this.log('error', message, data);
  }
}