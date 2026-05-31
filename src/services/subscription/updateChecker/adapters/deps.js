const subscriptionManager = require('../../subscriptionManager')
const notificationService = require('../../../notificationService')
const biliApi = require('../../../biliApi')
const imageGenerator = require('../../../imageGenerator')
const config = require('../../../../config')
const logger = require('../../../../utils/logger')
const notificationHistory = require('../../../../utils/notificationHistory')

function optionalRequire(path) {
    try {
        return require(path)
    } catch (error) {
        if (error && error.code === 'MODULE_NOT_FOUND') {
            return null
        }
        throw error
    }
}

const subscriptionStateStore = optionalRequire('../../subscriptionStateStore')
const subscriptionDeliveryStore = optionalRequire('../../subscriptionDeliveryStore')

module.exports = {
    subscriptionManager,
    notificationService,
    biliApi,
    imageGenerator,
    config,
    logger,
    notificationHistory,
    subscriptionStateStore,
    subscriptionDeliveryStore
}
