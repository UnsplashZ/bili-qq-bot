const subscriptionManager = require('../../subscriptionManager')
const notificationService = require('../../../notificationService')
const biliApi = require('../../../biliApi')
const imageGenerator = require('../../../imageGenerator')
const config = require('../../../../config')
const logger = require('../../../../utils/logger')
const notificationHistory = require('../../../../utils/notificationHistory')

module.exports = {
    subscriptionManager,
    notificationService,
    biliApi,
    imageGenerator,
    config,
    logger,
    notificationHistory
}
