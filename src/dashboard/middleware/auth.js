const jwt = require('jsonwebtoken');
const config = require('../../config');
const logger = require('../../utils/logger');
const {
    canonicalHttpOrigin,
    validateDashboardAllowedOrigins
} = require('../../config/validator');

function canonicalOrigin(value) {
    return canonicalHttpOrigin(value);
}

function configuredAllowedOrigins() {
    const listenPort = config.dashboardPort || 3000;
    const defaults = [
        `http://localhost:${listenPort}`,
        `http://127.0.0.1:${listenPort}`
    ];
    const configured = validateDashboardAllowedOrigins(
        Array.isArray(config.dashboardAllowedOrigins) ? config.dashboardAllowedOrigins : []
    );
    return new Set([...defaults, ...configured]);
}

function canonicalRequestOrigin(req) {
    const rawHost = req.headers.host;
    if (typeof rawHost !== 'string' || rawHost.length === 0 || rawHost.length > 255 ||
        rawHost.trim() !== rawHost ||
        !/^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?|\[[0-9A-Fa-f:.]+\])(?::[1-9][0-9]{0,4})?$/u.test(rawHost)) {
        return null;
    }
    const protocol = req.socket?.encrypted ? 'https:' : 'http:';
    try {
        const url = new URL(`${protocol}//${rawHost}`);
        if (url.protocol !== protocol || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
            return null;
        }
        if (!url.hostname || (url.port && Number(url.port) > 65535)) return null;
        return url.origin;
    } catch {
        return null;
    }
}

function requestSourceOrigin(value) {
    if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) return null;
    try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
        return url.origin;
    } catch {
        return null;
    }
}

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

    if (token == null) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    jwt.verify(token, config.jwtSecret, (err, user) => {
        if (err) {
            logger.logEvent('warn', 'AUTH', req.logScope || '', 'token-invalid', {
                ip: req.ip
            });
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
    const originHeader = req.headers.origin;
    const origin = originHeader || req.headers.referer;
    if (origin) {
        const sourceOrigin = originHeader ? canonicalOrigin(origin) : requestSourceOrigin(origin);
        const requestOrigin = canonicalRequestOrigin(req);
        if (!sourceOrigin) {
            logger.logEvent('warn', 'AUTH', req.logScope || '', 'csrf-invalid-origin', {
                origin
            });
            return res.status(403).json({ error: 'CSRF validation failed: Invalid origin header' });
        }
        if (sourceOrigin !== requestOrigin && !configuredAllowedOrigins().has(sourceOrigin)) {
            logger.logEvent('warn', 'AUTH', req.logScope || '', 'csrf-rejected', {
                origin: sourceOrigin
            });
            return res.status(403).json({
                error: 'CSRF validation failed: Invalid origin',
                message: 'Access requires the request Host origin or an exact URL origin in config/config.yaml dashboard.allowedOrigins.',
                origin: sourceOrigin
            });
        }
    }

    // 2. 对于已认证的请求，确保token在Authorization头中（不是cookie）
    // 这防止CSRF攻击，因为恶意网站无法读取和设置Authorization头
    if (req.headers.authorization) {
        // Token在Authorization头中，通过CSRF检查
        logger.logEvent('debug', 'AUTH', req.logScope || '', 'csrf-passed', {
            method: req.method,
            path: req.path
        });
        return next();
    }

    // 如果没有Authorization头但需要认证，后续的authenticateToken会拒绝
    next();
}

module.exports = authenticateToken;
module.exports.csrfProtection = csrfProtection;
module.exports.canonicalOrigin = canonicalOrigin;
module.exports.configuredAllowedOrigins = configuredAllowedOrigins;
module.exports.canonicalRequestOrigin = canonicalRequestOrigin;
