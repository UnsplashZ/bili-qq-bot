'use strict'

const { classifyResponseModeHint } = require('./agent/responseModeClassifier')

function classifyResponseMode(input) {
    return classifyResponseModeHint(input)
}

module.exports = {
    classifyResponseMode,
    classifyResponseModeHint
}
