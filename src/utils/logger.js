const log4js = require('log4js');
const { redactSensitive, redactString } = require('./redactSensitive');

const listeners = new Set();
const LEVEL_LABELS = {
    trace: 'TRC',
    debug: 'DBG',
    info: 'INF',
    warn: 'WRN',
    error: 'ERR',
    fatal: 'FTL'
}
const SEVERITY_BY_LEVEL = {
    trace: 10,
    debug: 20,
    info: 30,
    warn: 40,
    error: 50,
    fatal: 60
}
const CHANNEL_WIDTH = 8
const ANSI_BY_LEVEL = {
    trace: '\x1b[90m',
    debug: '\x1b[36m',
    info: '\x1b[32m',
    warn: '\x1b[33m',
    error: '\x1b[31m',
    fatal: '\x1b[97;41m'
}
const ANSI_RESET = '\x1b[0m'

function normalizeLevel(level) {
    const normalized = String(level || 'info').toLowerCase()
    return LEVEL_LABELS[normalized] ? normalized : 'info'
}

function pad2(value) {
    return String(value).padStart(2, '0')
}

function formatTimestamp(date) {
    const value = date instanceof Date ? date : new Date(date)
    return [
        value.getFullYear(),
        pad2(value.getMonth() + 1),
        pad2(value.getDate())
    ].join('/') + ' ' + [
        pad2(value.getHours()),
        pad2(value.getMinutes()),
        pad2(value.getSeconds())
    ].join(':')
}

function parseBoolean(value, fallback = false) {
    if (value === undefined || value === null || value === '') return fallback
    if (typeof value === 'boolean') return value
    const normalized = String(value).trim().toLowerCase()
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false
    return fallback
}

function parseCsvSet(value) {
    if (!value) return null
    const entries = String(value)
        .split(',')
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean)
    return entries.length > 0 ? new Set(entries) : null
}

function parseLoggerEnv(env = {}) {
    const minLevel = normalizeLevel(env.LOG_LEVEL || 'info')
    return {
        minLevel,
        minSeverity: SEVERITY_BY_LEVEL[minLevel],
        includeChannels: parseCsvSet(env.LOG_CHANNELS),
        excludeChannels: parseCsvSet(env.LOG_EXCLUDE_CHANNELS),
        color: parseBoolean(env.LOG_COLOR, false),
        timestamp: parseBoolean(env.LOG_TIMESTAMP, false),
        pretty: parseBoolean(env.LOG_PRETTY, true),
        stacks: String(env.LOG_STACKS || 'error').trim().toLowerCase(),
        bufferSize: Number.parseInt(env.LOG_BUFFER_SIZE || '2000', 10) || 2000
    }
}

function normalizeLoggerConfig(config = {}) {
    const minLevel = normalizeLevel(config.level || config.minLevel || 'info')
    const toChannelSet = (value) => {
        if (!value) return null
        const items = Array.isArray(value) ? value : String(value).split(',')
        const normalized = items.map((item) => String(item).trim().toUpperCase()).filter(Boolean)
        return normalized.length > 0 ? new Set(normalized) : null
    }
    const stacks = String(config.stacks || 'error').trim().toLowerCase()
    return {
        minLevel,
        minSeverity: SEVERITY_BY_LEVEL[minLevel],
        includeChannels: toChannelSet(config.channels || config.includeChannels),
        excludeChannels: toChannelSet(config.excludeChannels),
        color: parseBoolean(config.color, false),
        timestamp: parseBoolean(config.timestamp, false),
        pretty: parseBoolean(config.pretty, true),
        stacks: stacks === 'always' ? 'all' : (stacks === 'never' ? 'never' : stacks),
        bufferSize: Math.max(1, Number.parseInt(config.bufferSize || '2000', 10) || 2000)
    }
}

let activeFormatOptions = normalizeLoggerConfig()

function colorize(value, level, enabled) {
    if (!enabled) return value
    const prefix = ANSI_BY_LEVEL[normalizeLevel(level)]
    return prefix ? `${prefix}${value}${ANSI_RESET}` : value
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
    const safeFields = redactSensitive(fields)
    return Object.entries(safeFields)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => `${key}=${stringifyFieldValue(value)}`)
        .join(' ')
}

function splitDisplayFields(fields = {}) {
    const summaryFields = { ...fields }
    const stackText = typeof summaryFields.stack === 'string'
        ? summaryFields.stack
        : typeof summaryFields.traceback === 'string'
            ? summaryFields.traceback
            : ''

    delete summaryFields.stack
    delete summaryFields.traceback

    return { summaryFields, stackText }
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
    if (typeof error === 'string') return redactString(error)
    if (error instanceof Error) return redactString(error.message)
    if (typeof error.message === 'string') return redactString(error.message)
    try {
        return redactString(JSON.stringify(redactSensitive(error)))
    } catch (_) {
        return redactString(String(error))
    }
}

