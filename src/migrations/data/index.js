'use strict'

const { scanDataInventory, compareDataInventories } = require('./inventory')
const { DataMigrationRegistry, createValidationMigrator, createJsonFileMigrator } = require('./registry')

module.exports = {
    scanDataInventory,
    compareDataInventories,
    DataMigrationRegistry,
    createValidationMigrator,
    createJsonFileMigrator
}
