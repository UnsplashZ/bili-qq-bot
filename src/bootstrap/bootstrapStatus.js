'use strict'

let current = null

function setApplicationBootstrapStatus(status) {
    current = status ? structuredClone(status) : null
}

function getApplicationBootstrapStatus() {
    return current ? structuredClone(current) : null
}

module.exports = { setApplicationBootstrapStatus, getApplicationBootstrapStatus }
