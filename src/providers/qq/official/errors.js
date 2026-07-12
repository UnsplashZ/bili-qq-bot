class OfficialOpenApiError extends Error {
    constructor(message, options = {}) {
        super(message)
        this.name = 'OfficialOpenApiError'
        this.httpStatus = options.httpStatus || 0
        this.qqCode = options.qqCode ?? null
        this.category = options.category || classifyHttpStatus(this.httpStatus)
        this.retryable = options.retryable ?? isRetryableStatus(this.httpStatus)
        this.retryAfterMs = options.retryAfterMs || 0
        this.path = options.path || ''
        this.method = options.method || ''
    }
}

function isRetryableStatus(status) {
    return status === 429 || status === 500 || status === 502 || status === 503 || status === 504
}

function classifyHttpStatus(status) {
    if (status === 401 || status === 403) return 'auth'
    if (status === 404) return 'not_found'
    if (status === 429) return 'rate_limited'
    if (isRetryableStatus(status)) return 'retryable'
    if (status >= 400) return 'request_failed'
    return 'unknown'
}

function parseRetryAfterMs(value) {
    if (!value) return 0
    const seconds = Number(value)
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
    const dateMs = Date.parse(value)
    if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now())
    return 0
}

module.exports = {
    OfficialOpenApiError,
    classifyHttpStatus,
    isRetryableStatus,
    parseRetryAfterMs
}
