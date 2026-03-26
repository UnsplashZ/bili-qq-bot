'use strict'

const logger = require('../../utils/logger')
const linkRegistry = require('./linkRegistry')
const linkFetchService = require('./linkFetchService')
const linkRenderService = require('./linkRenderService')
const linkSender = require('./linkSender')
const linkCacheService = require('./linkCacheService')

function buildDescriptorCacheKey(descriptor, groupId, handler = null) {
    if (!descriptor || typeof descriptor !== 'object') {
        return null
    }

    if (descriptor.cacheKey) {
        return String(descriptor.cacheKey)
    }

    if (!descriptor.type) {
        return null
    }

    const uniqueId = (handler && typeof handler.getCacheIdentity === 'function'
        ? handler.getCacheIdentity(descriptor)
        : null)
        || descriptor.meta?.uniqueId
        || descriptor.id
        || descriptor.sourceToken
        || descriptor.match
        || descriptor.type

    if (!uniqueId) {
        return null
    }

    const resolvedGroupId = descriptor.groupId || groupId
    return resolvedGroupId
        ? `${descriptor.type}|${uniqueId}|${resolvedGroupId}`
        : `${descriptor.type}|${uniqueId}`
}

async function sendFallbackText(descriptor, url, text, context, options) {
    const sendGroupMessage = options.sendGroupMessage || defaultSendGroupMessage

    await sendGroupMessage(context.ws, context.groupId, [{
        type: 'text',
        data: {
            text: text || `获取信息失败，已降级为文本链接：\n${url}`
        }
    }], context.userId)

    return {
        status: 'sent_fallback_text',
        url
    }
}

function defaultSendGroupMessage() {}

async function prepareRender(handler, info, descriptor, groupId) {
    if (typeof handler.prepareRender === 'function') {
        return handler.prepareRender({
            info,
            descriptor,
            groupId,
            defaultPrepare: (nextInfo = info, nextDescriptor = descriptor, nextGroupId = groupId) => (
                linkRenderService.prepare(handler, nextInfo, nextDescriptor, nextGroupId)
            )
        })
    }

    return linkRenderService.prepare(handler, info, descriptor, groupId)
}

async function runAfterSend(handler, context, options) {
    if (typeof handler.afterSend !== 'function') {
        return
    }

    try {
        await handler.afterSend(context)
    } catch (error) {
        if (typeof options.onAfterSendError === 'function') {
            options.onAfterSendError(context, error)
            return
        }

        logger.error(`[linkPipeline] afterSend failed: ${logger.getErrorMessage(error)}`)
    }
}

async function processDescriptor(descriptor, context, options) {
    const handler = (options.getHandler || linkRegistry.getHandler)(descriptor.type)
    const cacheKey = buildDescriptorCacheKey(descriptor, context.groupId, handler)

    if (!handler) {
        return {
            descriptor,
            cacheKey,
            status: 'failed',
            reason: 'unsupported_type'
        }
    }

    try {
        const { info, fromCache } = await (options.fetchLinkInfo || linkFetchService.fetch)(handler, context.groupId, descriptor, {
            onCacheHit: options.onDataCacheHit
        })
        const fallbackUrl = handler.buildUrl(descriptor, info)

        if (!info || info.status !== 'success') {
            return {
                descriptor,
                cacheKey,
                status: 'failed',
                reason: 'fetch_failed',
                infoStatus: info?.status,
                error: info?.message || '',
                fromDataCache: fromCache
            }
        }

        const prepared = await (options.prepareLinkRender || prepareRender)(handler, info, descriptor, context.groupId)

        if (prepared.status === 'render_failed') {
            if (!prepared.url && !fallbackUrl) {
                return {
                    descriptor,
                    cacheKey,
                    status: 'failed',
                    reason: 'render_failed',
                    renderStatus: prepared.status,
                    cardType: prepared.cardType,
                    infoStatus: info.status,
                    fromDataCache: fromCache
                }
            }

            const targetUrl = prepared.url || fallbackUrl
            const failureText = typeof handler.buildRenderFailureText === 'function'
                ? handler.buildRenderFailureText(prepared, descriptor, info)
                : null
            const sent = await sendFallbackText(descriptor, targetUrl, failureText, context, options)
            linkCacheService.markProcessedDescriptor({ ...descriptor, cacheKey })

            const result = {
                descriptor,
                cacheKey,
                status: sent.status,
                reason: 'render_failed',
                renderStatus: prepared.status,
                cardType: prepared.cardType,
                url: sent.url,
                infoStatus: info.status,
                fromDataCache: fromCache
            }

            await runAfterSend(handler, {
                ...context,
                descriptor,
                info,
                prepared,
                result,
                handler
            }, options)

            return result
        }

        await (options.sendPreparedLink || linkSender.sendPrepared)(context.ws, context.groupId, prepared, context.userId, {
            logContext: options.logContext || null,
            sendGroupMessage: options.sendGroupMessage,
            sendGroupMessageWithFallback: options.sendGroupMessageWithFallback
        })

        linkCacheService.markProcessedDescriptor({ ...descriptor, cacheKey })

        const result = {
            descriptor,
            cacheKey,
            status: prepared.status === 'card_ready' ? 'sent_card' : 'sent_fallback_text',
            renderStatus: prepared.status,
            cardType: prepared.cardType,
            url: prepared.url,
            infoStatus: info.status,
            fromDataCache: fromCache
        }

        await runAfterSend(handler, {
            ...context,
            descriptor,
            info,
            prepared,
            result,
            handler
        }, options)

        return result
    } catch (error) {
        return {
            descriptor,
            cacheKey,
            status: 'failed',
            reason: 'pipeline_exception',
            error,
            errorMessage: logger.getErrorMessage(error)
        }
    }
}

async function processLinkDescriptors(descriptors, context = {}, options = {}) {
    const list = Array.isArray(descriptors) ? descriptors : []
    const uniqueDescriptors = []
    const seenCacheKeys = new Set()

    for (const descriptor of list) {
        const handler = (options.getHandler || linkRegistry.getHandler)(descriptor.type)
        const cacheKey = buildDescriptorCacheKey(descriptor, context.groupId, handler)
        if (cacheKey && seenCacheKeys.has(cacheKey)) {
            continue
        }
        if (cacheKey) {
            seenCacheKeys.add(cacheKey)
        }
        uniqueDescriptors.push({
            descriptor,
            cacheKey
        })
    }

    const results = []
    let skippedCachedCount = 0
    let successCount = 0
    let failureCount = 0

    for (const entry of uniqueDescriptors) {
        if (!options.skipProcessedCacheCheck && entry.cacheKey && linkCacheService.isCached(entry.cacheKey)) {
            skippedCachedCount += 1
            results.push({
                descriptor: entry.descriptor,
                cacheKey: entry.cacheKey,
                status: 'cached'
            })
            continue
        }

        const result = await processDescriptor(entry.descriptor, context, options)
        results.push(result)

        if (result.status === 'sent_card' || result.status === 'sent_fallback_text') {
            successCount += 1
        } else if (result.status === 'failed') {
            failureCount += 1
        }
    }

    return {
        allCached: uniqueDescriptors.length > 0 && skippedCachedCount === uniqueDescriptors.length,
        foundCount: list.length,
        skippedCachedCount,
        successCount,
        failureCount,
        results
    }
}

module.exports = {
    processLinkDescriptors
}
