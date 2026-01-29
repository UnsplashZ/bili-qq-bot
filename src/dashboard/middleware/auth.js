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

module.exports = authenticateToken;
