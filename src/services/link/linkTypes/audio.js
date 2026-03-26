'use strict'

const biliApi = require('../../biliApi')

module.exports = {
    type: 'audio',
    async fetch(groupId, descriptor) {
        return biliApi.getAudioInfo(descriptor.id, groupId)
    },
    buildUrl(descriptor) {
        return descriptor.meta?.url || `https://www.bilibili.com/audio/au${descriptor.id}`
    },
    resolveCardType() {
        return 'audio'
    }
}
