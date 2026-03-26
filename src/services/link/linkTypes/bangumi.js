'use strict'

const biliApi = require('../../biliApi')

module.exports = {
    type: 'bangumi',
    async fetch(groupId, descriptor) {
        return biliApi.getBangumiInfo(descriptor.id, groupId)
    },
    buildUrl(descriptor) {
        return `https://www.bilibili.com/bangumi/play/ss${descriptor.id}`
    },
    resolveCardType() {
        return 'bangumi'
    }
}
