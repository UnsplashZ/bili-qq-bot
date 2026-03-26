'use strict'

const biliApi = require('../../biliApi')

module.exports = {
    type: 'ep',
    async fetch(groupId, descriptor) {
        return biliApi.getEpInfo(descriptor.id, groupId)
    },
    buildUrl(descriptor) {
        return `https://www.bilibili.com/bangumi/play/ep${descriptor.id}`
    },
    resolveCardType() {
        return 'bangumi'
    }
}
