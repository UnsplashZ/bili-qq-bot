'use strict'

const biliApi = require('../../biliApi')

module.exports = {
    type: 'dynamic',
    async fetch(groupId, descriptor) {
        return biliApi.getDynamicInfo(descriptor.id, groupId)
    },
    buildUrl(descriptor) {
        return `https://t.bilibili.com/${descriptor.id}`
    },
    resolveCardType(info) {
        return info.type || 'dynamic'
    }
}
