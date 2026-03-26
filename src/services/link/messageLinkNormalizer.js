'use strict'

const logger = require('../../utils/logger')

function getJsonUrl(jsonData) {
    return jsonData?.meta?.detail_1?.qqdocurl
        || jsonData?.meta?.detail_1?.url
        || jsonData?.meta?.news?.jumpUrl
        || jsonData?.meta?.detail?.qqdocurl
        || jsonData?.meta?.detail?.url
        || jsonData?.prompt
        || jsonData?.meta?.detail_1?.preview
        || jsonData?.url
        || ''
}

function normalizeIncomingMessage({ rawMessage, messageSegments = [], traceContext = null } = {}) {
    let nextRawMessage = typeof rawMessage === 'string' ? rawMessage : String(rawMessage || '')
    const jsonMsg = Array.isArray(messageSegments)
        ? messageSegments.find((segment) => segment?.type === 'json')
        : null

    if (!jsonMsg?.data?.data) {
        return { rawMessage: nextRawMessage }
    }

    try {
        logger.logEvent('info', 'LINK', traceContext?.scope || '', 'json-extract-start')
        const jsonData = JSON.parse(jsonMsg.data.data)
        const url = getJsonUrl(jsonData)
        if (url) {
            logger.logEvent('info', 'LINK', traceContext?.scope || '', 'json-url-found', { url })
            nextRawMessage += ` ${url}`
        } else {
            logger.logEvent('warn', 'LINK', traceContext?.scope || '', 'json-url-missing', {
                preview: JSON.stringify(jsonData).slice(0, 500)
            })
        }
    } catch (error) {
        logger.logEvent('warn', 'LINK', traceContext?.scope || '', 'json-parse-failed', {
            error: logger.getErrorMessage(error)
        })
    }

    return { rawMessage: nextRawMessage }
}

module.exports = {
    normalizeIncomingMessage
}
