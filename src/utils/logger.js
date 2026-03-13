const log4js = require('log4js');

const listeners = new Set();
const LEVEL_LABELS = {
    trace: 'TRC',
    debug: 'DBG',
    info: 'INF',
    warn: 'WRN',
    error: 'ERR',
    fatal: 'FTL'
}

function stringifyFieldValue(value) {
    if (value === null || value === undefined || value === '') return ''
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    if (typeof value === 'string') {
        return /\s/.test(value) ? JSON.stringify(value) : value
    }
    return JSON.stringify(value)
}

function formatFields(fields = {}) {
    return Object.entries(fields)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => `${key}=${stringifyFieldValue(value)}`)
        .join(' ')
}

function sanitizeScopePart(value) {
    return String(value ?? '')
        .trim()
        .replace(/\s+/g, '_')
        .replace(/[\[\]]/g, '')
}

function createScope(kind, ...parts) {
    const normalizedKind = sanitizeScopePart(kind || 'scope') || 'scope'
    const normalizedParts = parts
        .map(sanitizeScopePart)
        .filter(Boolean)
    return `${normalizedKind}:${normalizedParts.join(':')}`
}

function createMessageScope(groupId, userId, messageId) {
    return createScope('msg', groupId || 'unknown', userId || 'unknown', messageId || Date.now())
}

function getErrorMessage(error) {
    if (!error) return ''
    if (typeof error === 'string') return error
    if (error instanceof Error) return error.message
    if (typeof error.message === 'string') return error.message
    try {
        return JSON.stringify(error)
    } catch (_) {
        return String(error)
    }
}

function formatEvent({ level = 'info', channel = 'BOT', scope = '', message = '', fields = {} }) {
    const levelLabel = LEVEL_LABELS[level] || String(level || 'info').toUpperCase().slice(0, 3)
    const channelLabel = String(channel || 'BOT').toUpperCase().padEnd(8)
    const scopeLabel = scope ? `[${scope}] ` : ''
    const fieldsLabel = formatFields(fields)
    return `${levelLabel} ${channelLabel} ${scopeLabel}${message}${fieldsLabel ? ` ${fieldsLabel}` : ''}`
}

log4js.configure({
    appenders: {
        out: {
            type: 'stdout',
            layout: {
                type: 'pattern',
                pattern: '%m'
            }
        },
        app: {
            type: 'dateFile',
            filename: 'logs/application.log',
            pattern: '.yyyy-MM-dd',
            compress: true,
            numBackups: 7,
            keepFileExt: true
        },
        stream: {
            type: {
                configure: (config, layouts) => {
                    return (loggingEvent) => {
                        const logData = {
                            timestamp: loggingEvent.startTime,
                            level: loggingEvent.level.levelStr,
                            message: loggingEvent.data.map(d =>
                                (typeof d === 'object') ? JSON.stringify(d) : String(d)
                            ).join(' ')
                        };
                        listeners.forEach(cb => cb(logData));
                    };
                }
            }
        }
    },
    categories: {
        default: { appenders: ['out', 'app', 'stream'], level: 'info' }
    }
});

const logger = log4js.getLogger();

logger.formatEvent = formatEvent
logger.createScope = createScope
logger.createMessageScope = createMessageScope
logger.getErrorMessage = getErrorMessage
logger.logEvent = (level, channel, scope, message, fields = {}) => {
    const method = typeof logger[level] === 'function' ? level : 'info'
    logger[method](formatEvent({ level: method, channel, scope, message, fields }))
}
logger.onLog = (callback) => {
    listeners.add(callback);
    return () => listeners.delete(callback);
};

module.exports = logger;
