'use strict'

const biliApi = require('../../biliApi')
const videoDownloadService = require('../../videoDownloadService')

module.exports = {
    type: 'video',
    async fetch(groupId, descriptor) {
        return biliApi.getVideoInfo(descriptor.id, groupId)
    },
    buildUrl(descriptor) {
        return `https://www.bilibili.com/video/${descriptor.id}`
    },
    resolveCardType(info) {
        return info.type || 'video'
    },
    async afterSend(context) {
        if ((context.info.type || 'video') !== 'video') {
            return
        }

        await videoDownloadService.downloadAndSend(context.ws, context.groupId, context.descriptor.id, context.info)
    }
}
