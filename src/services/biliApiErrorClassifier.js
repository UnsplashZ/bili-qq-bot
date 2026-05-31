'use strict'

const ERROR_TYPES = new Set([
    'auth_failed',
    'transient_network',
    'rate_limited',
    'server_error',
    'unknown'
])

const AUTH_BILI_CODES = new Set([-101, -102, -111, -112])
const RATE_LIMIT_BILI_CODES = new Set([-412, 412])
const NETWORK_CODES = new Set([
    'ECONNABORTED',
    'ETIMEDOUT',
    'ESOCKETTIMEDOUT',
    'ECONNRESET',
    'ECONNREFUSED',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ENOTFOUND',
    'EAI_AGAIN',
    'ERR_NETWORK'
])

function firstDefined(...values) {
    return values.find((value) => value !== undefined && value !== null && value !== '')
}

function toNumberOrNull(value) {
    if (value === undefined || value === null || value === '') return null
    const normalized = Number(value)
    return Number.isFinite(normalized) ? normalized : null
}

function pickPayload(error) {
    if (!error || typeof error !== 'object') return {}
    if (error.response && error.response.data && typeof error.response.data === 'object') {
        return error.response.data
    }
    if (error.data && typeof error.data === 'object') {
        return error.data
    }
    return error
}

function hasText(text, patterns) {
    const value = String(text || '').toLowerCase()
    return patterns.some((pattern) => value.includes(pattern))
}

function retryableFor(errorType) {
    return errorType === 'transient_network' || errorType === 'rate_limited' || errorType === 'server_error'
}

function normalizeStructuredType(value) {
    const normalized = String(value || '').trim()
    return ERROR_TYPES.has(normalized) ? normalized : null
}

function classifyBiliApiError(error) {
    const payload = pickPayload(error)
    const response = error && typeof error === 'object' ? error.response : null
    const code = firstDefined(error?.code, payload.code)
    const biliCode = toNumberOrNull(firstDefined(payload.biliCode, payload.bili_code, payload.retcode))
    const httpStatus = toNumberOrNull(firstDefined(payload.httpStatus, payload.http_status, response?.status, error?.status))
    const endpoint = firstDefined(
        payload.endpoint,
        error?.endpoint,
        error?.config?.headers?.['x-rpc-endpoint'],
        error?.config?.url
    )
    const exceptionClass = firstDefined(payload.exceptionClass, payload.exception_class, error?.name)
    const message = String(firstDefined(payload.message, payload.error, error?.message, '') || '')
    const diagnosticText = `${message} ${exceptionClass || ''}`

    const structuredType = normalizeStructuredType(firstDefined(payload.errorType, payload.error_type, payload.failureKind, payload.failure_kind))
    let errorType = structuredType
    let inferredType = null
    const hasNetworkEvidence = NETWORK_CODES.has(String(code || '')) ||
        hasText(diagnosticText, ['timeout', 'timed out', '超时', 'network', 'socket', 'econnreset', 'econnrefused', 'clientconnector', 'clientconnection'])
    const hasAuthEvidence = AUTH_BILI_CODES.has(biliCode) ||
        hasText(message, ['未登录', 'cookie', 'credential', 'csrf', 'sessdata', 'login'])

    if (AUTH_BILI_CODES.has(biliCode)) {
        inferredType = 'auth_failed'
    } else if (RATE_LIMIT_BILI_CODES.has(biliCode) || httpStatus === 429 || hasText(message, ['rate limit', 'too many requests', '请求过于频繁', '风控'])) {
        inferredType = 'rate_limited'
    } else if (hasNetworkEvidence) {
        inferredType = 'transient_network'
    } else if (hasAuthEvidence) {
        inferredType = 'auth_failed'
    } else if (httpStatus !== null && httpStatus >= 500) {
        inferredType = 'server_error'
    } else {
        inferredType = 'unknown'
    }

    const correctedStructuredUnknown = errorType === 'unknown' && inferredType !== 'unknown'
    if (!errorType || correctedStructuredUnknown) {
        errorType = inferredType
    }

    const retryable = typeof payload.retryable === 'boolean' && !correctedStructuredUnknown
        ? payload.retryable
        : retryableFor(errorType)

    return {
        errorType,
        failureKind: errorType,
        retryable,
        biliCode,
        httpStatus,
        endpoint: endpoint ? String(endpoint) : null,
        exceptionClass: exceptionClass ? String(exceptionClass) : null,
        code: code ? String(code) : null,
        message
    }
}

module.exports = {
    classifyBiliApiError
}
