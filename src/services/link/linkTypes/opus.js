'use strict'

const biliApi = require('../../biliApi')

module.exports = {
    type: 'opus',
    async fetch(groupId, descriptor) {
        return biliApi.getOpusInfo(descriptor.id, groupId)
    },
    buildUrl(descriptor) {
        return `https://www.bilibili.com/opus/${descriptor.id}`
    },
    resolveCardType(info) {
        return info.type || 'opus'
    }
}
