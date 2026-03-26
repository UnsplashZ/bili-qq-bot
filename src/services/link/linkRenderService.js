'use strict'

const imageGenerator = require('../imageGenerator')
const logger = require('../../utils/logger')

async function prepare(handler, info, descriptor, groupId) {
    const url = handler.buildUrl(descriptor, info)
    const cardType = handler.resolveCardType(info, descriptor)

    if (!url || !cardType) {
        return {
            status: 'render_failed',
            url,
            cardType
        }
    }

    try {
        const base64Image = await imageGenerator.generatePreviewCard(info, cardType, groupId)
        return {
            status: 'card_ready',
            url,
            cardType,
            base64Image
        }
    } catch (error) {
        return {
            status: 'fallback_text_ready',
            url,
            cardType,
            reason: 'preview_generation_failed',
            error: logger.getErrorMessage(error),
            text: `预览生成失败，已降级为文本链接：\n${url}`
        }
    }
}

module.exports = {
    prepare
}
