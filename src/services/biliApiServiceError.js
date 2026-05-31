'use strict'

const { classifyBiliApiError } = require('./biliApiErrorClassifier')

function firstDefined(...values) {
    return values.find((value) => value !== undefined && value !== null && value !== '')
}

function pickResponsePayload(error) {
    if (!error || typeof error !== 'object') return null
    if (error.response && error.response.data && typeof error.response.data === 'object') {
        return error.response.data
    }
    if (error.responseData && typeof error.responseData === 'object') {
        return error.responseData
    }
    if (error.data && typeof error.data === 'object') {
        return error.data
    }
    return null
}

function resolveErrorType(payload, classified) {
    const structuredTypes = [
        payload?.errorType,
        payload?.error_type,
        payload?.failureKind,
        payload?.failure_kind
    ].filter((value) => value !== undefined && value !== null && value !== '')
    const explicitType = structuredTypes.find((value) => value !== 'unknown')
    if (explicitType) {
        return explicitType
    }
    return classified.errorType
}

function hasStructuredUnknown(payload) {
    return [
        payload?.errorType,
        payload?.error_type,
        payload?.failureKind,
        payload?.failure_kind
    ].some((value) => value === 'unknown')
}

function normalizeServiceError(error, fallbackEndpoint) {
    const payload = pickResponsePayload(error)
    const classified = classifyBiliApiError(payload && !error?.response?.data
        ? {
            ...error,
            response: {
                status: error?.httpStatus,
                data: payload
            }
        }
        : error)
    const message = String(firstDefined(
        payload?.message,
        payload?.error,
        error?.message,
        'Service communication error'
    ))
    const errorType = resolveErrorType(payload, classified)
    const httpStatus = firstDefined(payload?.httpStatus, payload?.http_status, error?.httpStatus, error?.response?.status, classified.httpStatus)
    const endpoint = firstDefined(payload?.endpoint, error?.endpoint, classified.endpoint, fallbackEndpoint)
    const retryable = errorType === classified.errorType && hasStructuredUnknown(payload)
        ? classified.retryable
        : (typeof payload?.retryable === 'boolean' ? payload.retryable : classified.retryable)
    const biliCode = firstDefined(payload?.biliCode, payload?.bili_code, classified.biliCode)
    const exceptionClass = firstDefined(payload?.exceptionClass, payload?.exception_class, classified.exceptionClass)
    const code = firstDefined(payload?.code, error?.code, classified.code)

    return {
        ...(payload || {}),
        status: 'error',
        message,
        errorType,
        failureKind: errorType,
        retryable,
        endpoint: endpoint ? String(endpoint) : endpoint,
        httpStatus,
        biliCode,
        exceptionClass,
        code
    }
}

module.exports = {
    normalizeServiceError
}
