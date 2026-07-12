'use strict'

const notificationService = require('../notificationService')

async function sendPrepared(ws, groupId, prepared, userId = null, options = {}) {
    const sendGroupMessage = options.sendGroupMessage || defaultSendGroupMessage
    const sendGroupMessageWithFallback = options.sendGroupMessageWithFallback || defaultSendGroupMessageWithFallback

    if (prepared.status === 'card_ready') {
        return sendGroupMessageWithFallback(ws, groupId, prepared.base64Image, prepared.url, userId, options.logContext || null)
    }

    const text = prepared.text || `获取信息失败，已降级为文本链接：\n${prepared.url}`
    return sendGroupMessage(ws, groupId, [{
        type: 'text',
        data: { text }
    }], userId)
}

async function defaultSendGroupMessageWithFallback(ws, groupId, base64Image, url, userId = null) {
    return defaultSendGroupMessage(ws, groupId, [
        { type: 'image', data: { file: `base64://${base64Image}` } },
        { type: 'text', data: { text: `${url}` } }
    ], userId)
}

async function defaultSendGroupMessage(ws, groupId, messageChain, userId = null) {
    if (typeof groupId === 'string' && groupId.startsWith('private_')) {
        const realUserId = groupId.replace('private_', '')
        await notificationService.sendPrivateMessage(ws, realUserId, messageChain, 'LinkHandler', true)
        return
    }

    if (groupId) {
        await notificationService.sendGroupMessage(ws, groupId, messageChain, 'LinkHandler', true)
        return
    }

    if (userId) {
        await notificationService.sendPrivateMessage(ws, userId, messageChain, 'LinkHandler', true)
    }
}

module.exports = {
    sendPrepared
}