function formatEvent({ level = 'info', channel = 'BOT', scope = '', message = '', fields = {}, timestamp = new Date() }, options = activeFormatOptions) {
    const normalizedLevel = normalizeLevel(level)
    const levelLabel = LEVEL_LABELS[normalizedLevel] || String(normalizedLevel).toUpperCase().slice(0, 3)
    const channelText = String(channel || 'BOT').toUpperCase()
    const scopeLabel = scope ? `[${scope}] ` : ''
    const { summaryFields, stackText } = splitDisplayFields(fields)
    const fieldsLabel = formatFields(summaryFields)
    const prefixParts = []

    if (options.timestamp) {
        prefixParts.push(formatTimestamp(timestamp))
    }

    prefixParts.push(colorize(levelLabel, normalizedLevel, options.color))
    prefixParts.push(channelText.padEnd(CHANNEL_WIDTH))

    const body = `${scopeLabel}${message}${fieldsLabel ? ` ${fieldsLabel}` : ''}`

    if (!options.pretty) {
        return JSON.stringify({
            timestamp: formatTimestamp(timestamp),
            level: normalizedLevel,
            channel: channelText,
            scope,
            action: message,
            fields: redactSensitive(fields)
        })
    }

    const summary = `${prefixParts.join(' ')} ${body}`.trimEnd()
    const shouldShowStack = Boolean(stackText) && (
        options.stacks === 'all' ||
        (options.stacks === 'error' && SEVERITY_BY_LEVEL[normalizedLevel] >= SEVERITY_BY_LEVEL.error)
    )

    if (!shouldShowStack) {
        return summary
    }

    const stackBlock = stackText
        .split('\n')
        .map((line) => `    ${String(line).trimStart()}`)
        .join('\n')

    return `${summary}\n${stackBlock}`
}

function buildEvent(level, channel, scope, message, fields = {}) {
    const normalizedLevel = normalizeLevel(level)
    const eventTimestamp = new Date()
    const formatOptions = activeFormatOptions
    const cleanFormatOptions = { ...formatOptions, color: false }
    const event = {
        timestamp: eventTimestamp,
        timestampText: formatTimestamp(eventTimestamp),
        level: normalizedLevel,
        severity: SEVERITY_BY_LEVEL[normalizedLevel],
        channel: String(channel || 'BOT').toUpperCase(),
        scope: scope || '',
        action: message || '',
        fields: redactSensitive(fields || {})
    }
    event.rendered = formatEvent({
        level: event.level,
        channel: event.channel,
        scope: event.scope,
        message: event.action,
        fields: event.fields,
        timestamp: event.timestamp
    }, cleanFormatOptions)
    event.message = event.rendered
    return event
}

function shouldEmitToStdout(event, env = activeFormatOptions) {
    if (event.severity < env.minSeverity) {
        return false
    }
    if (env.includeChannels && !env.includeChannels.has(event.channel)) {
        return false
    }
    if (env.excludeChannels && env.excludeChannels.has(event.channel)) {
        return false
    }
    return true
}

log4js.configure({
    appenders: {
        app: {
            type: 'dateFile',
            filename: 'logs/application.log',
            pattern: '.yyyy-MM-dd',
            compress: true,
            numBackups: 7,
            keepFileExt: true,
            layout: {
                type: 'pattern',
                pattern: '%m'
            }
        }
    },
    categories: {
        default: { appenders: ['app'], level: 'trace' }
    }
});

const logger = log4js.getLogger();

logger.parseLoggerEnv = parseLoggerEnv
logger.normalizeLoggerConfig = normalizeLoggerConfig
logger.reconfigure = (config = {}) => {
    activeFormatOptions = normalizeLoggerConfig(config)
    return { ...activeFormatOptions }
}
logger.getRuntimeOptions = () => ({ ...activeFormatOptions })
logger.formatTimestamp = formatTimestamp
logger.formatEvent = formatEvent
logger.createScope = createScope
logger.createMessageScope = createMessageScope
logger.getErrorMessage = getErrorMessage
logger.redactSensitive = redactSensitive
logger.redactString = redactString
logger.shouldEmitToStdout = shouldEmitToStdout
logger.logEvent = (level, channel, scope, message, fields = {}) => {
    const event = buildEvent(level, channel, scope, message, fields)

    listeners.forEach((cb) => cb(event))

    if (shouldEmitToStdout(event)) {
        process.stdout.write(`${formatEvent({
            level: event.level,
            channel: event.channel,
            scope: event.scope,
            message: event.action,
            fields: event.fields,
            timestamp: event.timestamp
        })}\n`)
    }

    logger[event.level](event.rendered)
    return event
}
logger.onLog = (callback) => {
    listeners.add(callback);
    return () => listeners.delete(callback);
};

module.exports = logger;
