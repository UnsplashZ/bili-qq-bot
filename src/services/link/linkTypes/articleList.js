'use strict'

const biliApi = require('../../biliApi')

module.exports = {
    type: 'article_list',
    async fetch(groupId, descriptor) {
        return biliApi.getArticleListInfo(descriptor.id, groupId)
    },
    buildUrl(descriptor) {
        return descriptor.meta?.url || `https://www.bilibili.com/read/readlist/rl${descriptor.id}`
    },
    resolveCardType() {
        return 'article_list'
    }
}
