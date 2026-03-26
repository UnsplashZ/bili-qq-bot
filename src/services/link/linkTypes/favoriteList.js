'use strict'

const biliApi = require('../../biliApi')

module.exports = {
    type: 'favorite_list',
    getCacheIdentity(descriptor) {
        return descriptor.meta?.uniqueId || descriptor.id
    },
    async fetch(groupId, descriptor) {
        const favoriteType = descriptor.meta?.favoriteType || 'video'
        const mediaId = favoriteType === 'video' ? (descriptor.meta?.mediaId ?? descriptor.id) : null
        return biliApi.getFavoriteListInfo(mediaId, groupId, favoriteType)
    },
    buildUrl(descriptor) {
        const favoriteType = descriptor.meta?.favoriteType || 'video'
        const mediaId = descriptor.meta?.mediaId ?? descriptor.id

        if (descriptor.meta?.url) {
            return descriptor.meta.url
        }

        if (favoriteType === 'video' && mediaId) {
            return `https://www.bilibili.com/medialist/detail/ml${mediaId}`
        }

        return descriptor.match || null
    },
    resolveCardType() {
        return 'favorite_list'
    }
}
