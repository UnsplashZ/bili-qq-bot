'use strict'

const biliApi = require('../../biliApi')

module.exports = {
    type: 'article',
    async fetch(groupId, descriptor) {
        return biliApi.getArticleInfo(descriptor.id, groupId)
    },
    buildUrl(descriptor, info) {
        return info.data?.canonical_url || `https://www.bilibili.com/read/cv${descriptor.id}`
    },
    resolveCardType() {
        return 'article'
    }
}
