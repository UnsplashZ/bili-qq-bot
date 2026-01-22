const logger = require('../../utils/logger');

function authMiddleware(config) {
  const username = config.webuiUsername || 'root';
  const password = config.webuiPassword;

  if (!password) {
    logger.warn('[WebUI] WEBUI_PASSWORD not set, authentication disabled!');
    return (req, res, next) => next();
  }

  return (req, res, next) => {
    // 跳过静态资源
    if (req.path.startsWith('/css') || req.path.startsWith('/js') || req.path.startsWith('/lib')) {
      return next();
    }

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Basic ')) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Bili QQ Bot WebUI"');
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const credentials = Buffer.from(authHeader.substring(6), 'base64').toString();
    const [user, pass] = credentials.split(':');

    if (user !== username || pass !== password) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    next();
  };
}

module.exports = authMiddleware;
