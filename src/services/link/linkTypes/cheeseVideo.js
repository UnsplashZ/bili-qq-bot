'use strict'

const biliApi = require('../../biliApi')

module.exports = {
    type: 'cheese_video',
    getCacheIdentity(descriptor) {
        return descriptor.meta?.uniqueId || descriptor.id
    },
    async fetch(groupId, descriptor) {
        return biliApi.getCheeseVideoInfo(
            descriptor.meta?.epId || null,
            descriptor.meta?.seasonId || null,
            groupId
        )
    },
    buildUrl(descriptor) {
        if (descriptor.meta?.url) {
            return descriptor.meta.url
        }

        if (descriptor.meta?.epId) {
            return `https://www.bilibili.com/cheese/play/ep${descriptor.meta.epId}`
        }

        return `https://www.bilibili.com/cheese/play/ss${descriptor.meta?.seasonId || descriptor.id}`
    },
    resolveCardType() {
        return 'cheese_video'
    }
}
