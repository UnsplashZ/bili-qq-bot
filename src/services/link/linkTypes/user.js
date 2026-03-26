'use strict'

const biliApi = require('../../biliApi')
const config = require('../../../config')
const imageGenerator = require('../../imageGenerator')
const logger = require('../../../utils/logger')

module.exports = {
    type: 'user',
    async fetch(groupId, descriptor) {
        return biliApi.getUserInfo(descriptor.id, groupId)
    },
    buildUrl(descriptor) {
        return `https://space.bilibili.com/${descriptor.id}`
    },
    resolveCardType() {
        return 'user'
    },
    buildFetchFailureText(info, descriptor) {
        const errorMsg = info?.message || '无法获取用户信息'
        return `获取用户失败: ${errorMsg}\nhttps://space.bilibili.com/${descriptor.id}`
    },
    async prepareRender({ info, descriptor, groupId }) {
        const url = `https://space.bilibili.com/${descriptor.id}`

        try {
            const showId = config.getGroupConfig(groupId, 'showId')
            const base64Image = await imageGenerator.generatePreviewCard(info, 'user', groupId, showId)
            return {
                status: 'card_ready',
                url,
                cardType: 'user',
                base64Image
            }
        } catch (error) {
            return {
                status: 'fallback_text_ready',
                url,
                cardType: 'user',
                reason: 'preview_generation_failed',
                error: logger.getErrorMessage(error),
                text: url
            }
        }
    }
}
