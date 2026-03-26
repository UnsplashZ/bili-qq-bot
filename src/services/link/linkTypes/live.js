'use strict'

const biliApi = require('../../biliApi')

module.exports = {
    type: 'live',
    async fetch(groupId, descriptor) {
        return biliApi.getLiveRoomInfo(descriptor.id, groupId)
    },
    buildUrl(descriptor) {
        return `https://live.bilibili.com/${descriptor.id}`
    },
    resolveCardType() {
        return 'live'
    }
}
