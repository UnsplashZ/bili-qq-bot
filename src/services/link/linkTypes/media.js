'use strict'

const biliApi = require('../../biliApi')

module.exports = {
    type: 'media',
    async fetch(groupId, descriptor) {
        return biliApi.getMediaInfo(descriptor.id, groupId)
    },
    buildUrl(descriptor) {
        return `https://www.bilibili.com/bangumi/media/md${descriptor.id}`
    },
    resolveCardType() {
        return 'bangumi'
    }
}
