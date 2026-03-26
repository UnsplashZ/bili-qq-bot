'use strict'

const logger = require('../utils/logger')
const notificationService = require('../services/notificationService')
const linkService = require('../services/link')

const LINK_CACHE_SCOPE = logger.createScope('svc', 'link-cache')

class LinkHandler {
    constructor() {
        this.shortLinkRegex = linkService.shortLinkRegex
        this.requestIdCounter = 0
    }

    generateRequestId() {
        return `LH-${Date.now()}-${++this.requestIdCounter}`
    }

    getScope(traceContext = null) {
        return traceContext?.scope || ''
    }

    log(level, scope, message, fields = {}) {
        logger.logEvent(level, 'LINK', scope, message, fields)
    }

    extractLinks(rawMessage, groupId, traceContext = null) {
        return linkService.extractLinksFromMessage(rawMessage, groupId, traceContext)
    }

    isLinkCached(cacheKey) {
        return linkService.isCached(cacheKey)
    }

    addLinkToCache(cacheKey) {
        return linkService.markProcessed(cacheKey)
    }

    cleanupExpiredCache() {
        return linkService.cleanupExpired()
    }

    async sendGroupMessageWithFallback(ws, groupId, base64Image, url, userId = null, logContext = null) {
        const scope = logContext?.scope || ''
        try {
            this.sendGroupMessage(ws, groupId, [
                { type: 'image', data: { file: `base64://${base64Image}` } },
                { type: 'text', data: { text: `${url}` } }
            ], userId)
            this.log('info', scope, 'message-sent', {
                url,
                requestId: logContext?.requestId || '',
                linkType: logContext?.linkType || '',
                linkId: logContext?.linkId || ''
            })
        } catch (error) {
            this.log('warn', scope, 'fallback-text', {
                url,
                requestId: logContext?.requestId || '',
                linkType: logContext?.linkType || '',
                linkId: logContext?.linkId || '',
                reason: 'message_send_failed',
                error: logger.getErrorMessage(error)
            })
            this.sendGroupMessage(ws, groupId, [{
                type: 'text',
                data: {
                    text: `图片发送失败，已降级为文本链接：\n${url}`
                }
            }], userId)
        }
    }

    sendGroupMessage(ws, groupId, messageChain, userId = null) {
        if (typeof groupId === 'string' && groupId.startsWith('private_')) {
            const realUserId = groupId.replace('private_', '')
            notificationService.sendPrivateMessage(ws, realUserId, messageChain, 'LinkHandler', true)
            return
        }

        if (groupId) {
            notificationService.sendGroupMessage(ws, groupId, messageChain, 'LinkHandler', true)
        } else if (userId) {
            notificationService.sendPrivateMessage(ws, userId, messageChain, 'LinkHandler', true)
        } else {
            this.log('warn', '', 'send-skipped', {
                reason: 'missing_target'
            })
        }
    }

    async processSingleLink(link, ws, groupId, userId = null, traceContext = null) {
        const scope = this.getScope(traceContext)
        const requestId = this.generateRequestId()

        this.log('info', scope, 'fetch-start', {
            requestId,
            linkType: link.type,
            linkId: link.id,
            groupId,
            userId
        })

        const pipelineResult = await linkService.handleIncomingMessageLinks({
            ws,
            groupId,
            userId,
            descriptors: [link],
            traceContext,
            sendGroupMessage: this.sendGroupMessage.bind(this),
            sendGroupMessageWithFallback: this.sendGroupMessageWithFallback.bind(this)
        })

        const result = pipelineResult.results[0]
        if (!result) {
            return null
        }

        if (result.status === 'sent_card') {
            this.log('info', scope, 'card-ready', {
                requestId,
                linkType: link.type,
                linkId: link.id,
                url: result.url
            })
            return result
        }

        if (result.status === 'sent_fallback_text') {
            this.log('warn', scope, 'fallback-text', {
                requestId,
                linkType: link.type,
                linkId: link.id,
                reason: result.reason || result.renderStatus || 'fallback_sent',
                status: result.infoStatus,
                error: result.error || ''
            })
            return result
        }

        if (result.status === 'failed') {
            this.log('error', scope, 'item-failed', {
                requestId,
                linkType: link.type,
                linkId: link.id,
                reason: result.reason || 'pipeline_failed',
                status: result.infoStatus,
                error: result.errorMessage || result.error || ''
            })
            return result
        }

        return result
    }

    async expandUrl(shortUrl) {
        return linkService.expandShortUrl(shortUrl)
    }

    addUrlToCache(url, groupId) {
        if (!url || !groupId) {
            this.log('warn', LINK_CACHE_SCOPE, 'cache-add-skipped', {
                reason: 'missing_url_or_group',
                groupId
            })
            return {
                addedCount: 0,
                cacheKeys: []
            }
        }

        const result = linkService.cacheResolvedText(url, groupId)
        if (result.addedCount === 0) {
            this.log('debug', LINK_CACHE_SCOPE, 'cache-add-skipped', {
                reason: 'no_valid_links',
                groupId
            })
            return result
        }

        for (const cacheKey of result.cacheKeys) {
            this.log('debug', LINK_CACHE_SCOPE, 'cache-added', {
                cacheKey,
                groupId
            })
        }

        return result
    }
}

module.exports = new LinkHandler()
