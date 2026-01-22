const express = require('express');
const path = require('path');
const logger = require('../utils/logger');
const authMiddleware = require('./middleware/auth');
const groupsRouter = require('./routes/groups');
const subscriptionsRouter = require('./routes/subscriptions');
const configRouter = require('./routes/config');
const bilibiliRouter = require('./routes/bilibili');
const biliApi = require('../services/biliApi');

class WebUIServer {
  constructor(config) {
    this.config = config;
    this.app = express();
    this.server = null;

    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    // 解析 JSON
    this.app.use(express.json());

    // 静态文件服务
    this.app.use(express.static(path.join(__dirname, 'public')));

    // Basic Auth 认证
    this.app.use(authMiddleware(this.config));

    // 日志中间件
    this.app.use((req, res, next) => {
      logger.info(`[WebUI] ${req.method} ${req.path}`);
      next();
    });
  }

  setupRoutes() {
    // API 路由
    this.app.use('/api/groups', groupsRouter);
    this.app.use('/api/subscriptions', subscriptionsRouter);
    this.app.use('/api/config', configRouter);
    this.app.use('/api/bilibili', bilibiliRouter);

    // SPA fallback - 对于非 API 路由，返回 index.html
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    // 错误处理
    this.app.use((err, req, res, next) => {
      logger.error('[WebUI] Error:', err);
      res.status(500).json({
        success: false,
        message: err.message || 'Internal Server Error'
      });
    });
  }

  async start() {
    const host = this.config.webuiHost || '127.0.0.1';
    const port = this.config.webuiPort || 3100;

    try {
      // 启动 FastAPI 服务
      await biliApi.startFastAPIService();
    } catch (error) {
      logger.error('[WebUI] Failed to start FastAPI service:', error);
      process.exit(1);
    }

    this.server = this.app.listen(port, host, () => {
      logger.info(`[WebUI] Server started on http://${host}:${port}`);
    });

    // 优雅关闭
    const shutdown = () => this.stop();
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  }

  stop() {
    if (this.server) {
      this.server.close(() => {
        logger.info('[WebUI] Server stopped');
      });
    }

    // 停止 Python 进程
    if (biliApi.pythonProcess) {
      logger.info('[WebUI] Stopping FastAPI service...');
      biliApi.pythonProcess.kill();
    }
  }
}

module.exports = WebUIServer;
