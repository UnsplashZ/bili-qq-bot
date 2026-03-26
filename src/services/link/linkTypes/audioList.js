'use strict'

const biliApi = require('../../biliApi')

module.exports = {
    type: 'audio_list',
    async fetch(groupId, descriptor) {
        return biliApi.getAudioListInfo(descriptor.id, groupId)
    },
    buildUrl(descriptor) {
        return descriptor.meta?.url || `https://www.bilibili.com/audio/am${descriptor.id}`
    },
    resolveCardType() {
        return 'audio_list'
    }
}
