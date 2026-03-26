'use strict'

const biliApi = require('../../biliApi')

module.exports = {
    type: 'note',
    async fetch(groupId, descriptor) {
        return biliApi.getNoteInfo(descriptor.id, groupId)
    },
    buildUrl(descriptor) {
        return descriptor.meta?.url || `https://www.bilibili.com/h5/note-app/view?cvid=${descriptor.id}`
    },
    resolveCardType() {
        return 'note'
    }
}
