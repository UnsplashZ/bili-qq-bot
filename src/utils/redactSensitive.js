const DEFAULT_REDACTION = '[REDACTED]'

const SENSITIVE_KEY_RE = /(?:secret|token|authorization|cookie|password|passwd|jwt|session|clientsecret|access[_-]?key|api[_-]?key)/i
const SAFE_STATUS_KEY_RE = /^(?:tokenTtlSeconds|tokenConfigured|refreshInFlight|configured)$/i
const AUTH_VALUE_RE = /\b(?:QQBot|Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g
const ACCESS_TOKEN_PAIR_RE = /\b(access[_-]?token|client[_-]?secret|secret|token|password|jwt|session)\b\s*[:=]\s*["']?[^"',\s}]+/gi

function redactString(value, replacement = DEFAULT_REDACTION) {
    return String(value)
        .replace(AUTH_VALUE_RE, (match) => {
            const prefix = match.split(/\s+/)[0]
            return `${prefix} ${replacement}`
        })
        .replace(JWT_RE, replacement)
        .replace(ACCESS_TOKEN_PAIR_RE, (match, key) => `${key}=${replacement}`)
}

function redactSensitive(value, options = {}, seen = new WeakSet()) {
    const replacement = options.replacement || DEFAULT_REDACTION

    if (value === null || value === undefined) return value
    if (typeof value === 'string') return redactString(value, replacement)
    if (typeof value !== 'object') return value

    if (seen.has(value)) return '[Circular]'
    seen.add(value)

    if (Array.isArray(value)) {
        return value.map((item) => redactSensitive(item, options, seen))
    }

    const output = {}
    for (const [key, entry] of Object.entries(value)) {
        if (SENSITIVE_KEY_RE.test(key) && !SAFE_STATUS_KEY_RE.test(key)) {
            output[key] = replacement
            continue
        }
        output[key] = redactSensitive(entry, options, seen)
    }
    return output
}

module.exports = {
    redactSensitive,
    redactString,
    DEFAULT_REDACTION
}
