'use strict'

const biliApi = require('../../biliApi')

module.exports = {
    type: 'topic',
    async fetch(groupId, descriptor) {
        return biliApi.getTopicInfo(descriptor.id, groupId)
    },
    buildUrl(descriptor) {
        return descriptor.meta?.url || `https://www.bilibili.com/v/topic/detail/?topic_id=${descriptor.id}`
    },
    resolveCardType() {
        return 'topic'
    }
}
