const UpdateChecker = require('./UpdateChecker')
const { resolveArticleTitle } = require('./helpers/article')

const lifecycleMethods = require('./modules/lifecycle')
const targetingMethods = require('./modules/targeting')
const feedMethods = require('./modules/feed')
const manualCheckMethods = require('./modules/manualChecks')
const unifiedCheckMethods = require('./modules/unifiedChecks')
const atAllMethods = require('./modules/atAll')
const notifyMethods = require('./modules/notify')
const maintenanceMethods = require('./modules/maintenance')

Object.assign(
    UpdateChecker.prototype,
    lifecycleMethods,
    targetingMethods,
    feedMethods,
    manualCheckMethods,
    unifiedCheckMethods,
    atAllMethods,
    notifyMethods,
    maintenanceMethods
)

const updateCheckerInstance = new UpdateChecker()

module.exports = updateCheckerInstance
module.exports.resolveArticleTitle = resolveArticleTitle
