const jwt = require('jsonwebtoken');
const config = require('../../config');
const logger = require('../../utils/logger');

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

    if (token == null) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    jwt.verify(token, config.jwtSecret, (err, user) => {
        if (err) {
            logger.warn(`Invalid token attempt from ${req.ip}`);
            return res.status(401).json({ error: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
}

// 🆕 P2-2: CSRF保护中间件（简化版，适用于内网）
function csrfProtection(req, res, next) {
    // 仅对修改操作进行CSRF检查
    const modifyingMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];
    if (!modifyingMethods.includes(req.method)) {
        return next();
    }

    // 1. 验证请求来源（Origin或Referer）
    const origin = req.headers.origin || req.headers.referer;
    if (origin) {
        const allowedOrigins = [
            'http://localhost:3000',
            'http://127.0.0.1:3000',
            `http://localhost:${config.dashboardPort || 3000}`,
            `http://127.0.0.1:${config.dashboardPort || 3000}`
        ];

        const originUrl = new URL(origin);
        const isAllowed = allowedOrigins.some(allowed => {
            const allowedUrl = new URL(allowed);
            return originUrl.origin === allowedUrl.origin;
        });

        if (!isAllowed) {
            logger.warn(`[Security] CSRF: Rejected request from unauthorized origin: ${origin}`);
            return res.status(403).json({ error: 'CSRF validation failed: Invalid origin' });
        }
    }

    // 2. 对于已认证的请求，确保token在Authorization头中（不是cookie）
    // 这防止CSRF攻击，因为恶意网站无法读取和设置Authorization头
    if (req.headers.authorization) {
        // Token在Authorization头中，通过CSRF检查
        logger.debug(`[Security] CSRF check passed for ${req.method} ${req.path}`);
        return next();
    }

    // 如果没有Authorization头但需要认证，后续的authenticateToken会拒绝
    next();
}

module.exports = authenticateToken;
module.exports.csrfProtection = csrfProtection;
