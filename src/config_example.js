
export default {
  // NapCat WebSocket 配置
  napcat: {
    host: 'localhost',
    port: 3001, // NapCat 的 WebSocket 端口
    reconnectInterval: 5000 // 重连间隔(毫秒)
  },

  // 机器人配置
  bot: {
    qq: '你的机器人QQ号', // 机器人的 QQ 号
    // AI 触发配置
    ai: {
      // @触发
      atTrigger: true,
      // 随机触发概率 (0-1)
      randomTriggerProbability: 0.1, // 10% 概率触发
      // 自定义 AI API 配置
      apiUrl: 'http://your-api-endpoint.com/chat',
      apiKey: 'your-api-key', // 如果需要
      // API 请求配置
      timeout: 30000,
      model: 'gpt-3.5-turbo' // 根据你的 API 调整
    },
    // 管理员 QQ 列表
    admins: ['管理员QQ1', '管理员QQ2']
  },

  // B站配置
  bilibili: {
    // B站 Cookie (用于获取部分需要登录的信息)
    cookie: 'your_bilibili_cookie',
    // 请求头
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://www.bilibili.com'
    },
    // API 配置
    api: {
      videoInfo: 'https://api.bilibili.com/x/web-interface/view',
      dynamicInfo: 'https://api.bilibili.com/x/polymer/web-dynamic/v1/detail',
      userInfo: 'https://api.bilibili.com/x/space/acc/info',
      articleInfo: 'https://api.bilibili.com/x/article/viewinfo'
    }
  },

  // 图片生成配置
  image: {
    // Puppeteer 配置
    puppeteer: {
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ]
    },
    // 图片输出配置
    output: {
      path: './temp',
      format: 'png',
      quality: 90
    }
  },

  // 日志配置
  logging: {
    level: 'info', // debug, info, warn, error
    saveToFile: true,
    logPath: './logs'
  }
};