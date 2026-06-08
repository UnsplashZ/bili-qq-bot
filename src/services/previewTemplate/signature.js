'use strict'

const crypto = require('crypto')
const { stableStringify } = require('./merge')
const { normalizeTemplate } = require('./normalizer')

function signTemplate(template) {
    if (!template) return 'default'
    return crypto.createHash('sha256').update(stableStringify(template)).digest('hex').slice(0, 16)
}

function getPreviewTemplateSignature(type, template) {
    if (!template) return 'default'
    const normalized = normalizeTemplate(template, { type, checkSize: false })
    return signTemplate(normalized)
}

module.exports = {
    signTemplate,
    getPreviewTemplateSignature
}
