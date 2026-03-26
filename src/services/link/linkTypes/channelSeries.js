'use strict'

const biliApi = require('../../biliApi')

module.exports = {
    type: 'channel_series',
    getCacheIdentity(descriptor) {
        return descriptor.meta?.uniqueId || descriptor.id
    },
    async fetch(groupId, descriptor) {
        return biliApi.getChannelSeriesInfo(
            descriptor.meta?.uid,
            descriptor.meta?.seriesId || descriptor.id,
            descriptor.meta?.seriesType || 'series',
            groupId
        )
    },
    buildUrl(descriptor) {
        return descriptor.meta?.url || descriptor.match || null
    },
    resolveCardType() {
        return 'channel_series'
    }
}
