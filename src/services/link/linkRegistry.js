'use strict'

const video = require('./linkTypes/video')
const bangumi = require('./linkTypes/bangumi')
const dynamic = require('./linkTypes/dynamic')
const article = require('./linkTypes/article')
const live = require('./linkTypes/live')
const opus = require('./linkTypes/opus')
const ep = require('./linkTypes/ep')
const media = require('./linkTypes/media')

const handlers = new Map([
    video,
    bangumi,
    dynamic,
    article,
    live,
    opus,
    ep,
    media
].map((handler) => [handler.type, handler]))

function getHandler(type) {
    return handlers.get(type) || null
}

module.exports = {
    getHandler
}
