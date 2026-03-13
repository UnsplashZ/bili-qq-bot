const logger = require('../../../../utils/logger')

function getRequestScope(req) {
    return req && req.logScope ? req.logScope : ''
}

function dashLog(req, level, message, fields = {}) {
    logger.logEvent(level, 'DASH', getRequestScope(req), message, fields)
}

function authLog(req, level, message, fields = {}) {
    logger.logEvent(level, 'AUTH', getRequestScope(req), message, fields)
}

function storeLog(scopeName, level, message, fields = {}) {
    logger.logEvent(level, 'STORE', logger.createScope('svc', scopeName), message, fields)
}

module.exports = {
    dashLog,
    authLog,
    storeLog,
    getRequestScope
}
