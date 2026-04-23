'use strict'

const { recognizeBotControlShortcut } = require('./botControl/naturalLanguageShortcutParser')

function recognizeNaturalLanguageBotControlAction(rawMessage, options = {}) {
    return recognizeBotControlShortcut(rawMessage, options)
}

module.exports = {
    recognizeNaturalLanguageBotControlAction,
    recognizeBotControlShortcut
}
